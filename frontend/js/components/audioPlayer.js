// Custom audio player component

import { CONFIG } from '../config.js';
import { formatTime } from '../utils/format.js';
import { base64ToBlob, generateWaveform, updateWaveformProgress } from '../utils/audio.js';

// Access AUDIO safely (it's a regular property, not a getter)
const AUDIO = CONFIG?.AUDIO || { DEFAULT_SPEED: 1.0 };

/**
 * Setup custom audio player
 */
export function setupCustomAudioPlayer(elements) {
    if (!elements.ttsPlayPause || !elements.ttsProgress || !elements.ttsAudio) return;
    
    // Prevent duplicate setup - check if already initialized
    if (elements.ttsAudio._playerInitialized) {
        console.log('[AudioPlayer] Audio player already initialized, skipping duplicate setup');
        return;
    }
    
    // Mark as initialized
    elements.ttsAudio._playerInitialized = true;
    
    // Play/Pause button
    const playPauseHandler = () => {
        if (elements.ttsAudio.paused) {
            elements.ttsAudio.play().catch(err => {
                console.warn('[AudioPlayer] Play failed:', err);
            });
        } else {
            elements.ttsAudio.pause();
        }
    };
    elements.ttsPlayPause.addEventListener('click', playPauseHandler);
    
    // Progress bar - handle both input (while dragging) and change (on release)
    let isDragging = false;
    
    const progressInputHandler = (e) => {
        isDragging = true;
        const time = (e.target.value / 100) * elements.ttsAudio.duration;
        if (!isNaN(time) && isFinite(time)) {
            elements.ttsAudio.currentTime = time;
        }
    };
    elements.ttsProgress.addEventListener('input', progressInputHandler);
    
    const progressChangeHandler = (e) => {
        isDragging = false;
        const time = (e.target.value / 100) * elements.ttsAudio.duration;
        if (!isNaN(time) && isFinite(time)) {
            elements.ttsAudio.currentTime = time;
        }
    };
    elements.ttsProgress.addEventListener('change', progressChangeHandler);
    
    // Speed control
    if (elements.ttsSpeed) {
        const speedHandler = (e) => {
            const speed = parseFloat(e.target.value);
            if (elements.ttsAudio) {
                elements.ttsAudio.playbackRate = speed;
            }
        };
        elements.ttsSpeed.addEventListener('change', speedHandler);
    }
    
    // Audio events
    const loadedMetadataHandler = () => {
        if (elements.ttsDuration) {
            elements.ttsDuration.textContent = formatTime(elements.ttsAudio.duration);
        }
    };
    elements.ttsAudio.addEventListener('loadedmetadata', loadedMetadataHandler);
    
    // Smooth progress update using requestAnimationFrame
    let animationFrameId = null;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 16; // ~60fps (16ms)
    
    const smoothProgressUpdate = () => {
        const now = performance.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            lastUpdateTime = now;
            
            if (elements.ttsAudio.duration && isFinite(elements.ttsAudio.duration)) {
                const currentTime = elements.ttsAudio.currentTime;
                const progress = (currentTime / elements.ttsAudio.duration) * 100;
                
                // Update progress bar (only if not dragging)
                if (elements.ttsProgress && !isDragging) {
                    elements.ttsProgress.value = progress || 0;
                }
                
                // Update time display
                if (elements.ttsCurrentTime) {
                    elements.ttsCurrentTime.textContent = formatTime(currentTime);
                }
                
                // Update waveform progress indicator (smooth updates)
                if (elements.ttsWaveform && !elements.ttsAudio.paused) {
                    const container = elements.ttsWaveform.closest('.audio-waveform-container');
                    if (container) {
                        updateWaveformProgress(
                            elements.ttsWaveform,
                            container,
                            currentTime,
                            elements.ttsAudio.duration
                        );
                    }
                }
            }
        }
        
        // Continue animation loop if audio is playing
        if (!elements.ttsAudio.paused && !elements.ttsAudio.ended) {
            animationFrameId = requestAnimationFrame(smoothProgressUpdate);
        }
    };
    
    const timeUpdateHandler = () => {
        // Use timeupdate as a fallback and to start the animation loop
        if (!animationFrameId && !elements.ttsAudio.paused) {
            animationFrameId = requestAnimationFrame(smoothProgressUpdate);
        }
    };
    elements.ttsAudio.addEventListener('timeupdate', timeUpdateHandler);
    
    // Start smooth updates when playing
    const playHandler = () => {
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.add('hidden');
        if (pauseIcon) pauseIcon.classList.remove('hidden');
        
        // Start smooth progress updates
        if (!animationFrameId) {
            animationFrameId = requestAnimationFrame(smoothProgressUpdate);
        }
    };
    
    // Stop smooth updates when pausing
    const pauseHandler = () => {
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
        
        // Stop animation loop
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        
        // Final update on pause
        if (elements.ttsWaveform && elements.ttsAudio.duration) {
            const container = elements.ttsWaveform.closest('.audio-waveform-container');
            if (container) {
                updateWaveformProgress(
                    elements.ttsWaveform,
                    container,
                    elements.ttsAudio.currentTime,
                    elements.ttsAudio.duration
                );
            }
        }
    };
    
    const endedHandler = () => {
        elements.ttsAudio.currentTime = 0;
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
        
        // Stop animation loop
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        
        // Reset progress
        if (elements.ttsWaveform && elements.ttsAudio.duration) {
            const container = elements.ttsWaveform.closest('.audio-waveform-container');
            if (container) {
                updateWaveformProgress(
                    elements.ttsWaveform,
                    container,
                    0,
                    elements.ttsAudio.duration
                );
            }
        }
    };
    
    elements.ttsAudio.addEventListener('play', playHandler);
    elements.ttsAudio.addEventListener('pause', pauseHandler);
    elements.ttsAudio.addEventListener('ended', endedHandler);
    
    // Cleanup function to cancel animation frame if needed
    if (elements.ttsAudio._cleanupAnimation) {
        elements.ttsAudio._cleanupAnimation();
    }
    elements.ttsAudio._cleanupAnimation = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    };
}

