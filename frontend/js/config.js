// Configuration constants for the TTS application

export const CONFIG = {
    // API Configuration
    API_BASE: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:8085' 
        : `http://${window.location.hostname}:8085`,
    WS_BASE: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'ws://localhost:8085'
        : `ws://${window.location.hostname}:8085`,
    
    // Streaming Configuration
    STREAMING: {
        MAX_AUDIO_SAMPLES: 10_000_000, // ~7.5 minutes at 22kHz (safety limit)
        MAX_MEL_FRAMES: 50000, // Limit mel frames accumulation
        RECONNECT_ATTEMPTS: 3,
        RECONNECT_DELAY: 1000, // ms
        DEFAULT_SAMPLE_RATE: 22050,
        FRAME_WIDTH: 2, // pixels per frame in spectrogram
    },
    
    // VAD Configuration
    VAD: {
        ENABLED: true,
        SILENCE_THRESHOLD: 30, // Audio level threshold (0-255)
        SILENCE_DURATION: 1500, // Milliseconds of silence before auto-stop
        CHECK_INTERVAL: 100, // How often to check audio levels (ms)
        MIN_RECORDING_DURATION: 500, // Minimum recording duration before VAD can trigger (ms)
    },
    
    // Audio Configuration
    AUDIO: {
        DEFAULT_SPEED: 1.0,
        MIN_SPEED: 0.5,
        MAX_SPEED: 2.0,
        SPEED_STEP: 0.25,
    },
    
    // Request Configuration
    REQUEST: {
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000, // ms
        TIMEOUT: 60000, // 60 seconds
        LLM_TIMEOUT: 180000, // 3 minutes for LLM
        TTS_TIMEOUT: 120000, // 2 minutes for TTS
    },
    
    // UI Configuration
    UI: {
        TOAST_DURATION: 5000, // ms
        ANIMATION_DURATION: 300, // ms
    },
};

// Language mappings
export const LANGUAGE_NAMES = {
    'de_DE': 'German (Germany)',
    'fr_FR': 'French (France)',
    'en_US': 'English (US)',
    'en_GB': 'English (UK)',
    'es_ES': 'Spanish (Spain)',
    'it_IT': 'Italian (Italy)',
    'pt_PT': 'Portuguese (Portugal)',
    'nl_NL': 'Dutch (Netherlands)'
};

export const TTS_TO_SPEECH_LANG = {
    'de_DE': 'de-DE',
    'fr_FR': 'fr-FR',
    'en_US': 'en-US',
    'en_GB': 'en-GB',
    'es_ES': 'es-ES',
    'it_IT': 'it-IT',
    'pt_PT': 'pt-PT',
    'nl_NL': 'nl-NL'
};
