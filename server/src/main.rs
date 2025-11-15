pub mod error;
pub mod validation;
pub mod config;

use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{Path, Request, State, WebSocketUpgrade},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tower::ServiceBuilder;
use tower_http::{cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer};
use tower_governor::{governor::GovernorConfigBuilder, key_extractor::GlobalKeyExtractor, GovernorLayer};
use tracing::{error, info, warn};
use std::sync::atomic::{AtomicU64, Ordering};

use llm_core::{LlmClient, LlmProvider};
use futures_util::SinkExt;

use crate::error::ApiError;
use crate::validation::{validate_chat_request, validate_conversation_id, validate_tts_request};
use crate::config::ServerConfig;

#[derive(Clone)]
pub struct AppState {
    pub tts: Arc<tts_core::TtsManager>,
    pub llm: Arc<std::sync::Mutex<LlmClient>>,
    pub request_count: Arc<AtomicU64>,
    pub config: ServerConfig,
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
    language: Option<String>, // For TTS language selection
}

#[derive(Serialize)]
pub struct ChatResponse {
    reply: String,
    conversation_id: String,
    audio_base64: Option<String>, // Audio for bot response
    sample_rate: Option<u32>,
    duration_ms: Option<u64>,
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

    // Initialize start time for uptime calculation
    let _ = START_TIME.get_or_init(|| std::time::Instant::now());

    // Load configuration from environment
    let config = ServerConfig::from_env();
    
    let state = AppState { 
        tts, 
        llm,
        request_count: Arc::new(AtomicU64::new(0)),
        config: config.clone(),
    };
    info!("Server configuration loaded: port={}, rate_limit={}/min, llm_timeout={}s", 
        config.port, config.rate_limit_per_minute, config.llm_timeout_secs);
    
    // CORS configuration - environment-aware
    let cors = if let Some(ref allowed_origins) = config.cors_allowed_origins {
        // Production: Use specific origins from environment
        let origins: Vec<axum::http::HeaderValue> = allowed_origins
            .iter()
            .filter_map(|origin: &String| {
                origin.parse::<axum::http::HeaderValue>().ok()
            })
            .collect();
        
        if origins.is_empty() {
            warn!("CORS_ALLOWED_ORIGINS is empty, falling back to permissive CORS");
            CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::OPTIONS])
                .allow_headers(tower_http::cors::Any)
                .allow_credentials(false)
        } else {
            info!("CORS configured for {} origin(s)", origins.len());
            CorsLayer::new()
                .allow_origin(tower_http::cors::AllowOrigin::list(origins))
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::OPTIONS])
                .allow_headers(tower_http::cors::Any)
                .allow_credentials(false)
        }
    } else {
        // Development: Allow all origins (with warning)
        warn!("CORS_ALLOWED_ORIGINS not set, allowing all origins (development mode)");
        CorsLayer::new()
            .allow_origin(tower_http::cors::Any)
            .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::OPTIONS])
            .allow_headers(tower_http::cors::Any)
            .allow_credentials(false)
    };

    // Rate limiting configuration
    // Using GlobalKeyExtractor to rate limit globally (all requests share the same limit)
    // This works better in Docker/proxy environments where IP extraction can be problematic
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second((config.rate_limit_per_minute / 60) as u64) // Convert per-minute to per-second
            .burst_size(config.rate_limit_per_minute as u32)
            .key_extractor(GlobalKeyExtractor)
            .finish()
            .unwrap(),
    );
    
    info!("Rate limiting: {} requests per minute", config.rate_limit_per_minute);
    
    // Request ID middleware for tracing
    async fn add_request_id(mut request: Request, next: Next) -> Response {
        let request_id = uuid::Uuid::new_v4().to_string();
        request.headers_mut().insert(
            "x-request-id",
            axum::http::HeaderValue::from_str(&request_id).unwrap(),
        );
        let mut response = next.run(request).await;
        response.headers_mut().insert(
            "x-request-id",
            axum::http::HeaderValue::from_str(&request_id).unwrap(),
        );
        response
    }
    
    // Note: GovernorLayer needs a key extractor to identify requests for rate limiting
    // The key extractor is configured in the GovernorConfigBuilder above
    let middleware_stack = ServiceBuilder::new()
        .layer(TraceLayer::new_for_http())
        .layer(GovernorLayer::new(governor_conf))
        .layer(TimeoutLayer::new(config.request_timeout()))
        .layer(cors)
        .into_inner();

    // Separate routes for metrics (should be protected in production)
    let public_api = Router::new()
        .route("/health", get(health_check))
        .route("/healthz", get(health_check))
        .route("/voices", get(list_voices))
        .route("/voices/detail", get(list_voices_detail))
        .route("/tts", post(tts_endpoint))
        .route("/chat", post(chat_endpoint))
        .route("/voice-chat", post(voice_chat_endpoint))
        .route("/stream/{lang}/{text}", get(stream_ws));
    
    // Metrics endpoint - consider adding authentication in production
    let metrics_api = Router::new()
        .route("/metrics", get(metrics_endpoint));
    
    let api = Router::new()
        .merge(public_api)
        .merge(metrics_api);

    let app = Router::new()
        .merge(api.clone())   // root paths
        .nest("/api", api)    // /api prefix
        .layer(axum::middleware::from_fn(add_request_id))
        .layer(middleware_stack)
        .with_state(state);

    let addr: SocketAddr = format!("0.0.0.0:{}", config.port).parse()?;

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

