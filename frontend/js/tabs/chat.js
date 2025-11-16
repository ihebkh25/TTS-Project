// Chat Tab Module - AI Chat functionality

import { CONFIG } from '../config.js';
import { sendChatMessage, sendVoiceChatMessage } from '../services/api.js';
import { setButtonState, showStatus } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { addChatMessage, scrollChatToBottom, clearChat, exportChat, updateMessageState, addMessageSpectrogram, cleanupAudioBlobUrls } from '../components/chat.js';
import { base64ToBlob } from '../utils/audio.js';
import { 
    isSpeechRecognitionSupported, 
    createSpeechRecognition,
    requestMicrophoneAccess,
    createVADChecker,
    calculateAudioLevel
} from '../services/voice.js';
import { ttsLangToSpeechLang } from '../utils/format.js';

// Constants
const TRANSCRIPT_UPDATE_THROTTLE_MS = 100; // Throttle transcript updates to avoid excessive DOM updates
const RECORDING_TIMER_INTERVAL_MS = 100; // Update recording timer every 100ms
const MESSAGE_SENDING_STATE_DELAY_MS = 500; // Delay before removing "sending" state from user message
const SCROLL_NEAR_BOTTOM_THRESHOLD = 100; // Pixels from bottom to consider "near bottom"
const SPECTROGRAM_BAR_COUNT = 64; // Number of frequency bars in spectrogram visualization
const DEFAULT_LANGUAGE = 'en_US'; // Default language for voice mode

/**
 * Initialize Chat tab
 * @param {Object} elements - DOM elements
 * @param {Object} state - State object with currentConversationId
 * @returns {Object} Tab handlers and cleanup functions
 */
