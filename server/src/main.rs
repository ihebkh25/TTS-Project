use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tower_http::{cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer};
use tower_governor::{governor::GovernorConfigBuilder, key_extractor::GlobalKeyExtractor, GovernorLayer};
use tracing::{error, info, warn};
use std::sync::atomic::{AtomicU64, Ordering};


mod error;
mod validation;
mod config;
mod metrics;

use crate::error::ApiError;
use crate::validation::validate_tts_request;
use crate::config::ServerConfig;
use crate::metrics::AppMetrics;

#[derive(Clone)]
pub struct AppState {
    pub tts: Arc<tts_core::TtsManager>,
    pub request_count: Arc<AtomicU64>,
    pub config: ServerConfig,
    pub metrics: AppMetrics,
}

#[derive(Deserialize)]
pub struct TtsRequest {
    text: String,
    language: Option<String>,
    speaker: Option<i64>,
    voice: Option<String>, // voice ID (e.g., "norman", "thorsten")
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
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<String>,
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
    info!("Starting TTS server...");

    info!("Loading TTS models...");
    let tts = Arc::new(
        tts_core::TtsManager::new_from_mapfile("models/map.json")
            .unwrap_or_else(|e| {
                warn!("Could not load models/map.json: {e}, using empty map.");
                tts_core::TtsManager::new(std::collections::HashMap::new())
            }),
    );
    info!("Loaded {} TTS voices", tts.list_languages().len());
    
    // Preload frequently used models (en_US, de_DE)
    info!("Preloading frequently used TTS models...");
    if let Err(e) = tts.preload_models(&["en_US", "de_DE"]) {
        warn!("Failed to preload some TTS models: {e}");
    } else {
        info!("TTS models preloaded successfully");
    }

    // Initialize start time for uptime calculation
    let _ = START_TIME.get_or_init(|| std::time::Instant::now());

    // Load configuration from environment
    let config = ServerConfig::from_env();
    
    let state = AppState { 
        tts, 
        request_count: Arc::new(AtomicU64::new(0)),
        config: config.clone(),
        metrics: AppMetrics::new(),
    };
    info!("Server configuration loaded: port={}, rate_limit={}/min", 
        config.port, config.rate_limit_per_minute);
    
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
        .route("/tts", post(tts_endpoint));
    
