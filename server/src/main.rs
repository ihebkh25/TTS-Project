pub mod error;
pub mod validation;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tower::ServiceBuilder;
// Note: tower-governor 0.8 has compatibility issues with Axum 0.7
// Temporarily disabled rate limiting - can be re-enabled with a compatible version
// use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{
    cors::CorsLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing::{info, warn};
use llm_core::{LlmClient, LlmProvider};

use crate::error::ApiError;
use crate::validation::{validate_chat_request, validate_conversation_id, validate_tts_request};

#[derive(Clone)]
pub struct AppState {
    pub tts: Arc<tts_core::TtsManager>,
    pub llm: Arc<std::sync::Mutex<LlmClient>>,
}

// ---- Basic request/response types ----
#[derive(Deserialize)]
struct TtsRequest {
    text: String,
    language: Option<String>,
    speaker: Option<i64>,
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

#[derive(Deserialize)]
struct ChatRequest {
    message: String,
    conversation_id: Option<String>,
}

#[derive(Serialize)]
struct ChatResponse {
    reply: String,
    conversation_id: String,
}

fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // Load environment variables from .env file
    dotenv::dotenv().ok();

    // Create tokio runtime
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async_main())
}

async fn async_main() -> anyhow::Result<()> {
    info!("Starting TTS server...");

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

    info!("Using LLM provider: {:?}, model: {}", provider, model);

    // Init LLM client with optional Qdrant storage
    let llm = if std::env::var("QDRANT_URL").is_ok() {
        info!("Initializing LLM client with Qdrant storage");
        LlmClient::with_storage(provider, &model, None).await?
    } else {
        info!("Initializing LLM client without storage");
        LlmClient::new(provider, &model)?
    };
    let llm = Arc::new(std::sync::Mutex::new(llm));

    // Init TTS
    info!("Loading TTS models...");
    let tts = Arc::new(
        tts_core::TtsManager::new_from_mapfile("models/map.json")
            .unwrap_or_else(|_| tts_core::TtsManager::new(std::collections::HashMap::new())),
    );
    info!("Loaded {} TTS models", tts.list_languages().len());

    let state = AppState { tts, llm };

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    // Configure rate limiting (requests per minute)
    let rate_limit = std::env::var("RATE_LIMIT_PER_MINUTE")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(60);

    info!("Rate limit: {} requests per minute (currently disabled due to compatibility)", rate_limit);

    // Build middleware stack
    // Note: tower-governor 0.8 has compatibility issues with Axum 0.7
    // Rate limiting is temporarily disabled - can be re-enabled with a compatible version
    let middleware_stack = ServiceBuilder::new()
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::new(Duration::from_secs(30)))
        .layer(cors)
        .into_inner();

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/voices", get(list_voices))
        .route("/voices/detail", get(list_voices_detail))
        .route("/tts", post(tts_endpoint))
        .route("/chat", post(chat_endpoint))
        .route("/stream/:lang/:text", get(stream_ws))
        .layer(middleware_stack)
        .with_state(state);

    // Get port from environment variable or default to 8081
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8081);
    let addr: SocketAddr = format!("0.0.0.0:{}", port)
        .parse()
        .map_err(|e| anyhow::anyhow!("Failed to parse address: {}", e))?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| {
            anyhow::anyhow!(
                "Failed to bind to {}: {}. Try a different port by setting PORT environment variable.",
                addr,
                e
            )
        })?;

    info!("Server listening on http://{}", addr);

    axum::serve(listener, app).await?;
    Ok(())
}

pub async fn health_check() -> &'static str {
    "ok"
}

pub async fn list_voices(State(state): State<AppState>) -> Json<Vec<String>> {
    Json(state.tts.list_languages())
}