export function initChatTab(elements, state) {
    // Store event listener references for cleanup
    const eventListeners = [];
    const timeoutIds = [];
    
    // Helper to add event listener with cleanup tracking
    function addEventListenerWithCleanup(element, event, handler, options) {
        if (!element) return;
        element.addEventListener(event, handler, options);
        eventListeners.push({ element, event, handler, options });
    }
    
    // Announce messages to screen readers via ARIA live regions
    function announceToScreenReader(message, priority = 'polite') {
        const liveRegion = priority === 'assertive' 
            ? document.getElementById('chatAriaLiveAssertive')
            : document.getElementById('chatAriaLive');
        
        if (liveRegion) {
            // Clear previous message
            liveRegion.textContent = '';
            // Use setTimeout to ensure screen readers pick up the change
            const timeoutId = setTimeout(() => {
                liveRegion.textContent = message;
                // Remove from array
                const index = timeoutIds.indexOf(timeoutId);
                if (index > -1) timeoutIds.splice(index, 1);
            }, 100);
            timeoutIds.push(timeoutId);
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
            }, MESSAGE_SENDING_STATE_DELAY_MS);
            
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
                const replyText = data.reply || 'No response received';
                updateMessageState(botMessage, 'complete', replyText);
                
                // Announce bot response to screen readers
                announceToScreenReader(`Bot response: ${replyText}`, 'polite');
                
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
                            try {
                                URL.revokeObjectURL(audioElement.previousUrl);
                            } catch (e) {
                                // URL may have already been revoked, ignore error
                                console.warn('Error revoking previous audio URL:', e);
                            }
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
            const errorMessage = `Sorry, I'm having trouble connecting to the AI service. ${error.message}`;
            addChatMessage(
                elements.chatMessages, 
                'bot', 
                errorMessage
            );
            showStatus(elements.chatStatus, 'error', `Error: ${error.message}`);
            showToast('error', `Error: ${error.message}`);
            // Announce error to screen readers
            announceToScreenReader(`Error: ${error.message}`, 'assertive');
        } finally {
            setButtonState(elements.chatBtn, false, 'Send');
        }
    }
    
    // Set up event listeners
    function setupEventListeners() {
        addEventListenerWithCleanup(elements.chatForm, 'submit', handleChatSubmit);

        // Ensure right-side button uses headset icon (in case of cached HTML)
        if (elements.useVoiceModeBtn) {
            elements.useVoiceModeBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                    <path d="M3 11a9 9 0 0 1 18 0"></path>
                    <path d="M21 13v3a3 3 0 0 1-3 3h-2a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h2"></path>
                    <path d="M3 13v3a3 3 0 0 0 3 3h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H6"></path>
                    <path d="M12 21a3 3 0 0 0 3-3"></path>
                </svg>
            `;
            elements.useVoiceModeBtn.setAttribute('aria-label', 'Use Voice Mode');
            elements.useVoiceModeBtn.setAttribute('title', 'Use Voice Mode');
        }

        // Navigate to Voice Mode tab
        if (elements.useVoiceModeBtn) {
            const goVoice = () => {
                const btn = document.querySelector('.tab-btn[data-tab="voice-chat"]');
                if (btn) btn.click();
            };
            addEventListenerWithCleanup(elements.useVoiceModeBtn, 'click', goVoice);
        }
        
        // Enter key support for chat
        const keypressHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (elements.chatForm) {
                    elements.chatForm.dispatchEvent(new Event('submit'));
                }
            }
        };
        addEventListenerWithCleanup(elements.chatInput, 'keypress', keypressHandler);
        
        // Clear and export chat buttons
        addEventListenerWithCleanup(elements.clearChatBtn, 'click', () => {
            clearChat(elements.chatMessages);
            if (state.setCurrentConversationId) {
                state.setCurrentConversationId(null);
            } else {
                state.currentConversationId = null;
            }
            showStatus(elements.chatStatus, 'info', 'Chat cleared');
            showToast('success', 'Chat cleared');
        });
        
        addEventListenerWithCleanup(elements.exportChatBtn, 'click', () => {
            exportChat(elements.chatMessages);
            showStatus(elements.chatStatus, 'success', 'Chat exported!');
            showToast('success', 'Chat exported successfully!');
        });
    }
    
    // Dictating Mode State
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
        const barCount = Math.min(SPECTROGRAM_BAR_COUNT, voiceModeState.dataArray.length);
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
                    updateVoiceModeStatus('Microphone access denied', false);
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
            
            // Set up VAD with error handling
            try {
                voiceModeState.vadChecker = createVADChecker(
                    voiceModeState.analyser,
                    voiceModeState.dataArray,
                    {
                        isRecording: () => voiceModeState.isRecording,
                        onVoiceDetected: (audioLevel) => {
                            // Voice detected
                        },
                        onSilenceDetected: (silenceDuration, audioLevel) => {
                            console.log('[Dictating Mode] Silence detected, stopping recording', {
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
            } catch (error) {
                console.error('[Dictating Mode] Failed to create VAD checker:', error);
                showToast('error', `Failed to initialize voice detection: ${error.message}`);
                // Continue without VAD - user can manually stop recording
                voiceModeState.vadChecker = null;
            }
            
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
                            console.log('[Dictating Mode] Final transcript:', transcript);
                        } else {
                            interimTranscript += transcript;
                        }
                    }
                    
                    voiceModeState.transcript = finalTranscript + interimTranscript;
                    
                    // Update real-time transcript in chat
                    updateRealTimeTranscript(voiceModeState.transcript, interimTranscript.length > 0);
                };
                
                voiceModeState.speechRecognition.onerror = (event) => {
                    console.error('[Dictating Mode] Speech recognition error:', event.error);
                    const errorMessages = {
                        'no-speech': 'No speech detected. Please speak clearly.',
                        'audio-capture': 'Microphone not accessible. Please check permissions.',
                        'not-allowed': 'Microphone access denied. Please allow microphone access.',
                        'network': 'Network error. Please check your connection.',
                        'aborted': 'Speech recognition aborted.',
                        'service-not-allowed': 'Speech recognition service not allowed.',
                        'bad-grammar': 'Speech recognition grammar error.',
                        'language-not-supported': 'Language not supported for speech recognition.'
                    };
                    
                    const errorMessage = errorMessages[event.error] || `Speech recognition error: ${event.error}`;
                    
                    if (event.error === 'no-speech') {
                        // This is normal during pauses, just log it
                        console.log('[Dictating Mode] No speech detected (this is normal during pauses)');
                    } else if (event.error === 'not-allowed' || event.error === 'audio-capture') {
                        // Critical errors - stop recording
                        console.error('[Dictating Mode] Critical speech recognition error:', event);
                        showToast('error', errorMessage);
                        updateVoiceModeStatus('Microphone access error', false);
                        stopRecording();
                    } else {
                        // Other errors - show warning but continue
                        console.error('[Dictating Mode] Speech recognition error details:', event);
                        showToast('warning', errorMessage);
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
            
            // Start VAD (if successfully created)
            if (voiceModeState.vadChecker) {
                try {
                    voiceModeState.vadChecker.start();
                } catch (error) {
                    console.error('[Dictating Mode] Failed to start VAD:', error);
                    showToast('warning', 'Voice detection may not work properly. You can manually stop recording.');
                }
            }
            
            // Start visualization
            startAudioVisualization();
            
            // Update UI with visual feedback
            updateVoiceModeStatus('Listening...', true);
            
            // Start recording timer
            voiceModeState.recordingStartTime = Date.now();
            startRecordingTimer();
            
            // Clear any previous transcript message
            clearRealTimeTranscript();
            
            console.log('[Dictating Mode] Recording started');
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
        console.log('[Dictating Mode] Recording stopped', {
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
            
            console.log('[Dictating Mode] Sending voice message:', finalTranscript);
            sendVoiceMessage(finalTranscript);
        } else {
            // Remove transcript message if no speech detected
            if (voiceModeState.currentTranscriptMessage) {
                voiceModeState.currentTranscriptMessage.remove();
                voiceModeState.currentTranscriptMessage = null;
            }
            console.log('[Dictating Mode] No speech detected');
            showToast('info', 'No speech detected');
        }
        
        // Clear transcript
        voiceModeState.transcript = '';
        clearRealTimeTranscript();
    }
    
    // Send voice message
    async function sendVoiceMessage(message) {
        if (!message || !message.trim()) {
            console.warn('[Dictating Mode] Attempted to send empty message');
            return;
        }
        
        console.log('[Dictating Mode] Sending voice message to API', {
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
        
        // Announce user message to screen readers
        announceToScreenReader(`You said: ${message}`, 'polite');
        
        try {
            const data = await sendVoiceChatMessage(
                message,
                voiceModeState.selectedLanguage,
                state.currentConversationId
            );
            
            console.log('[Dictating Mode] Voice message response received', {
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
                const replyText = data.reply || 'No response received';
                updateMessageState(botMessage, 'complete', replyText);
                
                // Announce bot response to screen readers
                announceToScreenReader(`Bot response: ${replyText}`, 'polite');
                
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
                            try {
                                URL.revokeObjectURL(audioElement.previousUrl);
                            } catch (e) {
                                // URL may have already been revoked, ignore error
                                console.warn('Error revoking previous audio URL:', e);
                            }
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
            const errorMessage = `Sorry, I'm having trouble with the voice chat. ${error.message}`;
            addChatMessage(
                elements.chatMessages,
                'bot',
                errorMessage
            );
            updateVoiceModeStatus('Click microphone to start recording');
            showToast('error', `Error: ${error.message}`);
            // Announce error to screen readers
            announceToScreenReader(`Voice chat error: ${error.message}`, 'assertive');
        }
    }
    
    // Update real-time transcript in chat
    function updateRealTimeTranscript(transcript, isInterim = false) {
        if (!transcript.trim() && !isInterim) return;
        
        const now = Date.now();
        // Throttle updates to avoid too frequent DOM updates
        if (now - voiceModeState.lastTranscriptUpdate < TRANSCRIPT_UPDATE_THROTTLE_MS && isInterim) {
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
    
    // Update dictating mode status
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
        
        // Update ARIA live region for screen readers
        announceToScreenReader(status, 'polite');
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
                const indicatorTemplate = document.getElementById('recordingIndicatorTemplate');
                if (indicatorTemplate) {
                    statusText.textContent = 'Listening... ';
                    const indicator = indicatorTemplate.content.cloneNode(true).querySelector('.recording-indicator');
                    indicator.textContent = `● ${timeStr}`;
                    statusText.appendChild(indicator);
                } else {
                    // Fallback
                    statusText.innerHTML = `Listening... <span class="recording-indicator">● ${timeStr}</span>`;
                }
            }
        }, RECORDING_TIMER_INTERVAL_MS);
    }
    
    // Stop recording timer
    function stopRecordingTimer() {
        if (voiceModeState.recordingTimer) {
            clearInterval(voiceModeState.recordingTimer);
            voiceModeState.recordingTimer = null;
        }
        voiceModeState.recordingStartTime = null;
    }
    
    // Enter dictating mode
    async function enterVoiceMode() {
        if (voiceModeState.isActive) return;
        
        voiceModeState.isActive = true;
        
        // Show compact dictating mode controls
        if (elements.voiceModeControls) {
            elements.voiceModeControls.classList.remove('hidden');
        }
        
        // Change voice toggle button to mic button (using template)
        if (elements.voiceModeToggleBtn) {
            const template = document.getElementById('voiceToggleMicTemplate');
            if (template) {
                elements.voiceModeToggleBtn.innerHTML = '';
                elements.voiceModeToggleBtn.appendChild(template.content.cloneNode(true));
            } else {
                // Fallback
                elements.voiceModeToggleBtn.innerHTML = `
                    <svg class="voice-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                `;
            }
            elements.voiceModeToggleBtn.setAttribute('aria-label', 'Start recording');
            elements.voiceModeToggleBtn.setAttribute('title', 'Start recording');
        }
        
        // Get selected language
        if (elements.voiceModeLanguage) {
            voiceModeState.selectedLanguage = elements.voiceModeLanguage.value || DEFAULT_LANGUAGE;
        }
        
        updateVoiceModeStatus('Click microphone to start recording');
        showToast('success', 'Dictating mode activated');
    }
    
    // Exit dictating mode
    function exitVoiceMode() {
        if (!voiceModeState.isActive) return;
        
        // Stop recording if active
        if (voiceModeState.isRecording) {
            stopRecording();
        }
        
        // Clean up
        cleanupVoiceMode();
        
        // Hide compact dictating mode controls
        if (elements.voiceModeControls) {
            elements.voiceModeControls.classList.add('hidden');
        }
        
        // Restore voice toggle button (using template)
        if (elements.voiceModeToggleBtn) {
            const template = document.getElementById('voiceToggleMicTemplate');
            if (template) {
                elements.voiceModeToggleBtn.innerHTML = '';
                elements.voiceModeToggleBtn.appendChild(template.content.cloneNode(true));
            } else {
                // Fallback
                elements.voiceModeToggleBtn.innerHTML = `
                    <svg class="voice-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                `;
            }
            elements.voiceModeToggleBtn.setAttribute('aria-label', 'Use dictating mode');
            elements.voiceModeToggleBtn.setAttribute('title', 'Use dictating mode');
        }
        
        voiceModeState.isActive = false;
        showToast('info', 'Dictating mode deactivated');
    }
    
    // Cleanup dictating mode resources
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
    
    // Setup voice input and dictating mode
    function setupVoiceFeatures() {
        // Check for speech recognition support
        if (!isSpeechRecognitionSupported()) {
            console.warn('Speech recognition not supported in this browser');
        }
        
        // Setup dictating mode toggle
        const voiceToggleHandler = () => {
            if (voiceModeState.isActive) {
                // If dictating mode is active, toggle recording
                if (voiceModeState.isRecording) {
                    stopRecording();
                } else {
                    startRecording();
                }
            } else {
                // Enter dictating mode
                enterVoiceMode();
            }
        };
        addEventListenerWithCleanup(elements.voiceModeToggleBtn, 'click', voiceToggleHandler);
        
        // Exit dictating mode
        addEventListenerWithCleanup(elements.exitVoiceModeBtn, 'click', exitVoiceMode);
        
        // Language change handler
        const languageChangeHandler = (e) => {
            voiceModeState.selectedLanguage = e.target.value || DEFAULT_LANGUAGE;
        };
        addEventListenerWithCleanup(elements.voiceModeLanguage, 'change', languageChangeHandler);
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
            // Clear all pending timeouts
            timeoutIds.forEach(timeoutId => clearTimeout(timeoutId));
            timeoutIds.length = 0;
            
            // Remove all event listeners
            eventListeners.forEach(({ element, event, handler, options }) => {
                if (element && element.removeEventListener) {
                    element.removeEventListener(event, handler, options);
                }
            });
            eventListeners.length = 0;
            
            // Cleanup dictating mode when tab is switched away
            if (voiceModeState.isActive) {
                exitVoiceMode();
            }
            
            // Cleanup all audio blob URLs and spectrograms
            if (elements.chatMessages) {
                const messages = elements.chatMessages.querySelectorAll('.message');
                messages.forEach(message => {
                    // Clear any pending timeouts
                    if (message._updateTimeouts) {
                        message._updateTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
                        message._updateTimeouts = [];
                    }
                    
                    // Cleanup spectrogram if present
                    const audioElement = message.querySelector('audio.message-audio');
                    if (audioElement && audioElement._spectrogramCleanup) {
                        audioElement._spectrogramCleanup();
                        audioElement._spectrogramCleanup = null;
                    }
                });
                
                cleanupAudioBlobUrls(elements.chatMessages);
            }
        }
    };
}

