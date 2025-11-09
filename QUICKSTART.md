# Quick Start Guide

This guide will help you set up and run the TTS Project server in a production-ready environment.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Model Configuration](#model-configuration)
4. [Environment Configuration](#environment-configuration)
5. [Building the Project](#building-the-project)
6. [Verification](#verification)
7. [Starting the Server](#starting-the-server)
8. [API Testing](#api-testing)
9. [Troubleshooting](#troubleshooting)
10. [Next Steps](#next-steps)

---

## Prerequisites

### System Requirements

Before proceeding, ensure your system meets the following requirements:

| Requirement | Version | Installation |
|------------|---------|--------------|
| **Rust** | 1.70+ | [rustup.rs](https://rustup.rs) |
| **Cargo** | Included with Rust | Automatically installed |
| **Git** | Latest | System package manager |
| **Python** | 3.8+ (optional) | For utility scripts |

### Verification

Verify your installation:

```bash
rustc --version  # Should display 1.70 or higher
cargo --version  # Should display cargo version
git --version    # Should display git version
```

---

## Initial Setup

### 1. Clone and Navigate

```bash
# Navigate to your project directory
cd /path/to/tts_project

# Verify you're in the correct directory
ls -la Cargo.toml
```

### 2. Clean Build Environment (Recommended)

For a clean build, remove any previous build artifacts:

```bash
# Clean Cargo build cache
cargo clean

# Remove target directory (optional, more thorough)
rm -rf target/
```

### 3. Verify Project Structure

Confirm the workspace structure:

```
tts_project/
├── Cargo.toml              # Workspace configuration
├── models/
│   ├── map.json            # Language-to-model mapping
│   └── <lang_code>/        # Model directories
│       ├── *.onnx          # Model binary
│       └── *.onnx.json     # Model configuration
├── tts_core/               # TTS engine wrapper
├── llm_core/               # LLM client abstraction
└── server/                 # HTTP API server
```

---

## Model Configuration

### Overview

TTS models are not included in the repository due to their size (~70MB per model). You must download and configure them separately.

### Download Methods

#### Method 1: Manual Download (Recommended)

1. **Visit the Piper TTS Repository**
   - Navigate to: https://github.com/rhasspy/piper/releases
   - Download models for your target languages

2. **Create Directory Structure**
   ```bash
   mkdir -p models/de_DE
   mkdir -p models/fr_FR
   ```

3. **Place Model Files**
   ```
   models/de_DE/
   ├── de_DE-mls-medium.onnx
   └── de_DE-mls-medium.onnx.json
   
   models/fr_FR/
   ├── fr_FR-siwis-medium.onnx
   └── fr_FR-siwis-medium.onnx.json
   ```

#### Method 2: Automated Script

```bash
# Run the download script (if available)
python3 scripts/download_voices.py

# Verify models are correctly placed
python3 scripts/check_models.py
```

### Model Configuration

Verify `models/map.json` contains valid entries:

```bash
cat models/map.json
```

**Expected Format:**
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

**Validation:**
- Paths must be relative to project root
- Model files must exist at specified paths
- JSON syntax must be valid

---

## Environment Configuration

### Configuration Methods

#### Option 1: Environment File (Recommended)

Create a `.env` file in the project root:

```bash
# Create from template (if available)
cp .env.example .env

# Or create manually
touch .env
```

**Configuration Template:**

```bash
# ============================================
# LLM Configuration
# ============================================
OPENAI_API_KEY=your_openai_api_key_here
LLM_PROVIDER=openai                    # Options: openai, ollama
LLM_MODEL=gpt-3.5-turbo               # Model name

# ============================================
# Server Configuration
# ============================================
PORT=8085                              # Server port
RATE_LIMIT_PER_MINUTE=60              # Rate limit (currently disabled)
RUST_LOG=info                          # Log level: error, warn, info, debug, trace

# ============================================
# Qdrant Configuration (Optional)
# ============================================
# QDRANT_URL=http://localhost:6333
# QDRANT_API_KEY=

# ============================================
# Ollama Configuration (Optional)
# ============================================
# OLLAMA_BASE_URL=http://localhost:11434
```

**Security Note:** The `.env` file is gitignored and will not be committed to version control.

#### Option 2: Environment Variables

Set variables in your shell session:

```bash
export OPENAI_API_KEY="your_key_here"
export LLM_PROVIDER="openai"
export LLM_MODEL="gpt-3.5-turbo"
export PORT=8085
export RUST_LOG=info
```

For persistent configuration, add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.).

### Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes* | - | OpenAI API key (*required for OpenAI provider) |
| `LLM_PROVIDER` | No | `openai` | LLM provider: `openai` or `ollama` |
| `LLM_MODEL` | No | `gpt-3.5-turbo` | Model identifier |
| `PORT` | No | `8085` | HTTP server port |
| `RATE_LIMIT_PER_MINUTE` | No | `60` | Requests per minute (currently disabled) |
| `QDRANT_URL` | No | - | Qdrant server URL for conversation history |
| `QDRANT_API_KEY` | No | - | Qdrant API key (if authentication required) |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL |
| `RUST_LOG` | No | `info` | Logging level |

---

## Building the Project

### Build Commands

#### Development Build

```bash
# Debug build (faster compilation, larger binary)
cargo build
```

**Use Case:** Development and debugging

#### Production Build

```bash
# Release build (optimized, smaller binary)
cargo build --release
```

**Use Case:** Production deployment

**Build Time:** Initial build may take 5-10 minutes as it compiles all dependencies.

### Build Optimization

#### Limited Parallelism (Timeout Issues)

If you encounter compilation timeouts:

```bash
# Clean previous builds
cargo clean

# Build with limited parallelism
CARGO_BUILD_JOBS=2 cargo build --release
```

#### Sequential Build (Memory Issues)

For systems with limited memory:

```bash
# Build crates individually
cargo build --package tts_core --release
cargo build --package llm_core --release
cargo build --package server --release
```

#### Build Verification

```bash
# Verify all crates compile without building binaries
cargo check --workspace
```

**Expected Output:**
```
Finished `dev` profile [unoptimized + debuginfo] target(s)
```

---

## Verification

### Compilation Check

```bash
# Verify workspace compiles
cargo check --workspace
```

### Unit Tests

Run validation tests to ensure core functionality:

```bash
# Run unit tests
cargo test --package server --lib
```

**Expected Output:**
```
running 9 tests
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured
```

### Integration Tests (Optional)

```bash
# Run integration tests
cargo test --test integration
```

---

## Starting the Server

### Development Mode

```bash
# Start with default settings
cargo run -p server

# Start with explicit logging
RUST_LOG=info cargo run -p server

# Start with debug logging
RUST_LOG=debug cargo run -p server
```

### Production Mode

```bash
# Start optimized server
cargo run --release -p server
```

### Server Verification

Once started, verify the server is running:

```bash
# Health check
curl http://localhost:8085/health
```

**Expected Response:** `ok`

**Server Logs:**
```
2024-XX-XX INFO server: Starting TTS server...
2024-XX-XX INFO server: Using LLM provider: OpenAI, model: gpt-3.5-turbo
2024-XX-XX INFO server: Initializing LLM client without storage
2024-XX-XX INFO server: Loading TTS models...
2024-XX-XX INFO server: Loaded 2 TTS models
2024-XX-XX INFO server: Server listening on http://0.0.0.0:8085
```

---

## API Testing

### Health Check

```bash
curl http://localhost:8085/health
```

**Response:** `ok`

### List Available Voices

```bash
curl http://localhost:8085/voices
```

**Response:**
```json
["de_DE", "fr_FR"]
```

### Synthesize Speech

```bash
curl -X POST http://localhost:8085/tts \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, world!",
    "language": "de_DE"
  }' \
  --output output.wav
```

**Response:**
```json
{
  "audio_base64": "UklGRiQAAABXQVZFZm10...",
  "spectrogram_base64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "duration_ms": 1234,
  "sample_rate": 22050
}
```

### Chat Endpoint

```bash
curl -X POST http://localhost:8085/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello, how are you?",
    "conversation_id": null
  }'
```

**Response:**
```json
{
  "reply": "Hello! I'm doing well, thank you for asking...",
  "conversation_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### WebSocket Streaming

For real-time audio streaming:

```bash
# Install wscat (if not installed)
npm install -g wscat

# Connect to WebSocket endpoint
wscat -c ws://localhost:8085/stream/de_DE/Hello%20world
```

**Note:** WebSocket streams audio chunks and mel spectrogram frames in real-time.

### Postman Collection

For comprehensive API testing, import the Postman collection:

- **Location:** `tests/postman/TTS_API.postman_collection.json`
- **Documentation:** See `tests/postman/README.md` for usage instructions

---

## Troubleshooting

### Build Errors

**Issue:** Compilation errors or dependency conflicts

**Solution:**
```bash
# Clean and rebuild
cargo clean
cargo build --release

# Update dependencies
cargo update
```

### Missing Models

**Issue:** "Model not found" errors

**Diagnosis:**
```bash
# Check model files exist
ls -la models/de_DE/

# Verify map.json configuration
cat models/map.json

# Check file paths are correct
python3 scripts/check_models.py
```

**Solution:**
1. Verify model files are in correct directories
2. Ensure `models/map.json` paths are relative to project root
3. Check file permissions

### Port Already in Use

**Issue:** Port 8085 is already in use

**Diagnosis:**
```bash
# Check what's using the port
lsof -i:8085

# Or on Linux
netstat -tulpn | grep 8085
```

**Solution:**
```bash
# Option 1: Use different port
export PORT=8086
cargo run -p server

# Option 2: Stop the process using the port
kill -9 <PID>
```

### LLM Errors

**Issue:** Chat endpoint returns errors

**Diagnosis:**
```bash
# Verify API key is set
echo $OPENAI_API_KEY

# Check provider configuration
echo $LLM_PROVIDER

# Test OpenAI API connectivity
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**Solution:**
1. Verify `OPENAI_API_KEY` is set correctly
2. Check API key has sufficient credits
3. For Ollama, ensure service is running: `curl http://localhost:11434/api/tags`

### Qdrant Connection Errors

**Issue:** Qdrant storage not working

**Diagnosis:**
```bash
# Check Qdrant is running
curl http://localhost:6333/health

# Verify environment variables
echo $QDRANT_URL
echo $QDRANT_API_KEY
```

**Solution:**
1. Ensure Qdrant server is running
2. Verify `QDRANT_URL` is correct
3. Check API key if authentication is enabled
4. **Note:** Qdrant is optional - server works without it

### Runtime Errors

**Issue:** Server panics or crashes

**Diagnosis:**
```bash
# Run with verbose logging
RUST_LOG=debug cargo run -p server

# Check system resources
top
df -h
```

**Solution:**
1. Check server logs for error messages
2. Verify sufficient disk space
3. Check memory availability
4. Review model file integrity

---

## Next Steps

### Documentation

- **[README.md](README.md)** - Project overview and API documentation
- **[PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md)** - Architecture and technical details
- **[tests/README.md](tests/README.md)** - Testing documentation and guidelines
- **[frontend/FRONTEND_GUIDE.md](frontend/FRONTEND_GUIDE.md)** - Frontend setup and usage

### Development

- **Run Tests:** `cargo test --workspace`
- **Code Coverage:** `cargo tarpaulin --workspace --out Html`
- **Linting:** `cargo clippy --workspace`

### Production Deployment

1. Build release binary: `cargo build --release`
2. Configure environment variables
3. Set up process manager (systemd, supervisor, etc.)
4. Configure reverse proxy (nginx, Caddy, etc.)
5. Set up monitoring and logging

### API Testing

- **Postman Collection:** Import `tests/postman/TTS_API.postman_collection.json`
- **Integration Tests:** `cargo test --test integration`
- **Manual Testing:** Use curl commands or frontend interface

---

## Quick Reference

### Essential Commands

```bash
# Clean build
cargo clean && cargo build --release

# Start server
cargo run --release -p server

# Run tests
cargo test --workspace

# Verify models
python3 scripts/check_models.py

# Health check
curl http://localhost:8085/health
```

### Environment Variables

```bash
# Required for chat
export OPENAI_API_KEY="your_key"
export LLM_PROVIDER="openai"

# Optional
export PORT=8085
export RUST_LOG=info
```

### Common Workflows

**Development:**
```bash
cargo build
RUST_LOG=debug cargo run -p server
```

**Production:**
```bash
cargo build --release
RUST_LOG=info cargo run --release -p server
```

**Testing:**
```bash
cargo test --workspace -- --nocapture
```

---

## Support

For additional help:

1. **Check Documentation:** Review `README.md` and `PROJECT_ANALYSIS.md`
2. **Review Logs:** Check server logs with `RUST_LOG=debug`
3. **Test Endpoints:** Use Postman collection or curl commands
4. **Verify Configuration:** Ensure all environment variables are set correctly

---

**Last Updated:** 2024  
**Server Port:** 8085  
**Status:** Production Ready ✅
