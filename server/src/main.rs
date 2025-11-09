use std::{net::SocketAddr, sync::{Arc, Mutex}};

use axum::{
    extract::{Path, State, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use llm_core::{LlmClient, LlmProvider};

#[derive(Clone)]
struct AppState {
    tts: Arc<tts_core::TtsManager>,
    llm: Arc<Mutex<LlmClient>>,
}

// ---- Basic request/response types ----
#[derive(Deserialize)]
struct TtsRequest {
    text: String,
    language: Option<String>,
    speaker: Option<i64>, // NEW: optional speaker override
}

#[derive(Serialize)]
struct TtsResponse {
    audio_base64: String,
    spectrogram_base64: String,
    duration_ms: u64,
    sample_rate: u32,
}

#[derive(Serialize)]
struct VoiceInfo {
    key: String,
    config: String,
    speaker: Option<i64>,
}

fn main() -> anyhow::Result<()> {
    // Load environment variables from .env file before creating tokio runtime
    dotenv::dotenv().ok();
    
    // Create tokio runtime
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async_main())
}

async fn async_main() -> anyhow::Result<()> {
    // Determine LLM provider from environment
    let provider = std::env::var("LLM_PROVIDER")
        .ok()
        .and_then(|p| match p.as_str() {
            "ollama" => Some(LlmProvider::Ollama),
            "openai" | _ => Some(LlmProvider::OpenAI),
        })
        .unwrap_or(LlmProvider::OpenAI);
    
    let model = std::env::var("LLM_MODEL")
        .unwrap_or_else(|_| match provider {
            LlmProvider::OpenAI => "gpt-3.5-turbo".to_string(),
            LlmProvider::Ollama => "llama2".to_string(),
        });
    
    // Init LLM client with optional Qdrant storage
    let llm = if std::env::var("QDRANT_URL").is_ok() {
        LlmClient::with_storage(provider, &model, None).await?
    } else {
        LlmClient::new(provider, &model)?
    };
    let llm = Arc::new(Mutex::new(llm));
    // Init TTS:
    // Try to load models/map.json; if missing, fall back to an empty map
    // so env-based defaults (if you wired them) can still work.
    let tts = Arc::new(
        tts_core::TtsManager::new_from_mapfile("models/map.json")
            .unwrap_or_else(|_| tts_core::TtsManager::new(std::collections::HashMap::new())),
    );

    let state = AppState { tts, llm };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/voices", get(list_voices))
        .route("/voices/detail", get(list_voices_detail))
        .route("/tts", post(tts_endpoint))
        .route("/chat", post(chat_endpoint))
        .route("/stream/:lang/:text", get(stream_ws))
        .with_state(state);

    // Get port from environment variable or default to 8081
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8081);
    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()
        .map_err(|e| anyhow::anyhow!("Failed to parse address: {}", e))?;
    
    let listener = TcpListener::bind(addr).await
        .map_err(|e| anyhow::anyhow!("Failed to bind to {}: {}. Try a different port by setting PORT environment variable.", addr, e))?;
    println!("Server listening on http://{}", addr);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn list_voices(State(state): State<AppState>) -> Json<Vec<String>> {
    Json(state.tts.list_languages())
}

async fn list_voices_detail(State(state): State<AppState>) -> Json<Vec<VoiceInfo>> {
    let mut out = Vec::new();
    for (k, (cfg, spk)) in state.tts.map_iter() {
        out.push(VoiceInfo {
            key: k.clone(),
            config: cfg.clone(),
            speaker: *spk,
        });
    }
    Json(out)
}

async fn tts_endpoint(
    State(state): State<AppState>,
    Json(req): Json<TtsRequest>,
) -> Result<Json<TtsResponse>, (StatusCode, String)> {
    // 1) Synthesize and get sample rate from config
    let (samples, sample_rate) = state
        .tts
        .synthesize_with_sample_rate(&req.text, req.language.as_deref(), req.speaker)
        .map_err(internal_err)?;

    // 2) Mel
    let sample_rate_f32 = sample_rate as f32;
    let frame_size = 1024usize;
    let hop_size = 256usize;
    let n_mels = 80usize;

    let mel =
        tts_core::TtsManager::audio_to_mel(&samples, sample_rate_f32, frame_size, hop_size, n_mels);
    let spectrogram_base64 = tts_core::TtsManager::mel_to_png_base64(&mel);

    // 3) WAV (base64)
    let audio_base64 = tts_core::TtsManager::encode_wav_base64(&samples, sample_rate)
        .map_err(internal_err)?;

    // Calculate duration in milliseconds
    let duration_ms = (samples.len() as f32 / sample_rate_f32 * 1000.0) as u64;

    Ok(Json(TtsResponse {
        audio_base64,
        spectrogram_base64,
        duration_ms,
        sample_rate,
    }))
}

#[derive(Deserialize)]
struct ChatRequest {
    message: String,
    conversation_id: Option<String>, // Optional conversation ID for history
}
#[derive(Serialize)]
struct ChatResponse {
    reply: String,
    conversation_id: String, // Return conversation ID for client to use
}

async fn chat_endpoint(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let message = req.message.clone();
    let conversation_id = req.conversation_id.clone();
    let llm = state.llm.clone();
    let (reply, conv_id) = tokio::task::spawn_blocking(move || {
        let llm = llm.lock().unwrap();
        // Use or create conversation ID
        let conv_id = conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let reply = llm.chat_with_history(Some(conv_id.clone()), &message)
            .map_err(|e| format!("LLM error: {}", e))?;
        Ok::<_, String>((reply, conv_id))
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Task join error: {}", e)))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    
    Ok(Json(ChatResponse { 
        reply,
        conversation_id: conv_id,
    }))
}


// GET /stream/:lang/:text -> websocket that streams (audio_chunk, mel_frame)
async fn stream_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((lang, text)): Path<(String, String)>,
) -> impl IntoResponse {
    ws.on_upgrade(move |mut socket| async move {
        use axum::extract::ws::Message;

        // Synthesize full audio once
        let samples = match state.tts.synthesize_blocking(&text, Some(&lang)) {
            Ok(s) => s,
            Err(e) => {
                let _ = socket
                    .send(Message::Text(format!(r#"{{"error":"{}"}}"#, e)))
                    .await;
                return;
            }
        };

        // Get sample rate from config for the language
        let sample_rate = match state.tts.config_for(Some(&lang)) {
            Ok((cfg_path, _)) => {
                state.tts.get_sample_rate(&cfg_path)
                    .unwrap_or(22050) as f32
            }
            Err(_) => 22_050.0f32, // fallback
        };
        
        // Stream mel frames (simple, per-chunk)
        let frame_size = 1024usize;
        let hop_size = 256usize;
        let n_mels = 80usize;

        let mut stft = mel_spec::prelude::Spectrogram::new(frame_size, hop_size);
        let mut mel = mel_spec::prelude::MelSpectrogram::new(frame_size, sample_rate as f64, n_mels);

        let mut offset = 0usize;
        while offset + hop_size <= samples.len() {
            let slice = &samples[offset..offset + hop_size];

            let mel_frame_f64: Vec<f64> = if let Some(fft_frame) = stft.add(slice) {
                let arr_f64 = ndarray::Array1::from_iter(
                    fft_frame.into_iter().map(|c: num_complex::Complex<f64>| c),
                );
                let (flat, _off) = mel.add(&arr_f64).into_raw_vec_and_offset();
                flat
            } else {
                vec![0.0f64; n_mels]
            };

            // downcast to f32 for smaller JSON
            let mel_frame: Vec<f32> = mel_frame_f64.iter().copied().map(|v| v as f32).collect();
            let chunk: Vec<f32> = slice.to_vec();

            let msg = serde_json::json!({ "audio": chunk, "mel": mel_frame });

            if socket.send(Message::Text(msg.to_string())).await.is_err() {
                break;
            }

            offset += hop_size;
        }
    })
}

fn internal_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
