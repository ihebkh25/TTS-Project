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
        recordingTimer: null
    };
    
    // Initialize voice mode canvas visualization
    function initVoiceCanvas(canvas, isResponse = false) {
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        if (isResponse) {
            // Response canvas - draw background
            ctx.fillStyle = 'rgba(30, 30, 30, 0.5)';
            ctx.fillRect(0, 0, width, height);
        }
        
        return { ctx, width, height };
    }
    
    // Draw audio visualization
    function drawAudioVisualization(canvas, audioLevel, isRecording = false) {
        if (!canvas || !audioLevel) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);
        
        // Normalize audio level (0-255 to 0-1)
        const normalizedLevel = Math.min(audioLevel / 255, 1);
        
        // Draw circular visualization for mic
        const centerX = width / 2;
        const centerY = height / 2;
        const maxRadius = Math.min(width, height) / 2 - 10;
        
        // Base circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
        ctx.strokeStyle = isRecording ? 'rgba(239, 68, 68, 0.3)' : 'rgba(99, 102, 241, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Audio level visualization
        const radius = maxRadius * (0.3 + normalizedLevel * 0.7);
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        
        if (isRecording) {
            gradient.addColorStop(0, 'rgba(239, 68, 68, 0.6)');
            gradient.addColorStop(0.5, 'rgba(239, 68, 68, 0.3)');
            gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
        } else {
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
            gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.2)');
            gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');
        }
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Frequency bars
        const barCount = 32;
        const barWidth = (maxRadius * 2) / barCount;
        
        for (let i = 0; i < barCount; i++) {
            const angle = (i / barCount) * Math.PI * 2;
            const barHeight = (normalizedLevel * maxRadius * 0.5) * (0.5 + Math.random() * 0.5);
            
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(angle);
            ctx.fillStyle = isRecording ? 'rgba(239, 68, 68, 0.6)' : 'rgba(99, 102, 241, 0.5)';
            ctx.fillRect(maxRadius, -barWidth / 2, barHeight, barWidth);
            ctx.restore();
        }
    }
    
    // Draw response audio visualization
    function drawResponseVisualization(canvas, audioLevel) {
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear with background
        ctx.fillStyle = 'rgba(30, 30, 30, 0.5)';
        ctx.fillRect(0, 0, width, height);
        
        if (!audioLevel) return;
        
        const normalizedLevel = Math.min(audioLevel / 255, 1);
        const barCount = 64;
        const barWidth = width / barCount;
        
        for (let i = 0; i < barCount; i++) {
            const barHeight = (normalizedLevel * height * 0.8) * (0.3 + Math.random() * 0.7);
            const x = i * barWidth;
            const y = (height - barHeight) / 2;
            
            const gradient = ctx.createLinearGradient(x, 0, x + barWidth, height);
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.8)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.6)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, barWidth - 2, barHeight);
        }
    }
    
    // Start audio visualization loop
    function startAudioVisualization() {
        if (voiceModeState.animationFrame) return;
        
        function animate() {
            if (!voiceModeState.isRecording || !voiceModeState.analyser || !voiceModeState.dataArray) {
                voiceModeState.animationFrame = null;
                return;
            }
            
            const audioLevel = calculateAudioLevel(voiceModeState.analyser, voiceModeState.dataArray);
            
            if (elements.voiceMicCanvas) {
                drawAudioVisualization(elements.voiceMicCanvas, audioLevel, true);
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
        
        if (elements.voiceMicCanvas) {
            const ctx = elements.voiceMicCanvas.getContext('2d');
            ctx.clearRect(0, 0, elements.voiceMicCanvas.width, elements.voiceMicCanvas.height);
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
                    
                    if (elements.voiceTranscriptText) {
                        elements.voiceTranscriptText.textContent = voiceModeState.transcript;
                    }
                    
                    // Always show transcript container when recording
                    if (elements.voiceTranscriptContainer) {
                        elements.voiceTranscriptContainer.style.display = 'block';
                    }
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
            if (elements.voiceMicButton) {
                elements.voiceMicButton.classList.add('recording');
            }
            
            // Add recording indicator to status
            updateVoiceMicStatus('Listening...', true);
            
            // Add recording class to transcript container and show it
            if (elements.voiceTranscriptContainer) {
                elements.voiceTranscriptContainer.classList.add('recording');
                elements.voiceTranscriptContainer.style.display = 'block';
            }
            
            // Start recording timer
            voiceModeState.recordingStartTime = Date.now();
            startRecordingTimer();
            
            console.log('[Voice Mode] Recording started');
            showToast('success', 'Recording started');
            
        } catch (error) {
            console.error('Error starting recording:', error);
            showToast('error', `Failed to start recording: ${error.message}`);
            updateVoiceMicStatus('Error starting recording');
            
            // Reset recording state on error
            voiceModeState.isRecording = false;
            stopRecordingTimer();
            
            if (elements.voiceMicButton) {
                elements.voiceMicButton.classList.remove('recording');
            }
            
            if (elements.voiceTranscriptContainer) {
                elements.voiceTranscriptContainer.classList.remove('recording');
            }
            
            updateVoiceMicStatus('Click to speak', false);
            
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
        if (elements.voiceMicButton) {
            elements.voiceMicButton.classList.remove('recording');
        }
        
        // Remove recording class from transcript container
        if (elements.voiceTranscriptContainer) {
            elements.voiceTranscriptContainer.classList.remove('recording');
        }
        
        // Send message if we have a transcript
        const finalTranscript = voiceModeState.transcript.trim();
        console.log('[Voice Mode] Recording stopped', {
            transcript: finalTranscript,
            hasTranscript: !!finalTranscript
        });
        
        if (finalTranscript) {
            console.log('[Voice Mode] Sending voice message:', finalTranscript);
            sendVoiceMessage(finalTranscript);
        } else {
            updateVoiceMicStatus('Click to speak', false);
            console.log('[Voice Mode] No speech detected');
            showToast('info', 'No speech detected');
        }
        
        // Clear transcript
        voiceModeState.transcript = '';
        if (elements.voiceTranscriptText) {
            elements.voiceTranscriptText.textContent = '';
        }
        if (elements.voiceTranscriptContainer) {
            elements.voiceTranscriptContainer.style.display = 'none';
        }
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
        
        updateVoiceMicStatus('Sending...', false);
        updateVoiceResponseStatus('Processing...');
        
        // Add user message to chat
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
            }
            
            // Play audio response
            if (data.audio_base64 && elements.voiceResponseAudio) {
                const audioBlob = await base64ToBlob(data.audio_base64, 'audio/wav');
                const audioUrl = URL.createObjectURL(audioBlob);
                elements.voiceResponseAudio.src = audioUrl;
                
                // Visualize while playing
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = audioContext.createMediaElementSource(elements.voiceResponseAudio);
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                
                source.connect(analyser);
                analyser.connect(audioContext.destination);
                
                function visualizeResponse() {
                    if (elements.voiceResponseAudio.paused || elements.voiceResponseAudio.ended) {
                        if (elements.voiceResponseCanvas) {
                            const ctx = elements.voiceResponseCanvas.getContext('2d');
                            ctx.clearRect(0, 0, elements.voiceResponseCanvas.width, elements.voiceResponseCanvas.height);
                        }
                        audioContext.close();
                        return;
                    }
                    
                    analyser.getByteFrequencyData(dataArray);
                    const audioLevel = calculateAudioLevel(analyser, dataArray);
                    drawResponseVisualization(elements.voiceResponseCanvas, audioLevel);
                    
                    requestAnimationFrame(visualizeResponse);
                }
                
                elements.voiceResponseAudio.play();
                visualizeResponse();
                
                elements.voiceResponseAudio.onended = () => {
                    updateVoiceResponseStatus('');
                    audioContext.close();
                };
            }
            
            updateVoiceMicStatus('Click to speak');
            updateVoiceResponseStatus('Response received');
            showToast('success', 'Voice message sent successfully!');
            
        } catch (error) {
            console.error('Voice chat error:', error);
            addChatMessage(
                elements.chatMessages,
                'bot',
                `Sorry, I'm having trouble with the voice chat. ${error.message}`
            );
            updateVoiceMicStatus('Click to speak');
            updateVoiceResponseStatus('Error occurred');
            showToast('error', `Error: ${error.message}`);
        }
    }
    
    // Update voice mic status
    function updateVoiceMicStatus(status, isRecording = false) {
        if (elements.voiceMicStatus) {
            elements.voiceMicStatus.textContent = status;
            if (isRecording) {
                elements.voiceMicStatus.classList.add('recording');
            } else {
                elements.voiceMicStatus.classList.remove('recording');
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
            
            if (elements.voiceMicStatus) {
                const baseText = 'Listening...';
                elements.voiceMicStatus.innerHTML = `${baseText} <span class="recording-indicator">● ${timeStr}</span>`;
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
    
    // Update voice response status
    function updateVoiceResponseStatus(status) {
        if (elements.voiceResponseStatus) {
            elements.voiceResponseStatus.textContent = status;
        }
    }
    
    // Enter voice mode
    async function enterVoiceMode() {
        if (voiceModeState.isActive) return;
        
        voiceModeState.isActive = true;
        
        if (elements.textInputWrapper && elements.voiceModeWrapper) {
            elements.textInputWrapper.classList.add('hidden');
            elements.voiceModeWrapper.classList.remove('hidden');
        }
        
        // Initialize canvases
        if (elements.voiceMicCanvas) {
            initVoiceCanvas(elements.voiceMicCanvas);
        }
        if (elements.voiceResponseCanvas) {
            initVoiceCanvas(elements.voiceResponseCanvas, true);
        }
        
        // Get selected language
        if (elements.voiceModeLanguage) {
            voiceModeState.selectedLanguage = elements.voiceModeLanguage.value || 'en_US';
        }
        
        updateVoiceMicStatus('Click to speak');
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
        
        if (elements.textInputWrapper && elements.voiceModeWrapper) {
            elements.textInputWrapper.classList.remove('hidden');
            elements.voiceModeWrapper.classList.add('hidden');
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
        if (elements.voiceMicButton) {
            elements.voiceMicButton.classList.remove('recording');
        }
        if (elements.voiceTranscriptContainer) {
            elements.voiceTranscriptContainer.classList.remove('recording');
        }
        updateVoiceMicStatus('Click to speak', false);
        
        if (elements.voiceTranscriptText) {
            elements.voiceTranscriptText.textContent = '';
        }
        if (elements.voiceTranscriptContainer) {
            elements.voiceTranscriptContainer.style.display = 'none';
        }
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
                enterVoiceMode();
            });
        }
        
        // Exit voice mode
        if (elements.exitVoiceModeBtn) {
            elements.exitVoiceModeBtn.addEventListener('click', () => {
                exitVoiceMode();
            });
        }
        
        // Voice mic button
        if (elements.voiceMicButton) {
            elements.voiceMicButton.addEventListener('click', () => {
                if (voiceModeState.isRecording) {
                    stopRecording();
                } else {
                    startRecording();
                }
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

