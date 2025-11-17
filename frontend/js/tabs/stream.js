// Streaming Tab Module - Real-time audio streaming functionality

import { CONFIG } from '../config.js';
import { setButtonState, showStatus } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { base64ToBlob, generateWaveform } from '../utils/audio.js';
import { initStreamSpectrogram, visualizeMelFrame } from '../components/spectrogram.js';
import { startWebSocketStream } from '../services/websocket.js';
import { formatTime } from '../utils/format.js';
import { populateVoiceSelect, parseVoiceKey } from '../utils/voices.js';

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
    
    // Populate voice select when voiceDetails are available
    function populateVoiceDropdown() {
        if (!elements.streamVoice || !voiceDetails || voiceDetails.length === 0) return;
        populateVoiceSelect(elements.streamVoice, voiceDetails);
    }
    
    // Populate voice dropdown on initialization if voiceDetails are already loaded
    if (voiceDetails && voiceDetails.length > 0) {
        populateVoiceDropdown();
    }
    let streamSpectrogramState = null;
    let streamMetadata = null;
    
    // Set up character counter
    function setupCharacterCounter() {
        if (!elements.streamText || !elements.streamCharCount) return;
        
        elements.streamText.addEventListener('input', () => {
            const count = elements.streamText.value.length;
            elements.streamCharCount.textContent = count;
        });
        elements.streamCharCount.textContent = elements.streamText.value.length;
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
        
        const timeUpdateHandler = () => {
            if (elements.streamProgressSlider && !isDragging) {
                const progress = (elements.streamAudio.currentTime / elements.streamAudio.duration) * 100;
                elements.streamProgressSlider.value = progress || 0;
            }
            if (elements.streamCurrentTime) {
                elements.streamCurrentTime.textContent = formatTime(elements.streamAudio.currentTime);
            }
        };
        elements.streamAudio.addEventListener('timeupdate', timeUpdateHandler);
        
        const playHandler = () => {
            const playIcon = elements.streamPlayPause.querySelector('.play-icon');
            const pauseIcon = elements.streamPlayPause.querySelector('.pause-icon');
            if (playIcon) playIcon.classList.add('hidden');
            if (pauseIcon) pauseIcon.classList.remove('hidden');
        };
        elements.streamAudio.addEventListener('play', playHandler);
        
        const pauseHandler = () => {
            const playIcon = elements.streamPlayPause.querySelector('.play-icon');
            const pauseIcon = elements.streamPlayPause.querySelector('.pause-icon');
            if (playIcon) playIcon.classList.remove('hidden');
            if (pauseIcon) pauseIcon.classList.add('hidden');
        };
        elements.streamAudio.addEventListener('pause', pauseHandler);
        
        const endedHandler = () => {
            elements.streamAudio.currentTime = 0;
            const playIcon = elements.streamPlayPause.querySelector('.play-icon');
            const pauseIcon = elements.streamPlayPause.querySelector('.pause-icon');
            if (playIcon) playIcon.classList.remove('hidden');
            if (pauseIcon) pauseIcon.classList.add('hidden');
        };
        elements.streamAudio.addEventListener('ended', endedHandler);
    }
    
    // Streaming Form Submission Handler
    async function handleStreamSubmit(e) {
        e.preventDefault();
        
        const text = elements.streamText.value.trim();
        const voiceKey = elements.streamVoice.value;
        
        if (!text) {
            showStatus(elements.streamStatus, 'error', 'Please enter some text to stream');
            return;
        }
        
        if (!voiceKey) {
            showStatus(elements.streamStatus, 'error', 'Please select a voice');
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
            setButtonState(elements.streamBtn, false, 'Start Streaming');
            showStatus(elements.streamStatus, 'info', 'Streaming stopped.');
            if (elements.streamProgress) {
                elements.streamProgress.classList.add('hidden');
            }
            return;
        }
        
        // Reset UI elements for new stream
        streamMetadata = null;
        if (elements.streamSpectrogram) {
            elements.streamSpectrogram.classList.add('hidden');
        }
        if (elements.streamAudioPlayer) {
            elements.streamAudioPlayer.classList.add('hidden');
        }
        if (elements.streamMetrics) {
            elements.streamMetrics.classList.add('hidden');
        }
        if (state.setCurrentStreamAudioBlob) {
            state.setCurrentStreamAudioBlob(null);
        }
        
        setButtonState(elements.streamBtn, true, 'Connecting...');
        showStatus(elements.streamStatus, 'info', 'Connecting to stream...');
        
        // Initialize spectrogram
        if (elements.streamSpectrogramCanvas && elements.streamSpectrogram) {
            streamSpectrogramState = initStreamSpectrogram(
                elements.streamSpectrogramCanvas,
                elements.streamSpectrogram
            );
            if (streamSpectrogramState) {
                elements.streamSpectrogram.classList.remove('hidden');
            }
        }
        
        try {
            const cleanup = await startWebSocketStream(text, language, voice, {
                isStreaming: () => state.isStreaming,
                onOpen: () => {
                    state.isStreaming = true;
                    setButtonState(elements.streamBtn, false, 'Stop Streaming');
                    showStatus(elements.streamStatus, 'info', 'Connected! Waiting for audio...');
                    if (elements.streamProgress) {
                        elements.streamProgress.classList.remove('hidden');
                    }
                    if (elements.streamMetrics) {
                        elements.streamMetrics.classList.remove('hidden');
                    }
                },
                onMetadata: (metadata) => {
                    streamMetadata = metadata;
                    console.log('[Stream] Metadata received:', metadata);
                    
                    // Update chunks display if we now have the actual total
                    if (metadata.totalChunks > 0 && elements.streamMetrics) {
                        const chunksDisplay = elements.streamMetrics.querySelector('#streamChunks');
                        if (chunksDisplay) {
                            // Get current chunk number from the display or use metadata
                            const currentText = chunksDisplay.textContent;
                            const currentChunk = currentText.match(/^(\d+)/)?.[1] || metadata.totalChunks;
                            chunksDisplay.textContent = `${currentChunk} / ${metadata.totalChunks}`;
                        }
                    }
                },
                onStatus: (status, message) => {
                    console.log('[Stream] Status:', status, message);
                    if (status === 'synthesizing') {
                        showStatus(elements.streamStatus, 'info', message || 'Generating audio...');
                    } else if (status === 'streaming') {
                        showStatus(elements.streamStatus, 'success', message || 'Streaming audio chunks...');
                        showToast('success', 'Streaming started');
                    }
                },
                onProgress: (chunks, metrics) => {
                    // Update progress bar
                    if (elements.streamProgress && metrics) {
                        const progressFill = elements.streamProgress.querySelector('.progress-fill');
                        if (progressFill) {
                            progressFill.style.width = `${Math.min(100, metrics.progress)}%`;
                        }
                    } else if (elements.streamProgress) {
                        // Fallback for legacy format
                        const progressFill = elements.streamProgress.querySelector('.progress-fill');
                        if (progressFill) {
                            progressFill.style.width = `${Math.min(100, chunks * 2)}%`;
                        }
                    }
                    
                    // Update metrics display
                    if (metrics && elements.streamMetrics) {
                        const progressPercent = elements.streamMetrics.querySelector('#streamProgressPercent');
                        const chunksDisplay = elements.streamMetrics.querySelector('#streamChunks');
                        const chunksPerSec = elements.streamMetrics.querySelector('#streamChunksPerSec');
                        const timeDisplay = elements.streamMetrics.querySelector('#streamTime');
                        const timeRemaining = elements.streamMetrics.querySelector('#streamTimeRemaining');
                        
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
                },
                onMelFrame: (melFrame) => {
                    if (streamSpectrogramState) {
                        visualizeMelFrame(streamSpectrogramState, melFrame);
                    }
                },
                onError: (error) => {
                    showStatus(elements.streamStatus, 'error', error);
                    showToast('error', error);
                },
                onReconnecting: (attempt, max) => {
                    showStatus(elements.streamStatus, 'info', 
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
                        
                        // Show audio player
                        if (elements.streamAudioPlayer) {
                            elements.streamAudioPlayer.classList.remove('hidden');
                        }
                        
                        // Show spectrogram if it was visible during streaming
                        if (elements.streamSpectrogram) {
                            elements.streamSpectrogram.classList.remove('hidden');
                        }
                        
                        // Reset speed to default
                        if (elements.streamSpeed) {
                            elements.streamSpeed.value = AUDIO.DEFAULT_SPEED.toString();
                            elements.streamAudio.playbackRate = AUDIO.DEFAULT_SPEED;
                        }
                        
                        // Generate waveform
                        if (elements.streamWaveform) {
                            await generateWaveform(audioBlob, elements.streamWaveform);
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
                        
                        showStatus(elements.streamStatus, 'success', 
                            `Streaming complete! Audio ready to play.<br>
                             Received ${chunks} chunks, ${samples} samples total.`);
                        showToast('success', 'Streaming complete!');
                    } catch (error) {
                        console.error('[Stream] Error setting up audio:', error);
                        showStatus(elements.streamStatus, 'error', `Error setting up audio: ${error.message}`);
                    }
                },
                onClose: () => {
                    state.isStreaming = false;
                    state.currentWebSocket = null;
                    setButtonState(elements.streamBtn, false, 'Start Streaming');
                    if (elements.streamProgress) {
                        elements.streamProgress.classList.add('hidden');
                    }
                }
            });
            
            // Store cleanup function for stopping
            state.currentWebSocket = { close: cleanup };
        } catch (error) {
            console.error('Streaming Error:', error);
            showStatus(elements.streamStatus, 'error', `Error: ${error.message}`);
            setButtonState(elements.streamBtn, false, 'Start Streaming');
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
        populateVoiceDropdown
    };
}

