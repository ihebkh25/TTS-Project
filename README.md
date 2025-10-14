# TTS Project Structure

This repository contains a Rust workspace with three crates:

- **tts_core** – wraps Piper TTS models and provides functions for synthesizing speech and computing mel spectrograms.
- **llm_core** – loads a local LLM, stores conversation history in Qdrant and generates replies.
- **server** – exposes HTTP endpoints (`/tts` and `/chat`) for text‑to‑speech synthesis and conversational chat.

Download the necessary models into a `models` directory at the root of the workspace.  Then run `cargo run -p server` to start the API server.