pub async fn list_voices_detail(State(state): State<AppState>) -> Json<Vec<VoiceInfo>> {
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

pub async fn tts_endpoint(
    State(state): State<AppState>,
    Json(req): Json<TtsRequest>,
) -> Result<Json<TtsResponse>, ApiError> {
    // Validate input
    validate_tts_request(&req.text, req.language.as_deref())?;

    // Synthesize and get sample rate from config
    let (samples, sample_rate) = state
        .tts
        .synthesize_with_sample_rate(&req.text, req.language.as_deref(), req.speaker)
        .map_err(ApiError::TtsError)?;

    // Mel spectrogram
    let sample_rate_f32 = sample_rate as f32;
    let frame_size = 1024usize;
    let hop_size = 256usize;
    let n_mels = 80usize;

    let mel = tts_core::TtsManager::audio_to_mel(
        &samples,
        sample_rate_f32,
        frame_size,
        hop_size,
        n_mels,
    );
    let spectrogram_base64 = tts_core::TtsManager::mel_to_png_base64(&mel);

    // WAV (base64)
    let audio_base64 = tts_core::TtsManager::encode_wav_base64(&samples, sample_rate)
        .map_err(|e| ApiError::TtsError(anyhow::anyhow!("WAV encoding error: {}", e)))?;

    // Calculate duration in milliseconds
    let duration_ms = (samples.len() as f32 / sample_rate_f32 * 1000.0) as u64;

    Ok(Json(TtsResponse {
        audio_base64,
        spectrogram_base64,
        duration_ms,
        sample_rate,
    }))
}

pub async fn chat_endpoint(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, ApiError> {
    // Validate input
    validate_chat_request(&req.message)?;

    // Validate conversation ID if provided
    if let Some(ref conv_id) = req.conversation_id {
        validate_conversation_id(conv_id)?;
    }

    let message = req.message.clone();
    let conversation_id = req.conversation_id.clone();
    let llm = state.llm.clone();

    let (reply, conv_id) = tokio::task::spawn_blocking(move || {
        let llm = llm.lock().unwrap();
        // Use or create conversation ID
        let conv_id = conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let reply = llm
            .chat_with_history(Some(conv_id.clone()), &message)
            .map_err(|e| ApiError::LlmError(format!("LLM error: {}", e)))?;
        Ok::<_, ApiError>((reply, conv_id))
    })
    .await
    .map_err(|e| ApiError::InternalError(format!("Task join error: {}", e)))?
    .map_err(|e| e)?;

    Ok(Json(ChatResponse {
        reply,
        conversation_id: conv_id,
    }))
}

// GET /stream/:lang/:text -> websocket that streams (audio_chunk, mel_frame)
pub async fn stream_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((lang, text)): Path<(String, String)>,
) -> impl IntoResponse {
    // Validate input
    if let Err(e) = validate_tts_request(&text, Some(&lang)) {
        return ws.on_upgrade(move |mut socket| async move {
            use axum::extract::ws::Message;
            let error_msg = serde_json::json!({
                "error": format!("{}", e),
                "code": 400
            });
            let _ = socket.send(Message::Text(error_msg.to_string())).await;
        });
    }

    ws.on_upgrade(move |mut socket| async move {
        use axum::extract::ws::Message;
        use futures_util::{SinkExt, StreamExt};

        // Synthesize full audio once
        let samples = match state.tts.synthesize_blocking(&text, Some(&lang)) {
            Ok(s) => s,
            Err(e) => {
                warn!("TTS synthesis error: {}", e);
                let error_msg = serde_json::json!({
                    "error": format!("TTS error: {}", e),
                    "code": 500
                });
                if let Err(send_err) = socket.send(Message::Text(error_msg.to_string())).await {
                    warn!("Failed to send error message: {}", send_err);
                }
                if let Err(close_err) = socket.close().await {
                    warn!("Failed to close socket: {}", close_err);
                }
                return;
            }
        };

        // Get sample rate from config for the language
        let sample_rate = match state.tts.config_for(Some(&lang)) {
            Ok((cfg_path, _)) => {
                state.tts
                    .get_sample_rate(&cfg_path)
                    .unwrap_or(22050) as f32
            }
            Err(_) => {
                warn!("Failed to get sample rate for language: {}, using default", lang);
                22_050.0f32
            }
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

            if let Err(e) = socket.send(Message::Text(msg.to_string())).await {
                warn!("Failed to send WebSocket message: {}", e);
                break;
            }

            offset += hop_size;
        }

        // Send completion message
        let completion_msg = serde_json::json!({ "status": "complete" });
        if let Err(e) = socket.send(Message::Text(completion_msg.to_string())).await {
            warn!("Failed to send completion message: {}", e);
        }

        // Gracefully close the connection
        if let Err(e) = socket.close().await {
            warn!("Failed to close WebSocket: {}", e);
        }
    })
}
