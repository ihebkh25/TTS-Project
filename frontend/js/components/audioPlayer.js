// Custom audio player component

import { CONFIG } from '../config.js';
import { formatTime } from '../utils/format.js';
import { base64ToBlob, generateWaveform } from '../utils/audio.js';

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
    
    const timeUpdateHandler = () => {
        if (elements.ttsProgress && !isDragging) {
            const progress = (elements.ttsAudio.currentTime / elements.ttsAudio.duration) * 100;
            elements.ttsProgress.value = progress || 0;
        }
        if (elements.ttsCurrentTime) {
            elements.ttsCurrentTime.textContent = formatTime(elements.ttsAudio.currentTime);
        }
    };
    elements.ttsAudio.addEventListener('timeupdate', timeUpdateHandler);
    
    const playHandler = () => {
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.add('hidden');
        if (pauseIcon) pauseIcon.classList.remove('hidden');
    };
    elements.ttsAudio.addEventListener('play', playHandler);
    
    const pauseHandler = () => {
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
    };
    elements.ttsAudio.addEventListener('pause', pauseHandler);
    
    const endedHandler = () => {
        elements.ttsAudio.currentTime = 0;
        const playIcon = elements.ttsPlayPause.querySelector('.play-icon');
        const pauseIcon = elements.ttsPlayPause.querySelector('.pause-icon');
        if (playIcon) playIcon.classList.remove('hidden');
        if (pauseIcon) pauseIcon.classList.add('hidden');
    };
    elements.ttsAudio.addEventListener('ended', endedHandler);
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
        
        // Generate waveform
        if (elements.ttsWaveform) {
            await generateWaveform(audioBlob, elements.ttsWaveform);
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

