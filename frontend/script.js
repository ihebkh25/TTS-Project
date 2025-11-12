// TTS Project - Frontend JavaScript
// Modern, comprehensive frontend with dynamic voice loading and enhanced features

// Configuration
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:8085' 
    : `http://${window.location.hostname}:8085`;
const WS_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'ws://localhost:8085'
    : `ws://${window.location.hostname}:8085`;
let isStreaming = false;
let currentWebSocket = null;
let currentConversationId = null;
let voices = [];
let voiceDetails = [];
let currentAudioBlob = null;

// DOM Elements - Initialize after DOM is ready
let elements = {};

// Initialize DOM elements
function initElements() {
    elements = {
        // Forms
        ttsForm: document.getElementById('ttsForm'),
        streamForm: document.getElementById('streamForm'),
        chatForm: document.getElementById('chatForm'),
        
        // Inputs
        ttsText: document.getElementById('ttsText'),
        ttsLanguage: document.getElementById('ttsLanguage'),
        ttsSpeaker: document.getElementById('ttsSpeaker'),
        streamText: document.getElementById('streamText'),
        streamLanguage: document.getElementById('streamLanguage'),
        chatInput: document.getElementById('chatInput'),
        serverUrl: document.getElementById('serverUrl'),
        
        // Buttons
        ttsBtn: document.getElementById('ttsBtn'),
        streamBtn: document.getElementById('streamBtn'),
        chatBtn: document.getElementById('chatBtn'),
        downloadTtsBtn: document.getElementById('downloadTtsBtn'),
        clearChatBtn: document.getElementById('clearChatBtn'),
        exportChatBtn: document.getElementById('exportChatBtn'),
        
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
        chatMessages: document.getElementById('chatMessages'),
        streamProgress: document.getElementById('streamProgress'),
        
        // Custom Audio Player
        ttsAudioPlayer: document.getElementById('ttsAudioPlayer'),
        ttsPlayPause: document.getElementById('ttsPlayPause'),
        ttsProgress: document.getElementById('ttsProgress'),
        ttsWaveform: document.getElementById('ttsWaveform'),
        ttsDownloadBtn: document.getElementById('ttsDownloadBtn'),
        ttsCurrentTime: document.querySelector('#ttsAudioPlayer .current-time'),
        ttsDuration: document.querySelector('#ttsAudioPlayer .duration'),
        
        // Groups
        speakerGroup: document.getElementById('speakerGroup'),
        ttsCharCount: document.getElementById('ttsCharCount'),
        
        // Toast container
        toastContainer: document.getElementById('toastContainer')
    };
}

// Initialize the application
async function init() {
    console.log('TTS Project Frontend Initializing...');
    
    // Initialize DOM elements
    initElements();
    
    // Set up tabs
    setupTabs();
    
    // Check server status on load
    await checkServerStatus();
    
    // Load voices dynamically
    await loadVoices();
    
    // Set up event listeners
    setupEventListeners();
    
    // Set up character counter
    setupCharacterCounter();
    
    // Set up custom audio player
    setupCustomAudioPlayer();
    
    console.log('Frontend initialized successfully');
}

// Tab configuration with titles and descriptions
const tabConfig = {
    tts: { title: 'Text-to-Speech', desc: 'Convert text to natural-sounding speech' },
    stream: { title: 'Real-time Streaming', desc: 'Stream audio in real-time' },
    chat: { title: 'AI Chat', desc: 'Chat with AI assistant' },
    server: { title: 'Server Information', desc: 'Server status and configuration' }
};

// Tab functionality
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('pageTitle');
    const pageDescription = document.getElementById('pageDescription');
    
    // Ensure only the first tab is visible initially
    tabContents.forEach((content, index) => {
        if (index === 0) {
            content.classList.add('active');
            const firstTab = content.getAttribute('data-tab');
            if (firstTab && tabConfig[firstTab]) {
                if (pageTitle) pageTitle.textContent = tabConfig[firstTab].title;
                if (pageDescription) pageDescription.textContent = tabConfig[firstTab].desc;
            }
        } else {
            content.classList.remove('active');
        }
    });
    
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = button.getAttribute('data-tab');
            
            if (!targetTab) return;
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Find and activate the corresponding content section
            const targetContent = document.querySelector(`.tab-content[data-tab="${targetTab}"]`);
            if (targetContent) {
                targetContent.classList.add('active');
                
                // Update page title and description
                if (tabConfig[targetTab]) {
                    if (pageTitle) pageTitle.textContent = tabConfig[targetTab].title;
                    if (pageDescription) pageDescription.textContent = tabConfig[targetTab].desc;
                }
            } else {
                console.error(`Tab content not found for: ${targetTab}`);
            }
        });
    });
}

