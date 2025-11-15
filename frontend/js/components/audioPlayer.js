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
    
    // Play/Pause button
    elements.ttsPlayPause.addEventListener('click', () => {
        if (elements.ttsAudio.paused) {
            elements.ttsAudio.play();
        } else {
            elements.ttsAudio.pause();
        }
    });
    
    // Progress bar - handle both input (while dragging) and change (on release)
    let isDragging = false;
    
    elements.ttsProgress.addEventListener('input', (e) => {
        isDragging = true;
        const time = (e.target.value / 100) * elements.ttsAudio.duration;
        if (!isNaN(time) && isFinite(time)) {
            elements.ttsAudio.currentTime = time;
        }
    });
    
    elements.ttsProgress.addEventListener('change', (e) => {
        isDragging = false;
        const time = (e.target.value / 100) * elements.ttsAudio.duration;
        if (!isNaN(time) && isFinite(time)) {
            elements.ttsAudio.currentTime = time;
        }
    });
    
    // Speed control
    if (elements.ttsSpeed) {
        elements.ttsSpeed.addEventListener('change', (e) => {
            const speed = parseFloat(e.target.value);
            if (elements.ttsAudio) {
                elements.ttsAudio.playbackRate = speed;
            }
        });
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

