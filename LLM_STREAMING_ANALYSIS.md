# LLM Backend Streaming Support Analysis

## Executive Summary

**Current Status: ❌ Streaming NOT Supported**

The LLM backend currently does **NOT** support streaming. However, both underlying providers (OpenAI and Ollama) **DO** support streaming at the API level. The limitation is in the current implementation which uses blocking HTTP clients.

---

## Current Implementation Analysis

### 1. LLM Provider Trait

**Location:** `llm_core/src/lib.rs:48-51`

```rust
pub trait LlmProviderTrait {
    fn chat(&self, messages: &[Message]) -> Result<String>;
    fn provider_type(&self) -> LlmProvider;
}
```

**Analysis:**
- Returns complete `String` response (not a stream)
- No streaming method in the trait
- Blocking API design

### 2. OpenAI Client

**Location:** `llm_core/src/lib.rs:122-184`

**Current Implementation:**
- Uses `reqwest::blocking::Client` (blocking HTTP client)
- Makes single POST request to `/v1/chat/completions`
- Waits for complete response
- No `stream: true` parameter in request

**OpenAI API Support:**
- ✅ OpenAI API **DOES** support streaming via `stream: true` parameter
- ✅ Returns Server-Sent Events (SSE) with incremental tokens
- ✅ Format: `data: {"choices": [{"delta": {"content": "token"}}]}`

**What's Missing:**
- No `stream` parameter in request struct
- Blocking client can't handle SSE streams efficiently
- No streaming response parsing

### 3. Ollama Client

**Location:** `llm_core/src/lib.rs:215-249`

**Current Implementation:**
```rust
struct Req { model: String, messages: Vec<Msg>, stream: bool }
// ...
let body = Req { 
    model: self.model.clone(), 
    messages: msgs, 
    stream: false  // ❌ Hardcoded to false
};
```

**Ollama API Support:**
- ✅ Ollama API **DOES** support streaming via `stream: true` parameter
- ✅ Returns JSON lines with incremental tokens
- ✅ Format: `{"message": {"content": "token"}, "done": false}`

**What's Missing:**
- `stream` field exists but is hardcoded to `false`
- Comment says: "Use non-streaming for now (blocking client doesn't handle streaming well)"
- No streaming response parsing

### 4. Dependencies

**Location:** `llm_core/Cargo.toml`

```toml
reqwest = { version = "0.11", features = ["json", "blocking"] }
```

**Analysis:**
- Uses `blocking` feature (synchronous client)
- Would need `tokio` async runtime for streaming
- Already has `tokio` as dependency (for other features)

---

## Provider API Streaming Support

### OpenAI Streaming API

**Endpoint:** `POST https://api.openai.com/v1/chat/completions`

**Request:**
```json
{
  "model": "gpt-3.5-turbo",
  "messages": [...],
  "stream": true  // ✅ Enable streaming
}
```

**Response Format (SSE):**
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo-0125","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo-0125","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: [DONE]
```

### Ollama Streaming API

**Endpoint:** `POST http://localhost:11434/api/chat`

**Request:**
```json
{
  "model": "llama2",
  "messages": [...],
  "stream": true  // ✅ Enable streaming
}
```

**Response Format (JSON Lines):**
```json
{"model":"llama2","created_at":"2023-08-04T19:29:08.789Z","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"llama2","created_at":"2023-08-04T19:29:08.789Z","message":{"role":"assistant","content":" there"},"done":false}
{"model":"llama2","created_at":"2023-08-04T19:29:08.789Z","message":{"role":"assistant","content":""},"done":true}
```

---

## Implementation Requirements

### 1. Refactor to Async Clients

**Current:** `reqwest::blocking::Client`  
**Needed:** `reqwest::Client` (async)

**Changes Required:**
- Remove `blocking` feature from reqwest
- Use async/await instead of blocking calls
- Update trait to return `Result<impl Stream<Item = Result<String>>>`

### 2. Add Streaming Trait Method

**Proposed Trait:**
```rust
pub trait LlmProviderTrait {
    fn chat(&self, messages: &[Message]) -> Result<String>;
    fn chat_stream(&self, messages: &[Message]) -> Result<impl Stream<Item = Result<String>>>;
    fn provider_type(&self) -> LlmProvider;
}
```

### 3. Implement Streaming for OpenAI

**Requirements:**
- Add `stream: true` to request
- Parse SSE format
- Extract tokens from `choices[0].delta.content`
- Handle `[DONE]` marker

### 4. Implement Streaming for Ollama

**Requirements:**
- Set `stream: true` in request
- Parse JSON lines format
- Extract tokens from `message.content`
- Handle `done: true` marker

### 5. Update LlmClient

**Changes Required:**
- Add `chat_with_history_stream()` method
- Handle conversation context with streaming
- Update conversation history incrementally

---

## Implementation Strategy

### Phase 1: Add Async Streaming Support

1. **Update Dependencies**
   - Remove `blocking` feature from reqwest
   - Ensure tokio async runtime is available

