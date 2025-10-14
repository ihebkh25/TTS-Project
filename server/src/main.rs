use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{Path, State, WebSocketUpgrade},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::{net::TcpListener, sync::Mutex};
use llm_core::OpenAiClient;

#[derive(Clone)]
struct AppState {
    tts: Arc<tts_core::TtsManager>,
    llm: Arc<Mutex<OpenAiClient>>,
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
    wav_base64: String,
    spectrogram_base64: String,
}

#[derive(Serialize)]
struct VoiceInfo {
    key: String,
    config: String,
    speaker: Option<i64>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Init TTS:
    // Try to load models/map.json; if missing, fall back to an empty map
    // so env-based defaults (if you wired them) can still work.
    let tts = Arc::new(
        tts_core::TtsManager::new_from_mapfile("models/map.json")
            .unwrap_or_else(|_| tts_core::TtsManager::new(std::collections::HashMap::new())),
    );

    // Init LLM (your stub/engine)
    let llm = Arc::new(Mutex::new(OpenAiClient::new("gpt-3.5-turbo")?));

    let state = AppState { tts, llm };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/voices", get(list_voices))
        .route("/voices/detail", get(list_voices_detail))
        .route("/tts", post(tts_endpoint))
        .route("/chat", post(chat_endpoint))
        .route("/stream/:lang/:text", get(stream_ws))
        .with_state(state);

    let addr: SocketAddr = "0.0.0.0:8080".parse().unwrap();
    let listener = TcpListener::bind(addr).await?;
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
    // 1) Synthesize
    let samples: Vec<f32> = state
        .tts
        .synthesize_with(&req.text, req.language.as_deref(), req.speaker)
        .map_err(internal_err)?;

    // 2) Mel
    let sample_rate = 22_050.0f32;
    let frame_size = 1024usize;
    let hop_size = 256usize;
    let n_mels = 80usize;

    let mel =
        tts_core::TtsManager::audio_to_mel(&samples, sample_rate, frame_size, hop_size, n_mels);
    let spectrogram_base64 = tts_core::TtsManager::mel_to_png_base64(&mel);

    // 3) WAV (base64)
    let wav_base64 = tts_core::TtsManager::encode_wav_base64(&samples, sample_rate as u32)
        .map_err(internal_err)?;

    Ok(Json(TtsResponse {
        wav_base64,
        spectrogram_base64,
    }))
}

#[derive(Deserialize)]
struct ChatRequest {
    message: String,
}
#[derive(Serialize)]
struct ChatResponse {
    reply: String,
}

async fn chat_endpoint(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let llm = state.llm.lock().await;
    let reply = llm.chat(&req.message)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ChatResponse { reply }))
}


// GET /stream/:lang/:text -> websocket that streams (audio_chunk, mel_frame)
async fn stream_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((lang, text)): Path<(String, String)>,
) -> impl IntoResponse {
    ws.on_upgrade(move |mut socket| async move {
        use axum::extract::ws::Message;
        use futures_util::SinkExt;

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

        // Stream mel frames (simple, per-chunk)
        let frame_size = 1024usize;
        let hop_size = 256usize;
        let n_mels = 80usize;
        let sample_rate = 22_050.0f32;

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
