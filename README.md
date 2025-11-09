# TTS Project

A high-performance multilingual Text-to-Speech and Chat server built with Rust, featuring Piper TTS engine integration and OpenAI/Ollama LLM support.

## 🚀 Quick Start

**New to the project?** Start here: **[QUICKSTART.md](QUICKSTART.md)**

The quick start guide will walk you through:
- Prerequisites and installation
- Model setup
- Environment configuration
- Building and running the server
- Testing the API

## 📦 Project Structure

This repository contains a Rust workspace with three crates:

- **tts_core** – Wraps Piper TTS models and provides functions for synthesizing speech and computing mel spectrograms.
- **llm_core** – LLM client supporting OpenAI and Ollama, with optional Qdrant integration for conversation history.
- **server** – HTTP API server exposing endpoints for TTS synthesis and conversational chat.

## ✨ Features

### Text-to-Speech
- **Multilingual Support**: Multiple language models via Piper TTS
- **Model Caching**: Efficient model loading and caching
- **Speaker Selection**: Custom speaker selection per request
- **Dynamic Sample Rate**: Reads sample rate from model configuration
- **Audio Formats**: WAV encoding with base64 output
- **Mel Spectrograms**: Visual spectrogram generation

### Chat & LLM
- **OpenAI Integration**: Full OpenAI API support
- **Ollama Support**: Local LLM support via Ollama
- **Conversation History**: Stateful conversations with Qdrant storage
- **Provider Abstraction**: Easy switching between LLM providers

### API Server
- **REST Endpoints**: `/health`, `/voices`, `/tts`, `/chat`
- **WebSocket Streaming**: Real-time audio and spectrogram streaming
- **Input Validation**: Comprehensive request validation
- **Error Handling**: Structured error responses
- **CORS Support**: Full CORS configuration for frontend
- **Request Logging**: Structured logging with tracing
- **Timeout Protection**: Request timeout handling

## 📋 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/voices` | List available languages |
| `GET` | `/voices/detail` | Detailed voice information |
| `POST` | `/tts` | Synthesize speech |
| `POST` | `/chat` | Chat with LLM |
| `GET` | `/stream/:lang/:text` | WebSocket audio streaming |

## 🔧 Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8085` | Server port |
| `OPENAI_API_KEY` | Yes (for OpenAI) | - | OpenAI API key |
| `LLM_PROVIDER` | No | `openai` | `openai` or `ollama` |
| `LLM_MODEL` | No | `gpt-3.5-turbo` | Model name |
| `QDRANT_URL` | No | - | Qdrant server URL (optional) |
| `QDRANT_API_KEY` | No | - | Qdrant API key (optional) |
| `RATE_LIMIT_PER_MINUTE` | No | `60` | Rate limit per minute |
| `RUST_LOG` | No | `info` | Log level |

## 📚 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Complete setup guide
- **[tests/README.md](tests/README.md)** - Testing documentation
- **[frontend/FRONTEND_GUIDE.md](frontend/FRONTEND_GUIDE.md)** - Frontend setup
- **[Postman Collection](tests/postman/TTS_API.postman_collection.json)** - API testing collection

## 🧪 Testing

```bash
# Run all tests
cargo test --workspace

# Run unit tests
cargo test --package server --lib

# Run integration tests
cargo test --test integration
```

## 🚀 Running the Server

```bash
# Development mode
cargo run -p server

# Production mode
cargo run --release -p server
```

Server runs on `http://localhost:8085` by default.

## 📦 Requirements

- **Rust** (1.70+): Install from [rustup.rs](https://rustup.rs)
- **Piper Models**: Download TTS models separately (~70MB each)
- **OpenAI API Key**: Required for chat functionality (optional for TTS only)

## 🤝 Contributing

See [tests/README.md](tests/README.md) for testing guidelines and contribution information.

## 📄 License

This project is part of a Rust workspace implementing TTS and LLM capabilities.
