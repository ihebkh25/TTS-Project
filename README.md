# TTS Project

High-performance multilingual Text-to-Speech server built with Rust, featuring Piper TTS engine integration.

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

# Health check
curl http://localhost:8085/health
```

## Project Structure

Rust workspace with two crates:
- **tts_core** – Piper TTS wrapper for speech synthesis and mel spectrograms
- **server** – HTTP API server for TTS

## Features

### Text-to-Speech (TTS)
- **Multilingual Support**: 7+ languages (English, German, French, Dutch, Spanish, Italian, Ukrainian)
- **Multiple Voices**: Multiple voices per language with metadata (gender, quality)
- **Model Caching**: Efficient in-memory model caching for fast synthesis
- **Audio Formats**: WAV output with base64 encoding
- **Mel Spectrograms**: Real-time mel spectrogram generation for visualization
- **Real-time Streaming**: WebSocket-based streaming with progressive audio chunks

### API & Infrastructure
- **REST API**: Comprehensive REST endpoints for TTS
- **WebSocket Streaming**: Real-time audio streaming
- **Input Validation**: Robust request validation with helpful error messages
- **Rate Limiting**: Configurable rate limiting (default: 60 req/min)
- **CORS Support**: Configurable CORS for cross-origin requests
- **Structured Logging**: Comprehensive logging with tracing
- **Metrics**: System metrics endpoint (CPU, memory, request count, uptime)

## API Endpoints

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` / `/healthz` | Health check |
| `GET` | `/voices` | List available language codes |
| `GET` | `/voices/detail` | Detailed voice information (all voices with metadata) |
| `POST` | `/tts` | Synthesize speech (returns base64 WAV) |
| `GET` | `/metrics` | Server metrics (CPU, memory, request count, uptime) |

### WebSocket Endpoints

| Endpoint | Description |
|----------|-------------|
| `WS /stream/{lang}/{text}?voice={voice_id}` | Real-time TTS audio streaming with mel spectrogram |

**Note:** All REST endpoints are also available under `/api` prefix.

See [API Reference](docs/API.md) for complete documentation, request/response formats, and examples.

## Configuration

### Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8085` | Server port |
| `RATE_LIMIT_PER_MINUTE` | No | `60` | Rate limit per minute |
| `REQUEST_TIMEOUT_SECS` | No | `60` | General request timeout (seconds) |
| `CORS_ALLOWED_ORIGINS` | No | - | Comma-separated list of allowed origins |
| `RUST_LOG` | No | `info` | Log level (trace, debug, info, warn, error) |

### TTS Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PIPER_ESPEAKNG_DATA_DIRECTORY` | No | `/usr/share` | eSpeak-ng data directory (auto-set in Docker) |

**Model Configuration:** Voice models are configured in `models/map.json`. See [Architecture](docs/ARCHITECTURE.md#model-configuration) for details.

## Requirements

### For Docker Deployment
- **Docker** and **Docker Compose**
- **Piper TTS Models** (~70MB each, download separately)

### For Local Development
- **Rust** 1.70+ ([rustup.rs](https://rustup.rs))
- **Piper TTS Models** (~70MB each, download separately)
- **Python 3** (for frontend development server, optional)

### Model Setup
1. Download Piper models from [Piper releases](https://github.com/rhasspy/piper/releases)
2. Place models in `./models/{language}/{voice}/` directory
3. Update `models/map.json` with model paths
4. Verify with: `python3 scripts/check_models.py`

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
docker run -p 8085:8085 tts-server

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