#[derive(Serialize)]
pub struct MetricsResponse {
    pub cpu_usage_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub memory_usage_percent: f32,
    pub request_count: u64,
    pub uptime_seconds: u64,
    pub system_load: Option<f64>,
}

static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

pub async fn metrics_endpoint(State(state): State<AppState>) -> Json<MetricsResponse> {
    let mut system = sysinfo::System::new();
    system.refresh_cpu();
    system.refresh_memory();
    
    // Get CPU usage (average across all cores)
    let cpu_usage = system.global_cpu_info().cpu_usage();
    
    // Get memory information
    let memory_used = system.used_memory();
    let memory_total = system.total_memory();
    let memory_usage_percent = if memory_total > 0 {
        (memory_used as f64 / memory_total as f64 * 100.0) as f32
    } else {
        0.0
    };
    
    // Get request count
    let request_count = state.request_count.load(Ordering::Relaxed);
    
    // Get uptime
    let uptime = START_TIME.get()
        .map(|start| start.elapsed().as_secs())
        .unwrap_or(0);
    
    // Get system load (Unix-like systems only)
    let system_load = {
        #[cfg(unix)]
        {
            use std::fs;
            if let Ok(loadavg) = fs::read_to_string("/proc/loadavg") {
                loadavg.split_whitespace().next()
                    .and_then(|s| s.parse::<f64>().ok())
            } else {
                None
            }
        }
        #[cfg(not(unix))]
        None
    };
    
    Json(MetricsResponse {
        cpu_usage_percent: cpu_usage,
        memory_used_mb: memory_used / 1024 / 1024, // Convert bytes to MB
        memory_total_mb: memory_total / 1024 / 1024,
        memory_usage_percent,
        request_count,
        uptime_seconds: uptime,
        system_load,
    })
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
    state.request_count.fetch_add(1, Ordering::Relaxed);
    validate_tts_request(&req.text, req.language.as_deref())?;

    let (samples, sample_rate) = state
        .tts
        .synthesize_with_sample_rate(&req.text, req.language.as_deref(), req.speaker)
        .map_err(ApiError::TtsError)?;

    let sample_rate_f32 = sample_rate as f32;

    let audio_base64 = tts_core::TtsManager::encode_wav_base64(&samples, sample_rate)
        .map_err(|e| ApiError::TtsError(anyhow::anyhow!("WAV encoding error: {e}")))?;

    let duration_ms = (samples.len() as f32 / sample_rate_f32 * 1000.0) as u64;

    Ok(Json(TtsResponse {
        audio_base64,
        duration_ms,
        sample_rate,
    }))
}

