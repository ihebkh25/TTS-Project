// Voice recognition service

import { CONFIG } from '../config.js';
import { ttsLangToSpeechLang } from '../utils/format.js';

const { VAD } = CONFIG;

/**
 * Check if speech recognition is supported
 */
export function isSpeechRecognitionSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

/**
 * Get SpeechRecognition constructor
 */
export function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
}

/**
 * Create a speech recognition instance
 */
export function createSpeechRecognition(options = {}) {
    if (!isSpeechRecognitionSupported()) {
        throw new Error('Speech recognition not supported');
    }
    
    const SpeechRecognition = getSpeechRecognition();
    const recognition = new SpeechRecognition();
    
    recognition.continuous = options.continuous ?? false;
    recognition.interimResults = options.interimResults ?? true;
    recognition.lang = options.lang || 'en-US';
    recognition.maxAlternatives = options.maxAlternatives || 1;
    
    return recognition;
}

/**
 * Calculate audio level from analyser node (for VAD)
 */
export function calculateAudioLevel(analyser, dataArray) {
    if (!analyser || !dataArray) return 0;
    
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate RMS (Root Mean Square) for better voice detection
    let sum = 0;
    let count = 0;
    
    // Focus on speech frequency range (roughly 300-3400 Hz)
    const speechStartBin = 3;
    const speechEndBin = Math.min(40, dataArray.length);
    
    for (let i = speechStartBin; i < speechEndBin; i++) {
        sum += dataArray[i] * dataArray[i]; // Square for RMS
        count++;
    }
    
    const rms = Math.sqrt(sum / count);
    return rms;
}

/**
 * Create VAD (Voice Activity Detection) checker
 */
export function createVADChecker(analyser, dataArray, callbacks) {
    let vadState = {
        lastVoiceTime: null,
        silenceStartTime: null,
        isVoiceDetected: false,
        vadCheckInterval: null,
        recordingStartTime: null,
    };
    
    function checkVoiceActivity() {
        if (!callbacks.isRecording?.() || !VAD.ENABLED) return;
        
        const audioLevel = calculateAudioLevel(analyser, dataArray);
        const now = Date.now();
        const recordingDuration = now - vadState.recordingStartTime;
        
        const hasVoice = audioLevel > VAD.SILENCE_THRESHOLD;
        
        if (hasVoice) {
            vadState.isVoiceDetected = true;
            vadState.lastVoiceTime = now;
            vadState.silenceStartTime = null;
            callbacks.onVoiceDetected?.(audioLevel);
        } else {
            if (vadState.isVoiceDetected) {
                if (!vadState.silenceStartTime) {
                    vadState.silenceStartTime = now;
                }
                
                const silenceDuration = now - vadState.silenceStartTime;
                
                if (recordingDuration >= VAD.MIN_RECORDING_DURATION && 
                    silenceDuration >= VAD.SILENCE_DURATION) {
                    callbacks.onSilenceDetected?.(silenceDuration, audioLevel);
                    stopVAD();
                } else if (silenceDuration > VAD.SILENCE_DURATION * 0.5) {
                    callbacks.onSilenceWarning?.(silenceDuration);
                }
            }
        }
    }
    
    function startVAD() {
        if (!VAD.ENABLED || vadState.vadCheckInterval) return;
        
        vadState.recordingStartTime = Date.now();
        vadState.lastVoiceTime = null;
        vadState.silenceStartTime = null;
        vadState.isVoiceDetected = false;
        
        vadState.vadCheckInterval = setInterval(() => {
            checkVoiceActivity();
        }, VAD.CHECK_INTERVAL);
    }
    
    function stopVAD() {
        if (vadState.vadCheckInterval) {
            clearInterval(vadState.vadCheckInterval);
            vadState.vadCheckInterval = null;
        }
        vadState.isVoiceDetected = false;
        vadState.silenceStartTime = null;
    }
    
    return {
        start: startVAD,
        stop: stopVAD,
        getState: () => ({ ...vadState })
    };
}

/**
 * Request microphone access with error handling
 */
export async function requestMicrophoneAccess(callbacks = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const error = new Error('Microphone access is not supported in this browser.');
        callbacks.onError?.(error);
        return null;
    }
    
    // Check permissions API if available
    if (navigator.permissions) {
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            
            if (permissionStatus.state === 'denied') {
                const error = new Error('Microphone permission denied');
                callbacks.onError?.(error);
                return null;
            }
            
            permissionStatus.onchange = () => {
                if (permissionStatus.state === 'granted') {
                    callbacks.onPermissionGranted?.();
                }
            };
        } catch (err) {
            console.log('Permissions API not fully supported:', err);
        }
    }
    
    try {
        // Try with full constraints first
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
        } catch (err) {
            // Fallback to basic audio
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (err2) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: {} });
            }
        }
        
        callbacks.onSuccess?.(stream);
        return stream;
    } catch (err) {
        callbacks.onError?.(err);
        return null;
    }
}

