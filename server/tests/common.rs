//! Common utilities for integration tests

use axum::Router;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tts_core::TtsManager;
use llm_core::{LlmClient, LlmProvider};
use tower::ServiceExt;

// Note: AppState is defined in main.rs, so we need to define it here for tests
// In a real scenario, this would be in a shared module

#[derive(Clone)]
pub struct AppState {
    pub tts: Arc<tts_core::TtsManager>,
    pub llm: Arc<Mutex<LlmClient>>,
}

/// Create a test app instance
pub async fn create_test_app() -> Router {
    use axum::{
        routing::get,
        Router,
    };
    use tower::ServiceBuilder;
    use tower_http::cors::CorsLayer;
    
    // Create minimal TTS manager for testing
    let mut map = HashMap::new();
    map.insert(
        "de_DE".to_string(),
        (
            "models/de_DE/de_DE-mls-medium.onnx.json".to_string(),
            None,
        ),
    );
    let tts = Arc::new(TtsManager::new(map));

    // Create LLM client (may fail if API key not set, but that's ok for tests)
    // Set a dummy API key for testing if none is set
    if std::env::var("OPENAI_API_KEY").is_err() {
        std::env::set_var("OPENAI_API_KEY", "test-key-for-integration-tests");
    }
    let llm = Arc::new(std::sync::Mutex::new(
        LlmClient::new(LlmProvider::OpenAI, "gpt-3.5-turbo")
            .expect("Failed to create LLM client for tests"),
    ));

    let state = AppState { tts, llm };
    
    // Create a test router with all handlers
    // Use actual handlers from main.rs by importing them
    use axum::{
        extract::State,
        routing::post,
        Json,
    };
    use server::error::ApiError;
    use server::validation::{validate_tts_request, validate_chat_request, validate_conversation_id};
    
    // Define request/response types for tests (matching main.rs)
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
    
    #[derive(serde::Deserialize)]
    struct ChatRequest {
        message: String,
        conversation_id: Option<String>,
    }
    
    #[derive(serde::Serialize)]
    struct ChatResponse {
        reply: String,
        conversation_id: String,
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
                        // For tests, return a mock response
                        Ok(Json(TtsResponse {
                            audio_base64: "mock_audio".to_string(),
                            duration_ms: 1000,
                            sample_rate: 22050,
                        }))
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
        .route("/chat", post({
            move |State(_s): State<AppState>, Json(req): Json<ChatRequest>| async move {
                match validate_chat_request(&req.message) {
                    Ok(_) => {
                        if let Some(ref conv_id) = req.conversation_id {
                            if let Err(e) = validate_conversation_id(conv_id) {
                                let status = match e {
                                    ApiError::InvalidInput(_) => axum::http::StatusCode::BAD_REQUEST,
                                    _ => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                                };
                                return Err((status, Json(serde_json::json!({"error": e.to_string()}))));
                            }
                        }
                        // For tests, return a mock response
                        Ok(Json(ChatResponse {
                            reply: "Mock response".to_string(),
                            conversation_id: req.conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                        }))
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

