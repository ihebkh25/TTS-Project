# 🎵 TTS Project - Frontend Guide

## 🚀 Quick Start

### 1. Start the TTS Server
```bash
# Terminal 1: Start the TTS server
cargo run --release -p server
```

### 2. Start the Frontend
```bash
# Terminal 2: Start the frontend server
python3 serve_frontend.py
# OR
./start_frontend.sh
```

### 3. Open the Frontend
- **Frontend URL**: http://localhost:8082
- **TTS Server**: http://localhost:8085

## 🎯 Features Overview

### 🎤 Text-to-Speech Section
- **Text Input**: Enter any text to synthesize
- **Language Selection**: Choose from English, German, or French
- **Audio Playback**: Generated audio plays automatically
- **Spectrogram**: Visual representation of the audio
- **Status Updates**: Real-time feedback on generation progress

### 📡 Real-time Streaming Section
- **WebSocket Connection**: Direct connection to TTS server
- **Live Audio**: Real-time audio streaming
- **Stop/Start Control**: Toggle streaming on/off
- **Connection Status**: Visual feedback on connection state

### 💬 AI Chat Section
- **Conversational Interface**: Chat with the AI assistant
- **Message History**: See conversation history
- **Optional LLM**: Works with or without OpenAI API key
- **Real-time Responses**: Instant AI responses

### 🔧 Server Information Section
- **Server Status**: Check if TTS server is running
- **Available Voices**: List all supported languages
- **Health Monitoring**: Real-time server status
- **Connection Testing**: Verify API connectivity

## 🎨 Interface Design

### Modern UI Features
- **Responsive Design**: Works on desktop and mobile
- **Gradient Backgrounds**: Beautiful visual appeal
- **Real-time Status**: Live server connection status
- **Audio Controls**: Built-in audio player
- **Error Handling**: Clear error messages and recovery

### Color Scheme
- **Primary**: Blue gradient (#667eea to #764ba2)
- **Success**: Green (#d4edda)
- **Error**: Red (#f8d7da)
- **Info**: Blue (#d1ecf1)

## 🔧 Technical Details

### Frontend Architecture
- **Pure HTML/CSS/JavaScript**: No frameworks required
- **CORS Support**: Cross-origin requests enabled
- **WebSocket Integration**: Real-time streaming
- **Audio Processing**: Base64 audio handling
- **Responsive Grid**: Mobile-friendly layout

### API Integration
- **REST Endpoints**: HTTP POST/GET requests
- **WebSocket Streaming**: Real-time audio delivery
- **Error Handling**: Graceful failure management
- **Status Monitoring**: Live server health checks

## 🚀 Usage Examples

### Basic TTS Synthesis
1. Enter text: "Hello, this is a test!"
2. Select language: "English (US)"
3. Click "🎵 Generate Speech"
4. Listen to the generated audio

### Real-time Streaming
1. Enter text: "Hello World, this is streaming!"
2. Select language: "German"
3. Click "📡 Start Streaming"
4. Watch the real-time audio generation

### AI Chat
1. Type message: "Hello, how are you?"
2. Click "💬 Send Message"
3. See AI response in chat history
4. Continue conversation

### Server Monitoring
1. Click "🔄 Check Server Status"
2. See connection status in top-right corner
3. Click "🎭 Get Available Voices"
4. View supported languages

## 🛠️ Development

### File Structure
```
tts_project/
├── index.html              # Main frontend interface
├── serve_frontend.py       # Python HTTP server
├── start_frontend.sh      # Startup script
└── FRONTEND_GUIDE.md      # This guide
```

### Customization
- **Styling**: Edit CSS in `<style>` section
- **Functionality**: Modify JavaScript functions
- **API Endpoints**: Update server URLs
- **Features**: Add new interface sections

### Browser Compatibility
- **Chrome**: Full support
- **Firefox**: Full support
- **Safari**: Full support
- **Edge**: Full support

## 🔍 Troubleshooting

### Common Issues

#### Frontend Won't Load
```bash
# Check if port 8082 is available
lsof -i:8082

# Use different port
python3 serve_frontend.py --port 8083
```

#### TTS Server Not Responding
```bash
# Check if TTS server is running
curl http://localhost:8085/health

# Start TTS server
cargo run --release -p server
```

#### WebSocket Connection Failed
- Ensure TTS server is running on port 8085
- Check browser console for errors
- Verify WebSocket URL format

#### Audio Not Playing
- Check browser audio permissions
- Verify Base64 audio data format
- Test with different browsers

### Debug Mode
```bash
# Run with verbose output
python3 serve_frontend.py --port 8082 --debug
```

## 📈 Future Enhancements

### Planned Features
- [ ] **Voice Selection**: Choose specific voice models
- [ ] **Audio Effects**: Speed, pitch, volume controls
- [ ] **Batch Processing**: Multiple text synthesis
- [ ] **Audio Download**: Save generated audio files
- [ ] **History**: Previous synthesis history
- [ ] **Themes**: Dark/light mode toggle
- [ ] **Mobile App**: Native mobile interface

### Advanced Features
- [ ] **Real-time Transcription**: Speech-to-text
- [ ] **Voice Cloning**: Custom voice training
- [ ] **SSML Support**: Advanced speech markup
- [ ] **Multi-language**: Simultaneous language support
- [ ] **Cloud Integration**: Remote TTS services

## 🤝 Contributing

### Adding New Features
1. Edit `index.html` for UI changes
2. Modify JavaScript functions for functionality
3. Update `serve_frontend.py` for server changes
4. Test with different browsers
5. Update this guide

### Code Style
- **HTML**: Semantic markup
- **CSS**: Modern flexbox/grid
- **JavaScript**: ES6+ features
- **Python**: PEP 8 style

---

**🎵 Built with ❤️ for the TTS Project**
