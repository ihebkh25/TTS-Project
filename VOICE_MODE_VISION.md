# Voice Mode Vision & Implementation Strategy

## Executive Summary

This document outlines the vision for transitioning from the current "Voice Mode" (dictation-style) to a new real-time streaming "Voice Mode" that takes full advantage of our streaming infrastructure.

---

## Current State Analysis

### Current "Voice Mode" (To Be Renamed: "Dictating")

**Current Flow:**
1. User clicks microphone → starts recording
2. Real-time speech-to-text (shows transcript in chat)
3. VAD (Voice Activity Detection) detects silence → stops recording
4. Sends complete transcript to LLM
5. Waits for full LLM response
6. Generates complete TTS audio
7. Plays audio back

**Characteristics:**
- ✅ Turn-based conversation (speak → wait → listen)
- ✅ Complete responses before playback
- ✅ Good for dictation and structured Q&A
- ❌ Higher latency (waits for complete generation)
- ❌ Less natural conversation flow

**Use Cases:**
- Dictation with AI assistance
- Structured Q&A sessions
- When you want complete responses before playback

---

## Proposed New "Voice Mode" (Real-Time Streaming)

### Vision

**New Flow:**
1. User speaks → real-time speech-to-text
2. On pause/silence → send to LLM
3. **LLM streams response tokens** as they're generated
4. **TTS streams audio chunks** as text arrives
5. Audio playback starts **immediately**
6. Continuous conversation flow

**Key Differences:**
- ⚡ **Streaming LLM response** (text tokens as they arrive)
- ⚡ **Streaming TTS** (audio chunks as text is available)
- ⚡ **Lower latency** (starts speaking sooner)
- ⚡ **More natural conversation flow**

**Use Cases:**
- Natural voice conversations
- Real-time assistance
- Interactive dialogue
- When you want immediate feedback

---

## Implementation Strategy

### Phase 1: Backend Streaming Support

#### 1.1 LLM Streaming Endpoint (WebSocket)
- Stream text tokens as they're generated
- Send metadata (token count, status)
- Handle conversation context

#### 1.2 Combined Streaming Endpoint
- Stream LLM tokens → TTS chunks
- Pipeline: LLM token → TTS chunk → WebSocket
- Real-time audio generation

### Phase 2: Frontend Real-Time Voice Mode

#### 2.1 UI Components
- Visual indicator for streaming
- Real-time text display (streaming)
- Audio player for streaming audio
- Conversation state management

#### 2.2 Integration
- Connect speech-to-text → WebSocket
- Handle streaming text → display
- Handle streaming audio → playback
- Manage conversation flow

---

## Architecture Proposal

