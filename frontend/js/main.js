// Main entry point for the TTS application

import { initElements } from './utils/dom.js';
import { setupTabs } from './utils/tabs.js';
import { populateLanguageSelects } from './utils/voices.js';
import { showToast } from './utils/toast.js';
import { showStatus, setButtonState, updateServerStatus } from './utils/dom.js';
import { setupCustomAudioPlayer, setupAudioPlayer, downloadAudio } from './components/audioPlayer.js';
import { displaySpectrogram, initStreamSpectrogram, visualizeMelFrame } from './components/spectrogram.js';
import { addChatMessage, clearChat, exportChat, scrollChatToBottom } from './components/chat.js';
import { getVoices, getVoiceDetails, generateTTS, sendChatMessage, sendVoiceChatMessage, checkServerHealth, getServerMetrics } from './services/api.js';
import { startWebSocketStream } from './services/websocket.js';
import { generateWaveform, base64ToBlob, playAudio } from './utils/audio.js';
import { formatLanguageName } from './utils/format.js';

// Global state
let elements = {};
let voices = [];
let voiceDetails = [];
let currentAudioBlob = null;
let currentStreamAudioBlob = null;
let currentConversationId = null;
let isStreaming = false;
let currentWebSocket = null;
let streamSpectrogramState = null;

// Initialize the application
async function init() {
    console.log('TTS Project Frontend Initializing...');
    
    // Initialize DOM elements
    elements = initElements();
    
    // Set up tabs
    setupTabs((tabName, tabContent) => {
        if (tabName === 'chat') {
            setTimeout(() => {
                scrollChatToBottom(elements.chatMessages);
            }, 100);
        }
    });
    
    // Check server status on load
    await checkServerStatus();
    
    // Load voices dynamically
    await loadVoices();
    
    // Set up event listeners
    setupEventListeners();
    
    // Set up streaming handler
    setupStreamingHandler();
    
    // Set up character counter
    setupCharacterCounter();
    
    // Set up custom audio player
    setupCustomAudioPlayer(elements);
    
    console.log('Frontend initialized successfully');
}

// Load voices from API
async function loadVoices() {
    try {
        voices = await getVoices();
        
        // Populate language selects
        const selects = [elements.ttsLanguage, elements.streamLanguage, elements.voiceModeLanguage].filter(Boolean);
        populateLanguageSelects(selects, voices);
        
        // Load voice details
        voiceDetails = await getVoiceDetails();
        
    } catch (error) {
        console.error('Error loading voices:', error);
        showStatus(elements.serverInfo, 'error', `Failed to load voices: ${error.message}`);
    }
}

// Set up event listeners
function setupEventListeners() {
    // TTS Form Handler
    if (elements.ttsForm) {
        elements.ttsForm.addEventListener('submit', handleTtsSubmit);
    }
    
    // Streaming Form Handler - will be set up after elements are initialized
    
    // Chat Form Handler
    if (elements.chatForm) {
        elements.chatForm.addEventListener('submit', handleChatSubmit);
    }
    
    // Enter key support for chat
    if (elements.chatInput) {
        elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (elements.chatForm) {
                    elements.chatForm.dispatchEvent(new Event('submit'));
                }
            }
        });
    }
    
    // Download buttons
    if (elements.downloadTtsBtn) {
        elements.downloadTtsBtn.addEventListener('click', () => {
            try {
                downloadAudio(currentAudioBlob, `tts-${Date.now()}.wav`);
                showStatus(elements.ttsStatus, 'success', 'Audio downloaded!');
                showToast(elements.toastContainer, 'success', 'Audio downloaded successfully!');
            } catch (error) {
                showStatus(elements.ttsStatus, 'error', error.message);
            }
        });
    }
    
    if (elements.streamDownloadBtn) {
        elements.streamDownloadBtn.addEventListener('click', () => {
            try {
                downloadAudio(currentStreamAudioBlob, `stream-${Date.now()}.wav`);
                showStatus(elements.streamStatus, 'success', 'Audio downloaded!');
                showToast(elements.toastContainer, 'success', 'Streaming audio downloaded successfully!');
            } catch (error) {
                showStatus(elements.streamStatus, 'error', error.message);
            }
        });
    }
    
    // Clear and export chat buttons
    if (elements.clearChatBtn) {
        elements.clearChatBtn.addEventListener('click', () => {
            clearChat(elements.chatMessages);
            currentConversationId = null;
            showStatus(elements.chatStatus, 'info', 'Chat cleared');
            showToast(elements.toastContainer, 'success', 'Chat cleared');
        });
    }
    
    if (elements.exportChatBtn) {
        elements.exportChatBtn.addEventListener('click', () => {
            exportChat(elements.chatMessages);
            showStatus(elements.chatStatus, 'success', 'Chat exported!');
            showToast(elements.toastContainer, 'success', 'Chat exported successfully!');
        });
    }
}

