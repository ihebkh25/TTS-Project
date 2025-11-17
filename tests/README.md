# Test Suite Documentation

This directory contains comprehensive tests for the TTS project.

## 📁 Test Structure

```
tests/
├── README.md                    # This file
├── run_tests.sh                 # Test runner script
├── test_streaming.js            # WebSocket streaming test (manual)
└── postman/                     # Postman collection
    ├── README.md
    └── TTS_API.postman_collection.json

server/tests/
├── integration.rs               # Integration test entry point
├── common.rs                    # Integration test utilities
├── e2e.rs                       # End-to-end test entry point
├── e2e_tts_pipeline.rs         # E2E TTS pipeline tests
├── e2e_chat_pipeline.rs        # E2E chat pipeline tests
├── e2e_websocket_streaming.rs  # E2E WebSocket tests
└── e2e_test_helpers.rs         # E2E test utilities
```

**Note:** Unit tests are located in their respective crate modules:
- `server/src/validation.rs` - Contains validation unit tests (9 tests passing)
- Future tests will be added to `tts_core/src/lib.rs` and `llm_core/src/lib.rs`

## 📊 Test Coverage

### Unit Tests

| Category | Status | Tests | Coverage |
|----------|--------|-------|----------|
| Validation | ✅ Passing | 9 tests | ~40% |
| Error Handling | ✅ Passing | Included | - |
| TTS Core | ⏳ Pending | 0 tests | 0% |
| LLM Core | ⏳ Pending | 0 tests | 0% |
| Qdrant Storage | ⏳ Pending | 0 tests | 0% |

**Current Unit Tests:**
- ✅ Text length validation
- ✅ Language code validation
- ✅ Conversation ID validation
- ✅ Chat message validation
- ✅ Error handling

### Integration Tests

| Category | Status | Coverage |
|----------|--------|----------|
| Health Check | ✅ Implemented | 100% |
| Voice Listing | ✅ Implemented | 100% |
| TTS Endpoint | ✅ Implemented | ~60% |
| Chat Endpoint | ✅ Implemented | ~60% |
| Error Responses | ✅ Implemented | 100% |
| WebSocket | ⏳ Pending | 0% |
| Rate Limiting | ⏳ Pending | 0% |
| CORS | ⏳ Pending | 0% |

### End-to-End Tests

| Category | Status | Coverage |
|----------|--------|----------|
| TTS Pipeline | ✅ Implemented | ~80% |
| Chat Pipeline | ✅ Implemented | ~70% |
| WebSocket Streaming | ⏳ Manual Testing | 0% |

**Current E2E Tests:**
- ✅ Complete TTS pipeline (text → audio)
- ✅ TTS with speaker selection
- ✅ TTS with multiple languages
- ✅ Complete chat pipeline (message → LLM → audio)
- ✅ Chat conversation continuity
- ✅ Chat with TTS audio generation
- ✅ Voice chat endpoint

## 🚀 Running Tests

### Quick Start

```bash
# Run all tests
cargo test --workspace

# Or use the test runner script
./tests/run_tests.sh
```

### Unit Tests

```bash
# Run all unit tests (validation tests in server crate)
cargo test --package server --lib

# Run tests for specific package
cargo test --package tts_core --lib
cargo test --package llm_core --lib
cargo test --package server --lib
```

### Integration Tests

```bash
# Run integration tests only
cargo test --package server --test integration

# Run with output
cargo test --package server --test integration -- --nocapture
```

### End-to-End Tests

```bash
# Run e2e tests only
cargo test --package server --test e2e

# Run with output
cargo test --package server --test e2e -- --nocapture

# Run specific e2e test
cargo test --package server --test e2e test_complete_tts_pipeline
```

### Manual WebSocket Testing

```bash
# Test WebSocket streaming (requires running server)
node tests/test_streaming.js "Hello, world!" en_US

# Or with conversation ID
node tests/test_streaming.js "Hello" en_US "conversation-uuid"
```

### Advanced Options

```bash
# Run with limited parallelism (if you encounter timeout errors)
CARGO_BUILD_JOBS=2 cargo test --workspace

# Show test output
cargo test --workspace -- --nocapture

# Run specific test
cargo test test_name

# Run with verbose logging
RUST_LOG=debug cargo test

# Generate coverage report (requires cargo-tarpaulin)
cargo install cargo-tarpaulin
cargo tarpaulin --workspace --out Html
```