```
┌─────────────────────────────────────────────────────────┐
│                    NEW VOICE MODE                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  User Speech → STT → WebSocket → Backend                │
│                                                          │
│  Backend:                                                │
│    ├─ LLM Streaming (tokens)                            │
│    └─ TTS Streaming (chunks)                            │
│         └─ WebSocket → Frontend                         │
│                                                          │
│  Frontend:                                               │
│    ├─ Display streaming text                            │
│    ├─ Play streaming audio                              │
│    └─ Ready for next input                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Comparison: Dictating vs Voice Mode

| Feature | Dictating Mode | Voice Mode (New) |
|---------|---------------|------------------|
| **LLM Response** | Complete response | Streaming tokens |
| **TTS Generation** | Complete audio | Streaming chunks |
| **Latency** | Higher (waits for completion) | Lower (starts immediately) |
| **User Experience** | Turn-based | Continuous flow |
| **Best For** | Dictation, Q&A | Natural conversation |
| **Backend** | REST endpoint | WebSocket streaming |

---

## Recommendations

### 1. Rename Current Mode to "Dictating"
- ✅ Clear purpose: dictation with AI response
- ✅ Keep existing functionality
- ✅ No breaking changes

### 2. New "Voice Mode" Features
- ⚡ Real-time streaming conversation
- ⚡ Lower latency
- ⚡ Natural back-and-forth
- ⚡ Visual feedback for streaming

### 3. Implementation Priority

**High Priority:**
- Backend LLM streaming capability
- Combined LLM+TTS streaming endpoint
- WebSocket protocol design

**Medium Priority:**
- Frontend streaming UI components
- Real-time text display
- Streaming audio player

**Low Priority:**
- Advanced features (interruption, barge-in)
- Conversation history management
- Error recovery

---

## Questions to Clarify

### 1. LLM Streaming Capability
- **Question:** Does your LLM backend support token streaming?
- **Impact:** Determines if we need to modify LLM integration
- **Action:** Check `llm_core` for streaming support

### 2. Interruption Handling
- **Question:** Should users be able to interrupt the AI mid-response?
- **Impact:** Affects UX design and state management
- **Options:**
  - Allow interruption (more natural)
  - Wait for completion (simpler)

### 3. Conversation Flow
- **Question:** Continuous mode or turn-based with streaming?
- **Impact:** Determines state management complexity
- **Options:**
  - Continuous (always listening)
  - Turn-based (click to speak)

### 4. Fallback Strategy
- **Question:** If streaming fails, fall back to dictating mode?
- **Impact:** Error handling and user experience
- **Recommendation:** Yes, graceful degradation

---

## Technical Requirements

### Backend Requirements

1. **LLM Streaming Support**
   - Token-by-token generation
   - WebSocket connection
   - Conversation context management

2. **TTS Streaming Integration**
   - Chunk-based audio generation
   - Real-time mel spectrogram
   - Audio buffer management

3. **WebSocket Protocol**
   - Message types: `text_token`, `audio_chunk`, `status`, `metadata`
   - Error handling
   - Connection management

### Frontend Requirements

1. **Streaming UI Components**
   - Real-time text display
   - Streaming audio player
   - Visual indicators

2. **State Management**
   - Conversation state
   - Streaming state
   - Error states

3. **Integration**
   - Speech-to-text → WebSocket
   - WebSocket → UI updates
   - Audio playback management

---

## Next Steps

### Immediate Actions

1. ✅ **Check LLM Streaming Capability**
   - Review `llm_core` implementation
   - Determine if streaming is supported
   - Identify required modifications

2. ✅ **Design WebSocket Protocol**
   - Define message types
   - Specify data formats
   - Plan error handling

3. ✅ **Implement Backend Streaming Endpoint**
   - Create WebSocket handler
   - Integrate LLM streaming
   - Integrate TTS streaming

4. ✅ **Build Frontend Streaming Voice Mode UI**
   - Create streaming components
   - Integrate with existing chat UI
   - Add visual feedback

5. ✅ **Test and Optimize**
   - Latency testing
   - Error handling
   - User experience refinement

---

## File Structure Changes

### Backend
```
server/src/
├── main.rs (add streaming chat endpoint)
└── streaming/
    ├── chat_stream.rs (LLM + TTS streaming)
    └── protocol.rs (WebSocket message types)
```

### Frontend
```
frontend/
├── js/
│   ├── tabs/
│   │   └── chat.js (rename voice mode → dictating)
│   ├── services/
│   │   └── chat_stream.js (new streaming service)
│   └── components/
│       └── streaming_chat.js (new streaming UI)
└── tabs/
    └── chat.html (update UI labels)
```

---

## Success Metrics

### Performance
- **Latency:** < 500ms from speech end to audio start
- **Streaming Quality:** Smooth audio playback
- **Error Rate:** < 1% connection failures

### User Experience
- **Natural Flow:** Feels like real conversation
- **Visual Feedback:** Clear streaming indicators
- **Error Recovery:** Graceful fallback to dictating mode

---

## Risks & Mitigation

### Risk 1: LLM Doesn't Support Streaming
- **Mitigation:** Implement token buffering or use alternative approach
- **Fallback:** Use dictating mode

### Risk 2: High Latency
- **Mitigation:** Optimize TTS chunk generation
- **Fallback:** Increase buffer size

### Risk 3: Complex State Management
- **Mitigation:** Clear state machine design
- **Fallback:** Simplify to turn-based streaming

---

## Conclusion

The transition from dictation-style "Voice Mode" to real-time streaming "Voice Mode" will significantly improve user experience by reducing latency and creating a more natural conversation flow. The implementation should be done in phases, starting with backend streaming support, followed by frontend integration.

**Key Success Factors:**
1. LLM streaming capability
2. Efficient TTS chunk generation
3. Smooth WebSocket communication
4. Intuitive UI/UX

**Next Action:** Check LLM streaming capability and design WebSocket protocol.

---

*Document created: 2024*
*Last updated: 2024*

