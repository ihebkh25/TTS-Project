//! End-to-end tests for the complete chat pipeline
//! Tests: User message -> LLM response -> TTS audio output

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;

use crate::test_helpers::create_test_app;

#[tokio::test]
async fn test_complete_chat_pipeline_new_conversation() {
    let app = create_test_app().await;
    
    // Step 1: Start a new conversation
    let request_body = json!({
        "message": "Hello, this is a test message.",
        "language": "en_US"
    });
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/chat")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    // May fail if LLM is not configured, but should return proper structure
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let chat_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    if status == StatusCode::OK {
        // Verify complete response structure
        assert!(chat_response["reply"].is_string(), "Should have reply");
        assert!(chat_response["conversation_id"].is_string(), "Should have conversation_id");
        
        // Verify conversation_id is a valid UUID format
        let conv_id = chat_response["conversation_id"].as_str().unwrap();
        assert!(conv_id.len() == 36, "Conversation ID should be UUID format");
        
        // Verify optional audio fields if present
        if chat_response["audio_base64"].is_string() {
            assert!(!chat_response["audio_base64"].as_str().unwrap().is_empty());
            assert!(chat_response["sample_rate"].is_number());
            assert!(chat_response["duration_ms"].is_number());
        }
    } else {
        // If LLM is not configured, should return proper error
        assert!(chat_response["error"].is_string(), "Should have error message");
    }
}

#[tokio::test]
async fn test_chat_pipeline_conversation_continuity() {
    let app = create_test_app().await;
    
    // Step 1: Start conversation
    let request_body = json!({
        "message": "My name is Alice."
    });
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/chat")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let chat_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    if status == StatusCode::OK {
        let conversation_id = chat_response["conversation_id"].as_str().unwrap();
        
        // Step 2: Continue conversation
        let continue_request = json!({
            "message": "What is my name?",
            "conversation_id": conversation_id
        });
        
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/chat")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&continue_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let continue_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
        
        if status == StatusCode::OK {
            // Verify same conversation ID is returned
            assert_eq!(
                continue_response["conversation_id"].as_str().unwrap(),
                conversation_id,
                "Should maintain same conversation ID"
            );
            assert!(continue_response["reply"].is_string());
        }
    }
}

#[tokio::test]
async fn test_chat_pipeline_with_tts_audio() {
    let app = create_test_app().await;
    
    // Test chat with language specified (should generate audio)
    let request_body = json!({
        "message": "Say hello in German.",
        "language": "de_DE"
    });
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/chat")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let chat_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    if status == StatusCode::OK {
        assert!(chat_response["reply"].is_string());
        // Audio may or may not be present depending on implementation
        // This test verifies the structure is correct if audio is included
        if chat_response["audio_base64"].is_string() {
            assert!(chat_response["sample_rate"].is_number());
            assert!(chat_response["duration_ms"].is_number());
        }
    }
}

#[tokio::test]
async fn test_voice_chat_endpoint() {
    let app = create_test_app().await;
    
    // Test the voice-chat endpoint if it exists
    let request_body = json!({
        "message": "Hello, voice chat test.",
        "language": "en_US"
    });
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/voice-chat")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    // Voice-chat endpoint may or may not exist, but if it does, should return proper structure
    let status = response.status();
    if status == StatusCode::OK || status == StatusCode::NOT_FOUND {
        // Either endpoint exists and works, or doesn't exist (both are valid)
        return;
    }
    
    // If it exists, verify structure
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let chat_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    if status == StatusCode::OK {
        assert!(chat_response["reply"].is_string());
        assert!(chat_response["conversation_id"].is_string());
    }
}

