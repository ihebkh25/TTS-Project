// Streaming Tab Module - Real-time audio streaming functionality

import { CONFIG } from '../config.js';
import { setButtonState } from '../utils/dom.js';
import { base64ToBlob, generateWaveform, updateWaveformProgress } from '../utils/audio.js';
import { setupWaveformInteractivity } from '../components/audioPlayer.js';
import { initStreamSpectrogram, visualizeMelFrame } from '../components/spectrogram.js';
import { startWebSocketStream } from '../services/websocket.js';
import { formatTime } from '../utils/format.js';
import { populateLanguageSelect, populateVoiceSelectForLanguage, parseVoiceKey, getDefaultVoiceForLanguage } from '../utils/voices.js';

// Access AUDIO safely (it's a regular property, not a getter)
const AUDIO = CONFIG?.AUDIO || { DEFAULT_SPEED: 1.0 };

/**
 * Initialize Streaming tab
 * @param {Object} elements - DOM elements
 * @param {Object} state - State object with isStreaming, currentWebSocket, currentStreamAudioBlob, voiceDetails
 * @returns {Object} Tab handlers and cleanup functions
 */
export function initStreamTab(elements, state) {
    const { voiceDetails = [] } = state;
    
    // Populate language and voice dropdowns when voiceDetails are available
    function populateVoiceDropdowns() {
        if (!voiceDetails || voiceDetails.length === 0) return;
        
        // Populate language dropdown
        if (elements.streamLanguage) {
            populateLanguageSelect(elements.streamLanguage, voiceDetails);
            
            // Set up language change handler
            elements.streamLanguage.addEventListener('change', handleLanguageChange);
            
            // Trigger initial population if a language is already selected
            if (elements.streamLanguage.value) {
                handleLanguageChange();
            }
        }
    }
    
    // Handle language selection change
    function handleLanguageChange() {
        const selectedLang = elements.streamLanguage?.value;
        const voiceSelect = elements.streamVoice;
        
        if (!voiceSelect) return;
        
        if (!selectedLang) {
            // No language selected - disable voice dropdown
            voiceSelect.disabled = true;
            voiceSelect.innerHTML = '<option value="">Select language first...</option>';
            return;
        }
        
        // Enable voice dropdown and populate with voices for selected language
        voiceSelect.disabled = false;
        populateVoiceSelectForLanguage(voiceSelect, selectedLang, voiceDetails);
        
        // Auto-select default voice for the language
        const defaultVoice = getDefaultVoiceForLanguage(selectedLang, voiceDetails);
        if (defaultVoice && voiceSelect.querySelector(`option[value="${defaultVoice.key}"]`)) {
            voiceSelect.value = defaultVoice.key;
        }
    }
    
    // Populate dropdowns on initialization if voiceDetails are already loaded
    if (voiceDetails && voiceDetails.length > 0) {
        populateVoiceDropdowns();
    }
    let streamSpectrogramState = null;
    let streamMetadata = null;
    
    // Set up character counter with auto-resize (like TTS tab)
    function setupCharacterCounter() {
        if (!elements.streamText || !elements.streamCharCount) return;
        
        const minHeight = parseFloat(getComputedStyle(elements.streamText).fontSize) * 1.6 * 3 + 16; // 3 lines + padding
        const autoResize = () => {
            elements.streamText.style.height = 'auto';
            const newHeight = Math.max(minHeight, Math.min(elements.streamText.scrollHeight, 200)); // min 3 lines, max 200px
            elements.streamText.style.height = `${newHeight}px`;
        };
        
        elements.streamText.addEventListener('input', () => {
            const count = elements.streamText.value.length;
            elements.streamCharCount.textContent = count;
            autoResize();
        });
        
        autoResize();
        elements.streamCharCount.textContent = elements.streamText.value.length;
    }
    
    // Status message handling (like TTS tab)
    function showStreamStatus(type, message) {
        const statusWrapper = document.getElementById('streamStatusMessageWrapper');
        const statusMessage = document.getElementById('streamStatusMessage');
        
        if (!statusWrapper || !statusMessage) return;
        
        if (message) {
            statusMessage.className = `tts-status-message ${type}`;
            statusMessage.textContent = message;
            statusWrapper.style.display = 'flex';
        } else {
            statusWrapper.style.display = 'none';
        }
    }
    
    function hideStreamStatus() {
        const statusWrapper = document.getElementById('streamStatusMessageWrapper');
        if (statusWrapper) {
            statusWrapper.style.display = 'none';
        }
    }
    
    // Set up custom audio player for streaming
    function setupStreamAudioPlayer() {
        if (!elements.streamPlayPause || !elements.streamProgressSlider || !elements.streamAudio) return;
        
        // Prevent duplicate setup
        if (elements.streamAudio._playerInitialized) {
            return;
        }
        
        elements.streamAudio._playerInitialized = true;
        
        // Play/Pause button
        const playPauseHandler = () => {
            if (elements.streamAudio.paused) {
                elements.streamAudio.play().catch(err => {
                    console.warn('[StreamAudioPlayer] Play failed:', err);
                });
            } else {
                elements.streamAudio.pause();
            }
        };
        elements.streamPlayPause.addEventListener('click', playPauseHandler);
        
        // Progress bar
        let isDragging = false;
        
        const progressInputHandler = (e) => {
            isDragging = true;
            const time = (e.target.value / 100) * elements.streamAudio.duration;
            if (!isNaN(time) && isFinite(time)) {
                elements.streamAudio.currentTime = time;
            }
        };
        elements.streamProgressSlider.addEventListener('input', progressInputHandler);
        
        const progressChangeHandler = (e) => {
            isDragging = false;
            const time = (e.target.value / 100) * elements.streamAudio.duration;
            if (!isNaN(time) && isFinite(time)) {
                elements.streamAudio.currentTime = time;
            }
        };
        elements.streamProgressSlider.addEventListener('change', progressChangeHandler);
        
        // Speed control
        if (elements.streamSpeed) {
            const speedHandler = (e) => {
                const speed = parseFloat(e.target.value);
                if (elements.streamAudio) {
                    elements.streamAudio.playbackRate = speed;
                }
            };
            elements.streamSpeed.addEventListener('change', speedHandler);
        }
        
        // Audio events
        const loadedMetadataHandler = () => {
            if (elements.streamDuration) {
                elements.streamDuration.textContent = formatTime(elements.streamAudio.duration);
            }
        };
        elements.streamAudio.addEventListener('loadedmetadata', loadedMetadataHandler);
        
        // Smooth progress update using requestAnimationFrame (like TTS tab)
        let animationFrameId = null;
        let lastUpdateTime = 0;
        const UPDATE_INTERVAL = 16; // ~60fps (16ms)
        
        const smoothProgressUpdate = () => {
            const now = performance.now();
            if (now - lastUpdateTime >= UPDATE_INTERVAL) {
                lastUpdateTime = now;
                
                if (elements.streamAudio.duration && isFinite(elements.streamAudio.duration)) {
                    const currentTime = elements.streamAudio.currentTime;
                    const progress = (currentTime / elements.streamAudio.duration) * 100;
                    
                    // Update progress bar (only if not dragging)
                    if (elements.streamProgressSlider && !isDragging) {
                        elements.streamProgressSlider.value = progress || 0;
                    }
                    
                    // Update time display
                    if (elements.streamCurrentTime) {
                        elements.streamCurrentTime.textContent = formatTime(currentTime);
                    }
                    
                    // Update waveform progress indicator (smooth updates)
                    if (elements.streamWaveform && !elements.streamAudio.paused) {
                        const container = elements.streamWaveform.closest('.audio-waveform-container');
                        if (container) {
                            updateWaveformProgress(
                                elements.streamWaveform,
                                container,
                                currentTime,
                                elements.streamAudio.duration
                            );
                        }
                    }
                }
            }
            
            // Continue animation loop if audio is playing
            if (!elements.streamAudio.paused && !elements.streamAudio.ended) {
                animationFrameId = requestAnimationFrame(smoothProgressUpdate);
            }
        };
        
        const timeUpdateHandler = () => {
            // Use timeupdate as a fallback and to start the animation loop
            if (!animationFrameId && !elements.streamAudio.paused) {
                animationFrameId = requestAnimationFrame(smoothProgressUpdate);
            }
        };
        elements.streamAudio.addEventListener('timeupdate', timeUpdateHandler);
        
        const playHandler = () => {
            const playIcon = elements.streamPlayPause.querySelector('.play-icon');
            const pauseIcon = elements.streamPlayPause.querySelector('.pause-icon');
            if (playIcon) playIcon.classList.add('hidden');
            if (pauseIcon) pauseIcon.classList.remove('hidden');
            
            // Start smooth progress updates
            if (!animationFrameId) {
                animationFrameId = requestAnimationFrame(smoothProgressUpdate);
            }
        };
        elements.streamAudio.addEventListener('play', playHandler);
        
        const pauseHandler = () => {
            const playIcon = elements.streamPlayPause.querySelector('.play-icon');
            const pauseIcon = elements.streamPlayPause.querySelector('.pause-icon');
            if (playIcon) playIcon.classList.remove('hidden');
            if (pauseIcon) pauseIcon.classList.add('hidden');
            
            // Stop animation loop
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            
            // Final update on pause
            if (elements.streamWaveform && elements.streamAudio.duration) {
                const container = elements.streamWaveform.closest('.audio-waveform-container');
                if (container) {
                    updateWaveformProgress(
                        elements.streamWaveform,
                        container,
                        elements.streamAudio.currentTime,
                        elements.streamAudio.duration
                    );
                }
            }
        };
        elements.streamAudio.addEventListener('pause', pauseHandler);
        
        const endedHandler = () => {
            elements.streamAudio.currentTime = 0;
            const playIcon = elements.streamPlayPause.querySelector('.play-icon');
            const pauseIcon = elements.streamPlayPause.querySelector('.pause-icon');
            if (playIcon) playIcon.classList.remove('hidden');
            if (pauseIcon) pauseIcon.classList.add('hidden');
            
            // Stop animation loop
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            
            // Reset progress
            if (elements.streamWaveform && elements.streamAudio.duration) {
                const container = elements.streamWaveform.closest('.audio-waveform-container');
                if (container) {
                    updateWaveformProgress(
                        elements.streamWaveform,
                        container,
                        0,
                        elements.streamAudio.duration
                    );
                }
            }
        };
        elements.streamAudio.addEventListener('ended', endedHandler);
        
        // Cleanup function to cancel animation frame if needed
        if (elements.streamAudio._cleanupAnimation) {
            elements.streamAudio._cleanupAnimation();
        }
        elements.streamAudio._cleanupAnimation = () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        };
    }
    
    // Streaming Form Submission Handler
    async function handleStreamSubmit(e) {
        e.preventDefault();
        
        const text = elements.streamText.value.trim();
        const selectedLang = elements.streamLanguage?.value;
        const voiceKey = elements.streamVoice.value;
        
        if (!text) {
            showStreamStatus('error', 'Please enter some text to stream');
            return;
        }
        
        if (!selectedLang) {
            showStreamStatus('error', 'Please select a language');
            return;
        }
        
        if (!voiceKey) {
            showStreamStatus('error', 'Please select a voice');
            return;
        }
        
        // Parse voice key to get language and voice
        const { lang: language, voice } = parseVoiceKey(voiceKey);
        
            if (state.isStreaming) {
                // Stop streaming
                if (state.currentWebSocket && typeof state.currentWebSocket.close === 'function') {
                    state.currentWebSocket.close();
                    state.currentWebSocket = null;
                }
                state.isStreaming = false;
                setButtonState(elements.streamBtn, false, 'Stream');
                showStreamStatus('info', 'Streaming stopped.');
                const progressWrapper = document.querySelector('.stream-progress-wrapper');
                if (progressWrapper) {
                    progressWrapper.classList.add('hidden');
                }
                return;
            }
        
        // Reset UI elements for new stream
        streamMetadata = null;
        
        // Hide welcome message
        const welcomeMessage = document.querySelector('#streamResultsContent .tts-welcome-message');
        if (welcomeMessage) {
            welcomeMessage.style.display = 'none';
        }
        
        // Hide previous audio player
        const audioWrapper = document.getElementById('streamAudioWrapper');
        if (audioWrapper) {
            audioWrapper.classList.add('hidden');
        } else if (elements.streamAudioPlayer) {
            elements.streamAudioPlayer.classList.add('hidden');
        }
        
        // Hide spectrogram
        if (elements.streamSpectrogram) {
            elements.streamSpectrogram.classList.add('hidden');
        }
        
        // Hide metrics and progress
        const metricsWrapper = document.querySelector('.stream-metrics-wrapper');
        if (metricsWrapper) {
            metricsWrapper.classList.add('hidden');
        }
        const progressWrapper = document.querySelector('.stream-progress-wrapper');
        if (progressWrapper) {
            progressWrapper.classList.add('hidden');
        }
        
        if (state.setCurrentStreamAudioBlob) {
            state.setCurrentStreamAudioBlob(null);
        }
        
        setButtonState(elements.streamBtn, true, 'Connecting...');
        showStreamStatus('info', 'Connecting to stream...');
        
        // Initialize spectrogram (show it first to get valid dimensions)
        if (elements.streamSpectrogramCanvas && elements.streamSpectrogram) {
            // Show spectrogram container first to get valid dimensions
            elements.streamSpectrogram.classList.remove('hidden');
            
            // Wait a frame for layout to settle
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            streamSpectrogramState = initStreamSpectrogram(
                elements.streamSpectrogramCanvas,
                elements.streamSpectrogram
            );
        }
        
        try {
            const cleanup = await startWebSocketStream(text, language, voice, {
                isStreaming: () => state.isStreaming,
                onOpen: () => {
                    state.isStreaming = true;
                    setButtonState(elements.streamBtn, false, 'Stop Streaming');
                    showStreamStatus('info', 'Connected! Waiting for audio...');
                    
                    // Show progress wrapper
                    const progressWrapper = document.querySelector('.stream-progress-wrapper');
                    if (progressWrapper) {
                        progressWrapper.classList.remove('hidden');
                    }
                    
                    // Show metrics wrapper
                    const metricsWrapper = document.querySelector('.stream-metrics-wrapper');
                    if (metricsWrapper) {
                        metricsWrapper.classList.remove('hidden');
                    }
                },
                onMetadata: (metadata) => {
                    streamMetadata = metadata;
                    console.log('[Stream] Metadata received:', metadata);
                    
                    // Update chunks display if we now have the actual total
                    const metricsWrapper = document.querySelector('.stream-metrics-wrapper');
                    if (metadata.totalChunks > 0 && metricsWrapper) {
                        const streamMetrics = metricsWrapper.querySelector('.stream-metrics');
                        if (streamMetrics) {
                            const chunksDisplay = streamMetrics.querySelector('#streamChunks');
                            if (chunksDisplay) {
                                // Get current chunk number from the display or use metadata
                                const currentText = chunksDisplay.textContent;
                                const currentChunk = currentText.match(/^(\d+)/)?.[1] || metadata.totalChunks;
                                chunksDisplay.textContent = `${currentChunk} / ${metadata.totalChunks}`;
                            }
                        }
                    }
                },
                onStatus: (status, message) => {
                    console.log('[Stream] Status:', status, message);
                    if (status === 'synthesizing') {
                        showStreamStatus('info', message || 'Generating audio...');
                    } else if (status === 'streaming') {
                        showStreamStatus('success', message || 'Streaming audio chunks...');
                    }
                },
                onProgress: (chunks, metrics) => {
                    // Update progress bar
                    const progressFill = document.getElementById('streamProgressFill');
                    if (progressFill && metrics) {
                        progressFill.style.width = `${Math.min(100, metrics.progress)}%`;
                    } else if (progressFill) {
                        // Fallback for legacy format
                        progressFill.style.width = `${Math.min(100, chunks * 2)}%`;
                    }
                    
                    // Update metrics display
                    const metricsWrapper = document.querySelector('.stream-metrics-wrapper');
                    if (metrics && metricsWrapper) {
                        const streamMetrics = metricsWrapper.querySelector('.stream-metrics');
                        if (streamMetrics) {
                            const progressPercent = streamMetrics.querySelector('#streamProgressPercent');
                            const chunksDisplay = streamMetrics.querySelector('#streamChunks');
                            const chunksPerSec = streamMetrics.querySelector('#streamChunksPerSec');
                            const timeDisplay = streamMetrics.querySelector('#streamTime');
                            const timeRemaining = streamMetrics.querySelector('#streamTimeRemaining');
                            
                            if (progressPercent) {
                                progressPercent.textContent = `${metrics.progress.toFixed(1)}%`;
                            }
                            
                            if (chunksDisplay) {
                                // Show "?" for total until we know the actual value
                                if (metrics.totalChunks > 0) {
                                    chunksDisplay.textContent = `${metrics.chunk} / ${metrics.totalChunks}`;
                                } else {
                                    chunksDisplay.textContent = `${metrics.chunk} / ?`;
                                }
                            }
                            
                            if (chunksPerSec) {
                                chunksPerSec.textContent = `${metrics.chunksPerSecond.toFixed(1)} chunks/s`;
                            }
                            
                            if (timeDisplay && streamMetadata) {
                                const currentTime = metrics.timestamp || 0;
                                const totalTime = streamMetadata.estimatedDuration || 0;
                                timeDisplay.textContent = `${currentTime.toFixed(1)}s / ${totalTime.toFixed(1)}s`;
                            }
                            
                            if (timeRemaining) {
                                if (metrics.estimatedTimeRemaining !== null && metrics.estimatedTimeRemaining !== undefined) {
                                    timeRemaining.textContent = `${metrics.estimatedTimeRemaining.toFixed(1)}s`;
                                } else {
                                    timeRemaining.textContent = '-';
                                }
                            }
                        }
                    }
                },
                onMelFrame: (melFrame) => {
                    if (streamSpectrogramState) {
                        visualizeMelFrame(streamSpectrogramState, melFrame);
                    }
                },
                onError: (error) => {
                    console.error('[Stream] Error:', error);
                    showStreamStatus('error', error);
                },
                onReconnecting: (attempt, max) => {
                    showStreamStatus('info', 
                        `Connection lost. Reconnecting... (${attempt}/${max})`);
                },
                onAudioBlob: (blob) => {
                    if (state.setCurrentStreamAudioBlob) {
                        state.setCurrentStreamAudioBlob(blob);
                    }
                },
                waveformCanvas: elements.streamWaveform,
                onComplete: async (wavBase64, chunks, samples) => {
                    try {
                        // Convert base64 to blob and set up audio
                        const audioBlob = await base64ToBlob(wavBase64, 'audio/wav');
                        const audioUrl = URL.createObjectURL(audioBlob);
                        
                        // Clean up previous URL
                        if (elements.streamAudio.previousUrl) {
                            URL.revokeObjectURL(elements.streamAudio.previousUrl);
                        }
                        elements.streamAudio.previousUrl = audioUrl;
                        
                        elements.streamAudio.src = audioUrl;
                        
                        // Set up custom audio player if not already done
                        setupStreamAudioPlayer();
                        
                        // Show audio player wrapper FIRST (before generating waveform)
                        // This ensures canvas has valid dimensions (offsetWidth > 0)
                        const audioWrapper = document.getElementById('streamAudioWrapper');
                        if (audioWrapper) {
                            audioWrapper.classList.remove('hidden');
                        } else if (elements.streamAudioPlayer) {
                            elements.streamAudioPlayer.classList.remove('hidden');
                        }
                        
                        // Wait a frame to ensure DOM has updated and canvas dimensions are available
                        await new Promise(resolve => requestAnimationFrame(resolve));
                        
                        // Show spectrogram if it was visible during streaming
                        if (elements.streamSpectrogram) {
                            elements.streamSpectrogram.classList.remove('hidden');
                        }
                        
                        // Hide welcome message if still visible
                        const welcomeMessage = document.querySelector('#streamResultsContent .tts-welcome-message');
                        if (welcomeMessage) {
                            welcomeMessage.style.display = 'none';
                        }
                        
                        // Show status message
                        const statusWrapper = document.getElementById('streamStatusMessageWrapper');
                        if (statusWrapper) {
                            statusWrapper.style.display = 'flex';
                        }
                        
                        // Reset speed to default
                        if (elements.streamSpeed) {
                            elements.streamSpeed.value = AUDIO.DEFAULT_SPEED.toString();
                            elements.streamAudio.playbackRate = AUDIO.DEFAULT_SPEED;
                        }
                        
                        // Generate waveform - ensure canvas is visible first
                        if (elements.streamWaveform) {
                            // Double-check canvas is visible and has dimensions
                            const waveformContainer = elements.streamWaveform.closest('.audio-waveform-container');
                            if (waveformContainer && waveformContainer.offsetWidth === 0) {
                                // Wait a bit more for layout to settle
                                await new Promise(resolve => {
                                    requestAnimationFrame(() => {
                                        requestAnimationFrame(resolve);
                                    });
                                });
                            }
                            
                            // Generate waveform
                            await generateWaveform(audioBlob, elements.streamWaveform, 120);
                            
                            // Setup waveform interactivity (click to seek, hover tooltip)
                            const canvas = elements.streamWaveform;
                            if (canvas._interactivitySetup) {
                                // Clean up old listeners if any
                                canvas._interactivitySetup = false;
                            }
                            setupWaveformInteractivity(elements.streamWaveform, elements.streamAudio);
                            canvas._interactivitySetup = true;
                        }
                        
                        // Scroll to audio player smoothly after everything is set up
                        if (audioWrapper) {
                            audioWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        } else if (elements.streamAudioPlayer) {
                            elements.streamAudioPlayer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        
                        // Store blob for download
                        if (state.setCurrentStreamAudioBlob) {
                            state.setCurrentStreamAudioBlob(audioBlob);
                        }
                        
                        // Auto-play audio after it's loaded
                        const playAudio = () => {
                            if (elements.streamAudio.readyState >= 2) {
                                elements.streamAudio.play().catch(error => {
                                    console.warn('[Stream] Autoplay prevented:', error);
                                });
                            } else {
                                elements.streamAudio.addEventListener('canplay', () => {
                                    elements.streamAudio.play().catch(error => {
                                        console.warn('[Stream] Autoplay prevented:', error);
                                    });
                                }, { once: true });
                            }
                        };
                        
                        playAudio();
                        
                        showStreamStatus('success', 
                            `Streaming complete! Audio ready to play. Received ${chunks} chunks, ${samples} samples total.`);
                    } catch (error) {
                        console.error('[Stream] Error setting up audio:', error);
                        showStreamStatus('error', `Error setting up audio: ${error.message}`);
                    }
                },
                onClose: () => {
                    state.isStreaming = false;
                    state.currentWebSocket = null;
                    setButtonState(elements.streamBtn, false, 'Stream');
                    const progressWrapper = document.querySelector('.stream-progress-wrapper');
                    if (progressWrapper) {
                        progressWrapper.classList.add('hidden');
                    }
                }
            });
            
            // Store cleanup function for stopping
            state.currentWebSocket = { close: cleanup };
        } catch (error) {
            console.error('Streaming Error:', error);
            showStreamStatus('error', `Error: ${error.message}`);
            setButtonState(elements.streamBtn, false, 'Stream');
        }
    }
    
    // Set up event listeners
    function setupEventListeners() {
        if (elements.streamForm) {
            elements.streamForm.addEventListener('submit', handleStreamSubmit);
        }
    }
    
    // Initialize
    setupCharacterCounter();
    setupEventListeners();
    setupStreamAudioPlayer();
    
        return {
            handleStreamSubmit,
            populateVoiceDropdown: populateVoiceDropdowns
        };
}

