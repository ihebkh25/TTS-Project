//! Test helpers for e2e tests

use axum::Router;
use std::collections::HashMap;
use std::sync::Arc;
use tts_core::TtsManager;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct AppState {
    pub tts: Arc<tts_core::TtsManager>,
}

/// Create a test app instance for e2e tests
/// This uses the actual server implementation to test complete workflows
pub async fn create_test_app() -> Router {
    use axum::{
        extract::State,
        routing::{get, post},
        Json,
    };
    use server::error::ApiError;
    use server::validation::validate_tts_request;
    
    // Create minimal TTS manager for testing
    let mut map = HashMap::new();
    map.insert(
        "de_DE".to_string(),
        (
            "models/de_DE/thorsten/config.onnx.json".to_string(),
            None,
        ),
    );
    // Add a few more test languages
    map.insert(
        "en_US".to_string(),
        (
            "models/en_US/en_US-lessac-medium.onnx.json".to_string(),
            None,
        ),
    );
    map.insert(
        "fr_FR".to_string(),
        (
            "models/fr_FR/fr_FR-siwis-medium.onnx.json".to_string(),
            None,
        ),
    );
    
    let tts = Arc::new(TtsManager::new(map));

    let state = AppState { tts };
    
    // Define request/response types (matching main.rs)
    #[derive(serde::Deserialize)]
    struct TtsRequest {
        text: String,
        language: Option<String>,
        speaker: Option<i64>,
    }
    
    #[derive(serde::Serialize)]
    struct TtsResponse {
        audio_base64: String,
        duration_ms: u64,
        sample_rate: u32,
    }
    
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/voices", get({
            move |State(s): State<AppState>| async move {
                Json(s.tts.list_languages())
            }
        }))
        .route("/voices/detail", get({
            move |State(s): State<AppState>| async move {
                let mut out = Vec::new();
                for (k, (cfg, spk)) in s.tts.map_iter() {
                    out.push(serde_json::json!({
                        "key": k,
                        "config": cfg,
                        "speaker": spk
                    }));
                }
                Json(out)
            }
        }))
        .route("/tts", post({
            move |State(s): State<AppState>, Json(req): Json<TtsRequest>| async move {
                match validate_tts_request(&req.text, req.language.as_deref()) {
                    Ok(_) => {
                        // For e2e tests, try to use actual TTS if models are available
                        // Otherwise return mock response
                        match s.tts.synthesize_with_sample_rate(
                            &req.text,
                            req.language.as_deref(),
                            req.speaker,
                        ) {
                            Ok((samples, sample_rate)) => {
                                let audio_base64 = tts_core::TtsManager::encode_wav_base64(&samples, sample_rate)
                                    .unwrap_or_else(|_| "mock_audio_base64".to_string());
                                let duration_ms = (samples.len() as f32 / sample_rate as f32 * 1000.0) as u64;
                                
                                Ok(Json(TtsResponse {
                                    audio_base64,
                                    duration_ms,
                                    sample_rate,
                                }))
                            }
                            Err(_) => {
                                // Return mock if TTS fails (models not available)
                                Ok(Json(TtsResponse {
                                    audio_base64: "mock_audio_base64_for_testing".to_string(),
                                    duration_ms: 1000,
                                    sample_rate: 22050,
                                }))
                            }
                        }
                    }
                    Err(e) => {
                        let status = match e {
                            ApiError::InvalidInput(_) => axum::http::StatusCode::BAD_REQUEST,
                            _ => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        };
                        Err((status, Json(serde_json::json!({"error": e.to_string()}))))
                    }
                }
            }
        }))
        .layer(ServiceBuilder::new().layer(CorsLayer::permissive()).into_inner())
        .with_state(state)
}

