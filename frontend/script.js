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
let currentStreamAudioBlob = null; // For streaming tab download
let streamMelFrames = []; // Accumulate mel frames for real-time visualization
let streamSpectrogramCtx = null; // Canvas context for real-time spectrogram

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
        chatMicBtn: document.getElementById('chatMicBtn'),
        voiceModeToggleBtn: document.getElementById('voiceModeToggleBtn'),
        exitVoiceModeBtn: document.getElementById('exitVoiceModeBtn'),
        voiceMicButton: document.getElementById('voiceMicButton'),
        voiceMicCanvas: document.getElementById('voiceMicCanvas'),
        voiceResponseCanvas: document.getElementById('voiceResponseCanvas'),
        voiceResponseAudio: document.getElementById('voiceResponseAudio'),
        voiceMicStatus: document.getElementById('voiceMicStatus'),
        voiceResponseStatus: document.getElementById('voiceResponseStatus'),
        voiceTranscriptContainer: document.getElementById('voiceTranscriptContainer'),
        voiceTranscriptText: document.getElementById('voiceTranscriptText'),
        textInputWrapper: document.getElementById('textInputWrapper'),
        voiceModeWrapper: document.getElementById('voiceModeWrapper'),
        voiceModeLanguage: document.getElementById('voiceModeLanguage'),
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
        streamAudioContainer: document.getElementById('streamAudioContainer'),
        streamDownloadBtn: document.getElementById('streamDownloadBtn'),
        ttsSpectrogram: document.getElementById('ttsSpectrogram'),
        streamSpectrogram: document.getElementById('streamSpectrogram'),
        streamSpectrogramCanvas: document.getElementById('streamSpectrogramCanvas'),
        streamWaveform: document.getElementById('streamWaveform'),
        chatMessages: document.getElementById('chatMessages'),
        streamProgress: document.getElementById('streamProgress'),
        serverMetrics: document.getElementById('serverMetrics'),
        
        // Custom Audio Player
        ttsAudioPlayer: document.getElementById('ttsAudioPlayer'),
        ttsPlayPause: document.getElementById('ttsPlayPause'),
        ttsProgress: document.getElementById('ttsProgress'),
        ttsWaveform: document.getElementById('ttsWaveform'),
        ttsDownloadBtn: document.getElementById('ttsDownloadBtn'),
        ttsSpeed: document.getElementById('ttsSpeed'),
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
                
                // If chat is the first tab, scroll to bottom after initialization
                if (firstTab === 'chat') {
                    setTimeout(() => {
                        scrollChatToBottom();
                    }, 300);
                }
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
                console.log(`Activated tab: ${targetTab}`, targetContent);
                console.log(`Element classes:`, targetContent.className);
                console.log(`Computed display:`, window.getComputedStyle(targetContent).display);
                
                // Update page title and description
                if (tabConfig[targetTab]) {
                    if (pageTitle) pageTitle.textContent = tabConfig[targetTab].title;
                    if (pageDescription) pageDescription.textContent = tabConfig[targetTab].desc;
                }
                
                // If switching to chat tab, scroll to bottom
                if (targetTab === 'chat') {
                    setTimeout(() => {
                        scrollChatToBottom();
                    }, 100);
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
    const selects = [elements.ttsLanguage, elements.streamLanguage, elements.voiceModeLanguage].filter(Boolean);
    
    selects.forEach(select => {
        if (!select) return;
        const isVoiceMode = select.id === 'voiceModeLanguage';
        
        // Determine default language (prefer en_US if available, otherwise de_DE)
        const defaultLang = voices.includes('en_US') ? 'en_US' : (voices.includes('de_DE') ? 'de_DE' : '');
        
        if (isVoiceMode) {
            // Voice mode: show default as selected, no "Default" option
            select.innerHTML = '';
        } else {
            select.innerHTML = '<option value="">Select language...</option>';
        }
        
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = formatLanguageName(voice);
            // Set default language as selected for voice mode
            if (isVoiceMode && voice === defaultLang) {
                option.selected = true;
            }
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

// Convert TTS language code to Speech Recognition language code
function ttsLangToSpeechLang(ttsLang) {
    const langMap = {
        'de_DE': 'de-DE',
        'fr_FR': 'fr-FR',
        'en_US': 'en-US',
        'en_GB': 'en-GB',
        'es_ES': 'es-ES',
        'it_IT': 'it-IT',
        'pt_PT': 'pt-PT',
        'nl_NL': 'nl-NL'
    };
    return langMap[ttsLang] || 'en-US';
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
    
    // Voice input (speech-to-text) setup
    if (elements.chatMicBtn) {
        setupVoiceInput();
    }
    
    // Voice mode toggle setup
    if (elements.voiceModeToggleBtn) {
        elements.voiceModeToggleBtn.addEventListener('click', () => {
            enterVoiceMode();
        });
    }
    
    if (elements.exitVoiceModeBtn) {
        elements.exitVoiceModeBtn.addEventListener('click', () => {
            exitVoiceMode();
        });
    }
    
    // Voice mode setup
    if (elements.voiceMicButton) {
        setupVoiceMode();
    }
    
    // Download button
    if (elements.downloadTtsBtn) {
        elements.downloadTtsBtn.addEventListener('click', downloadTtsAudio);
    }
    
    // Speed control
    if (elements.ttsSpeed) {
        elements.ttsSpeed.addEventListener('change', (e) => {
            const speed = parseFloat(e.target.value);
            if (elements.ttsAudio) {
                elements.ttsAudio.playbackRate = speed;
            }
        });
    }
    
    // Streaming download button
    if (elements.streamDownloadBtn) {
        elements.streamDownloadBtn.addEventListener('click', downloadStreamAudio);
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
        // Keep spectrogram and audio visible if they exist
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
    streamMelFrames = [];
    
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
    
    const startTime = Date.now();
    
    try {
        const requestBody = { message };
        if (currentConversationId) {
            requestBody.conversation_id = currentConversationId;
        }
        // Language is optional for regular chat (uses default)
        
        console.log('Sending chat message:', message.substring(0, 50) + '...');
        const requestStart = Date.now();
        
        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        const requestTime = Date.now() - requestStart;
        console.log(`Chat request completed in ${requestTime}ms`);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const totalTime = Date.now() - startTime;
        console.log(`Total chat response time: ${totalTime}ms`);
        
        // Store conversation ID
        currentConversationId = data.conversation_id;
        
        // Add bot response with audio
        addChatMessage('bot', data.reply || 'No response received', data.audio_base64);
        
        // Audio generation is optional for regular chat
        // Voice mode handles audio separately
        
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

// Initialize streaming spectrogram canvas
function initStreamSpectrogram() {
    if (!elements.streamSpectrogramCanvas) return;
    
    const canvas = elements.streamSpectrogramCanvas;
    const container = elements.streamSpectrogram;
    const containerWidth = container.offsetWidth || 800;
    
    canvas.width = containerWidth;
    canvas.height = 300;
    
    streamSpectrogramCtx = canvas.getContext('2d');
    streamMelFrames = [];
    
    // Clear canvas with black background
    if (streamSpectrogramCtx) {
        streamSpectrogramCtx.fillStyle = '#000';
        streamSpectrogramCtx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// Visualize mel frame in real-time
function visualizeMelFrame(melFrame) {
    if (!streamSpectrogramCtx || !elements.streamSpectrogramCanvas || melFrame.length === 0) return;
    
    const canvas = elements.streamSpectrogramCanvas;
    const n_mels = melFrame.length;
    const frameWidth = 2; // Width of each frame in pixels
    const melHeight = canvas.height;
    
    // Add frame to accumulation
    streamMelFrames.push([...melFrame]);
    
    // Keep only last N frames that fit on canvas
    const maxFrames = Math.floor(canvas.width / frameWidth);
    if (streamMelFrames.length > maxFrames) {
        streamMelFrames.shift(); // Remove oldest frame
    }
    
    // Clear canvas
    streamSpectrogramCtx.fillStyle = '#000';
    streamSpectrogramCtx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw all accumulated frames
    const binHeight = melHeight / n_mels;
    streamMelFrames.forEach((frame, frameIndex) => {
        const x = frameIndex * frameWidth;
        
        // Normalize mel values for visualization (per-frame normalization)
        const min = Math.min(...frame);
        const max = Math.max(...frame);
        const range = max - min || 1;
        
        // Draw each mel bin
        for (let i = 0; i < n_mels; i++) {
            const value = frame[i];
            const normalized = (value - min) / range;
            
            // Use a colormap (blue to cyan to green)
            const hue = 240 - (normalized * 120); // Blue (240) to Cyan (120)
            const saturation = 100;
            const lightness = 20 + (normalized * 60); // Dark to bright
            
            streamSpectrogramCtx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            streamSpectrogramCtx.fillRect(x, melHeight - (i + 1) * binHeight, frameWidth, binHeight);
        }
    });
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

        // Initialize spectrogram visualization
        initStreamSpectrogram();
        elements.streamSpectrogram.classList.remove('hidden');
        currentStreamAudioBlob = null; // Reset download blob

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
                
                // Visualize mel spectrogram frame in real-time
                if (data.mel && Array.isArray(data.mel)) {
                    visualizeMelFrame(data.mel);
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
                    
                    // Store blob for download and generate waveform
                    base64ToBlob(wavBase64, 'audio/wav').then(async blob => {
                        currentStreamAudioBlob = blob;
                        // Generate waveform visualization
                        await generateStreamWaveform(blob);
                    });
                    
                    playAudio(elements.streamAudio, wavBase64);
                    elements.streamAudioContainer.classList.remove('hidden');
                    
                    showStatus(elements.streamStatus, 'success', 
                        `Streaming complete! Audio ready to play.<br>
                         Received ${receivedChunks} chunks, ${audioSamples.length} samples total.`);
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
                elements.streamSpectrogram.classList.add('hidden');
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
        
        // Reset speed to default
        if (elements.ttsSpeed) {
            elements.ttsSpeed.value = '1';
            elements.ttsAudio.playbackRate = 1.0;
        }
        
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

// Generate waveform visualization for streaming tab
async function generateStreamWaveform(audioBlob) {
    if (!elements.streamWaveform) return;
    
    try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const canvas = elements.streamWaveform;
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth || 800;
        const height = canvas.height = 120; // Fixed height for streaming waveform
        
        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;
        
        // Clear canvas with light background
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(0, 0, width, height);
        
        // Draw waveform
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.moveTo(0, amp);
        
        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            
            for (let j = 0; j < step; j++) {
                const idx = (i * step) + j;
                if (idx < data.length) {
                    const datum = data[idx];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
            }
            
            ctx.lineTo(i, (1 + min) * amp);
            ctx.lineTo(i, (1 + max) * amp);
        }
        
        ctx.lineTo(width, amp);
        ctx.closePath();
        ctx.fill();
        
        // Add gradient overlay (different colors for streaming)
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.8)');
        gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.6)');
        gradient.addColorStop(1, 'rgba(168, 85, 247, 0.8)');
        ctx.fillStyle = gradient;
        ctx.fill();
        
    } catch (error) {
        console.error('Stream waveform generation error:', error);
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

// Download streaming audio
async function downloadStreamAudio() {
    if (!currentStreamAudioBlob) {
        showStatus(elements.streamStatus, 'error', 'No audio available to download');
        return;
    }
    
    const url = URL.createObjectURL(currentStreamAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stream-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus(elements.streamStatus, 'success', 'Audio downloaded!');
    showToast('success', 'Streaming audio downloaded successfully!');
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

// Helper function to scroll chat to bottom - ChatGPT style
function scrollChatToBottom(force = false) {
    if (!elements.chatMessages) return;
    
    const container = elements.chatMessages;
    
    // Use requestAnimationFrame to ensure DOM is fully rendered
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // Calculate scroll position
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;
            const maxScroll = scrollHeight - clientHeight;
            
            // Only scroll if we're near the bottom or forced
            const currentScroll = container.scrollTop;
            const isNearBottom = (scrollHeight - currentScroll - clientHeight) < 100;
            
            if (force || isNearBottom) {
                // Smooth scroll
                container.scrollTo({
                    top: scrollHeight,
                    behavior: force ? 'smooth' : 'auto'
                });
                
                // Immediate fallback for reliability
                container.scrollTop = scrollHeight;
            }
        });
    });
}

// Chat Functions - ChatGPT style structure
function addChatMessage(sender, message, audioBase64 = null) {
    if (!elements.chatMessages) return;
    
    const messageClass = sender === 'user' ? 'user' : 'bot';
    
    // Create wrapper div
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';
    
    // Create container div
    const messageContainer = document.createElement('div');
    messageContainer.className = `message-container ${messageClass}`;
    
    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageClass}`;
    
    // Create message content
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = message;
    messageElement.appendChild(messageContent);
    
    // Add audio player for bot messages with audio
    if (sender === 'bot' && audioBase64) {
        const audioWrapper = document.createElement('div');
        audioWrapper.className = 'message-audio-wrapper';
        
        const audioElement = document.createElement('audio');
        audioElement.controls = true;
        audioElement.className = 'message-audio';
        
        // Convert base64 to blob URL
        base64ToBlob(audioBase64, 'audio/wav').then(blob => {
            const audioUrl = URL.createObjectURL(blob);
            audioElement.src = audioUrl;
            // Clean up previous URL if exists
            if (audioElement.previousUrl) {
                URL.revokeObjectURL(audioElement.previousUrl);
            }
            audioElement.previousUrl = audioUrl;
            // Scroll again after audio loads
            scrollChatToBottom(true);
        }).catch(err => {
            console.error('Error creating audio blob:', err);
        });
        
        audioWrapper.appendChild(audioElement);
        messageElement.appendChild(audioWrapper);
    }
    
    // Assemble structure: wrapper > container > message
    messageContainer.appendChild(messageElement);
    messageWrapper.appendChild(messageContainer);
    
    // Remove welcome message if it exists
    const welcomeMessage = elements.chatMessages.querySelector('.message.welcome');
    if (welcomeMessage && sender === 'user') {
        const welcomeWrapper = welcomeMessage.closest('.message-wrapper');
        if (welcomeWrapper) {
            welcomeWrapper.remove();
        }
    }
    
    // Append to messages container
    elements.chatMessages.appendChild(messageWrapper);
    
    // Scroll to bottom after adding message (force scroll for new messages)
    scrollChatToBottom(true);
}

// Voice Input (Speech-to-Text) Setup
function setupVoiceInput() {
    // Check for speech recognition support
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        // Speech recognition not supported - hide button and show message
        if (elements.chatMicBtn) {
            elements.chatMicBtn.style.display = 'none';
        }
        console.warn('Speech recognition not supported in this browser');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;
    let accumulatedText = ''; // Store accumulated final text
    let recognitionState = 'idle'; // 'idle', 'starting', 'recording', 'stopping'

    try {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US'; // Default language, can be made configurable
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            isRecording = true;
            recognitionState = 'recording';
            // Preserve existing input and start accumulating new text
            if (elements.chatInput) {
                const existingValue = elements.chatInput.value.trim();
                accumulatedText = existingValue + (existingValue ? ' ' : '');
            } else {
                accumulatedText = '';
            }
            updateMicButtonState(true);
            showStatus(elements.chatStatus, 'info', 'Listening...');
        };

        recognition.onresult = (event) => {
            if (!event.results || event.results.length === 0) return;
            
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (!event.results[i] || !event.results[i][0]) continue;
                
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                    accumulatedText += transcript + ' '; // Accumulate final text
                } else {
                    interimTranscript += transcript;
                }
            }

            // Update input with accumulated final text and current interim results
            if (elements.chatInput) {
                const newValue = accumulatedText.trim() + (interimTranscript ? ' ' + interimTranscript : '');
                elements.chatInput.value = newValue;
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error, event);
            isRecording = false;
            recognitionState = 'idle';
            updateMicButtonState(false);
            
            let errorMsg = 'Speech recognition error';
            if (event.error === 'no-speech') {
                errorMsg = 'No speech detected. Please try again.';
            } else if (event.error === 'not-allowed') {
                errorMsg = 'Microphone permission denied. Please allow microphone access in your browser settings.';
            } else if (event.error === 'audio-capture') {
                errorMsg = 'No microphone found. Please connect a microphone.';
            } else if (event.error === 'network') {
                errorMsg = 'Network error. Please check your connection.';
            } else if (event.error === 'aborted') {
                // User stopped recording - this is normal, don't show error
                errorMsg = '';
            } else if (event.error === 'service-not-allowed') {
                errorMsg = 'Speech recognition service not allowed. Please check browser settings.';
            }
            
            if (errorMsg) {
                showStatus(elements.chatStatus, 'error', errorMsg);
            } else {
                // Clear status on normal abort
                if (elements.chatInput && elements.chatInput.value.trim()) {
                    showStatus(elements.chatStatus, 'success', 'Ready to send');
                } else {
                    showStatus(elements.chatStatus, 'info', '');
                }
            }
        };

        recognition.onend = () => {
            isRecording = false;
            recognitionState = 'idle';
            updateMicButtonState(false);
            
            // If we have text in the input, show ready status
            if (elements.chatInput && elements.chatInput.value.trim()) {
                showStatus(elements.chatStatus, 'success', 'Ready to send');
            } else {
                showStatus(elements.chatStatus, 'info', '');
            }
        };

        // Helper function to update microphone button visual state
        function updateMicButtonState(recording) {
            if (!elements.chatMicBtn) return;
            
            if (recording) {
                elements.chatMicBtn.classList.add('recording');
                const micIcon = elements.chatMicBtn.querySelector('.mic-icon');
                const micIconRecording = elements.chatMicBtn.querySelector('.mic-icon-recording');
                if (micIcon) micIcon.classList.add('hidden');
                if (micIconRecording) micIconRecording.classList.remove('hidden');
            } else {
                elements.chatMicBtn.classList.remove('recording');
                const micIcon = elements.chatMicBtn.querySelector('.mic-icon');
                const micIconRecording = elements.chatMicBtn.querySelector('.mic-icon-recording');
                if (micIcon) micIcon.classList.remove('hidden');
                if (micIconRecording) micIconRecording.classList.add('hidden');
            }
        }

        // Button event handlers
        if (elements.chatMicBtn) {
            let isPressed = false;
            let pressTimer = null;

            function handleStart(e) {
                e.preventDefault();
                e.stopPropagation();
                if (recognitionState === 'idle' && !isRecording) {
                    isPressed = true;
                    recognitionState = 'starting';
                    startRecording();
                }
            }

            function handleStop(e) {
                e.preventDefault();
                e.stopPropagation();
                if (isRecording && isPressed) {
                    recognitionState = 'stopping';
                    stopRecording();
                }
                isPressed = false;
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            }

            // Mouse events
            elements.chatMicBtn.addEventListener('mousedown', handleStart);
            elements.chatMicBtn.addEventListener('mouseup', handleStop);
            elements.chatMicBtn.addEventListener('mouseleave', handleStop);

            // Touch events for mobile
            elements.chatMicBtn.addEventListener('touchstart', handleStart, { passive: false });
            elements.chatMicBtn.addEventListener('touchend', handleStop, { passive: false });
            elements.chatMicBtn.addEventListener('touchcancel', handleStop, { passive: false });

            // Prevent context menu on long press
            elements.chatMicBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
        }

        function startRecording() {
            if (!recognition) return;
            
            // Check if already recording or starting
            if (isRecording || recognitionState === 'starting' || recognitionState === 'recording') {
                console.log('Recognition already active, skipping start');
                return;
            }

            try {
                recognitionState = 'starting';
                // Small delay to ensure state is set
                setTimeout(() => {
                    if (recognitionState === 'starting' && !isRecording) {
                        try {
                            recognition.start();
                        } catch (err) {
                            console.error('Error starting recognition in timeout:', err);
                            recognitionState = 'idle';
                            isRecording = false;
                            updateMicButtonState(false);
                            
                            let errorMsg = 'Failed to start voice input';
                            if (err.message && err.message.includes('already started')) {
                                errorMsg = 'Voice input already active';
                            } else if (err.message && err.message.includes('not allowed')) {
                                errorMsg = 'Microphone permission denied';
                            }
                            showStatus(elements.chatStatus, 'error', errorMsg);
                        }
                    }
                }, 50);
            } catch (err) {
                console.error('Error starting recognition:', err);
                recognitionState = 'idle';
                isRecording = false;
                updateMicButtonState(false);
                
                let errorMsg = 'Failed to start voice input';
                if (err.message && err.message.includes('already started')) {
                    errorMsg = 'Voice input already active';
                } else if (err.message && err.message.includes('not allowed')) {
                    errorMsg = 'Microphone permission denied';
                }
                showStatus(elements.chatStatus, 'error', errorMsg);
            }
        }

        function stopRecording() {
            if (!recognition) return;
            
            if (isRecording || recognitionState === 'recording' || recognitionState === 'starting') {
                try {
                    recognitionState = 'stopping';
                    recognition.stop();
                } catch (err) {
                    console.error('Error stopping recognition:', err);
                    // Force reset state
                    recognitionState = 'idle';
                    isRecording = false;
                    updateMicButtonState(false);
                }
            }
        }

    } catch (err) {
        console.error('Error setting up speech recognition:', err);
        if (elements.chatMicBtn) {
            elements.chatMicBtn.style.display = 'none';
        }
        showStatus(elements.chatStatus, 'error', 'Voice input not available in this browser');
    }
}

// Generate audio for chat message separately (fallback)
async function generateChatAudio(text, language) {
    try {
        const requestBody = { text, language };
        const response = await fetch(`${API_BASE}/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.audio_base64 || null;
    } catch (error) {
        console.error('Error generating chat audio:', error);
        return null;
    }
}

// Clear chat - ChatGPT style
function clearChat() {
    if (!elements.chatMessages) return;
    
    // Clear all messages
    elements.chatMessages.innerHTML = '';
    
    // Add welcome message back with new structure
    const welcomeWrapper = document.createElement('div');
    welcomeWrapper.className = 'message-wrapper';
    
    const welcomeContainer = document.createElement('div');
    welcomeContainer.className = 'message-container bot';
    
    const welcomeMessage = document.createElement('div');
    welcomeMessage.className = 'message bot welcome';
    welcomeMessage.textContent = '👋 Hello! I\'m your AI assistant. Ask me anything!';
    
    welcomeContainer.appendChild(welcomeMessage);
    welcomeWrapper.appendChild(welcomeContainer);
    elements.chatMessages.appendChild(welcomeWrapper);
    
    // Reset conversation
    currentConversationId = null;
    
    // Scroll to top
    elements.chatMessages.scrollTop = 0;
    
    showStatus(elements.chatStatus, 'info', 'Chat cleared');
    showToast('success', 'Chat cleared');
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

// Voice Mode Functions
function enterVoiceMode() {
    if (elements.textInputWrapper && elements.voiceModeWrapper) {
        elements.textInputWrapper.classList.add('hidden');
        elements.voiceModeWrapper.classList.remove('hidden');
    }
}

function exitVoiceMode() {
    if (elements.textInputWrapper && elements.voiceModeWrapper) {
        elements.textInputWrapper.classList.remove('hidden');
        elements.voiceModeWrapper.classList.add('hidden');
    }
    // Stop any ongoing recording
    if (window.voiceModeRecognition) {
        try {
            window.voiceModeRecognition.stop();
        } catch (e) {
            console.warn('Error stopping recognition:', e);
        }
    }
    // Cleanup microphone stream
    if (window.voiceModeStream) {
        window.voiceModeStream.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped microphone track on exit');
        });
        window.voiceModeStream = null;
    }
}

// Voice Mode Setup with Frequency Visualization
function setupVoiceMode() {
    console.log('Setting up voice mode...');
    
    if (!elements.voiceMicButton) {
        console.error('Voice mic button not found');
        return;
    }
    
    if (!elements.voiceMicCanvas || !elements.voiceResponseCanvas) {
        console.error('Frequency canvases not found');
        return;
    }

    // Check for speech recognition support
    const hasWebkit = 'webkitSpeechRecognition' in window;
    const hasStandard = 'SpeechRecognition' in window;
    
    console.log('Speech recognition support:', { hasWebkit, hasStandard });
    
    if (!hasWebkit && !hasStandard) {
        console.warn('Speech recognition not supported in this browser');
        if (elements.voiceMicButton) {
            elements.voiceMicButton.disabled = true;
            elements.voiceMicStatus.textContent = 'Voice recognition not supported';
        }
        showStatus(elements.chatStatus, 'error', 'Speech recognition not supported in this browser. Please use Chrome, Edge, or Safari.');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;
    let audioContext = null;
    let analyser = null;
    let microphone = null;
    let dataArray = null;
    let animationFrameId = null;
    let currentConversationId = null;
    
    // VAD (Voice Activity Detection) configuration
    const VAD_CONFIG = {
        enabled: true, // Enable/disable VAD
        silenceThreshold: 30, // Audio level threshold (0-255, lower = more sensitive)
        silenceDuration: 1500, // Milliseconds of silence before auto-stop
        checkInterval: 100, // How often to check audio levels (ms)
        minRecordingDuration: 500, // Minimum recording duration before VAD can trigger (ms)
    };
    
    let vadState = {
        lastVoiceTime: null,
        silenceStartTime: null,
        isVoiceDetected: false,
        vadCheckInterval: null,
        recordingStartTime: null,
    };

    // Initialize audio context for frequency analysis
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
        console.error('Error initializing audio context:', err);
    }

    // Setup canvas
    const micCanvas = elements.voiceMicCanvas;
    const responseCanvas = elements.voiceResponseCanvas;
    const micCtx = micCanvas.getContext('2d');
    const responseCtx = responseCanvas.getContext('2d');
    
    function resizeCanvases() {
        // Mic canvas: 220x220 to fit in 240x240 container
        micCanvas.width = 220;
        micCanvas.height = 220;
        
        // Response canvas: full width/height of container minus padding
        const responseContainer = elements.voiceResponseCanvas?.parentElement;
        if (responseContainer) {
            const containerWidth = responseContainer.offsetWidth - 32; // minus padding
            const containerHeight = responseContainer.offsetHeight - 32;
            responseCanvas.width = containerWidth || 468;
            responseCanvas.height = containerHeight || 88;
        } else {
            responseCanvas.width = responseCanvas.offsetWidth || 468;
            responseCanvas.height = responseCanvas.offsetHeight || 88;
        }
    }
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // VAD: Calculate average audio level from frequency data
    function calculateAudioLevel() {
        if (!analyser || !dataArray) return 0;
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate RMS (Root Mean Square) for better voice detection
        let sum = 0;
        let count = 0;
        
        // Focus on speech frequency range (roughly 300-3400 Hz)
        // With fftSize=256 and sampleRate=44100, each bin is ~86 Hz
        // So bins 3-40 roughly cover speech frequencies
        const speechStartBin = 3;
        const speechEndBin = Math.min(40, dataArray.length);
        
        for (let i = speechStartBin; i < speechEndBin; i++) {
            sum += dataArray[i] * dataArray[i]; // Square for RMS
            count++;
        }
        
        const rms = Math.sqrt(sum / count);
        return rms;
    }
    
    // VAD: Check for voice activity and handle auto-stop
    function checkVoiceActivity() {
        if (!isRecording || !VAD_CONFIG.enabled) return;
        
        const audioLevel = calculateAudioLevel();
        const now = Date.now();
        const recordingDuration = now - vadState.recordingStartTime;
        
        // Check if audio level indicates voice activity
        const hasVoice = audioLevel > VAD_CONFIG.silenceThreshold;
        
        if (hasVoice) {
            // Voice detected
            vadState.isVoiceDetected = true;
            vadState.lastVoiceTime = now;
            vadState.silenceStartTime = null;
            
            // Update status to show voice is detected
            if (elements.voiceMicStatus && elements.voiceMicStatus.textContent.includes('Listening')) {
                // Keep listening status, maybe add visual indicator
            }
        } else {
            // Silence detected
            if (vadState.isVoiceDetected) {
                // This is the start of silence after voice
                if (!vadState.silenceStartTime) {
                    vadState.silenceStartTime = now;
                }
                
                const silenceDuration = now - vadState.silenceStartTime;
                
                // Only auto-stop if:
                // 1. We've recorded for at least minimum duration
                // 2. Silence has lasted long enough
                if (recordingDuration >= VAD_CONFIG.minRecordingDuration && 
                    silenceDuration >= VAD_CONFIG.silenceDuration) {
                    
                    console.log('VAD: Auto-stopping due to silence', {
                        silenceDuration,
                        audioLevel,
                        recordingDuration
                    });
                    
                    // Auto-stop recording
                    if (recognition && isRecording) {
                        recognition.stop();
                        elements.voiceMicStatus.textContent = 'Processing...';
                    }
                    
                    // Stop VAD checking
                    stopVAD();
                } else if (silenceDuration > VAD_CONFIG.silenceDuration * 0.5) {
                    // Show warning that silence is detected (50% of threshold)
                    if (elements.voiceMicStatus && !elements.voiceMicStatus.textContent.includes('...')) {
                        elements.voiceMicStatus.textContent = 'Listening... (silence detected)';
                    }
                }
            }
        }
    }
    
    // Start VAD monitoring
    function startVAD() {
        if (!VAD_CONFIG.enabled || vadState.vadCheckInterval) return;
        
        vadState.recordingStartTime = Date.now();
        vadState.lastVoiceTime = null;
        vadState.silenceStartTime = null;
        vadState.isVoiceDetected = false;
        
        vadState.vadCheckInterval = setInterval(() => {
            checkVoiceActivity();
        }, VAD_CONFIG.checkInterval);
        
        console.log('VAD started', VAD_CONFIG);
    }
    
    // Stop VAD monitoring
    function stopVAD() {
        if (vadState.vadCheckInterval) {
            clearInterval(vadState.vadCheckInterval);
            vadState.vadCheckInterval = null;
        }
        vadState.isVoiceDetected = false;
        vadState.silenceStartTime = null;
    }
    
    // Frequency visualization for microphone
    function drawMicFrequency() {
        if (!isRecording || !analyser || !micCtx) return;
        
        analyser.getByteFrequencyData(dataArray);
        
        micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height);
        
        const centerX = micCanvas.width / 2;
        const centerY = micCanvas.height / 2;
        const radius = Math.min(centerX, centerY) - 20;
        const bars = dataArray.length;
        const angleStep = (Math.PI * 2) / bars;
        
        // Use color to indicate voice activity (green when voice detected)
        const audioLevel = calculateAudioLevel();
        const hasVoice = audioLevel > VAD_CONFIG.silenceThreshold;
        micCtx.strokeStyle = hasVoice ? '#10b981' : '#6366f1'; // Green when voice, blue when silent
        
        micCtx.lineWidth = 2;
        micCtx.beginPath();
        
        for (let i = 0; i < bars; i++) {
            const angle = i * angleStep - Math.PI / 2;
            const value = dataArray[i] / 255;
            const barLength = radius * 0.3 + (radius * 0.7 * value);
            const x = centerX + Math.cos(angle) * barLength;
            const y = centerY + Math.sin(angle) * barLength;
            
            if (i === 0) {
                micCtx.moveTo(x, y);
            } else {
                micCtx.lineTo(x, y);
            }
        }
        
        micCtx.closePath();
        micCtx.stroke();
        
        // Fill with gradient
        const gradient = micCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');
        micCtx.fillStyle = gradient;
        micCtx.fill();
        
        animationFrameId = requestAnimationFrame(drawMicFrequency);
    }

    // Frequency visualization for bot audio
    function drawResponseFrequency() {
        if (!analyser || !responseCtx) return;
        
        analyser.getByteFrequencyData(dataArray);
        
        responseCtx.clearRect(0, 0, responseCanvas.width, responseCanvas.height);
        
        const barWidth = responseCanvas.width / dataArray.length;
        const maxBarHeight = responseCanvas.height;
        
        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * maxBarHeight;
            const x = i * barWidth;
            const y = responseCanvas.height - barHeight;
            
            const gradient = responseCtx.createLinearGradient(0, responseCanvas.height, 0, y);
            gradient.addColorStop(0, '#6366f1');
            gradient.addColorStop(0.5, '#8b5cf6');
            gradient.addColorStop(1, '#ec4899');
            
            responseCtx.fillStyle = gradient;
            responseCtx.fillRect(x, y, barWidth - 1, barHeight);
        }
        
        animationFrameId = requestAnimationFrame(drawResponseFrequency);
    }

    // Function to update speech recognition language
    function updateRecognitionLanguage() {
        if (!recognition) return;
        const selectedLang = elements.voiceModeLanguage?.value || '';
        const defaultLang = voices.includes('en_US') ? 'en_US' : (voices.includes('de_DE') ? 'de_DE' : '');
        const ttsLang = selectedLang || defaultLang;
        const speechLang = ttsLangToSpeechLang(ttsLang);
        recognition.lang = speechLang;
        console.log('Speech recognition language updated:', { ttsLang, speechLang });
    }

    try {
        recognition = new SpeechRecognition();
        recognition.continuous = true; // Changed to continuous for better control
        recognition.interimResults = true; // Enable interim results for better feedback
        recognition.maxAlternatives = 1;
        
        // Set initial language based on voice mode selector
        updateRecognitionLanguage();
        
        console.log('Speech recognition initialized:', {
            continuous: recognition.continuous,
            interimResults: recognition.interimResults,
            lang: recognition.lang
        });
        
        // Update recognition language when voice mode language changes
        if (elements.voiceModeLanguage) {
            elements.voiceModeLanguage.addEventListener('change', () => {
                updateRecognitionLanguage();
                console.log('Language changed, speech recognition updated to:', recognition.lang);
            });
        }

        recognition.onstart = () => {
            console.log('Speech recognition started');
            isRecording = true;
            elements.voiceMicButton.classList.add('recording');
            elements.voiceMicStatus.textContent = 'Listening...';
            
            // Start VAD monitoring
            if (microphone && analyser) {
                startVAD();
            }
            
            // Start frequency visualization if microphone stream is available
            if (microphone && analyser) {
                drawMicFrequency();
            }
        };

        recognition.onresult = async (event) => {
            console.log('Speech recognition result:', event);
            if (!event.results || event.results.length === 0) {
                console.warn('No results in recognition event');
                return;
            }
            
            let finalTranscript = '';
            let interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i] && event.results[i][0]) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript + ' ';
                    } else {
                        interimTranscript += transcript;
                    }
                }
            }
            
            // Update status with interim results
            if (interimTranscript) {
                elements.voiceMicStatus.textContent = `Listening: ${interimTranscript}`;
            }
            
            // Only send when we have final results
            if (finalTranscript.trim()) {
                console.log('Final transcript:', finalTranscript.trim());
                // Stop recording before sending
                recognition.stop();
                await sendVoiceMessage(finalTranscript.trim());
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error, event);
            isRecording = false;
            elements.voiceMicButton.classList.remove('recording');
            
            // Stop VAD on error
            stopVAD();
            
            if (microphone) {
                microphone.disconnect();
                microphone = null;
            }
            
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height);
            
            let errorMsg = 'Speech recognition error';
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                errorMsg = 'Microphone permission denied. Please allow microphone access in browser settings.';
                elements.voiceMicStatus.textContent = 'Permission denied';
            } else if (event.error === 'no-speech') {
                errorMsg = 'No speech detected. Please try again.';
                elements.voiceMicStatus.textContent = 'No speech detected';
            } else if (event.error === 'audio-capture') {
                errorMsg = 'No microphone found. Please connect a microphone.';
                elements.voiceMicStatus.textContent = 'No microphone';
            } else if (event.error === 'network') {
                errorMsg = 'Network error. Please check your connection.';
                elements.voiceMicStatus.textContent = 'Network error';
            } else if (event.error === 'aborted') {
                // Normal stop, don't show error
                elements.voiceMicStatus.textContent = 'Click to speak';
                return;
            } else {
                errorMsg = `Error: ${event.error}`;
                elements.voiceMicStatus.textContent = 'Error occurred';
            }
            showStatus(elements.chatStatus, 'error', errorMsg);
        };

        recognition.onend = () => {
            console.log('Speech recognition ended');
            isRecording = false;
            elements.voiceMicButton.classList.remove('recording');
            
            // Stop VAD monitoring
            stopVAD();
            
            // Cleanup microphone (but keep stream for potential reuse)
            if (microphone) {
                microphone.disconnect();
                microphone = null;
            }
            
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (micCtx) {
                micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height);
            }
            
            // Only update status if not processing
            if (elements.voiceMicStatus.textContent !== 'Processing...') {
                elements.voiceMicStatus.textContent = 'Click to speak';
            }
        };

        // Store recognition globally for exit function
        window.voiceModeRecognition = recognition;

        // Function to request microphone access with improved error handling
        async function requestMicrophoneAccess() {
            // Check if we already have a stream
            if (window.voiceModeStream && window.voiceModeStream.active) {
                // Reconnect to audio context if needed
                if (audioContext && analyser && !microphone) {
                    microphone = audioContext.createMediaStreamSource(window.voiceModeStream);
                    microphone.connect(analyser);
                }
                return true;
            }

            // Check if getUserMedia is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                const errorMsg = 'Microphone access is not supported in this browser. Please use a modern browser like Chrome, Edge, Firefox, or Opera.';
                showStatus(elements.chatStatus, 'error', errorMsg);
                elements.voiceMicStatus.textContent = 'Not supported';
                showToast('error', errorMsg);
                return false;
            }

            // Check permissions API if available
            let permissionDenied = false;
            if (navigator.permissions) {
                try {
                    const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
                    console.log('Microphone permission status:', permissionStatus.state);
                    
                    if (permissionStatus.state === 'denied') {
                        permissionDenied = true;
                        const errorMsg = `Microphone permission denied. Please enable it in your browser settings:
                        <br><strong>Chrome/Edge:</strong> Click the lock icon in the address bar → Site settings → Microphone → Allow
                        <br><strong>Firefox:</strong> Click the lock icon → Permissions → Microphone → Allow
                        <br><strong>Safari:</strong> Safari → Preferences → Websites → Microphone → Allow`;
                        showStatus(elements.chatStatus, 'error', errorMsg);
                        elements.voiceMicStatus.textContent = 'Permission denied - Check settings';
                        showToast('error', 'Microphone permission denied. Check browser settings.');
                        return false;
                    }
                    
                    // Listen for permission changes
                    permissionStatus.onchange = () => {
                        console.log('Permission status changed to:', permissionStatus.state);
                        if (permissionStatus.state === 'granted') {
                            showStatus(elements.chatStatus, 'success', 'Microphone permission granted! You can now use voice mode.');
                            showToast('success', 'Microphone permission granted!');
                        }
                    };
                } catch (err) {
                    // Permissions API might not be supported, continue anyway
                    console.log('Permissions API not fully supported:', err);
                }
            }

            // Resume audio context on user interaction (required by browsers)
            if (audioContext && audioContext.state === 'suspended') {
                try {
                    await audioContext.resume();
                    console.log('Audio context resumed');
                } catch (err) {
                    console.warn('Could not resume audio context:', err);
                }
            }

            try {
                console.log('Requesting microphone access...');
                elements.voiceMicStatus.textContent = 'Requesting microphone access...';
                
                // Request microphone access with fallback options
                let stream;
                try {
                    // Try with all audio constraints first
                    stream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        } 
                    });
                } catch (err) {
                    console.warn('Failed with full constraints, trying basic audio:', err);
                    // Fallback to basic audio if advanced constraints fail
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ 
                            audio: true
                        });
                    } catch (err2) {
                        console.warn('Failed with basic audio, trying without constraints:', err2);
                        // Last resort: try without any constraints
                        stream = await navigator.mediaDevices.getUserMedia({ 
                            audio: {}
                        });
                    }
                }
                
                console.log('Microphone access granted');
                
                // Store stream globally for cleanup
                window.voiceModeStream = stream;
                
                // Connect to audio context for visualization
                if (audioContext && analyser) {
                    microphone = audioContext.createMediaStreamSource(stream);
                    microphone.connect(analyser);
                }
                
                return true;
            } catch (err) {
                console.error('Error accessing microphone:', err);
                let errorMsg = 'Failed to access microphone';
                let userMsg = 'Please allow microphone access in your browser settings.';
                
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    errorMsg = 'Microphone permission denied';
                    userMsg = 'Microphone permission denied. Please click the lock icon in your browser address bar and allow microphone access, then try again.';
                } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    errorMsg = 'No microphone found';
                    userMsg = 'No microphone found. Please connect a microphone and try again.';
                } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                    errorMsg = 'Microphone is in use';
                    userMsg = 'Microphone is already in use by another application. Please close other applications using the microphone and try again.';
                } else if (err.name === 'OverconstrainedError') {
                    errorMsg = 'Microphone constraints not supported';
                    userMsg = 'Your microphone does not support the requested settings. Trying with basic settings...';
                } else {
                    userMsg = `Error: ${err.message || err.name || 'Unknown error'}. Please check your browser settings.`;
                }
                
                showStatus(elements.chatStatus, 'error', userMsg);
                elements.voiceMicStatus.textContent = 'Click to try again';
                return false;
            }
        }

        // Function to cleanup microphone stream
        function cleanupMicrophone() {
            // Stop VAD
            stopVAD();
            
            if (window.voiceModeStream) {
                window.voiceModeStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Stopped microphone track');
                });
                window.voiceModeStream = null;
            }
            if (microphone) {
                microphone.disconnect();
                microphone = null;
            }
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (micCtx) {
                micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height);
            }
        }

        // Click to start/stop recording
        elements.voiceMicButton.addEventListener('click', async () => {
            console.log('Mic button clicked, isRecording:', isRecording);
            
            if (!isRecording) {
                // Request microphone access first
                const hasAccess = await requestMicrophoneAccess();
                if (!hasAccess) {
                    return; // Error already shown to user
                }
                
                // Now start speech recognition
                try {
                    console.log('Starting speech recognition...');
                    recognition.start();
                    elements.voiceMicStatus.textContent = 'Starting...';
                } catch (err) {
                    console.error('Error starting recognition:', err);
                    cleanupMicrophone();
                    let errorMsg = 'Failed to start voice input';
                    if (err.message && err.message.includes('already started')) {
                        errorMsg = 'Voice input already active';
                    } else if (err.message && err.message.includes('not allowed')) {
                        errorMsg = 'Microphone permission denied. Please allow microphone access.';
                    } else {
                        errorMsg = `Error: ${err.message || err.name || 'Unknown error'}`;
                    }
                    showStatus(elements.chatStatus, 'error', errorMsg);
                    elements.voiceMicStatus.textContent = 'Click to speak';
                }
            } else {
                console.log('Stopping speech recognition...');
                recognition.stop();
                cleanupMicrophone();
                // VAD will be stopped in recognition.onend
            }
        });

        async function sendVoiceMessage(text) {
            const startTime = Date.now();
            elements.voiceMicStatus.textContent = 'Processing...';
            showStatus(elements.chatStatus, 'info', 'Sending message...');
            
            // Add user message to chat
            addChatMessage('user', text);
            
            try {
                // Use voice mode language selector
                const selectedLanguage = elements.voiceModeLanguage?.value || '';
                const defaultLang = voices.includes('en_US') ? 'en_US' : (voices.includes('de_DE') ? 'de_DE' : '');
                const language = selectedLanguage || defaultLang;
                
                const requestBody = {
                    message: text,
                    language: language
                };
                if (currentConversationId) {
                    requestBody.conversation_id = currentConversationId;
                }
                
                console.log('Sending voice message:', text);
                const requestStart = Date.now();
                
                const response = await fetch(`${API_BASE}/voice-chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody)
                });

                const requestTime = Date.now() - requestStart;
                console.log(`Request completed in ${requestTime}ms`);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }

                const data = await response.json();
                const totalTime = Date.now() - startTime;
                console.log(`Total response time: ${totalTime}ms`);
                
                currentConversationId = data.conversation_id;
                
                // Add bot response to chat
                addChatMessage('bot', data.reply || 'Response received');
                
                // Play bot response with frequency visualization and real-time transcript
                await playBotResponse(data.audio_base64, data.sample_rate, data.cleaned_text || data.reply || '');
                
                showStatus(elements.chatStatus, 'success', `Response received (${(totalTime/1000).toFixed(1)}s)`);
                elements.voiceMicStatus.textContent = 'Click to speak';
                
            } catch (error) {
                console.error('Voice mode error:', error);
                showStatus(elements.chatStatus, 'error', `Error: ${error.message}`);
                elements.voiceMicStatus.textContent = 'Click to speak';
            }
        }

        async function playBotResponse(audioBase64, sampleRate, transcriptText) {
            try {
                // Resume audio context if suspended
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }
                
                const audioBlob = await base64ToBlob(audioBase64, 'audio/wav');
                const audioUrl = URL.createObjectURL(audioBlob);
                
                // Create audio source for visualization
                const audio = new Audio(audioUrl);
                
                // Check if we can create media element source (may fail if already connected)
                let source;
                try {
                    source = audioContext.createMediaElementSource(audio);
                    source.connect(analyser);
                    analyser.connect(audioContext.destination);
                } catch (err) {
                    // If media element source creation fails, use audio directly
                    console.warn('Could not create media element source, using direct audio:', err);
                    audio.connect = null; // Prevent errors
                }
                
                elements.voiceResponseAudio.src = audioUrl;
                elements.voiceResponseStatus.textContent = 'Bot is speaking...';
                
                // Show transcript container and initialize real-time text display
                let wordInterval = null;
                if (transcriptText && elements.voiceTranscriptContainer && elements.voiceTranscriptText) {
                    elements.voiceTranscriptContainer.style.display = 'block';
                    elements.voiceTranscriptText.textContent = '';
                    
                    // Wait for audio metadata to load to get accurate duration
                    await new Promise((resolve) => {
                        audio.addEventListener('loadedmetadata', resolve, { once: true });
                        // Fallback timeout
                        setTimeout(resolve, 1000);
                    });
                    
                    // Calculate words per second for real-time display
                    const words = transcriptText.split(/\s+/).filter(w => w.length > 0);
                    const audioDuration = audio.duration || 3; // Fallback to 3 seconds if duration unknown
                    const wordsPerSecond = words.length / audioDuration;
                    const intervalMs = Math.max(50, Math.min(500, 1000 / wordsPerSecond)); // Between 50ms and 500ms
                    
                    // Display text word by word in real-time
                    let currentWordIndex = 0;
                    wordInterval = setInterval(() => {
                        if (currentWordIndex < words.length && !audio.paused && !audio.ended) {
                            const displayedWords = words.slice(0, currentWordIndex + 1).join(' ');
                            elements.voiceTranscriptText.textContent = displayedWords;
                            currentWordIndex++;
                            
                            // Scroll to bottom to keep latest text visible
                            elements.voiceTranscriptText.scrollTop = elements.voiceTranscriptText.scrollHeight;
                        } else {
                            clearInterval(wordInterval);
                            wordInterval = null;
                            // Ensure full text is displayed when done
                            if (currentWordIndex < words.length) {
                                elements.voiceTranscriptText.textContent = transcriptText;
                            }
                        }
                    }, intervalMs);
                }
                
                // Start frequency visualization if source was created
                if (source) {
                    drawResponseFrequency();
                }
                
                await audio.play();
                
                audio.onended = () => {
                    elements.voiceResponseStatus.textContent = '';
                    if (animationFrameId) {
                        cancelAnimationFrame(animationFrameId);
                    }
                    responseCtx.clearRect(0, 0, responseCanvas.width, responseCanvas.height);
                    if (source) {
                        source.disconnect();
                    }
                    // Clear word interval if still running
                    if (wordInterval) {
                        clearInterval(wordInterval);
                    }
                    // Ensure full transcript is shown
                    if (transcriptText && elements.voiceTranscriptText) {
                        elements.voiceTranscriptText.textContent = transcriptText;
                    }
                    // Hide transcript after a short delay
                    if (elements.voiceTranscriptContainer) {
                        setTimeout(() => {
                            if (elements.voiceTranscriptContainer) {
                                elements.voiceTranscriptContainer.style.display = 'none';
                                if (elements.voiceTranscriptText) {
                                    elements.voiceTranscriptText.textContent = '';
                                }
                            }
                        }, 2000);
                    }
                    URL.revokeObjectURL(audioUrl);
                };
                
            } catch (error) {
                console.error('Error playing bot response:', error);
                showStatus(elements.chatStatus, 'error', 'Failed to play response');
                if (elements.voiceTranscriptContainer) {
                    elements.voiceTranscriptContainer.style.display = 'none';
                }
            }
        }

    } catch (err) {
        console.error('Error setting up voice mode:', err);
        if (elements.voiceMicButton) {
            elements.voiceMicButton.disabled = true;
        }
        showStatus(elements.chatStatus, 'error', 'Voice mode not available');
    }
}

// Get server metrics
async function getServerMetrics() {
    if (elements.serverMetrics) {
        elements.serverMetrics.classList.remove('hidden');
    }
    showStatus(elements.serverInfo, 'info', 'Fetching server metrics...');

    try {
        const response = await fetch(`${API_BASE}/metrics`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const metrics = await response.json();
        
        // Format uptime
        const uptimeHours = Math.floor(metrics.uptime_seconds / 3600);
        const uptimeMinutes = Math.floor((metrics.uptime_seconds % 3600) / 60);
        const uptimeSeconds = metrics.uptime_seconds % 60;
        const uptimeStr = `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`;
        
        // Format system load
        const loadStr = metrics.system_load 
            ? metrics.system_load.toFixed(2) 
            : 'N/A';
        
        // Create metrics display
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
        showToast('success', 'Metrics updated');
    } catch (error) {
        console.error('Metrics Error:', error);
        showStatus(elements.serverInfo, 'error', `Error fetching metrics: ${error.message}`);
        if (elements.serverMetrics) {
            elements.serverMetrics.classList.add('hidden');
        }
    }
}

// Global Functions (for HTML onclick handlers)
window.checkServerStatus = checkServerStatus;
window.getServerMetrics = getServerMetrics;
window.getVoices = getVoices;
window.getVoicesDetail = getVoicesDetail;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);