    // Metrics endpoints - consider adding authentication in production
    let metrics_api = Router::new()
        .route("/metrics", get(metrics_endpoint))
        .route("/metrics/detailed", get(detailed_metrics_endpoint));
    
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

/// Enhanced metrics endpoint with detailed per-endpoint and component metrics
pub async fn detailed_metrics_endpoint(State(state): State<AppState>) -> Json<crate::metrics::DetailedMetricsResponse> {
    use crate::metrics::{DetailedMetricsResponse, SystemMetrics, EndpointMetricsResponse, EndpointStats, TtsMetricsResponse};
    use chrono::Utc;
    
    let mut system = sysinfo::System::new();
    system.refresh_cpu();
    system.refresh_memory();
    
    let cpu_usage = system.global_cpu_info().cpu_usage();
    let memory_used = system.used_memory();
    let memory_total = system.total_memory();
    let memory_usage_percent = if memory_total > 0 {
        (memory_used as f64 / memory_total as f64 * 100.0) as f32
    } else {
        0.0
    };
    
    let uptime = START_TIME.get()
        .map(|start| start.elapsed().as_secs())
        .unwrap_or(0);
    
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
    
    Json(DetailedMetricsResponse {
        timestamp: Utc::now(),
        system: SystemMetrics {
            cpu_usage_percent: cpu_usage,
            memory_used_mb: memory_used / 1024 / 1024,
            memory_total_mb: memory_total / 1024 / 1024,
            memory_usage_percent,
            request_count: state.request_count.load(Ordering::Relaxed),
            uptime_seconds: uptime,
            system_load,
        },
        endpoints: EndpointMetricsResponse {
            tts: EndpointStats {
                request_count: state.metrics.tts.request_count.load(Ordering::Relaxed),
                error_count: state.metrics.tts.error_count.load(Ordering::Relaxed),
                avg_latency_ms: state.metrics.tts.avg_latency_ms(),
                min_latency_ms: state.metrics.tts.min_latency_ms.load(Ordering::Relaxed),
                max_latency_ms: state.metrics.tts.max_latency_ms.load(Ordering::Relaxed),
                p50_latency_ms: state.metrics.tts.p50_latency_ms(),
                p95_latency_ms: state.metrics.tts.p95_latency_ms(),
                p99_latency_ms: state.metrics.tts.p99_latency_ms(),
            },
        },
        tts: TtsMetricsResponse {
            synthesis_count: state.metrics.tts_specific.synthesis_count.load(Ordering::Relaxed),
            avg_synthesis_time_ms: state.metrics.tts_specific.avg_synthesis_time_ms(),
            cache_hits: state.metrics.tts_specific.cache_hits.load(Ordering::Relaxed),
            cache_misses: state.metrics.tts_specific.cache_misses.load(Ordering::Relaxed),
            cache_hit_rate: state.metrics.tts_specific.cache_hit_rate(),
            total_samples: state.metrics.tts_specific.total_samples.load(Ordering::Relaxed),
        },
    })
}

pub async fn list_voices(State(state): State<AppState>) -> Json<Vec<String>> {
    Json(state.tts.list_languages())
}

pub async fn list_voices_detail(State(state): State<AppState>) -> Json<Vec<VoiceInfo>> {
    let mut out = Vec::new();
    
    // Add voices from new format (multiple voices per language)
    for lang in state.tts.list_languages() {
        let voices = state.tts.list_voices_for_language(&lang);
        for (voice_id, voice_entry) in voices {
            out.push(VoiceInfo {
                key: format!("{}:{}", lang, voice_id),
                config: voice_entry.config.clone(),
                speaker: voice_entry.speaker_id,
                display_name: voice_entry.display_name.clone(),
                gender: voice_entry.gender.clone(),
                quality: voice_entry.quality.clone(),
            });
        }
    }
    
    // Add legacy format voices (for backwards compatibility)
    for (k, (cfg, spk)) in state.tts.map_iter() {
        // Skip if already added from new format
        if !out.iter().any(|v| v.key.starts_with(&format!("{}:", k))) {
            out.push(VoiceInfo {
                key: k.clone(),
                config: cfg.clone(),
                speaker: *spk,
                display_name: None,
                gender: None,
                quality: None,
            });
        }
    }
    
    Json(out)
}

pub async fn tts_endpoint(
    State(state): State<AppState>,
    Json(req): Json<TtsRequest>,
) -> Result<Json<TtsResponse>, ApiError> {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let start_time = std::time::Instant::now();
    validate_tts_request(&req.text, req.language.as_deref())?;

    let tts = state.tts.clone();
    // Clean text for natural TTS speech with pauses and prosody
    let text = clean_text_for_tts(&req.text);
    let language = req.language.clone();
    let voice = req.voice.clone();
    
    // Use new async caching method
    let tts_start = std::time::Instant::now();
    let (audio_base64, sample_rate, duration_ms, cache_hit) = tts
        .synthesize_with_cache(&text, language.as_deref(), voice.as_deref())
        .await
        .map_err(|e| {
            state.metrics.tts.record_error();
            ApiError::TtsError(e)
        })?;

    let tts_time_ms = tts_start.elapsed().as_millis() as u64;
    let latency_ms = start_time.elapsed().as_millis() as u64;
    
    // Record metrics with cache hit tracking
    state.metrics.tts.record_request(latency_ms);
    state.metrics.tts_specific.record_synthesis(tts_time_ms, 0, cache_hit); // samples not needed for cached responses
    
    info!("TTS request completed in {}ms (synthesis: {}ms), duration: {}ms, cache_hit: {}", 
          latency_ms, tts_time_ms, duration_ms, cache_hit);

    Ok(Json(TtsResponse {
        audio_base64,
        duration_ms,
        sample_rate,
    }))
}


/// Detect emotional tone from text based on punctuation and keywords
/// Returns a prosody hint (rate, pitch) for more expressive speech
fn detect_emotion(text: &str) -> (f32, f32) {
    let text_lower = text.to_lowercase();
    
    // Excitement indicators (exclamation marks, exciting words)
    let has_excitement = text.contains('!') || 
        text_lower.contains("amazing") || text_lower.contains("wonderful") || 
        text_lower.contains("fantastic") || text_lower.contains("incredible") ||
        text_lower.contains("excellent") || text_lower.contains("great");
    
    // Question indicators (questions typically have rising intonation)
    let is_question = text.trim_end().ends_with('?');
    
    // Sadness/concern indicators
    let has_concern = text_lower.contains("sorry") || text_lower.contains("unfortunately") ||
        text_lower.contains("problem") || text_lower.contains("issue") ||
        text_lower.contains("difficult") || text_lower.contains("challenge");
    
    // Adjust prosody based on emotion
    if has_excitement {
        // Slightly faster, higher pitch for excitement
        (1.05, 1.1)
    } else if is_question {
        // Normal speed, slightly higher pitch for questions (rising intonation)
        (1.0, 1.05)
    } else if has_concern {
        // Slightly slower, lower pitch for concern
        (0.95, 0.95)
    } else {
        // Neutral prosody
        (1.0, 1.0)
    }
}

/// Clean text for natural TTS speech
/// Removes markdown, special formatting, and converts text to be more natural for speech
/// Enhanced with pause markers for commas and sentence endings for all languages
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
    