// Load voices from API
async function loadVoices() {
    try {
        const response = await fetch(`${API_BASE}/voices`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        voices = await response.json();
        
        // Populate language selects
        populateLanguageSelects();
        
        // Load voice details
        await loadVoiceDetails();
        
    } catch (error) {
        console.error('Error loading voices:', error);
        showStatus(elements.serverInfo, 'error', `Failed to load voices: ${error.message}`);
    }
}

// Load voice details from API
async function loadVoiceDetails() {
    try {
        const response = await fetch(`${API_BASE}/voices/detail`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        voiceDetails = await response.json();
        
    } catch (error) {
        console.error('Error loading voice details:', error);
    }
}

// Populate language select elements
function populateLanguageSelects() {
    const selects = [elements.ttsLanguage, elements.streamLanguage].filter(Boolean);
    
    selects.forEach(select => {
        if (!select) return;
        select.innerHTML = '<option value="">Select language...</option>';
        
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = formatLanguageName(voice);
            select.appendChild(option);
        });
    });
}

// Format language code to readable name
function formatLanguageName(code) {
    const names = {
        'de_DE': 'German (Germany)',
        'fr_FR': 'French (France)',
        'en_US': 'English (US)',
        'en_GB': 'English (UK)',
        'es_ES': 'Spanish (Spain)',
        'it_IT': 'Italian (Italy)',
        'pt_PT': 'Portuguese (Portugal)',
        'nl_NL': 'Dutch (Netherlands)'
    };
    return names[code] || code;
}

// Set up event listeners
function setupEventListeners() {
    // TTS Form Handler
    if (elements.ttsForm) {
        elements.ttsForm.addEventListener('submit', handleTtsSubmit);
    }
    
    // Language change handler for speaker selection
    if (elements.ttsLanguage) {
        elements.ttsLanguage.addEventListener('change', handleLanguageChange);
    }
    
    // Streaming Form Handler
    if (elements.streamForm) {
        elements.streamForm.addEventListener('submit', handleStreamSubmit);
    }
    
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
    
    // Download button
    if (elements.downloadTtsBtn) {
        elements.downloadTtsBtn.addEventListener('click', downloadTtsAudio);
    }
    
    // Clear chat button
    if (elements.clearChatBtn) {
        elements.clearChatBtn.addEventListener('click', clearChat);
    }
    
    // Export chat button
    if (elements.exportChatBtn) {
        elements.exportChatBtn.addEventListener('click', exportChat);
    }
}

// Set up character counter
function setupCharacterCounter() {
    if (!elements.ttsText || !elements.ttsCharCount) return;
    
    elements.ttsText.addEventListener('input', () => {
        const count = elements.ttsText.value.length;
        elements.ttsCharCount.textContent = count;
    });
    // Initial count
    elements.ttsCharCount.textContent = elements.ttsText.value.length;
}

