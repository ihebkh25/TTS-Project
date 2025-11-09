// TTS Project - Frontend JavaScript

// Configuration
const API_BASE = 'http://localhost:8081';
let isStreaming = false;
let currentWebSocket = null;

// DOM Elements
const elements = {
    // Forms
    ttsForm: document.getElementById('ttsForm'),
    streamForm: document.getElementById('streamForm'),
    chatForm: document.getElementById('chatForm'),
    
    // Inputs
    ttsText: document.getElementById('ttsText'),
    ttsLanguage: document.getElementById('ttsLanguage'),
    streamText: document.getElementById('streamText'),
    streamLanguage: document.getElementById('streamLanguage'),
    chatInput: document.getElementById('chatInput'),
    
    // Buttons
    ttsBtn: document.getElementById('ttsBtn'),
    streamBtn: document.getElementById('streamBtn'),
    chatBtn: document.getElementById('chatBtn'),
    
    // Status and Output
    ttsStatus: document.getElementById('ttsStatus'),
    streamStatus: document.getElementById('streamStatus'),
    chatStatus: document.getElementById('chatStatus'),
    serverStatus: document.getElementById('serverStatus'),
    serverInfo: document.getElementById('serverInfo'),
    
    // Audio and Media
    ttsAudio: document.getElementById('ttsAudio'),
    streamAudio: document.getElementById('streamAudio'),
    ttsSpectrogram: document.getElementById('ttsSpectrogram'),
    chatMessages: document.getElementById('chatMessages')
};

// Initialize the application
function init() {
    console.log('🎵 TTS Project Frontend Initializing...');
    
    // Check server status on load
    checkServerStatus();
    
    // Set up event listeners
    setupEventListeners();
    
    console.log('✅ Frontend initialized successfully');
}

// Set up all event listeners
function setupEventListeners() {
    // TTS Form Handler
    elements.ttsForm.addEventListener('submit', handleTtsSubmit);
    
    // Streaming Form Handler
    elements.streamForm.addEventListener('submit', handleStreamSubmit);
    
    // Chat Form Handler
    elements.chatForm.addEventListener('submit', handleChatSubmit);
    
    // Enter key support for chat
    elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            elements.chatForm.dispatchEvent(new Event('submit'));
        }
    });
}

