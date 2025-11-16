//! Integration tests for the TTS project

mod common;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;

use common::*;

#[tokio::test]
async fn test_health_check() {
    let app = create_test_app().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body, "ok");
}

#[tokio::test]
async fn test_list_voices() {
    let app = create_test_app().await;
    let response = app
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
    assert!(!voices.is_empty());
}

#[tokio::test]
async fn test_list_voices_detail() {
    let app = create_test_app().await;
    let response = app
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
}

#[tokio::test]
async fn test_tts_endpoint_success() {
    let app = create_test_app().await;
    let request_body = json!({
        "text": "Hello, this is a test",
        "language": "de_DE"
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
    
    assert!(tts_response["audio_base64"].is_string());
    assert!(tts_response["sample_rate"].is_number());
    assert!(tts_response["duration_ms"].is_number());
}

#[tokio::test]
async fn test_tts_endpoint_validation_empty_text() {
    let app = create_test_app().await;
    let request_body = json!({
        "text": "",
        "language": "de_DE"
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

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let error: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(error["error"].is_string());
}

#[tokio::test]
async fn test_tts_endpoint_validation_long_text() {
    let app = create_test_app().await;
    let long_text = "a".repeat(6000); // Exceeds 5000 char limit
    let request_body = json!({
        "text": long_text,
        "language": "de_DE"
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

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_tts_endpoint_validation_invalid_language() {
    let app = create_test_app().await;
    let request_body = json!({
        "text": "Hello",
        "language": "invalid_lang"
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

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_chat_endpoint_success() {
    let app = create_test_app().await;
    let request_body = json!({
        "message": "Hello, how are you?"
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

    // May fail if LLM is not configured, but should return proper error
    let status = response.status();
    assert!(status == StatusCode::OK || status == StatusCode::INTERNAL_SERVER_ERROR);
    
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let chat_response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    if status == StatusCode::OK {
        assert!(chat_response["reply"].is_string());
        assert!(chat_response["conversation_id"].is_string());
    } else {
        assert!(chat_response["error"].is_string());
    }
}

#[tokio::test]
async fn test_chat_endpoint_with_conversation_id() {
    let app = create_test_app().await;
    let conversation_id = uuid::Uuid::new_v4().to_string();
    let request_body = json!({
        "message": "Hello",
        "conversation_id": conversation_id
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
    assert!(status == StatusCode::OK || status == StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn test_chat_endpoint_validation_empty_message() {
    let app = create_test_app().await;
    let request_body = json!({
        "message": ""
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

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_chat_endpoint_validation_invalid_conversation_id() {
    let app = create_test_app().await;
    let request_body = json!({
        "message": "Hello",
        "conversation_id": "invalid-uuid"
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

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_not_found_endpoint() {
    let app = create_test_app().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/nonexistent")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