/**
 * Setup audio player with waveform
 */
export async function setupAudioPlayer(elements, base64Data) {
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
            elements.ttsSpeed.value = AUDIO.DEFAULT_SPEED.toString();
            elements.ttsAudio.playbackRate = AUDIO.DEFAULT_SPEED;
        }
        
        // Generate waveform - ensure canvas is visible first
        if (elements.ttsWaveform) {
            // Double-check canvas is visible and has dimensions
            const waveformContainer = elements.ttsWaveform.closest('.audio-waveform-container');
            if (waveformContainer && waveformContainer.offsetWidth === 0) {
                // Wait a bit more for layout to settle
                await new Promise(resolve => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(resolve);
                    });
                });
            }
            
            // Generate waveform
            await generateWaveform(audioBlob, elements.ttsWaveform);
            
            // Setup waveform interactivity (click to seek, hover tooltip)
            // Remove old listeners if they exist to prevent duplicates
            const canvas = elements.ttsWaveform;
            if (canvas._interactivitySetup) {
                // Clean up old listeners if any
                canvas._interactivitySetup = false;
            }
            setupWaveformInteractivity(elements.ttsWaveform, elements.ttsAudio);
            canvas._interactivitySetup = true;
        }
        
        // Auto-play audio after it's loaded
        const playAudio = () => {
            if (elements.ttsAudio.readyState >= 2) { // HAVE_CURRENT_DATA or higher
                elements.ttsAudio.play().catch(error => {
                    console.warn('[Audio] Autoplay prevented:', error);
                    // Autoplay was prevented by browser policy - user will need to click play
                });
            } else {
                elements.ttsAudio.addEventListener('canplay', () => {
                    elements.ttsAudio.play().catch(error => {
                        console.warn('[Audio] Autoplay prevented:', error);
                    });
                }, { once: true });
            }
        };
        
        playAudio();
        
        return audioBlob;
    } catch (error) {
        console.error('Audio Setup Error:', error);
        throw new Error('Failed to setup audio: ' + error.message);
    }
}

/**
 * Setup waveform interactivity (click to seek, hover tooltip)
 */
export function setupWaveformInteractivity(canvas, audioElement) {
    if (!canvas || !audioElement) return;
    
    const container = canvas.closest('.audio-waveform-container');
    if (!container) return;
    
    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'audio-waveform-tooltip';
    container.appendChild(tooltip);
    
    // Click to seek
    const clickHandler = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        
        if (audioElement.duration && isFinite(audioElement.duration)) {
            audioElement.currentTime = percent * audioElement.duration;
        }
    };
    canvas.addEventListener('click', clickHandler);
    container.addEventListener('click', clickHandler);
    
    // Hover to show time
    const hoverHandler = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        
        if (audioElement.duration && isFinite(audioElement.duration)) {
            const time = percent * audioElement.duration;
            tooltip.textContent = formatTime(time);
            tooltip.style.left = `${x}px`;
        }
    };
    canvas.addEventListener('mousemove', hoverHandler);
    container.addEventListener('mousemove', hoverHandler);
    
    // Hide tooltip on mouse leave
    const leaveHandler = () => {
        tooltip.style.opacity = '0';
    };
    canvas.addEventListener('mouseleave', leaveHandler);
    container.addEventListener('mouseleave', leaveHandler);
    
    // Show tooltip on mouse enter
    const enterHandler = () => {
        tooltip.style.opacity = '1';
    };
    canvas.addEventListener('mouseenter', enterHandler);
    container.addEventListener('mouseenter', enterHandler);
}

/**
 * Download audio file
 */
export function downloadAudio(audioBlob, filename) {
    if (!audioBlob) {
        throw new Error('No audio available to download');
    }
    
    const url = URL.createObjectURL(audioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `audio-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