// Set up character counter
function setupCharacterCounter() {
    if (!elements.ttsText || !elements.ttsCharCount) return;
    
    elements.ttsText.addEventListener('input', () => {
        const count = elements.ttsText.value.length;
        elements.ttsCharCount.textContent = count;
    });
    elements.ttsCharCount.textContent = elements.ttsText.value.length;
}

// TTS Form Submission Handler
async function handleTtsSubmit(e) {
    e.preventDefault();
    
    if (!elements.ttsText || !elements.ttsLanguage) return;
    
    const text = elements.ttsText.value.trim();
    const language = elements.ttsLanguage.value;
    const speaker = elements.ttsSpeaker?.value ? parseInt(elements.ttsSpeaker.value) : null;
    
    if (!text) {
        showStatus(elements.ttsStatus, 'error', 'Please enter some text to synthesize');
        return;
    }
    
    if (!language) {
        showStatus(elements.ttsStatus, 'error', 'Please select a language');
        return;
    }
    
    setButtonState(elements.ttsBtn, true, 'Generating...');
    showStatus(elements.ttsStatus, 'info', 'Generating speech...');
    if (elements.downloadTtsBtn) elements.downloadTtsBtn.style.display = 'none';
    if (elements.ttsAudioPlayer) elements.ttsAudioPlayer.classList.add('hidden');
    
    try {
        const data = await generateTTS(text, language, speaker);
        
        // Store audio blob for download
        currentAudioBlob = await base64ToBlob(data.audio_base64, 'audio/wav');
        
        // Set up custom audio player
        await setupAudioPlayer(elements, data.audio_base64);
        
        // Display spectrogram if available
        if (data.spectrogram_base64) {
            displaySpectrogram(elements.ttsSpectrogram, data.spectrogram_base64);
        }
        
        showStatus(elements.ttsStatus, 'success', 
            `Speech generated successfully!<br>
             Duration: ${(data.duration_ms / 1000).toFixed(2)}s<br>
             Sample Rate: ${data.sample_rate}Hz`);
        
        showToast(elements.toastContainer, 'success', 'Speech generated successfully!');
        
    } catch (error) {
        console.error('TTS Error:', error);
        showStatus(elements.ttsStatus, 'error', `Error: ${error.message}`);
        showToast(elements.toastContainer, 'error', `Error: ${error.message}`);
    } finally {
        setButtonState(elements.ttsBtn, false, 'Generate Speech');
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
    
    if (!language) {
        showStatus(elements.streamStatus, 'error', 'Please select a language');
        return;
    }
    
    if (isStreaming) {
        // Stop streaming
        if (currentWebSocket) {
            currentWebSocket.close();
            currentWebSocket = null;
        }
        isStreaming = false;
        setButtonState(elements.streamBtn, false, 'Start Streaming');
        showStatus(elements.streamStatus, 'info', 'Streaming stopped.');
        elements.streamProgress.classList.add('hidden');
        return;
    }
    
    // Reset UI elements for new stream
    if (elements.streamSpectrogram) {
        elements.streamSpectrogram.classList.add('hidden');
    }
    if (elements.streamAudioContainer) {
        elements.streamAudioContainer.classList.add('hidden');
    }
    currentStreamAudioBlob = null;
    
    setButtonState(elements.streamBtn, true, 'Connecting...');
    showStatus(elements.streamStatus, 'info', 'Connecting to stream...');
    
    // Initialize spectrogram
    streamSpectrogramState = initStreamSpectrogram(
        elements.streamSpectrogramCanvas,
        elements.streamSpectrogram
    );
    if (streamSpectrogramState) {
        streamSpectrogramState.canvas = elements.streamSpectrogramCanvas;
    }
    elements.streamSpectrogram.classList.remove('hidden');
    
    try {
        const cleanup = await startWebSocketStream(text, language, {
            isStreaming: () => isStreaming,
            onOpen: () => {
                isStreaming = true;
                setButtonState(elements.streamBtn, false, 'Stop Streaming');
                showStatus(elements.streamStatus, 'success', 'Connected! Streaming audio...');
                showToast(elements.toastContainer, 'success', 'Streaming started');
                elements.streamProgress.classList.remove('hidden');
            },
            onProgress: (chunks) => {
                const progressFill = elements.streamProgress.querySelector('.progress-fill');
                if (progressFill) {
                    progressFill.style.width = `${Math.min(100, chunks * 2)}%`;
                }
            },
            onMelFrame: (melFrame) => {
                if (streamSpectrogramState) {
                    visualizeMelFrame(streamSpectrogramState, melFrame);
                }
            },
            onError: (error) => {
                showStatus(elements.streamStatus, 'error', error);
                showToast(elements.toastContainer, 'error', error);
            },
            onReconnecting: (attempt, max) => {
                showStatus(elements.streamStatus, 'info', 
                    `Connection lost. Reconnecting... (${attempt}/${max})`);
            },
            onAudioBlob: (blob) => {
                currentStreamAudioBlob = blob;
            },
            waveformCanvas: elements.streamWaveform,
            onComplete: async (wavBase64, chunks, samples) => {
                await playAudio(elements.streamAudio, wavBase64);
                elements.streamAudioContainer.classList.remove('hidden');
                showStatus(elements.streamStatus, 'success', 
                    `Streaming complete! Audio ready to play.<br>
                     Received ${chunks} chunks, ${samples} samples total.`);
                showToast(elements.toastContainer, 'success', 'Streaming complete!');
            },
            onClose: () => {
                isStreaming = false;
                currentWebSocket = null;
                setButtonState(elements.streamBtn, false, 'Start Streaming');
                elements.streamProgress.classList.add('hidden');
            }
        });
        
        // Store cleanup function for stopping
        currentWebSocket = { close: cleanup };
    } catch (error) {
        console.error('Streaming Error:', error);
        showStatus(elements.streamStatus, 'error', `Error: ${error.message}`);
        setButtonState(elements.streamBtn, false, 'Start Streaming');
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
    addChatMessage(elements.chatMessages, 'user', message);
    elements.chatInput.value = '';
    
    setButtonState(elements.chatBtn, true, 'Thinking...');
    showStatus(elements.chatStatus, 'info', 'Sending message...');
    
    try {
        const data = await sendChatMessage(message, currentConversationId);
        
        // Store conversation ID
        currentConversationId = data.conversation_id;
        
        // Add bot response with audio
        addChatMessage(elements.chatMessages, 'bot', data.reply || 'No response received', data.audio_base64);
        
        showStatus(elements.chatStatus, 'success', 'Message sent successfully!');
        showToast(elements.toastContainer, 'success', 'Message sent successfully!');
        
    } catch (error) {
        console.error('Chat Error:', error);
        addChatMessage(elements.chatMessages, 'bot', 
            `Sorry, I'm having trouble connecting to the AI service. ${error.message}`);
        showStatus(elements.chatStatus, 'error', `Error: ${error.message}`);
        showToast(elements.toastContainer, 'error', `Error: ${error.message}`);
    } finally {
        setButtonState(elements.chatBtn, false, 'Send');
    }
}

// Server Status Functions
async function checkServerStatus() {
    try {
        await checkServerHealth();
        updateServerStatus(elements.serverStatus, 'connected', 'Server Connected');
        showStatus(elements.serverInfo, 'success', 'Server is running and healthy!');
        showToast(elements.toastContainer, 'success', 'Server connected');
    } catch (error) {
        console.error('Server Status Error:', error);
        updateServerStatus(elements.serverStatus, 'disconnected', 'Server Disconnected');
        showStatus(elements.serverInfo, 'error', `Server is not responding: ${error.message}`);
        showToast(elements.toastContainer, 'error', 'Server connection failed');
    }
}

async function getServerMetrics() {
    if (elements.serverMetrics) {
        elements.serverMetrics.classList.remove('hidden');
    }
    showStatus(elements.serverInfo, 'info', 'Fetching server metrics...');
    
    try {
        const metrics = await getServerMetrics();
        
        const uptimeHours = Math.floor(metrics.uptime_seconds / 3600);
        const uptimeMinutes = Math.floor((metrics.uptime_seconds % 3600) / 60);
        const uptimeSeconds = metrics.uptime_seconds % 60;
        const uptimeStr = `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`;
        
        const loadStr = metrics.system_load 
            ? metrics.system_load.toFixed(2) 
            : 'N/A';
        
        const metricsHtml = `
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">CPU Usage</div>
                    <div class="metric-value">${metrics.cpu_usage_percent.toFixed(1)}%</div>
                    <div class="metric-bar">
                        <div class="metric-bar-fill" style="width: ${Math.min(100, metrics.cpu_usage_percent)}%; background: ${metrics.cpu_usage_percent > 80 ? '#ef4444' : metrics.cpu_usage_percent > 60 ? '#f59e0b' : '#10b981'};"></div>
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Memory Usage</div>
                    <div class="metric-value">${metrics.memory_usage_percent.toFixed(1)}%</div>
                    <div class="metric-detail">${metrics.memory_used_mb} MB / ${metrics.memory_total_mb} MB</div>
                    <div class="metric-bar">
                        <div class="metric-bar-fill" style="width: ${Math.min(100, metrics.memory_usage_percent)}%; background: ${metrics.memory_usage_percent > 80 ? '#ef4444' : metrics.memory_usage_percent > 60 ? '#f59e0b' : '#10b981'};"></div>
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Total Requests</div>
                    <div class="metric-value">${metrics.request_count.toLocaleString()}</div>
                    <div class="metric-detail">Since server start</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Uptime</div>
                    <div class="metric-value">${uptimeStr}</div>
                    <div class="metric-detail">${metrics.uptime_seconds.toLocaleString()} seconds</div>
                </div>
                ${metrics.system_load ? `
                <div class="metric-card">
                    <div class="metric-label">System Load</div>
                    <div class="metric-value">${loadStr}</div>
                    <div class="metric-detail">1-minute average</div>
                </div>
                ` : ''}
            </div>
        `;
        
        if (elements.serverMetrics) {
            elements.serverMetrics.innerHTML = metricsHtml;
        }
        
        showStatus(elements.serverInfo, 'success', 'Server metrics retrieved successfully!');
        showToast(elements.toastContainer, 'success', 'Metrics updated');
    } catch (error) {
        console.error('Metrics Error:', error);
        showStatus(elements.serverInfo, 'error', `Error fetching metrics: ${error.message}`);
        if (elements.serverMetrics) {
            elements.serverMetrics.classList.add('hidden');
        }
    }
}

async function getVoices() {
    showStatus(elements.serverInfo, 'info', 'Fetching voices...');
    
    try {
        const voicesList = await getVoices();
        showStatus(elements.serverInfo, 'success', 
            `Available voices:<br>
             ${voicesList.map(voice => `• ${formatLanguageName(voice)} (${voice})`).join('<br>')}`);
    } catch (error) {
        console.error('Voices Error:', error);
        showStatus(elements.serverInfo, 'error', `Error fetching voices: ${error.message}`);
    }
}

async function getVoicesDetail() {
    showStatus(elements.serverInfo, 'info', 'Fetching voice details...');
    
    try {
        const details = await getVoiceDetails();
        const detailsHtml = details.map(v => 
            `• <strong>${formatLanguageName(v.key)}</strong> (${v.key})<br>
             &nbsp;&nbsp;Config: ${v.config}<br>
             &nbsp;&nbsp;Speaker: ${v.speaker !== null ? v.speaker : 'Default'}`
        ).join('<br><br>');
        
        showStatus(elements.serverInfo, 'success', 
            `Voice details:<br><br>${detailsHtml}`);
    } catch (error) {
        console.error('Voice Details Error:', error);
        showStatus(elements.serverInfo, 'error', `Error fetching voice details: ${error.message}`);
    }
}

// Global Functions (for HTML onclick handlers)
window.checkServerStatus = checkServerStatus;
window.getServerMetrics = displayServerMetrics;
window.getVoices = getVoices;
window.getVoicesDetail = getVoicesDetail;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

