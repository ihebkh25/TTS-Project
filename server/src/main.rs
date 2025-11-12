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
use tower_http::{cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer};
use tracing::{error, info, warn};

use llm_core::{LlmClient, LlmProvider};

use crate::error::ApiError;
use crate::validation::{validate_chat_request, validate_conversation_id, validate_tts_request};

#[derive(Clone)]
pub struct AppState {
    pub tts: Arc<tts_core::TtsManager>,
    pub llm: Arc<std::sync::Mutex<LlmClient>>,
}

#[derive(Deserialize)]
pub struct TtsRequest {
    text: String,
    language: Option<String>,
    speaker: Option<i64>,
}

#[derive(Serialize)]
pub struct TtsResponse {
    audio_base64: String,
    spectrogram_base64: String,
    duration_ms: u64,
    sample_rate: u32,
}

#[derive(Serialize)]
pub struct VoiceInfo {
    key: String,
    config: String,
    speaker: Option<i64>,
}

#[derive(Deserialize)]
pub struct ChatRequest {
    message: String,
    conversation_id: Option<String>,
}

#[derive(Serialize)]
pub struct ChatResponse {
    reply: String,
    conversation_id: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let _ = dotenv::dotenv();

    async_main().await
}

async fn async_main() -> anyhow::Result<()> {
    info!("Starting TTS/LLM server...");

    let provider_env = std::env::var("LLM_PROVIDER").unwrap_or_else(|_| "openai".into());
    let provider = match provider_env.as_str() {
        "ollama" => LlmProvider::Ollama,
        _ => LlmProvider::OpenAI,
    };
    let model = std::env::var("LLM_MODEL").unwrap_or_else(|_| match provider {
        LlmProvider::OpenAI => "gpt-3.5-turbo".into(),
        LlmProvider::Ollama => "llama2".into(),
    });

    let llm = if let Ok(url) = std::env::var("QDRANT_URL") {
        if !url.trim().is_empty() {
            info!("Initializing LLM with Qdrant at {}", url);
            Arc::new(std::sync::Mutex::new(LlmClient::with_storage(provider, &model, None).await?))
        } else {
            info!("QDRANT_URL empty, using LLM without storage");
            Arc::new(std::sync::Mutex::new(LlmClient::new(provider, &model)?))
        }
    } else {
        info!("No QDRANT_URL set, using LLM without storage");
        Arc::new(std::sync::Mutex::new(LlmClient::new(provider, &model)?))
    };

    info!("Loading TTS models...");
    let tts = Arc::new(
        tts_core::TtsManager::new_from_mapfile("models/map.json")
            .unwrap_or_else(|e| {
                warn!("Could not load models/map.json: {e}, using empty map.");
                tts_core::TtsManager::new(std::collections::HashMap::new())
            }),
    );
    info!("Loaded {} TTS voices", tts.list_languages().len());

    let state = AppState { tts, llm };

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let middleware_stack = ServiceBuilder::new()
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::new(Duration::from_secs(60)))
        .layer(cors)
        .into_inner();

    let api = Router::new()
        .route("/health", get(health_check))
        .route("/healthz", get(health_check))
        .route("/voices", get(list_voices))
        .route("/voices/detail", get(list_voices_detail))
        .route("/tts", post(tts_endpoint))
        .route("/chat", post(chat_endpoint))
        .route("/stream/:lang/:text", get(stream_ws));

    let app = Router::new()
        .merge(api.clone())   // root paths
        .nest("/api", api)    // /api prefix
        .layer(middleware_stack)
        .with_state(state);

    let port = std::env::var("PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(8085);
    let addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;

    let listener = TcpListener::bind(addr).await.map_err(|e| {
        anyhow::anyhow!("Failed to bind {addr}: {e}. Try a different PORT.")
    })?;

    info!("Server listening on http://{addr}");
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
    validate_tts_request(&req.text, req.language.as_deref())?;

    let (samples, sample_rate) = state
        .tts
        .synthesize_with_sample_rate(&req.text, req.language.as_deref(), req.speaker)
        .map_err(ApiError::TtsError)?;

    let sample_rate_f32 = sample_rate as f32;
    let frame_size = 1024usize;
    let hop_size = 256usize;
    let n_mels = 80usize;

    let mel = tts_core::TtsManager::audio_to_mel(&samples, sample_rate_f32, frame_size, hop_size, n_mels);
    let spectrogram_base64 = tts_core::TtsManager::mel_to_png_base64(&mel);

    let audio_base64 = tts_core::TtsManager::encode_wav_base64(&samples, sample_rate)
        .map_err(|e| ApiError::TtsError(anyhow::anyhow!("WAV encoding error: {e}")))?;

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
    validate_chat_request(&req.message)?;
    if let Some(ref id) = req.conversation_id {
        validate_conversation_id(id)?;
    }

    let message = req.message.clone();
    let conv_id = req.conversation_id.clone();
    let llm = state.llm.clone();

    let result = tokio::task::spawn_blocking(move || {
        let llm = llm.lock().unwrap();
        let conv_id = conv_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        match llm.chat_with_history(Some(conv_id.clone()), &message) {
            Ok(reply) => Ok::<_, ApiError>((reply, conv_id)),
            Err(e) => Err(ApiError::LlmError(format!("LLM error: {e}"))),
        }
    })
    .await;

    let (reply, conv_id) = match result {
        Ok(res) => res?,
        Err(join_err) => {
            error!("Join error in chat task: {join_err}");
            return Err(ApiError::InternalError(format!("Join error: {join_err}")));
        }
    };

    Ok(Json(ChatResponse {
        reply,
        conversation_id: conv_id,
    }))
}

pub async fn stream_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path((lang, text)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(e) = validate_tts_request(&text, Some(&lang)) {
        return ws.on_upgrade(move |mut socket| async move {
            use axum::extract::ws::Message;
            let error_msg = serde_json::json!({ "error": format!("{e}"), "code": 400 });
            let _ = socket.send(Message::Text(error_msg.to_string())).await;
        });
    }

    ws.on_upgrade(move |mut socket| async move {
        use axum::extract::ws::Message;
        let samples = match state.tts.synthesize_blocking(&text, Some(&lang)) {
            Ok(s) => s,
            Err(e) => {
                let err_msg = serde_json::json!({ "error": format!("TTS error: {e}"), "code": 500 });
                let _ = socket.send(Message::Text(err_msg.to_string())).await;
                let _ = socket.close().await;
                return;
            }
        };

        let sample_rate = match state.tts.config_for(Some(&lang)) {
            Ok((cfg_path, _)) => state.tts.get_sample_rate(&cfg_path).unwrap_or(22050) as f32,
            Err(_) => 22_050.0f32,
        };

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
            let mel_frame: Vec<f32> = mel_frame_f64.iter().copied().map(|v| v as f32).collect();
            let chunk: Vec<f32> = slice.to_vec();

            let msg = serde_json::json!({ "audio": chunk, "mel": mel_frame });
            if let Err(e) = socket.send(Message::Text(msg.to_string())).await {
                warn!("Failed to send WS message: {e}");
                break;
            }
            offset += hop_size;
        }

        let _ = socket.send(Message::Text(serde_json::json!({ "status": "complete" }).to_string())).await;
        let _ = socket.close().await;
    })
}