pub async fn chat_endpoint(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, ApiError> {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let start_time = std::time::Instant::now();
    
    validate_chat_request(&req.message)?;
    if let Some(ref id) = req.conversation_id {
        validate_conversation_id(id)?;
    }

    let message = req.message.clone();
    let conv_id = req.conversation_id.clone();
    let llm = state.llm.clone();
    let language = req.language.clone();

    info!("Chat request received: message length={}, conv_id={:?}", message.len(), conv_id);

    // Run LLM in blocking task with timeout
    // Using spawn_blocking to avoid blocking the async runtime
    let result = tokio::time::timeout(
        state.config.llm_timeout(),
        tokio::task::spawn_blocking({
            let llm = llm.clone();
            let message = message.clone();
            let conv_id = conv_id.clone();
            move || {
                let llm = llm.lock().unwrap();
                let conv_id = conv_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                match llm.chat_with_history(Some(conv_id.clone()), &message) {
                    Ok(reply) => Ok::<_, ApiError>((reply, conv_id)),
                    Err(e) => Err(ApiError::LlmError(format!("LLM error: {e}"))),
                }
            }
        })
    )
    .await;

    let (reply, conv_id) = match result {
        Ok(Ok(Ok((reply, conv_id)))) => (reply, conv_id),
        Ok(Ok(Err(join_err))) => {
            error!("Join error in chat task: {join_err}");
            return Err(ApiError::InternalError(format!("Join error: {join_err}")));
        }
        Ok(Err(join_err)) => {
            error!("Task join error: {join_err}");
            return Err(ApiError::InternalError(format!("Task join error: {join_err}")));
        }
        Err(_) => {
            let timeout_secs = state.config.llm_timeout().as_secs();
            error!("LLM request timed out after {} seconds", timeout_secs);
            return Err(ApiError::LlmError(format!(
                "Request timed out after {} seconds. Please try again with a shorter message.",
                timeout_secs
            )));
        }
    };

    let llm_time = start_time.elapsed();
    info!("LLM response received in {:.2}s, reply length={}", llm_time.as_secs_f64(), reply.len());

    // Return text immediately - TTS generation moved to background for speed
    // This ensures response time is only limited by LLM, not TTS
    let response = ChatResponse {
        reply: reply.clone(),
        conversation_id: conv_id.clone(),
        audio_base64: None,
        sample_rate: None,
        duration_ms: None,
    };

    // Generate TTS in background (completely non-blocking)
    if let Some(lang) = language {
        let tts_state = state.tts.clone();
        let reply_for_tts = reply;
        tokio::spawn(async move {
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok((samples, sr)) = tts_state.synthesize_with_sample_rate(&reply_for_tts, Some(&lang), None) {
                    let _ = tts_core::TtsManager::encode_wav_base64(&samples, sr);
                    // Audio generated in background - frontend can request via /tts if needed
                }
            }).await;
        });
    }

    Ok(Json(response))
}

#[derive(Deserialize)]
pub struct VoiceChatRequest {
    message: String,
    conversation_id: Option<String>,
    language: Option<String>,
}

#[derive(Serialize)]
pub struct VoiceChatResponse {
    audio_base64: String,
    sample_rate: u32,
    duration_ms: u64,
    conversation_id: String,
    reply: String, // Original reply for display
    cleaned_text: String, // Cleaned text that was actually spoken
}

