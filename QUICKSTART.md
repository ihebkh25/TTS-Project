# Quick Start Guide

## Prerequisites

- **Docker** (recommended) or **Rust** 1.70+ ([rustup.rs](https://rustup.rs))
- Piper TTS models (~70MB each, download from [Piper releases](https://github.com/rhasspy/piper/releases))

## Setup

### Option 1: Docker (Recommended)

```bash
# Run with docker-compose (includes frontend)
docker-compose up --build

# Access:
# - Frontend: http://localhost:8082
# - API: http://localhost:8085
```

The Docker setup includes both server and frontend. Models are mounted from `./models` directory.

### Option 2: Local Build

#### 1. Download Models

```bash
# Create directories
mkdir -p models/de_DE models/fr_FR

# Download models and place in respective directories:
# models/de_DE/de_DE-mls-medium.onnx
# models/de_DE/de_DE-mls-medium.onnx.json
# models/fr_FR/fr_FR-siwis-medium.onnx
# models/fr_FR/fr_FR-siwis-medium.onnx.json
```

Verify `models/map.json`:
```json
{
  "de_DE": {
    "config": "models/de_DE/de_DE-mls-medium.onnx.json",
    "speaker": null
  },
  "fr_FR": {
    "config": "models/fr_FR/fr_FR-siwis-medium.onnx.json",
    "speaker": null
  }
}
```

#### 2. Configure Environment

```bash
# Required for chat
export OPENAI_API_KEY="your_key"
export LLM_PROVIDER="openai"

# Optional
export PORT=8085
export RUST_LOG=info
export PIPER_ESPEAKNG_DATA_DIRECTORY=/usr/share  # For local builds
```

#### 3. Build and Run

```bash
# Build
cargo build --release

# Run server
cargo run --release -p server

# Run frontend (separate terminal)
cd frontend && python3 serve_frontend.py

# Verify
curl http://localhost:8085/health
# Frontend: http://localhost:8082
```

## API Examples

**Health Check:**
```bash
curl http://localhost:8085/health
```

**List Voices:**
```bash
curl http://localhost:8085/voices
```

**Synthesize Speech:**
```bash
curl -X POST http://localhost:8085/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!", "language": "de_DE"}'
```

**Chat:**
```bash
curl -X POST http://localhost:8085/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "conversation_id": null}'
```

## Troubleshooting

**Build errors:**
```bash
cargo clean && cargo build --release
```

**Missing models:**
```bash
python3 scripts/check_models.py
ls -la models/de_DE/
```

**Port in use:**
```bash
export PORT=8086
# or
lsof -i:8085 && kill -9 <PID>
```

**LLM errors:**
```bash
echo $OPENAI_API_KEY  # Verify key is set
curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"
```

**eSpeak-ng errors:**
```bash
# Set data directory (usually /usr/share on Linux)
export PIPER_ESPEAKNG_DATA_DIRECTORY=/usr/share
```

## Next Steps

- **[API Reference](docs/API.md)** - Complete API documentation
- **[Architecture](docs/ARCHITECTURE.md)** - System design
- **[Deployment](docs/DEPLOYMENT.md)** - Production deployment
- **[Testing](tests/README.md)** - Test suite guide

