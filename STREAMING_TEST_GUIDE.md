# LLM Streaming Test Guide

## Overview

The LLM streaming implementation has been completed and is ready for testing. This guide explains how to test the streaming functionality.

## Implementation Summary

### ✅ Completed Features

1. **LLM Core Streaming**
   - OpenAI streaming with SSE parsing
   - Ollama streaming with JSON lines parsing
   - Conversation history management during streaming

2. **WebSocket Endpoint**
   - Endpoint: `/ws/chat/stream`
   - Real-time token streaming
   - Parallel TTS audio chunk generation
   - Proper cleanup and error handling

### Message Types

The WebSocket endpoint sends the following message types:

1. **`status`** - Connection and completion status
   ```json
   {
     "type": "status",
     "status": "streaming" | "complete",
     "message": "Starting LLM stream...",
     "text": "Full response text" // Only in complete status
   }
   ```

2. **`token`** - Individual LLM tokens
   ```json
   {
     "type": "token",
     "token": "Hello",
     "text": "Hello" // Accumulated text so far
   }
   ```

3. **`audio_chunk`** - TTS audio chunks (base64 WAV)
   ```json
   {
     "type": "audio_chunk",
     "audio": "UklGRiQAAABXQVZFZm10...",
     "sample_rate": 22050
   }
   ```

4. **`error`** - Error messages
   ```json
   {
     "type": "error",
     "error": "Error message",
     "code": 500
   }
   ```

## Testing

### Prerequisites

1. **Server Running**
   ```bash
   # Set environment variables
   export OPENAI_API_KEY="your_key"  # For OpenAI
   # OR
   export LLM_PROVIDER=ollama
   export OLLAMA_BASE_URL=http://localhost:11434
   
   # Run server
   cargo run --release -p server
   ```

2. **Test Tools** (choose one):
   - Node.js with `ws` package: `npm install ws`
   - Python with `websockets`: `pip install websockets`
   - `websocat`: `cargo install websocat`
   - `wscat`: `npm install -g wscat`

### Test Scripts

#### Option 1: Node.js Test Script

```bash
node test_streaming.js "Hello, how are you?" en_US
```

#### Option 2: Python Test Script

```bash
python3 test_streaming.py "Hello, how are you?" en_US
```

#### Option 3: Using websocat

```bash
MESSAGE="Hello, how are you?"
LANGUAGE="en_US"
URL="ws://localhost:8085/ws/chat/stream?message=$(echo -n "$MESSAGE" | jq -sRr @uri)&language=$LANGUAGE"
websocat "$URL" --text
```

#### Option 4: Using wscat

```bash
MESSAGE="Hello, how are you?"
LANGUAGE="en_US"
URL="ws://localhost:8085/ws/chat/stream?message=$(echo -n "$MESSAGE" | jq -sRr @uri)&language=$LANGUAGE"
wscat -c "$URL"
```

### Manual Testing with curl (WebSocket Upgrade)

```bash
# Note: curl doesn't support WebSocket directly, use one of the tools above
# But you can test the endpoint exists:
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  "http://localhost:8085/ws/chat/stream?message=Hello&language=en_US"
```

## Expected Behavior

1. **Connection**: WebSocket connects successfully
2. **Initial Status**: Receives `status` message with "streaming"
3. **Token Stream**: Receives multiple `token` messages as LLM generates response
4. **Audio Chunks**: Receives `audio_chunk` messages as text accumulates (every ~50 characters)
5. **Completion**: Receives final `status` message with "complete" and full text
6. **Connection Close**: WebSocket closes cleanly

## Debugging

### Common Issues

1. **Connection Refused**
   - Check if server is running: `curl http://localhost:8085/health`
   - Check server logs for errors

2. **No Tokens Received**
   - Check LLM provider configuration (OPENAI_API_KEY or OLLAMA_BASE_URL)
   - Check server logs for LLM errors
   - Verify message parameter is not empty

3. **No Audio Chunks**
   - Check if TTS models are loaded: `curl http://localhost:8085/voices`
   - Verify language parameter matches available models
   - Check server logs for TTS errors

4. **Stream Stops Prematurely**
   - Check server logs for errors
   - Verify LLM timeout settings
   - Check network connectivity

### Server Logs

Enable debug logging:
```bash
export RUST_LOG=debug
cargo run --release -p server
```

Look for:
- `[INFO]` - Normal operation
- `[WARN]` - Warnings (non-fatal)
- `[ERROR]` - Errors (fatal)

## Test Cases

### Test Case 1: Basic Streaming
```bash
node test_streaming.js "What is the capital of France?" en_US
```
**Expected**: Tokens stream in, audio chunks generated, completion message received.

### Test Case 2: Conversation Context
```bash
CONV_ID=$(uuidgen)
node test_streaming.js "My name is Alice" en_US "$CONV_ID"
node test_streaming.js "What is my name?" en_US "$CONV_ID"
```
**Expected**: Second message should remember the name from first message.

### Test Case 3: Long Response
```bash
node test_streaming.js "Write a short story about a robot" en_US
```
**Expected**: Multiple tokens and audio chunks, proper completion.

### Test Case 4: Error Handling
```bash
# Missing message parameter
curl "http://localhost:8085/ws/chat/stream?language=en_US"
```
**Expected**: Error message sent via WebSocket.

## Performance Metrics

Monitor:
- **Time to first token**: Should be < 2 seconds
- **Token rate**: Tokens per second
- **Audio chunk latency**: Time from text to audio
- **Total completion time**: End-to-end latency

## Next Steps

After successful testing:
1. Integrate with frontend chat interface
2. Add real-time UI updates for tokens
3. Implement audio playback for chunks
4. Add conversation management UI

---

*Last updated: 2024*