// TTS Form Submission Handler
async function handleTtsSubmit(e) {
    e.preventDefault();
    
    const text = elements.ttsText.value.trim();
    const language = elements.ttsLanguage.value;
    
    if (!text) {
        showStatus(elements.ttsStatus, 'error', 'Please enter some text to synthesize');
        return;
    }
    
    setButtonState(elements.ttsBtn, true, '🔄 Generating...');
    showStatus(elements.ttsStatus, 'info', 'Generating speech...');
    
    try {
        const response = await fetch(`${API_BASE}/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text, language })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Create and play audio
        await playAudio(elements.ttsAudio, data.audio_base64);
        
        // Display spectrogram if available
        if (data.spectrogram_base64) {
            displaySpectrogram(elements.ttsSpectrogram, data.spectrogram_base64);
        }

        showStatus(elements.ttsStatus, 'success', 
            `✅ Speech generated successfully!<br>
             Duration: ${data.duration_ms}ms<br>
             Sample Rate: ${data.sample_rate}Hz`);

    } catch (error) {
        console.error('TTS Error:', error);
        showStatus(elements.ttsStatus, 'error', `❌ Error: ${error.message}`);
    } finally {
        setButtonState(elements.ttsBtn, false, '🎵 Generate Speech');
    }
}

// Streaming Form Submission Handler
async function handleStreamSubmit(e) {
    e.preventDefault();
    
    const text = elements.streamText.value.trim();
    const language = elements.streamLanguage.value;
    
    if (!text) {
        showStatus(elements.streamStatus, 'error', 'Please enter some text to stream');
        return;
    }
    
    if (isStreaming) {
        // Stop streaming
        if (currentWebSocket) {
            currentWebSocket.close();
            currentWebSocket = null;
        }
        isStreaming = false;
        setButtonState(elements.streamBtn, false, '📡 Start Streaming');
        showStatus(elements.streamStatus, 'info', 'Streaming stopped.');
        return;
    }
    
    setButtonState(elements.streamBtn, true, '🔄 Connecting...');
    showStatus(elements.streamStatus, 'info', 'Connecting to stream...');
    
    try {
        await startWebSocketStream(text, language);
    } catch (error) {
        console.error('Streaming Error:', error);
        showStatus(elements.streamStatus, 'error', `❌ Error: ${error.message}`);
        setButtonState(elements.streamBtn, false, '📡 Start Streaming');
    }
}

// Chat Form Submission Handler
async function handleChatSubmit(e) {
    e.preventDefault();
    
    const message = elements.chatInput.value.trim();
    
    if (!message) {
        showStatus(elements.chatStatus, 'error', 'Please enter a message');
        return;
    }
    
    // Add user message to chat
    addChatMessage('user', message);
    elements.chatInput.value = '';
    
    setButtonState(elements.chatBtn, true, '🔄 Thinking...');
    
    try {
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Add bot response
        addChatMessage('bot', data.reply || 'No response received');
        showStatus(elements.chatStatus, 'success', '✅ Message sent successfully!');

    } catch (error) {
        console.error('Chat Error:', error);
        addChatMessage('bot', `Sorry, I'm having trouble connecting to the AI service. ${error.message}`);
        showStatus(elements.chatStatus, 'error', `❌ Error: ${error.message}`);
    } finally {
        setButtonState(elements.chatBtn, false, '💬 Send Message');
    }
}

// Convert f32 audio samples array to WAV base64
function convertF32ArrayToWavBase64(samples, sampleRate) {
    // Convert f32 samples to 16-bit PCM
    const pcm16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        // Clamp to [-1, 1] and convert to 16-bit integer
        const sample = Math.max(-1, Math.min(1, samples[i]));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    
    // Create WAV file
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcm16.length * 2; // 2 bytes per sample
    const fileSize = 36 + dataSize;
    
    // WAV header
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // RIFF header
    view.setUint8(0, 0x52); // 'R'
    view.setUint8(1, 0x49); // 'I'
    view.setUint8(2, 0x46); // 'F'
    view.setUint8(3, 0x46); // 'F'
    view.setUint32(4, fileSize, true); // File size - 8
    view.setUint8(8, 0x57); // 'W'
    view.setUint8(9, 0x41); // 'A'
    view.setUint8(10, 0x56); // 'V'
    view.setUint8(11, 0x45); // 'E'
    
    // fmt chunk
    view.setUint8(12, 0x66); // 'f'
    view.setUint8(13, 0x6D); // 'm'
    view.setUint8(14, 0x74); // 't'
    view.setUint8(15, 0x20); // ' '
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // Audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    view.setUint8(36, 0x64); // 'd'
    view.setUint8(37, 0x61); // 'a'
    view.setUint8(38, 0x74); // 't'
    view.setUint8(39, 0x61); // 'a'
    view.setUint32(40, dataSize, true);
    
    // PCM data
    const pcmView = new DataView(buffer, 44);
    for (let i = 0; i < pcm16.length; i++) {
        pcmView.setInt16(i * 2, pcm16[i], true); // Little-endian
    }
    
    // Convert to base64
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// WebSocket Streaming Implementation
async function startWebSocketStream(text, language) {
    const encodedText = encodeURIComponent(text);
    const wsUrl = `ws://localhost:8081/stream/${language}/${encodedText}`;
    
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        currentWebSocket = ws;
        const audioSamples = [];
        const sampleRate = 22050; // Default sample rate from backend

        ws.onopen = () => {
            isStreaming = true;
            setButtonState(elements.streamBtn, false, '⏹️ Stop Streaming');
            showStatus(elements.streamStatus, 'success', '✅ Connected! Streaming audio...');
        };

        ws.onmessage = (event) => {
            try {
                // Parse JSON message containing audio and mel arrays
                const data = JSON.parse(event.data);
                
                // Check for error messages
                if (data.error) {
                    throw new Error(data.error);
                }
                
                // Collect audio samples from the audio array
                if (data.audio && Array.isArray(data.audio)) {
                    audioSamples.push(...data.audio);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                showStatus(elements.streamStatus, 'error', 
                    `❌ Error processing stream: ${error.message}`);
            }
        };

        ws.onclose = () => {
            if (isStreaming && audioSamples.length > 0) {
                try {
                    // Convert f32 audio samples to WAV and encode as base64
                    const wavBase64 = convertF32ArrayToWavBase64(audioSamples, sampleRate);
                    playAudio(elements.streamAudio, wavBase64);
                    
                    showStatus(elements.streamStatus, 'success', 
                        '✅ Streaming complete! Audio ready to play.');
                } catch (error) {
                    console.error('Error converting audio:', error);
                    showStatus(elements.streamStatus, 'error', 
                        `❌ Error converting audio: ${error.message}`);
                }
            } else if (isStreaming) {
                showStatus(elements.streamStatus, 'error', 
                    '❌ No audio data received from stream.');
            }
            isStreaming = false;
            currentWebSocket = null;
            setButtonState(elements.streamBtn, false, '📡 Start Streaming');
            resolve();
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            showStatus(elements.streamStatus, 'error', 
                `❌ WebSocket error: ${error.message || 'Connection failed'}`);
            isStreaming = false;
            currentWebSocket = null;
            setButtonState(elements.streamBtn, false, '📡 Start Streaming');
            reject(error);
        };
    });
}

// Audio Playback Functions
async function playAudio(audioElement, base64Data) {
    try {
        const audioData = atob(base64Data);
        const audioBlob = new Blob([audioData], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        audioElement.src = audioUrl;
        audioElement.style.display = 'block';
        
        // Clean up previous URL
        if (audioElement.previousUrl) {
            URL.revokeObjectURL(audioElement.previousUrl);
        }
        audioElement.previousUrl = audioUrl;
        
    } catch (error) {
        console.error('Audio Playback Error:', error);
        throw new Error('Failed to play audio: ' + error.message);
    }
}

// Spectrogram Display
function displaySpectrogram(container, base64Data) {
    container.innerHTML = `
        <h4>Mel Spectrogram:</h4>
        <img src="data:image/png;base64,${base64Data}" alt="Spectrogram" loading="lazy">
    `;
}

// Chat Functions
function addChatMessage(sender, message) {
    const messageClass = sender === 'user' ? 'user' : 'bot';
    const senderName = sender === 'user' ? 'You' : 'Bot';
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageClass}`;
    messageElement.innerHTML = `<strong>${senderName}:</strong> ${message}`;
    
    elements.chatMessages.appendChild(messageElement);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Server Status Functions
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
            updateServerStatus('connected', '🟢 Server Connected');
            showStatus(elements.serverInfo, 'success', '✅ Server is running and healthy!');
        } else {
            throw new Error(`Server returned ${response.status}`);
        }
    } catch (error) {
        console.error('Server Status Error:', error);
        updateServerStatus('disconnected', '🔴 Server Disconnected');
        showStatus(elements.serverInfo, 'error', `❌ Server is not responding: ${error.message}`);
    }
}

async function getVoices() {
    showStatus(elements.serverInfo, 'info', '🔄 Fetching voices...');

    try {
        const response = await fetch(`${API_BASE}/voices`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const voices = await response.json();
        showStatus(elements.serverInfo, 'success', 
            `✅ Available voices:<br>
             ${voices.map(voice => `• ${voice}`).join('<br>')}`);
    } catch (error) {
        console.error('Voices Error:', error);
        showStatus(elements.serverInfo, 'error', `❌ Error fetching voices: ${error.message}`);
    }
}

// Utility Functions
function setButtonState(button, disabled, text) {
    button.disabled = disabled;
    button.textContent = text;
}

function showStatus(element, type, message) {
    element.innerHTML = `<div class="status ${type}">${message}</div>`;
}

function updateServerStatus(status, text) {
    elements.serverStatus.textContent = text;
    elements.serverStatus.className = `server-status ${status}`;
}

// Global Functions (for HTML onclick handlers)
window.checkServerStatus = checkServerStatus;
window.getVoices = getVoices;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

// Export for potential module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        init,
        checkServerStatus,
        getVoices,
        handleTtsSubmit,
        handleStreamSubmit,
        handleChatSubmit
    };
}