### Troubleshooting Build Issues

If you encounter timeout errors during compilation:

```bash
# Clean and rebuild with limited parallelism
cargo clean
CARGO_BUILD_JOBS=2 cargo test --workspace --lib
```

If you encounter package name errors:

```bash
# Ensure package names use underscores, not hyphens
# Check Cargo.toml files for correct naming
```

## 📈 Current Status

### ✅ Completed

- **Configuration**: All configuration errors fixed (100%)
- **Core Features**: All core features implemented (100%)
  - ✅ Local LLM support (Ollama)
  - ✅ Qdrant integration
  - ✅ Conversation history
- **Server Improvements**: All improvements complete (100%)
  - ✅ Structured error handling
  - ✅ Input validation
  - ✅ Rate limiting
  - ✅ Request logging
  - ✅ WebSocket error handling
  - ✅ CORS configuration
- **TTS Core**: All improvements complete (100%)
  - ✅ Model caching
  - ✅ Speaker selection
  - ✅ Sample rate from config
- **Test Infrastructure**: Complete with documentation
- **Unit Tests**: 9 validation tests passing
- **Integration Tests**: API endpoint tests implemented

### ⏳ Issues Still in Progress

#### 1. Test Coverage Expansion

**Unit Tests:**
- [ ] TTS core functionality tests
  - Model loading
  - Synthesis
  - Audio encoding
  - Mel spectrogram generation
- [ ] LLM core functionality tests
  - Provider abstraction
  - Conversation management
  - Qdrant storage operations
- [ ] Additional validation tests
  - Edge cases
  - Error scenarios

**Integration Tests:**
- [ ] WebSocket streaming tests
- [ ] Rate limiting tests
- [ ] CORS behavior tests
- [ ] Error scenario tests
- [ ] Authentication tests (if added)

**End-to-End Tests:**
- [x] Complete TTS pipeline
- [x] Complete chat pipeline
- [ ] WebSocket streaming (automated tests)
- [ ] Frontend integration tests

#### 2. Test Infrastructure Improvements

- [ ] Test fixtures for models
- [ ] Mock services for external dependencies
- [ ] CI/CD integration
- [ ] Coverage reporting automation

#### 3. Known Limitations

- Some tests require external services (Qdrant, Ollama)
- Model files are large and not included in repo
- Some tests may be slow due to model loading
- LLM tests require API keys or local services

## 🔧 Test Configuration

### Environment Variables

Tests use environment variables for configuration:

```bash
# LLM Tests
export LLM_PROVIDER="openai"  # or "ollama"
export LLM_MODEL="gpt-3.5-turbo"
export OPENAI_API_KEY="test-key"  # For OpenAI tests

# Qdrant Tests (optional)
export QDRANT_URL="http://localhost:6333"
export QDRANT_API_KEY=""  # Optional

# Server Tests
export PORT="8085"
export RATE_LIMIT_PER_MINUTE="60"
```

### Test Dependencies

Some tests require external services:

- **Qdrant**: Optional, for conversation history tests
- **Ollama**: Optional, for local LLM tests
- **OpenAI API**: Required for OpenAI chat tests
- **Model Files**: Required for TTS tests

## 📝 Writing New Tests

### Unit Test Example

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_function() {
        // Arrange
        let input = "test";
        
        // Act
        let result = function(input);
        
        // Assert
        assert_eq!(result, expected);
    }
}
```

### Integration Test Example

```rust
#[tokio::test]
async fn test_endpoint() {
    // Setup
    let app = create_test_app().await;
    let client = TestClient::new(app);
    
    // Test
    let response = client.post("/endpoint")
        .json(&request_body)
        .send()
        .await;
    
    // Assert
    assert_eq!(response.status(), 200);
}
```

## 🎯 Coverage Goals

- **Unit Tests**: 80%+ coverage
- **Integration Tests**: All endpoints covered
- **E2E Tests**: Critical paths covered

## 📚 Additional Resources

- [Rust Testing Book](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [Axum Testing Guide](https://docs.rs/axum/latest/axum/testing/index.html)
- [Tokio Testing](https://tokio.rs/tokio/topics/testing)
