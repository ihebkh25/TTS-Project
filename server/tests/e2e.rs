//! End-to-end test entry point
//! Run with: cargo test --test e2e

mod e2e_tts_pipeline;
mod e2e_chat_pipeline;
mod e2e_websocket_streaming;
mod e2e_test_helpers;

pub use e2e_test_helpers::*;