pub async fn voice_chat_endpoint(
    State(state): State<AppState>,
    Json(req): Json<VoiceChatRequest>,
) -> Result<Json<VoiceChatResponse>, ApiError> {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    validate_chat_request(&req.message)?;
    if let Some(ref id) = req.conversation_id {
        validate_conversation_id(id)?;
    }

    let message = req.message.clone();
    let conv_id = req.conversation_id.clone();
    let llm = state.llm.clone();
    // Default to en_US if available, otherwise de_DE
    let default_lang = if state.tts.list_languages().contains(&"en_US".to_string()) {
        "en_US"
    } else {
        "de_DE"
    };
    let language = req.language.clone().unwrap_or_else(|| default_lang.to_string());

    // Get LLM response with timeout
    // Using spawn_blocking to avoid blocking the async runtime
    let result = tokio::time::timeout(
        state.config.llm_timeout(),
        tokio::task::spawn_blocking({
            let llm = llm.clone();
            let message = message.clone();
            let conv_id = conv_id.clone();
            move || {
                let llm = llm.lock().unwrap();
                let conv_id = conv_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                match llm.chat_with_history(Some(conv_id.clone()), &message) {
                    Ok(reply) => Ok::<_, ApiError>((reply, conv_id)),
                    Err(e) => Err(ApiError::LlmError(format!("LLM error: {e}"))),
                }
            }
        })
    )
    .await;

    let (reply, conv_id) = match result {
        Ok(Ok(Ok((reply, conv_id)))) => (reply, conv_id),
        Ok(Ok(Err(join_err))) => {
            error!("Join error in voice chat task: {join_err}");
            return Err(ApiError::InternalError(format!("Join error: {join_err}")));
        }
        Ok(Err(join_err)) => {
            error!("Task join error: {join_err}");
            return Err(ApiError::InternalError(format!("Task join error: {join_err}")));
        }
        Err(_) => {
            let timeout_secs = state.config.llm_timeout().as_secs();
            error!("LLM request timed out after {} seconds", timeout_secs);
            return Err(ApiError::LlmError(format!(
                "Request timed out after {} seconds. Please try again with a shorter message.",
                timeout_secs
            )));
        }
    };

    // Clean text for natural TTS speech
    let cleaned_reply = clean_text_for_tts(&reply);
    
    // Generate TTS audio (required for voice chat)
    let (samples, sample_rate) = state
        .tts
        .synthesize_with_sample_rate(&cleaned_reply, Some(&language), None)
        .map_err(ApiError::TtsError)?;

    let sample_rate_f32 = sample_rate as f32;
    let duration_ms = (samples.len() as f32 / sample_rate_f32 * 1000.0) as u64;

    let audio_base64 = tts_core::TtsManager::encode_wav_base64(&samples, sample_rate)
        .map_err(|e| ApiError::TtsError(anyhow::anyhow!("WAV encoding error: {e}")))?;

    Ok(Json(VoiceChatResponse {
        audio_base64,
        sample_rate,
        duration_ms,
        conversation_id: conv_id,
        reply: reply.clone(),
        cleaned_text: cleaned_reply,
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
            let _ = socket.send(Message::Text(error_msg.to_string().into())).await;
        });
    }

    ws.on_upgrade(move |mut socket| async move {
        use axum::extract::ws::Message;
        
        // Send synthesizing status
        let _ = socket.send(Message::Text(
            serde_json::json!({ 
                "type": "status", 
                "status": "synthesizing", 
                "message": "Generating audio..." 
            }).to_string().into()
        )).await;
        
        // Get sample rate first
        let sample_rate = match state.tts.config_for(Some(&lang)) {
            Ok((cfg_path, _)) => state.tts.get_sample_rate(&cfg_path).unwrap_or(22050) as f32,
            Err(_) => 22_050.0f32,
        };

        let frame_size = 1024usize;
        let hop_size = 256usize;
        let n_mels = 80usize;
        
        // Get config path
        let (cfg_path, _) = match state.tts.config_for(Some(&lang)) {
            Ok(cfg) => cfg,
            Err(e) => {
                let err_msg = serde_json::json!({ "error": format!("Config error: {e}"), "code": 500 });
                let _ = socket.send(Message::Text(err_msg.to_string().into())).await;
                let _ = socket.close().await;
                return;
            }
        };
        
        // Create channel for streaming chunks in real-time
        let (tx, mut rx) = mpsc::channel::<Result<Vec<f32>, String>>(100);
        
        // Use spawn_blocking to run synthesis in a separate thread
        // Stream chunks as they're generated from the iterator
        let tts_state = state.tts.clone();
        let text_clone = text.clone();
        let cfg_path_clone = cfg_path.clone();
        
        // Move tx into the blocking task - when task completes, channel will close
        let synthesis_task = tokio::task::spawn_blocking(move || {
            // Get synthesizer
            let (synth_arc, _) = match tts_state.get_or_create_synth(&cfg_path_clone) {
                Ok(s) => s,
                Err(e) => {
                    let _ = tx.blocking_send(Err(format!("TTS error: {e}")));
                    return;
                }
            };
            
            let synth = synth_arc.lock().unwrap();
            
            // Create iterator and stream chunks as they come
            let iter = match synth.synthesize_parallel(text_clone, None) {
                Ok(i) => i,
                Err(e) => {
                    let _ = tx.blocking_send(Err(format!("piper synth error: {e}")));
                    return;
                }
            };
            
            // Stream chunks from iterator as they're generated
            for part_result in iter {
                match part_result {
                    Ok(samples) => {
                        let samples_vec = samples.into_vec();
                        if tx.blocking_send(Ok(samples_vec)).is_err() {
                            // Receiver dropped, stop processing
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = tx.blocking_send(Err(format!("chunk error: {e}")));
                        break;
                    }
                }
            }
            // tx is dropped here when the task completes, closing the channel
        });
        
        // Send streaming status
        let _ = socket.send(Message::Text(
            serde_json::json!({ 
                "type": "status", 
                "status": "streaming", 
                "message": "Streaming audio chunks..." 
            }).to_string().into()
        )).await;

        // Initialize mel spectrogram processors
        let mut stft = mel_spec::prelude::Spectrogram::new(frame_size, hop_size);
        let mut mel = mel_spec::prelude::MelSpectrogram::new(frame_size, sample_rate as f64, n_mels);
        
        // Buffer for accumulating samples and streaming in chunks
        let mut sample_buffer: Vec<f32> = Vec::new();
        let mut total_samples = 0usize;
        let mut offset = 0usize;
        let mut chunk_number = 0usize;
        let mut metadata_sent = false;
        let mut synthesis_error = None;
        
        // Receive chunks from the synthesis task and stream them immediately
        let mut synthesis_complete = false;
        while !synthesis_complete {
            match rx.recv().await {
                Some(Ok(chunk_samples)) => {
                    // Add samples to buffer
                    sample_buffer.extend_from_slice(&chunk_samples);
                    total_samples += chunk_samples.len();
                    
                    // Stream chunks from buffer while we have enough samples
                    while sample_buffer.len() >= hop_size {
                        let chunk: Vec<f32> = sample_buffer.drain(..hop_size).collect();
                        
                        // Calculate mel spectrogram frame
                        let mel_frame_f64: Vec<f64> = if let Some(fft_frame) = stft.add(&chunk) {
                            let arr_f64 = ndarray::Array1::from_iter(
                                fft_frame.into_iter().map(|c: num_complex::Complex<f64>| c),
                            );
                            let (flat, _off) = mel.add(&arr_f64).into_raw_vec_and_offset();
                            flat
                        } else {
                            vec![0.0f64; n_mels]
                        };
                        let mel_frame: Vec<f32> = mel_frame_f64.iter().copied().map(|v| v as f32).collect();
                        
                        // Send metadata after first chunk (for sample rate and hop size info)
                        // Don't send total_chunks here - wait until we know the actual value
                        if !metadata_sent {
                            let _ = socket.send(Message::Text(
                                serde_json::json!({
                                    "type": "metadata",
                                    "sample_rate": sample_rate as u32,
                                    "total_samples": 0, // Unknown until complete
                                    "estimated_duration": 0.0, // Unknown until complete
                                    "total_chunks": 0, // Don't send estimate - wait for actual
                                    "hop_size": hop_size
                                }).to_string().into()
                            )).await;
                            metadata_sent = true;
                        }
                        
                        // Calculate progress metadata
                        // Progress is based on samples processed (offset) vs samples received so far
                        // Since we don't know final total until synthesis completes, we use a conservative estimate
                        chunk_number += 1;
                        
                        let progress = if total_samples > offset {
                            // Progress based on what we've processed vs what we've received
                            // Cap at 95% until we know the final total
                            ((offset as f32 / total_samples as f32) * 100.0 * 0.95).min(95.0)
                        } else {
                            0.0
                        };
                        let timestamp = offset as f32 / sample_rate;
                        let chunk_duration = hop_size as f32 / sample_rate;

                        let msg = serde_json::json!({ 
                            "type": "chunk",
                            "audio": chunk, 
                            "mel": mel_frame,
                            "chunk": chunk_number,
                            "total_chunks": 0, // Don't send total until we know it (final metadata)
                            "progress": progress,
                            "timestamp": timestamp,
                            "duration": chunk_duration,
                            "offset": offset
                        });
                        
                        if let Err(e) = socket.send(Message::Text(msg.to_string().into())).await {
                            warn!("Failed to send WS message: {e}");
                            synthesis_complete = true;
                            break;
                        }
                        
                        offset += hop_size;
                    }
                }
                Some(Err(e)) => {
                    synthesis_error = Some(e);
                    break;
                }
                None => {
                    // Channel closed, synthesis complete
                    break;
                }
            }
        }
        
        // Wait for synthesis task to complete (in case it's still running)
        let _ = synthesis_task.await;
        
        // Check for synthesis errors
        if let Some(err) = synthesis_error {
            let err_msg = serde_json::json!({ "error": err, "code": 500 });
            let _ = socket.send(Message::Text(err_msg.to_string().into())).await;
            let _ = socket.close().await;
            return;
        }
        
        // Process any remaining samples in buffer (if any)
        // Note: We don't pad with zeros - we just send what we have if it's significant
        // The frontend can handle incomplete final chunks
        if !sample_buffer.is_empty() && sample_buffer.len() >= hop_size / 2 {
            // Only send if we have at least half a chunk to avoid very small final chunks
            // Pad to hop_size for consistent processing
            let mut final_chunk = sample_buffer.drain(..).collect::<Vec<f32>>();
            while final_chunk.len() < hop_size {
                final_chunk.push(0.0);
            }
            
            let mel_frame_f64: Vec<f64> = if let Some(fft_frame) = stft.add(&final_chunk) {
                let arr_f64 = ndarray::Array1::from_iter(
                    fft_frame.into_iter().map(|c: num_complex::Complex<f64>| c),
                );
                let (flat, _off) = mel.add(&arr_f64).into_raw_vec_and_offset();
                flat
            } else {
                vec![0.0f64; n_mels]
            };
            let mel_frame: Vec<f32> = mel_frame_f64.iter().copied().map(|v| v as f32).collect();
            
            chunk_number += 1;
            let progress = 100.0;
            let timestamp = offset as f32 / sample_rate;
            let chunk_duration = hop_size as f32 / sample_rate;
            let total_chunks = chunk_number;

            let msg = serde_json::json!({ 
                "type": "chunk",
                "audio": final_chunk, 
                "mel": mel_frame,
                "chunk": chunk_number,
                "total_chunks": total_chunks,
                "progress": progress,
                "timestamp": timestamp,
                "duration": chunk_duration,
                "offset": offset
            });
            
            let _ = socket.send(Message::Text(msg.to_string().into())).await;
        }
        
        // Send final metadata update with actual totals
        let final_duration = total_samples as f32 / sample_rate;
        let final_chunks = chunk_number;
        let _ = socket.send(Message::Text(
            serde_json::json!({
                "type": "metadata",
                "sample_rate": sample_rate as u32,
                "total_samples": total_samples,
                "estimated_duration": final_duration,
                "total_chunks": final_chunks,
                "hop_size": hop_size
            }).to_string().into()
        )).await;

        let _ = socket.send(Message::Text(
            serde_json::json!({ 
                "type": "status", 
                "status": "complete" 
            }).to_string().into()
        )).await;
        let _ = socket.close().await;
    })
}

/// Clean text for natural TTS speech
/// Removes markdown, special formatting, and converts text to be more natural for speech
fn clean_text_for_tts(text: &str) -> String {
    let mut cleaned = text.to_string();
    
    // Remove markdown code blocks (multiline)
    while let Some(start) = cleaned.find("```") {
        if let Some(end) = cleaned[start + 3..].find("```") {
            cleaned.replace_range(start..start + end + 6, "");
        } else {
            break;
        }
    }
    
    // Remove inline code blocks
    while let Some(start) = cleaned.find('`') {
        if let Some(end) = cleaned[start + 1..].find('`') {
            let code_content = cleaned[start + 1..start + 1 + end].to_string();
            cleaned.replace_range(start..start + end + 2, &code_content);
        } else {
            break;
        }
    }
    
    // Remove markdown links but keep the text [text](url) -> text
    let mut pos = 0;
    while let Some(start) = cleaned[pos..].find('[') {
        let start = pos + start;
        if let Some(mid) = cleaned[start + 1..].find(']') {
            let mid = start + 1 + mid;
            if let Some(end) = cleaned[mid + 1..].find(')') {
                let end = mid + 1 + end;
                let link_text = cleaned[start + 1..mid].to_string();
                let link_len = link_text.len();
                cleaned.replace_range(start..end + 1, &link_text);
                pos = start + link_len;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    
    // Remove markdown bold/italic but keep the text
    cleaned = cleaned.replace("**", "");
    cleaned = cleaned.replace("*", "");
    cleaned = cleaned.replace("__", "");
    cleaned = cleaned.replace("_", "");
    cleaned = cleaned.replace("~~", "");
    cleaned = cleaned.replace("#", "");
    
    // Remove markdown headers (lines starting with #)
    let lines: Vec<&str> = cleaned.lines().collect();
    cleaned = lines
        .iter()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with('#') {
                trimmed.trim_start_matches('#').trim_start()
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    
    // Remove markdown list markers
    let lines: Vec<&str> = cleaned.lines().collect();
    cleaned = lines
        .iter()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
                &trimmed[2..]
            } else if let Some(num_end) = trimmed.find(". ") {
                if trimmed[..num_end].chars().all(|c| c.is_ascii_digit()) {
                    &trimmed[num_end + 2..]
                } else {
                    line
                }
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    
    // Remove "asterisk" word if it appears (TTS might read * as "asterisk")
    cleaned = cleaned.replace(" asterisk ", " ");
    cleaned = cleaned.replace(" asterisks ", " ");
    cleaned = cleaned.replace("Asterisk ", "");
    cleaned = cleaned.replace("Asterisks ", "");
    
    // Normalize whitespace - replace multiple spaces/newlines with single space
    let mut result = String::with_capacity(cleaned.len());
    let mut last_was_whitespace = false;
    for ch in cleaned.chars() {
        if ch.is_whitespace() {
            if !last_was_whitespace {
                result.push(' ');
                last_was_whitespace = true;
            }
        } else {
            result.push(ch);
            last_was_whitespace = false;
        }
    }
    cleaned = result;
    
    // Fix spacing around punctuation - remove space before punctuation
    cleaned = cleaned.replace(" ,", ",");
    cleaned = cleaned.replace(" .", ".");
    cleaned = cleaned.replace(" !", "!");
    cleaned = cleaned.replace(" ?", "?");
    cleaned = cleaned.replace(" ;", ";");
    cleaned = cleaned.replace(" :", ":");
    
    // Ensure space after punctuation (but not if it's already there or at end of string)
    // Use a more careful approach to avoid double spaces
    let mut result = String::with_capacity(cleaned.len() * 2);
    let chars: Vec<char> = cleaned.chars().collect();
    for i in 0..chars.len() {
        result.push(chars[i]);
        if matches!(chars[i], ',' | '.' | '!' | '?' | ';' | ':') {
            // Add space after punctuation if not at end and next char is not whitespace or punctuation
            if i + 1 < chars.len() {
                let next_char = chars[i + 1];
                if !next_char.is_whitespace() && !matches!(next_char, ',' | '.' | '!' | '?' | ';' | ':' | ')') {
                    result.push(' ');
                }
            }
        }
    }
    cleaned = result;
    
    // Clean up double spaces that might have been created
    while cleaned.contains("  ") {
        cleaned = cleaned.replace("  ", " ");
    }
    
    // Remove leading/trailing whitespace
    cleaned = cleaned.trim().to_string();
    
    // If empty after cleaning, return original (fallback)
    if cleaned.is_empty() {
        text.to_string()
    } else {
        cleaned
    }
}