    // Enhanced: Add natural pauses for commas and sentence endings
    // This helps TTS systems naturally pause at appropriate points for all languages
    let mut result = String::with_capacity(cleaned.len() * 2);
    let chars: Vec<char> = cleaned.chars().collect();
    for i in 0..chars.len() {
        result.push(chars[i]);
        
        // Add pause markers after punctuation
        if i + 1 < chars.len() {
            let next_char = chars[i + 1];
            
            match chars[i] {
                // Commas: short pause (add extra space for natural pause)
                ',' if !next_char.is_whitespace() && !matches!(next_char, ',' | '.' | '!' | '?' | ';' | ':' | ')') => {
                    result.push_str("  "); // Double space for short pause hint
                }
                // Semicolons: medium pause
                ';' if !next_char.is_whitespace() && !matches!(next_char, ',' | '.' | '!' | '?' | ';' | ':' | ')') => {
                    result.push_str("   "); // Triple space for medium pause
                }
                // Colons: medium pause
                ':' if !next_char.is_whitespace() && !matches!(next_char, ',' | '.' | '!' | '?' | ';' | ':' | ')') => {
                    result.push_str("   "); // Triple space for medium pause
                }
                // Sentence endings: longer pause (period, exclamation, question)
                '.' | '!' | '?' if !next_char.is_whitespace() && !matches!(next_char, ',' | '.' | '!' | '?' | ';' | ':' | ')') => {
                    // Check if this is an abbreviation (e.g., "Dr.", "Mr.", "etc.")
                    let is_abbrev = if i >= 2 {
                        let prev_chars = &chars[i.saturating_sub(3)..=i];
                        let prev_str: String = prev_chars.iter().collect();
                        prev_str.ends_with("Dr.") || prev_str.ends_with("Mr.") || 
                        prev_str.ends_with("Mrs.") || prev_str.ends_with("Ms.") ||
                        prev_str.ends_with("Prof.") || prev_str.ends_with("etc.") ||
                        prev_str.ends_with("vs.") || prev_str.ends_with("e.g.") ||
                        prev_str.ends_with("i.e.") || prev_str.ends_with("a.m.") ||
                        prev_str.ends_with("p.m.")
                    } else {
                        false
                    };
                    
                    if !is_abbrev {
                        result.push_str("    "); // Quadruple space for longer sentence-ending pause
                    } else {
                        result.push(' '); // Just single space for abbreviations
                    }
                }
                _ => {
                    // Ensure space after punctuation if needed
                    if matches!(chars[i], ',' | '.' | '!' | '?' | ';' | ':') && 
                       !next_char.is_whitespace() && 
                       !matches!(next_char, ',' | '.' | '!' | '?' | ';' | ':' | ')') {
                        result.push(' ');
                    }
                }
            }
        }
    }
    cleaned = result;
    
    // Clean up excessive spaces (more than 4 consecutive spaces) but keep pause hints
    // This normalizes while preserving intentional pauses
    let mut result = String::with_capacity(cleaned.len());
    let mut space_count = 0;
    for ch in cleaned.chars() {
        if ch == ' ' {
            space_count += 1;
            // Keep up to 4 spaces (for sentence endings), normalize beyond that
            if space_count <= 4 {
                result.push(ch);
            }
        } else {
            space_count = 0;
            result.push(ch);
        }
    }
    cleaned = result;
    
    // Remove leading/trailing whitespace
    cleaned = cleaned.trim().to_string();
    
    // If empty after cleaning, return original (fallback)
    if cleaned.is_empty() {
        text.to_string()
    } else {
        cleaned
    }
}