// Handle language change for speaker selection
function handleLanguageChange() {
    if (!elements.ttsLanguage || !elements.speakerGroup) return;
    
    const language = elements.ttsLanguage.value;
    const voiceDetail = voiceDetails.find(v => v.key === language);
    
    if (voiceDetail && voiceDetail.speaker !== null) {
        // Show speaker selection if available
        elements.speakerGroup.style.display = 'block';
        // Populate speakers if needed
        // For now, we'll just show the group
    } else {
        elements.speakerGroup.style.display = 'none';
    }
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
        const requestBody = { text, language };
        if (speaker !== null) {
            requestBody.speaker = speaker;
        }
        
        const response = await fetch(`${API_BASE}/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Store audio blob for download
        currentAudioBlob = await base64ToBlob(data.audio_base64, 'audio/wav');
        
        // Set up custom audio player
        await setupAudioPlayer(data.audio_base64);
        
        // Display spectrogram if available
        if (data.spectrogram_base64) {
            displaySpectrogram(elements.ttsSpectrogram, data.spectrogram_base64);
        }

        showStatus(elements.ttsStatus, 'success', 
            `Speech generated successfully!<br>
             Duration: ${(data.duration_ms / 1000).toFixed(2)}s<br>
             Sample Rate: ${data.sample_rate}Hz`);
        
        showToast('success', 'Speech generated successfully!');

    } catch (error) {
        console.error('TTS Error:', error);
        showStatus(elements.ttsStatus, 'error', `Error: ${error.message}`);
        showToast('error', `Error: ${error.message}`);
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
    
    setButtonState(elements.streamBtn, true, 'Connecting...');
    showStatus(elements.streamStatus, 'info', 'Connecting to stream...');
    
    try {
        await startWebSocketStream(text, language);
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
    addChatMessage('user', message);
    elements.chatInput.value = '';
    
    setButtonState(elements.chatBtn, true, 'Thinking...');
    showStatus(elements.chatStatus, 'info', 'Sending message...');
    
    try {
        const requestBody = { message };
        if (currentConversationId) {
            requestBody.conversation_id = currentConversationId;
        }
        
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Store conversation ID
        currentConversationId = data.conversation_id;
        
        // Add bot response
        addChatMessage('bot', data.reply || 'No response received');
        showStatus(elements.chatStatus, 'success', 'Message sent successfully!');
        showToast('success', 'Message sent successfully!');

    } catch (error) {
        console.error('Chat Error:', error);
        addChatMessage('bot', `Sorry, I'm having trouble connecting to the AI service. ${error.message}`);
        showStatus(elements.chatStatus, 'error', `Error: ${error.message}`);
        showToast('error', `Error: ${error.message}`);
    } finally {
        setButtonState(elements.chatBtn, false, 'Send');
    }
}

// WebSocket Streaming Implementation
async function startWebSocketStream(text, language) {
    const encodedText = encodeURIComponent(text);
    const wsUrl = `${WS_BASE}/stream/${language}/${encodedText}`;
    
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        currentWebSocket = ws;
        const audioSamples = [];
        let sampleRate = 22050; // Default sample rate
        let totalChunks = 0;
        let receivedChunks = 0;

        ws.onopen = () => {
            isStreaming = true;
            setButtonState(elements.streamBtn, false, 'Stop Streaming');
            showStatus(elements.streamStatus, 'success', 'Connected! Streaming audio...');
            showToast('success', 'Streaming started');
            elements.streamProgress.classList.remove('hidden');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // Check for error messages
                if (data.error) {
                    throw new Error(data.error);
                }
                
                // Check for completion
                if (data.status === 'complete') {
                    return;
                }
                
                // Collect audio samples from the audio array
                if (data.audio && Array.isArray(data.audio)) {
                    audioSamples.push(...data.audio);
                    receivedChunks++;
                    updateStreamProgress(receivedChunks);
                }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                    showStatus(elements.streamStatus, 'error', 
                        `Error processing stream: ${error.message}`);
                    showToast('error', `Stream error: ${error.message}`);
                }
        };

        ws.onclose = () => {
            if (isStreaming && audioSamples.length > 0) {
                try {
                    // Convert f32 audio samples to WAV and encode as base64
                    const wavBase64 = convertF32ArrayToWavBase64(audioSamples, sampleRate);
                    playAudio(elements.streamAudio, wavBase64);
                    
                    showStatus(elements.streamStatus, 'success', 
                        'Streaming complete! Audio ready to play.');
                    showToast('success', 'Streaming complete!');
                } catch (error) {
                    console.error('Error converting audio:', error);
                    showStatus(elements.streamStatus, 'error', 
                        `Error converting audio: ${error.message}`);
                    showToast('error', `Audio conversion error: ${error.message}`);
                }
            } else if (isStreaming) {
                showStatus(elements.streamStatus, 'error', 
                    'No audio data received from stream.');
                showToast('error', 'No audio data received');
            }
            isStreaming = false;
            currentWebSocket = null;
            setButtonState(elements.streamBtn, false, 'Start Streaming');
            elements.streamProgress.classList.add('hidden');
            resolve();
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            showStatus(elements.streamStatus, 'error', 
                `WebSocket error: Connection failed`);
            showToast('error', 'WebSocket connection failed');
            isStreaming = false;
            currentWebSocket = null;
            setButtonState(elements.streamBtn, false, 'Start Streaming');
            elements.streamProgress.classList.add('hidden');
            reject(error);
        };
    });
}

