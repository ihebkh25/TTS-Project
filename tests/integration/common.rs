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
        routing::{get, post},
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
    let llm = Arc::new(std::sync::Mutex::new(
        LlmClient::new(LlmProvider::OpenAI, "gpt-3.5-turbo")
            .unwrap_or_else(|_| {
                // Fallback: create without API key for testing
                // Tests that require LLM will need OPENAI_API_KEY set
                LlmClient::new(LlmProvider::OpenAI, "gpt-3.5-turbo")
                    .expect("Failed to create LLM client")
            }),
    ));

    let state = AppState { tts, llm };
    
    // Create a simple test router
    // Note: In a real scenario, you'd want to extract handlers to a shared module
    // For now, we'll create a minimal test app
    use axum::Json;
    
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/voices", get({
            let tts = state.tts.clone();
            move || async move {
                Json(tts.list_languages())
            }
        }))
        .route("/voices/detail", get({
            let tts = state.tts.clone();
            move || async move {
                let mut out = Vec::new();
                for (k, (cfg, spk)) in tts.map_iter() {
                    out.push(serde_json::json!({
                        "key": k,
                        "config": cfg,
                        "speaker": spk
                    }));
                }
                Json(out)
            }
        }))
        .layer(ServiceBuilder::new().layer(CorsLayer::permissive()).into_inner())
        .with_state(state)
}

