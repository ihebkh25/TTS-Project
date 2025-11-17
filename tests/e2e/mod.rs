//! End-to-end tests for the TTS project
//! These tests verify complete workflows from user input to final output

mod tts_pipeline;
mod chat_pipeline;
mod websocket_streaming;
mod test_helpers;

pub use tts_pipeline::*;
pub use chat_pipeline::*;
pub use websocket_streaming::*;
pub use test_helpers::*;

