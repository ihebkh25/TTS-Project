# TTS Project

High-performance multilingual Text-to-Speech and Chat server built with Rust, featuring Piper TTS engine integration and OpenAI/Ollama LLM support.

## 📚 Documentation

- **[Quick Start](QUICKSTART.md)** - Get started in 5 minutes
- **[API Reference](docs/API.md)** - Complete API documentation
- **[Architecture](docs/ARCHITECTURE.md)** - System design
- **[Deployment](docs/DEPLOYMENT.md)** - Production deployment
- **[Testing](tests/README.md)** - Test suite guide
- **[Docs Index](docs/README.md)** - All documentation

## Quick Start

**Docker (Recommended):**
```bash
# Run with docker-compose (includes frontend)
docker-compose up --build

# Access:
# - Frontend: http://localhost:8082
# - API: http://localhost:8085
```

**Local Build:**
```bash
# Build and run
cargo build --release
cargo run --release -p server

# Required for chat
export OPENAI_API_KEY="your_key"
export LLM_PROVIDER="openai"

# Health check
curl http://localhost:8085/health
```

## Project Structure

Rust workspace with three crates:
- **tts_core** – Piper TTS wrapper for speech synthesis and mel spectrograms
- **llm_core** – LLM client (OpenAI/Ollama) with optional Qdrant conversation history
- **server** – HTTP API server for TTS and chat

## Features

**TTS:** Multilingual support, model caching, speaker selection, WAV/base64 output, mel spectrograms

**LLM:** OpenAI and Ollama support, stateful conversations with Qdrant storage

**API:** REST endpoints, WebSocket streaming, input validation, CORS, structured logging

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/voices` | List available languages |
| `GET` | `/voices/detail` | Detailed voice info |
| `POST` | `/tts` | Synthesize speech |
| `POST` | `/chat` | Chat with LLM |
| `POST` | `/voice-chat` | Chat with audio response |
| `WS` | `/stream/{lang}/{text}` | WebSocket TTS streaming |
| `WS` | `/ws/chat/stream` | WebSocket chat streaming |
| `GET` | `/metrics` | Server metrics |

See [API Reference](docs/API.md) for details.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8085` | Server port |
| `OPENAI_API_KEY` | Yes* | - | OpenAI API key (*for OpenAI provider) |
| `LLM_PROVIDER` | No | `openai` | `openai` or `ollama` |
| `LLM_MODEL` | No | `gpt-3.5-turbo` | Model name |
| `QDRANT_URL` | No | - | Qdrant server URL (optional, must not be empty) |
| `RATE_LIMIT_PER_MINUTE` | No | `60` | Rate limit per minute |
| `RUST_LOG` | No | `info` | Log level |
| `PIPER_ESPEAKNG_DATA_DIRECTORY` | No | `/usr/share` | eSpeak-ng data directory (auto-set in Docker) |

## Requirements

- **Docker** (recommended) or **Rust** 1.70+ ([rustup.rs](https://rustup.rs))
- **Piper Models** (~70MB each, download separately)
- **OpenAI API Key** (required for chat, optional for TTS only)

## Docker

**docker-compose (Recommended):**
```bash
docker-compose up --build
```
- Frontend: http://localhost:8082
- API: http://localhost:8085

**Individual services:**
```bash
# TTS Server
docker build -t tts-server .
docker run -p 8085:8085 -e OPENAI_API_KEY="your_key" tts-server

# Frontend
cd frontend && docker build -t tts-frontend .
docker run -p 8082:80 tts-frontend
```

## Documentation

- **[Quick Start](QUICKSTART.md)** - Setup guide
- **[API Reference](docs/API.md)** - Complete API docs
- **[Architecture](docs/ARCHITECTURE.md)** - System design
- **[Deployment](docs/DEPLOYMENT.md)** - Production guide
- **[Testing](tests/README.md)** - Test suite
- **[All Docs](docs/README.md)** - Documentation index