2. **Create Streaming Trait Method**
   - Add `chat_stream()` to `LlmProviderTrait`
   - Return `impl Stream<Item = Result<String>>`

3. **Implement OpenAI Streaming**
   - Use async reqwest client
   - Parse SSE stream
   - Yield tokens as they arrive

4. **Implement Ollama Streaming**
   - Use async reqwest client
   - Parse JSON lines stream
   - Yield tokens as they arrive

### Phase 2: Integrate with Backend

1. **Create WebSocket Endpoint**
   - New endpoint: `/ws/chat/stream`
   - Accepts conversation_id and message
   - Streams tokens to client

2. **Update LlmClient**
   - Add `chat_with_history_stream()` method
   - Maintain conversation context
   - Stream tokens while updating history

3. **Combine with TTS Streaming**
   - Stream LLM tokens → TTS chunks
   - Pipeline: Token → TTS → WebSocket
   - Real-time audio generation

### Phase 3: Frontend Integration

1. **WebSocket Client**
   - Connect to streaming endpoint
   - Handle token messages
   - Update UI in real-time

2. **Audio Playback**
   - Receive audio chunks
   - Play as they arrive
   - Smooth playback experience

---

## Code Examples

### Proposed OpenAI Streaming Implementation

```rust
async fn chat_stream(&self, messages: &[Message]) -> Result<impl Stream<Item = Result<String>>> {
    let url = "https://api.openai.com/v1/chat/completions";
    let msgs: Vec<ApiMsg> = messages.iter()
        .map(|m| ApiMsg { role: &m.role, content: &m.content })
        .collect();
    let body = serde_json::json!({
        "model": &self.model,
        "messages": msgs,
        "stream": true  // ✅ Enable streaming
    });

    let client = reqwest::Client::new();
    let mut req = client.post(url)
        .bearer_auth(&self.api_key)
        .json(&body);
    
    if let Some(org) = &self.org_id {
        req = req.header("OpenAI-Organization", org);
    }

    let response = req.send().await?;
    let stream = response.bytes_stream();
    
    // Parse SSE stream and yield tokens
    // Implementation details...
}
```

### Proposed Ollama Streaming Implementation

```rust
async fn chat_stream(&self, messages: &[Message]) -> Result<impl Stream<Item = Result<String>>> {
    let url = format!("{}/api/chat", self.base_url);
    let msgs: Vec<Msg> = messages.iter()
        .map(|m| Msg { role: m.role.clone(), content: m.content.clone() })
        .collect();
    let body = serde_json::json!({
        "model": &self.model,
        "messages": msgs,
        "stream": true  // ✅ Enable streaming
    });

    let client = reqwest::Client::new();
    let response = client.post(&url)
        .json(&body)
        .send()
        .await?;
    
    let stream = response.bytes_stream();
    
    // Parse JSON lines and yield tokens
    // Implementation details...
}
```

---

## Estimated Effort

### Backend Changes
- **LLM Core Refactoring:** 4-6 hours
  - Async client migration
  - Streaming trait implementation
  - OpenAI streaming parser
  - Ollama streaming parser

- **Backend Integration:** 3-4 hours
  - WebSocket endpoint
  - LlmClient streaming method
  - TTS integration

### Frontend Changes
- **WebSocket Client:** 2-3 hours
- **UI Updates:** 2-3 hours

**Total Estimated Time:** 11-16 hours

---

## Risks & Considerations

### 1. Breaking Changes
- **Risk:** Changing from blocking to async may break existing code
- **Mitigation:** Keep blocking methods, add async methods alongside

### 2. Error Handling
- **Risk:** Streaming errors are harder to handle
- **Mitigation:** Proper error propagation and recovery

### 3. Conversation Context
- **Risk:** Updating context during streaming is complex
- **Mitigation:** Buffer tokens, update context on completion

### 4. Performance
- **Risk:** Streaming may have overhead
- **Mitigation:** Benchmark and optimize

---

## Recommendations

### Immediate Actions

1. ✅ **Confirm Provider Support**
   - Both OpenAI and Ollama support streaming ✅
   - APIs are well-documented

2. ✅ **Plan Implementation**
   - Start with async client migration
   - Add streaming methods alongside existing ones
   - Test with both providers

3. ✅ **Design WebSocket Protocol**
   - Define message types
   - Plan error handling
   - Design for TTS integration

### Next Steps

1. Implement async streaming in `llm_core`
2. Create WebSocket endpoint in `server`
3. Integrate with TTS streaming
4. Build frontend streaming client
5. Test end-to-end flow

---

## Conclusion

**Current State:** ❌ No streaming support  
**Provider Support:** ✅ Both OpenAI and Ollama support streaming  
**Implementation Complexity:** Medium (requires async refactoring)  
**Estimated Effort:** 11-16 hours  
**Recommendation:** ✅ Proceed with implementation

The LLM backend can be extended to support streaming with moderate effort. The main work is migrating from blocking to async clients and implementing stream parsing for both providers.

---

*Document created: 2024*  
*Last updated: 2024*

