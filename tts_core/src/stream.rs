//! Streaming synthesis helpers.
//!
//! This module provides an API to generate audio and mel spectrogram
//! frames incrementally. Piper currently synthesizes an entire
//! utterance in one call. To support real-time visualization of
//! speech, we chunk the generated samples into overlapping windows
//! and compute a mel spectrogram frame for each chunk. Each
//! iteration yields a pair `(audio_chunk, mel_frame)`.
//!
//! Note: The `stream_speech` function was removed as it's not currently used.
//! The streaming functionality is implemented directly in the server endpoints.
