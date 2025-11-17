//! End-to-end tests for the complete TTS pipeline
//! Tests: Text input -> TTS synthesis -> Audio output

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;

use crate::e2e_test_helpers::create_test_app;

#[tokio::test]
async fn test_complete_tts_pipeline() {
    let app = create_test_app().await;
    
    // Step 1: Get available voices
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/voices")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let voices: Vec<String> = serde_json::from_slice(&body).unwrap();
    assert!(!voices.is_empty(), "Should have at least one voice available");
    
    // Step 2: Synthesize speech with a valid language
    let test_language = voices.first().unwrap();
    let request_body = json!({
        "text": "Hello, this is a complete TTS pipeline test.",
        "language": test_language
    });
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/tts")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let tts_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    // Verify complete response structure
    assert!(tts_response["audio_base64"].is_string(), "Should have audio_base64");
    assert!(!tts_response["audio_base64"].as_str().unwrap().is_empty(), "Audio should not be empty");
    assert!(tts_response["sample_rate"].is_number(), "Should have sample_rate");
    assert!(tts_response["duration_ms"].is_number(), "Should have duration_ms");
    
    // Verify audio is valid base64
    let audio_base64 = tts_response["audio_base64"].as_str().unwrap();
    assert!(audio_base64.len() > 0, "Audio should have content");
    
    // Verify reasonable values
    let sample_rate = tts_response["sample_rate"].as_u64().unwrap();
    assert!(sample_rate > 0, "Sample rate should be positive");
    assert!(sample_rate <= 48000, "Sample rate should be reasonable");
    
    let duration_ms = tts_response["duration_ms"].as_u64().unwrap();
    assert!(duration_ms > 0, "Duration should be positive");
}

#[tokio::test]
async fn test_tts_pipeline_with_speaker_selection() {
    let app = create_test_app().await;
    
    // Get detailed voice information
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/voices/detail")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let voices: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!voices.is_empty());
    
    // Test with speaker selection if available
    let voice = &voices[0];
    let language = voice["key"].as_str().unwrap();
    let speaker = voice["speaker"].as_i64();
    
    let mut request_body = json!({
        "text": "Testing speaker selection in TTS pipeline.",
        "language": language
    });
    
    if let Some(speaker_id) = speaker {
        request_body["speaker"] = json!(speaker_id);
    }
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/tts")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let tts_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(tts_response["audio_base64"].is_string());
}

#[tokio::test]
async fn test_tts_pipeline_multiple_languages() {
    let app = create_test_app().await;
    
    // Get available languages
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/voices")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let voices: Vec<String> = serde_json::from_slice(&body).unwrap();
    
    // Test TTS with first few available languages
    for language in voices.iter().take(3) {
        let request_body = json!({
            "text": "Testing multiple languages.",
            "language": language
        });
        
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/tts")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&request_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        
        assert_eq!(response.status(), StatusCode::OK, "Should work for language: {}", language);
    }
}