// Update stream progress
function updateStreamProgress(chunks) {
    const progressFill = elements.streamProgress.querySelector('.progress-fill');
    // Simple progress indicator (could be improved with actual progress)
    progressFill.style.width = `${Math.min(100, chunks * 2)}%`;
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

// Custom Audio Player Setup
function setupCustomAudioPlayer() {
    if (!elements.ttsPlayPause || !elements.ttsProgress) return;
    
    // Play/Pause button
    elements.ttsPlayPause.addEventListener('click', () => {
        if (elements.ttsAudio.paused) {
            elements.ttsAudio.play();
        } else {
            elements.ttsAudio.pause();
        }
    });
    
    // Progress bar
    elements.ttsProgress.addEventListener('input', (e) => {
        const time = (e.target.value / 100) * elements.ttsAudio.duration;
        elements.ttsAudio.currentTime = time;
    });
    
    // Download button
    if (elements.ttsDownloadBtn) {
        elements.ttsDownloadBtn.addEventListener('click', downloadTtsAudio);
    }
    
    // Audio events
    elements.ttsAudio.addEventListener('loadedmetadata', () => {
        if (elements.ttsDuration) {
            elements.ttsDuration.textContent = formatTime(elements.ttsAudio.duration);
        }
    });
    
    elements.ttsAudio.addEventListener('timeupdate', () => {
        if (elements.ttsProgress) {
            const progress = (elements.ttsAudio.currentTime / elements.ttsAudio.duration) * 100;
            elements.ttsProgress.value = progress || 0;
        }
        if (elements.ttsCurrentTime) {
            elements.ttsCurrentTime.textContent = formatTime(elements.ttsAudio.currentTime);
        }
    });
    
    elements.ttsAudio.addEventListener('play', () => {
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.add('hidden');
        if (pauseIcon) pauseIcon.classList.remove('hidden');
    });
    
    elements.ttsAudio.addEventListener('pause', () => {
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
    });
    
    elements.ttsAudio.addEventListener('ended', () => {
        elements.ttsAudio.currentTime = 0;
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
    });
}

// Setup audio player with waveform
async function setupAudioPlayer(base64Data) {
    try {
        const audioBlob = await base64ToBlob(base64Data, 'audio/wav');
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Clean up previous URL
        if (elements.ttsAudio.previousUrl) {
            URL.revokeObjectURL(elements.ttsAudio.previousUrl);
        }
        elements.ttsAudio.previousUrl = audioUrl;
        
        elements.ttsAudio.src = audioUrl;
        elements.ttsAudioPlayer.classList.remove('hidden');
        
        // Generate waveform
        await generateWaveform(audioBlob);
        
    } catch (error) {
        console.error('Audio Setup Error:', error);
        throw new Error('Failed to setup audio: ' + error.message);
    }
}

// Generate waveform visualization
async function generateWaveform(audioBlob) {
    try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const canvas = elements.ttsWaveform;
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;
        
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(0, 0, width, height);
        
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.moveTo(0, amp);
        
        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            
            ctx.lineTo(i, (1 + min) * amp);
            ctx.lineTo(i, (1 + max) * amp);
        }
        
        ctx.lineTo(width, amp);
        ctx.closePath();
        ctx.fill();
        
        // Add gradient overlay
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.8)');
        gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.6)');
        gradient.addColorStop(1, 'rgba(20, 184, 166, 0.8)');
        ctx.fillStyle = gradient;
        ctx.fill();
        
    } catch (error) {
        console.error('Waveform generation error:', error);
    }
}

