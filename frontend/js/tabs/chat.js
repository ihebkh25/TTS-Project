// Chat Tab Module - AI Chat functionality

import { CONFIG } from '../config.js';
import { sendChatMessage, sendVoiceChatMessage } from '../services/api.js';
import { setButtonState, showStatus } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { addChatMessage, scrollChatToBottom, clearChat, exportChat, updateMessageState, addMessageSpectrogram } from '../components/chat.js';
import { base64ToBlob } from '../utils/audio.js';
import { 
    isSpeechRecognitionSupported, 
    createSpeechRecognition,
    requestMicrophoneAccess,
    createVADChecker,
    calculateAudioLevel
} from '../services/voice.js';
import { ttsLangToSpeechLang } from '../utils/format.js';

/**
 * Initialize Chat tab
 * @param {Object} elements - DOM elements
 * @param {Object} state - State object with currentConversationId
 * @returns {Object} Tab handlers and cleanup functions
 */
export function initChatTab(elements, state) {
    // Chat Form Submission Handler
    async function handleChatSubmit(e) {
        e.preventDefault();
        
        const message = elements.chatInput.value.trim();
        
        if (!message) {
            showStatus(elements.chatStatus, 'error', 'Please enter a message');
            return;
        }
        
        // Add user message to chat with sending state
        const userMessage = addChatMessage(elements.chatMessages, 'user', message, null, 'sending');
        elements.chatInput.value = '';
        
        setButtonState(elements.chatBtn, true, 'Thinking...');
        showStatus(elements.chatStatus, 'info', 'Sending message...');
        
        try {
            // Update user message to complete state
            setTimeout(() => {
                if (userMessage) {
                    userMessage.classList.remove('message-sending');
                }
            }, 500);
            
            // Add bot message with generating state
            const botMessage = addChatMessage(
                elements.chatMessages, 
                'bot', 
                '', 
                null,
                'generating'
            );
            
            const data = await sendChatMessage(message, state.currentConversationId);
            
            // Store conversation ID
            if (state.setCurrentConversationId) {
                state.setCurrentConversationId(data.conversation_id);
            } else {
                state.currentConversationId = data.conversation_id;
            }
            
            // Update bot message with complete content
            if (botMessage) {
                updateMessageState(botMessage, 'complete', data.reply || 'No response received');
                
                // Add audio player for bot messages with audio
                if (data.audio_base64) {
                    const audioWrapper = document.createElement('div');
                    audioWrapper.className = 'message-audio-wrapper';
                    
                    const audioElement = document.createElement('audio');
                    audioElement.controls = true;
                    audioElement.className = 'message-audio';
                    
                    // Convert base64 to blob URL
                    base64ToBlob(data.audio_base64, 'audio/wav').then(blob => {
                        const audioUrl = URL.createObjectURL(blob);
                        audioElement.src = audioUrl;
                        if (audioElement.previousUrl) {
                            URL.revokeObjectURL(audioElement.previousUrl);
                        }
                        audioElement.previousUrl = audioUrl;
                        
                        // Add spectrogram visualization
                        addMessageSpectrogram(botMessage, audioElement, data.audio_base64);
                        
                        scrollChatToBottom(elements.chatMessages, true);
                    }).catch(err => {
                        console.error('Error creating audio blob:', err);
                    });
                    
                    audioWrapper.appendChild(audioElement);
                    botMessage.appendChild(audioWrapper);
                }
            }
            
            showStatus(elements.chatStatus, 'success', 'Message sent successfully!');
            showToast('success', 'Message sent successfully!');
            
        } catch (error) {
            console.error('Chat Error:', error);
            addChatMessage(
                elements.chatMessages, 
                'bot', 
                `Sorry, I'm having trouble connecting to the AI service. ${error.message}`
            );
            showStatus(elements.chatStatus, 'error', `Error: ${error.message}`);
            showToast('error', `Error: ${error.message}`);
        } finally {
            setButtonState(elements.chatBtn, false, 'Send');
        }
    }
    
    // Set up event listeners
    function setupEventListeners() {
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
        
        // Clear and export chat buttons
        if (elements.clearChatBtn) {
            elements.clearChatBtn.addEventListener('click', () => {
                clearChat(elements.chatMessages);
                if (state.setCurrentConversationId) {
                    state.setCurrentConversationId(null);
                } else {
                    state.currentConversationId = null;
                }
                showStatus(elements.chatStatus, 'info', 'Chat cleared');
                showToast('success', 'Chat cleared');
            });
        }
        
        if (elements.exportChatBtn) {
            elements.exportChatBtn.addEventListener('click', () => {
                exportChat(elements.chatMessages);
                showStatus(elements.chatStatus, 'success', 'Chat exported!');
                showToast('success', 'Chat exported successfully!');
            });
        }
    }
    
    // Voice Mode State
    let voiceModeState = {
        isActive: false,
        isRecording: false,
        mediaStream: null,
        audioContext: null,
        analyser: null,
        dataArray: null,
        speechRecognition: null,
        vadChecker: null,
        animationFrame: null,
        transcript: '',
        selectedLanguage: 'en_US',
        recordingStartTime: null,
        recordingTimer: null,
        currentTranscriptMessage: null, // Reference to the real-time transcript message in chat
        lastTranscriptUpdate: 0
    };
    
    // Initialize input spectrogram canvas
    function initInputSpectrogram() {
        const canvas = elements.voiceInputSpectrogram;
        if (!canvas) return;
        
        const container = canvas.parentElement;
        if (!container) return;
        
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        return { ctx, canvas };
    }
    
    // Draw spectrogram in input field
    function drawInputSpectrogram(audioLevel) {
        const canvas = elements.voiceInputSpectrogram;
        if (!canvas || !audioLevel || !voiceModeState.analyser || !voiceModeState.dataArray) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear with semi-transparent background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);
        
        // Get frequency data from analyser
        voiceModeState.analyser.getByteFrequencyData(voiceModeState.dataArray);
        
        // Draw frequency bars (spectrogram style)
        const barCount = Math.min(64, voiceModeState.dataArray.length);
        const barWidth = width / barCount;
        
        for (let i = 0; i < barCount; i++) {
            // Get frequency data (use multiple bins for smoother visualization)
            const binIndex = Math.floor((i / barCount) * voiceModeState.dataArray.length);
            const intensity = voiceModeState.dataArray[binIndex] / 255;
            const barHeight = intensity * height * 0.8;
            const x = i * barWidth;
            const y = height - barHeight;
            
            // Color gradient: blue to cyan to green to yellow
            const hue = 240 - (intensity * 180);
            const saturation = 100;
            const lightness = 30 + (intensity * 50);
            
            const gradient = ctx.createLinearGradient(x, y, x, height);
            gradient.addColorStop(0, `hsla(${hue}, ${saturation}%, ${lightness}%, 0.8)`);
            gradient.addColorStop(1, `hsla(${hue}, ${saturation}%, ${lightness * 0.3}%, 0.3)`);
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, barWidth - 1, barHeight);
        }
    }
    
    // Start audio visualization loop
    function startAudioVisualization() {
        if (voiceModeState.animationFrame) return;
        
        // Initialize input spectrogram
        initInputSpectrogram();
        if (elements.voiceInputSpectrogram) {
            elements.voiceInputSpectrogram.classList.remove('hidden');
        }
        
        function animate() {
            if (!voiceModeState.isRecording || !voiceModeState.analyser || !voiceModeState.dataArray) {
                voiceModeState.animationFrame = null;
                if (elements.voiceInputSpectrogram) {
                    elements.voiceInputSpectrogram.classList.add('hidden');
                }
                return;
            }
            
            const audioLevel = calculateAudioLevel(voiceModeState.analyser, voiceModeState.dataArray);
            
            // Draw spectrogram in input field
            if (elements.voiceInputSpectrogram) {
                drawInputSpectrogram(audioLevel);
            }
            
            voiceModeState.animationFrame = requestAnimationFrame(animate);
        }
        
        voiceModeState.animationFrame = requestAnimationFrame(animate);
    }
    
    // Stop audio visualization
    function stopAudioVisualization() {
        if (voiceModeState.animationFrame) {
            cancelAnimationFrame(voiceModeState.animationFrame);
            voiceModeState.animationFrame = null;
        }
        
        if (elements.voiceInputSpectrogram) {
            elements.voiceInputSpectrogram.classList.add('hidden');
            const ctx = elements.voiceInputSpectrogram.getContext('2d');
            ctx.clearRect(0, 0, elements.voiceInputSpectrogram.width, elements.voiceInputSpectrogram.height);
        }
    }
    
    // Start recording
    async function startRecording() {
        if (voiceModeState.isRecording) return;
        
        try {
            // Request microphone access
            const stream = await requestMicrophoneAccess({
                onError: (error) => {
                    console.error('Microphone access error:', error);
                    showToast('error', `Microphone access denied: ${error.message}`);
                    updateVoiceMicStatus('Microphone access denied');
                }
            });
            
            if (!stream) {
                return;
            }
            
            voiceModeState.mediaStream = stream;
            
            // Set up audio context and analyser
            voiceModeState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = voiceModeState.audioContext.createMediaStreamSource(stream);
            voiceModeState.analyser = voiceModeState.audioContext.createAnalyser();
            voiceModeState.analyser.fftSize = 256;
            voiceModeState.analyser.smoothingTimeConstant = 0.8;
            
            const bufferLength = voiceModeState.analyser.frequencyBinCount;
            voiceModeState.dataArray = new Uint8Array(bufferLength);
            
            source.connect(voiceModeState.analyser);
            
            // Set recording state BEFORE setting up VAD (VAD checks this)
            voiceModeState.isRecording = true;
            
            // Set up VAD
            voiceModeState.vadChecker = createVADChecker(
                voiceModeState.analyser,
                voiceModeState.dataArray,
                {
                    isRecording: () => voiceModeState.isRecording,
                    onVoiceDetected: (audioLevel) => {
                        // Voice detected
                    },
                    onSilenceDetected: (silenceDuration, audioLevel) => {
                        console.log('[Voice Mode] Silence detected, stopping recording', {
                            silenceDuration,
                            audioLevel,
                            transcript: voiceModeState.transcript
                        });
                        stopRecording();
                    },
                    onSilenceWarning: (silenceDuration) => {
                        // Optional: show warning
                    }
                }
            );
            
            // Set up speech recognition
            if (isSpeechRecognitionSupported()) {
                const speechLang = ttsLangToSpeechLang(voiceModeState.selectedLanguage);
                voiceModeState.speechRecognition = createSpeechRecognition({
                    continuous: true,
                    interimResults: true,
                    lang: speechLang
                });
                
                voiceModeState.speechRecognition.onresult = (event) => {
                    let interimTranscript = '';
                    let finalTranscript = '';
                    
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const transcript = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            finalTranscript += transcript + ' ';
                            console.log('[Voice Mode] Final transcript:', transcript);
                        } else {
                            interimTranscript += transcript;
                        }
                    }
                    
                    voiceModeState.transcript = finalTranscript + interimTranscript;
                    
                    // Update real-time transcript in chat
                    updateRealTimeTranscript(voiceModeState.transcript, interimTranscript.length > 0);
                };
                
                voiceModeState.speechRecognition.onerror = (event) => {
                    console.error('[Voice Mode] Speech recognition error:', event.error);
                    if (event.error === 'no-speech') {
                        // This is normal, just continue
                        console.log('[Voice Mode] No speech detected (this is normal)');
                    } else {
                        console.error('[Voice Mode] Speech recognition error details:', event);
                        showToast('error', `Speech recognition error: ${event.error}`);
                    }
                };
                
                voiceModeState.speechRecognition.onend = () => {
                    if (voiceModeState.isRecording) {
                        // Restart if still recording
                        try {
                            voiceModeState.speechRecognition.start();
                        } catch (e) {
                            console.error('Error restarting speech recognition:', e);
                        }
                    }
                };
                
                voiceModeState.speechRecognition.start();
            }
            
            // Start VAD
            voiceModeState.vadChecker.start();
            
            // Start visualization
            startAudioVisualization();
            
            // Update UI with visual feedback
            updateVoiceModeStatus('Listening...', true);
            
            // Start recording timer
            voiceModeState.recordingStartTime = Date.now();
            startRecordingTimer();
            
            // Clear any previous transcript message
            clearRealTimeTranscript();
            
            console.log('[Voice Mode] Recording started');
            showToast('success', 'Recording started');
            
        } catch (error) {
            console.error('Error starting recording:', error);
            showToast('error', `Failed to start recording: ${error.message}`);
            updateVoiceModeStatus('Error starting recording', false);
            
            // Reset recording state on error
            voiceModeState.isRecording = false;
            stopRecordingTimer();
            
            updateVoiceModeStatus('Click microphone to start recording', false);
            
            // Cleanup on error
            cleanupVoiceMode();
        }
    }
    
    // Stop recording
    function stopRecording() {
        if (!voiceModeState.isRecording) return;
        
        voiceModeState.isRecording = false;
        
        // Stop speech recognition
        if (voiceModeState.speechRecognition) {
            try {
                voiceModeState.speechRecognition.stop();
            } catch (e) {
                console.error('Error stopping speech recognition:', e);
            }
            voiceModeState.speechRecognition = null;
        }
        
        // Stop VAD
        if (voiceModeState.vadChecker) {
            voiceModeState.vadChecker.stop();
            voiceModeState.vadChecker = null;
        }
        
        // Stop visualization
        stopAudioVisualization();
        
        // Stop media stream
        if (voiceModeState.mediaStream) {
            voiceModeState.mediaStream.getTracks().forEach(track => track.stop());
            voiceModeState.mediaStream = null;
        }
        
        // Close audio context
        if (voiceModeState.audioContext) {
            voiceModeState.audioContext.close();
            voiceModeState.audioContext = null;
        }
        
        voiceModeState.analyser = null;
        voiceModeState.dataArray = null;
        
        // Stop recording timer
        stopRecordingTimer();
        
        // Update UI - remove recording visual feedback
        updateVoiceModeStatus('Click microphone to start recording', false);
        
        // Send message if we have a transcript
        const finalTranscript = voiceModeState.transcript.trim();
        console.log('[Voice Mode] Recording stopped', {
            transcript: finalTranscript,
            hasTranscript: !!finalTranscript
        });
        
        if (finalTranscript) {
            // Update the transcript message to final state
            if (voiceModeState.currentTranscriptMessage) {
                const messageContent = voiceModeState.currentTranscriptMessage.querySelector('.message-content');
                if (messageContent) {
                    messageContent.style.opacity = '1';
                    messageContent.style.fontStyle = 'normal';
                }
                voiceModeState.currentTranscriptMessage.classList.remove('message-sending');
            }
            
            console.log('[Voice Mode] Sending voice message:', finalTranscript);
            sendVoiceMessage(finalTranscript);
        } else {
            // Remove transcript message if no speech detected
            if (voiceModeState.currentTranscriptMessage) {
                voiceModeState.currentTranscriptMessage.remove();
                voiceModeState.currentTranscriptMessage = null;
            }
            console.log('[Voice Mode] No speech detected');
            showToast('info', 'No speech detected');
        }
        
        // Clear transcript
        voiceModeState.transcript = '';
        clearRealTimeTranscript();
    }
    
    // Send voice message
    async function sendVoiceMessage(message) {
        if (!message || !message.trim()) {
            console.warn('[Voice Mode] Attempted to send empty message');
            return;
        }
        
        console.log('[Voice Mode] Sending voice message to API', {
            message,
            language: voiceModeState.selectedLanguage,
            conversationId: state.currentConversationId
        });
        
        updateVoiceModeStatus('Sending...', false);
        
        // Remove the transcript message since we're sending the final message
        if (voiceModeState.currentTranscriptMessage) {
            voiceModeState.currentTranscriptMessage.remove();
            voiceModeState.currentTranscriptMessage = null;
        }
        
        // Add user message to chat (final version)
        addChatMessage(elements.chatMessages, 'user', message);
        
        try {
            const data = await sendVoiceChatMessage(
                message,
                voiceModeState.selectedLanguage,
                state.currentConversationId
            );
            
            console.log('[Voice Mode] Voice message response received', {
                hasAudio: !!data.audio_base64,
                hasReply: !!data.reply,
                conversationId: data.conversation_id
            });
            
            // Store conversation ID
            if (state.setCurrentConversationId) {
                state.setCurrentConversationId(data.conversation_id);
            } else {
                state.currentConversationId = data.conversation_id;
            }
            
            // Add bot response with generating state first
            const botMessage = addChatMessage(
                elements.chatMessages,
                'bot',
                '',
                null,
                'generating'
            );
            
            // Update with complete content
            if (botMessage) {
                updateMessageState(botMessage, 'complete', data.reply || 'No response received');
                
                // Add audio player for bot messages with audio
                if (data.audio_base64) {
                    const audioWrapper = document.createElement('div');
                    audioWrapper.className = 'message-audio-wrapper';
                    
                    const audioElement = document.createElement('audio');
                    audioElement.controls = true;
                    audioElement.className = 'message-audio';
                    
                    // Convert base64 to blob URL
                    base64ToBlob(data.audio_base64, 'audio/wav').then(blob => {
                        const audioUrl = URL.createObjectURL(blob);
                        audioElement.src = audioUrl;
                        if (audioElement.previousUrl) {
                            URL.revokeObjectURL(audioElement.previousUrl);
                        }
                        audioElement.previousUrl = audioUrl;
                        
                        // Add spectrogram visualization
                        addMessageSpectrogram(botMessage, audioElement, data.audio_base64);
                        
                        scrollChatToBottom(elements.chatMessages, true);
                    }).catch(err => {
                        console.error('Error creating audio blob:', err);
                    });
                    
                    audioWrapper.appendChild(audioElement);
                    botMessage.appendChild(audioWrapper);
                }
            }
            
            updateVoiceModeStatus('Click microphone to start recording');
            showToast('success', 'Voice message sent successfully!');
            
        } catch (error) {
            console.error('Voice chat error:', error);
            addChatMessage(
                elements.chatMessages,
                'bot',
                `Sorry, I'm having trouble with the voice chat. ${error.message}`
            );
            updateVoiceModeStatus('Click microphone to start recording');
            showToast('error', `Error: ${error.message}`);
        }
    }
    
    // Update real-time transcript in chat
    function updateRealTimeTranscript(transcript, isInterim = false) {
        if (!transcript.trim() && !isInterim) return;
        
        const now = Date.now();
        // Throttle updates to avoid too frequent DOM updates
        if (now - voiceModeState.lastTranscriptUpdate < 100 && isInterim) {
            return;
        }
        voiceModeState.lastTranscriptUpdate = now;
        
        // Create or update transcript message in chat
        if (!voiceModeState.currentTranscriptMessage) {
            // Create new message for transcript
            voiceModeState.currentTranscriptMessage = addChatMessage(
                elements.chatMessages,
                'user',
                transcript,
                null,
                'sending'
            );
            if (voiceModeState.currentTranscriptMessage) {
                voiceModeState.currentTranscriptMessage.classList.add('voice-transcript-message');
            }
        } else {
            // Update existing message
            const messageContent = voiceModeState.currentTranscriptMessage.querySelector('.message-content');
            if (messageContent) {
                messageContent.textContent = transcript;
                if (isInterim) {
                    messageContent.style.opacity = '0.7';
                    messageContent.style.fontStyle = 'italic';
                } else {
                    messageContent.style.opacity = '1';
                    messageContent.style.fontStyle = 'normal';
                }
            }
        }
        
        // Scroll to bottom to show latest transcript
        scrollChatToBottom(elements.chatMessages, true);
    }
    
    // Clear real-time transcript message
    function clearRealTimeTranscript() {
        if (voiceModeState.currentTranscriptMessage) {
            voiceModeState.currentTranscriptMessage = null;
        }
    }
    
    // Update voice mode status
    function updateVoiceModeStatus(status, isRecording = false) {
        const statusText = elements.voiceModeStatusCompact?.querySelector('.voice-mode-status-text');
        if (statusText) {
            statusText.textContent = status;
            if (isRecording) {
                statusText.classList.add('recording');
            } else {
                statusText.classList.remove('recording');
            }
        }
    }
    
    // Start recording timer
    function startRecordingTimer() {
        if (voiceModeState.recordingTimer) {
            clearInterval(voiceModeState.recordingTimer);
        }
        
        voiceModeState.recordingTimer = setInterval(() => {
            if (!voiceModeState.isRecording || !voiceModeState.recordingStartTime) {
                return;
            }
            
            const elapsed = Math.floor((Date.now() - voiceModeState.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            const timeStr = minutes > 0 
                ? `${minutes}:${seconds.toString().padStart(2, '0')}`
                : `${seconds}s`;
            
            const statusText = elements.voiceModeStatusCompact?.querySelector('.voice-mode-status-text');
            if (statusText) {
                statusText.innerHTML = `Listening... <span class="recording-indicator">● ${timeStr}</span>`;
            }
        }, 100);
    }
    
    // Stop recording timer
    function stopRecordingTimer() {
        if (voiceModeState.recordingTimer) {
            clearInterval(voiceModeState.recordingTimer);
            voiceModeState.recordingTimer = null;
        }
        voiceModeState.recordingStartTime = null;
    }
    
    // Enter voice mode
    async function enterVoiceMode() {
        if (voiceModeState.isActive) return;
        
        voiceModeState.isActive = true;
        
        // Show compact voice mode controls
        if (elements.voiceModeControls) {
            elements.voiceModeControls.classList.remove('hidden');
        }
        
        // Change voice toggle button to mic button
        if (elements.voiceModeToggleBtn) {
            elements.voiceModeToggleBtn.innerHTML = `
                <svg class="voice-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
            `;
            elements.voiceModeToggleBtn.setAttribute('aria-label', 'Start recording');
            elements.voiceModeToggleBtn.setAttribute('title', 'Start recording');
        }
        
        // Get selected language
        if (elements.voiceModeLanguage) {
            voiceModeState.selectedLanguage = elements.voiceModeLanguage.value || 'en_US';
        }
        
        updateVoiceModeStatus('Click microphone to start recording');
        showToast('success', 'Voice mode activated');
    }
    
    // Exit voice mode
    function exitVoiceMode() {
        if (!voiceModeState.isActive) return;
        
        // Stop recording if active
        if (voiceModeState.isRecording) {
            stopRecording();
        }
        
        // Clean up
        cleanupVoiceMode();
        
        // Hide compact voice mode controls
        if (elements.voiceModeControls) {
            elements.voiceModeControls.classList.add('hidden');
        }
        
        // Restore voice toggle button
        if (elements.voiceModeToggleBtn) {
            elements.voiceModeToggleBtn.innerHTML = `
                <svg class="voice-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
            `;
            elements.voiceModeToggleBtn.setAttribute('aria-label', 'Use voice mode');
            elements.voiceModeToggleBtn.setAttribute('title', 'Use voice mode');
        }
        
        voiceModeState.isActive = false;
        showToast('info', 'Voice mode deactivated');
    }
    
    // Cleanup voice mode resources
    function cleanupVoiceMode() {
        stopRecording();
        stopRecordingTimer();
        
        if (voiceModeState.mediaStream) {
            voiceModeState.mediaStream.getTracks().forEach(track => track.stop());
            voiceModeState.mediaStream = null;
        }
        
        if (voiceModeState.audioContext) {
            voiceModeState.audioContext.close();
            voiceModeState.audioContext = null;
        }
        
        if (voiceModeState.speechRecognition) {
            try {
                voiceModeState.speechRecognition.stop();
            } catch (e) {
                // Ignore errors
            }
            voiceModeState.speechRecognition = null;
        }
        
        voiceModeState.analyser = null;
        voiceModeState.dataArray = null;
        voiceModeState.vadChecker = null;
        voiceModeState.transcript = '';
        
        // Remove recording visual feedback
        updateVoiceModeStatus('Click microphone to start recording', false);
        
        // Clear real-time transcript
        clearRealTimeTranscript();
    }
    
    // Setup voice input and voice mode
    function setupVoiceFeatures() {
        // Check for speech recognition support
        if (!isSpeechRecognitionSupported()) {
            console.warn('Speech recognition not supported in this browser');
        }
        
        // Setup voice mode toggle
        if (elements.voiceModeToggleBtn) {
            elements.voiceModeToggleBtn.addEventListener('click', () => {
                if (voiceModeState.isActive) {
                    // If voice mode is active, toggle recording
                    if (voiceModeState.isRecording) {
                        stopRecording();
                    } else {
                        startRecording();
                    }
                } else {
                    // Enter voice mode
                    enterVoiceMode();
                }
            });
        }
        
        // Exit voice mode
        if (elements.exitVoiceModeBtn) {
            elements.exitVoiceModeBtn.addEventListener('click', () => {
                exitVoiceMode();
            });
        }
        
        // Language change handler
        if (elements.voiceModeLanguage) {
            elements.voiceModeLanguage.addEventListener('change', (e) => {
                voiceModeState.selectedLanguage = e.target.value || 'en_US';
            });
        }
    }
    
    // Initialize
    setupEventListeners();
    setupVoiceFeatures();
    
    // Scroll to bottom when tab is activated
    if (elements.chatMessages) {
        setTimeout(() => {
            scrollChatToBottom(elements.chatMessages);
        }, 100);
    }
    
    return {
        handleChatSubmit,
        cleanup: () => {
            // Cleanup voice mode when tab is switched away
            if (voiceModeState.isActive) {
                exitVoiceMode();
            }
        }
    };
}