// Format time helper
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Audio Playback Functions (kept for streaming)
async function playAudio(audioElement, base64Data) {
    try {
        const audioBlob = await base64ToBlob(base64Data, 'audio/wav');
        const audioUrl = URL.createObjectURL(audioBlob);
        
        audioElement.src = audioUrl;
        audioElement.classList.remove('hidden');
        
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

// Convert base64 to Blob
async function base64ToBlob(base64, mimeType) {
    const audioData = atob(base64);
    const bytes = new Uint8Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
        bytes[i] = audioData.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

// Download TTS audio
async function downloadTtsAudio() {
    if (!currentAudioBlob) {
        showStatus(elements.ttsStatus, 'error', 'No audio available to download');
        return;
    }
    
    const url = URL.createObjectURL(currentAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tts-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus(elements.ttsStatus, 'success', 'Audio downloaded!');
    showToast('success', 'Audio downloaded successfully!');
}

// Spectrogram Display
function displaySpectrogram(container, base64Data) {
    container.innerHTML = `
        <div class="spectrogram-wrapper">
            <h4>Mel Spectrogram:</h4>
            <img src="data:image/png;base64,${base64Data}" alt="Spectrogram" loading="lazy" class="spectrogram-image">
        </div>
    `;
}

// Chat Functions
function addChatMessage(sender, message) {
    if (!elements.chatMessages) return;
    
    const messageClass = sender === 'user' ? 'user' : 'bot';
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageClass}`;
    // textContent automatically escapes HTML, so escapeHtml is not needed
    messageElement.textContent = message;
    
    elements.chatMessages.appendChild(messageElement);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Clear chat
function clearChat() {
    if (!elements.chatMessages) return;
    
    elements.chatMessages.innerHTML = `
        <div class="message bot welcome">
            Hello! I'm your AI assistant. Ask me anything!
        </div>
    `;
    currentConversationId = null;
    showStatus(elements.chatStatus, 'info', 'Chat cleared');
}

// Export chat
function exportChat() {
    if (!elements.chatMessages) return;
    
    const messages = Array.from(elements.chatMessages.querySelectorAll('.message'))
        .map(msg => msg.textContent)
        .join('\n');
    
    const blob = new Blob([messages], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus(elements.chatStatus, 'success', 'Chat exported!');
    showToast('success', 'Chat exported successfully!');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Server Status Functions
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
            updateServerStatus('connected', 'Server Connected');
            showStatus(elements.serverInfo, 'success', 'Server is running and healthy!');
            showToast('success', 'Server connected');
        } else {
            throw new Error(`Server returned ${response.status}`);
        }
    } catch (error) {
        console.error('Server Status Error:', error);
        updateServerStatus('disconnected', 'Server Disconnected');
        showStatus(elements.serverInfo, 'error', `Server is not responding: ${error.message}`);
        showToast('error', 'Server connection failed');
    }
}

async function getVoices() {
    showStatus(elements.serverInfo, 'info', 'Fetching voices...');

    try {
        const response = await fetch(`${API_BASE}/voices`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const voices = await response.json();
        showStatus(elements.serverInfo, 'success', 
            `Available voices:<br>
             ${voices.map(voice => `• ${formatLanguageName(voice)} (${voice})`).join('<br>')}`);
    } catch (error) {
        console.error('Voices Error:', error);
        showStatus(elements.serverInfo, 'error', `Error fetching voices: ${error.message}`);
    }
}

async function getVoicesDetail() {
    showStatus(elements.serverInfo, 'info', 'Fetching voice details...');

    try {
        const response = await fetch(`${API_BASE}/voices/detail`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const details = await response.json();
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

// Toast Notification System
function showToast(type, message, duration = 5000) {
    if (!elements.toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const content = document.createElement('div');
    content.className = 'toast-content';
    content.textContent = message;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => dismissToast(toast));
    
    toast.appendChild(content);
    toast.appendChild(closeBtn);
    elements.toastContainer.appendChild(toast);
    
    // Auto dismiss
    setTimeout(() => {
        dismissToast(toast);
    }, duration);
}

function dismissToast(toast) {
    toast.classList.add('fade-out');
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

// Utility Functions
function setButtonState(button, disabled, text) {
    if (!button) return;
    button.disabled = disabled;
    
    const btnText = button.querySelector('.btn-text');
    const btnSpinner = button.querySelector('.btn-spinner');
    const sendIcon = button.querySelector('.send-icon');
    
    // For chat button, keep icon visible, hide text
    if (button.id === 'chatBtn') {
        if (btnSpinner) {
            if (disabled) {
                btnSpinner.classList.remove('hidden');
                if (sendIcon) sendIcon.classList.add('hidden');
            } else {
                btnSpinner.classList.add('hidden');
                if (sendIcon) sendIcon.classList.remove('hidden');
            }
        }
    } else {
        // For other buttons, use text
        if (btnText) {
            btnText.textContent = text;
        } else {
            button.textContent = text;
        }
        
        if (btnSpinner) {
            if (disabled) {
                btnSpinner.classList.remove('hidden');
            } else {
                btnSpinner.classList.add('hidden');
            }
        }
    }
}

function showStatus(element, type, message) {
    if (!element) return;
    element.innerHTML = `<div class="status status-${type}">${message}</div>`;
}

function updateServerStatus(status, text) {
    if (!elements.serverStatus) return;
    
    elements.serverStatus.innerHTML = `<span class="status-dot"></span><span>${text}</span>`;
    elements.serverStatus.className = `status-badge ${status}`;
}

// Global Functions (for HTML onclick handlers)
window.checkServerStatus = checkServerStatus;
window.getVoices = getVoices;
window.getVoicesDetail = getVoicesDetail;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);
