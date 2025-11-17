// Configuration constants for the TTS application

/**
 * Get the base URL for API requests
 * Handles localhost, Docker, and production environments
 */
function getApiBase() {
    try {
        // Ensure window.location is available
        if (typeof window === 'undefined' || !window.location) {
            console.error('[Config] window.location is not available');
            // Fallback for server-side rendering or testing
            return 'http://localhost:8085';
        }
        
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const port = window.location.port;
        
        // Backend API port (different from frontend port)
        const API_PORT = '8085';
        
        // Debug logging
        console.log('[Config] Determining API base URL:', {
            hostname,
            protocol,
            port,
            fullLocation: window.location.href
        });
        
        // Check if we're accessing via Docker (common Docker hostnames)
        // In Docker, frontend and backend are on same host but different ports
        const isDocker = hostname === 'localhost' || 
                         hostname === '127.0.0.1' || 
                         hostname === '' ||
                         hostname.includes('.local') ||
                         port === '8082'; // Frontend nginx port
        
        let apiBase;
        if (isDocker) {
            // Development/Docker: backend is on same host, different port
            apiBase = `${protocol}//${hostname}:${API_PORT}`;
        } else {
            // Production: use same protocol and hostname, but backend port (8085)
            apiBase = `${protocol}//${hostname}:${API_PORT}`;
        }
        
        // Validate the URL
        if (!apiBase || apiBase.includes('undefined') || apiBase.includes('null')) {
            console.error('[Config] Invalid API base URL computed:', apiBase);
            return 'http://localhost:8085'; // Fallback
        }
        
        console.log('[Config] API Base URL:', apiBase);
        return apiBase;
    } catch (error) {
        console.error('[Config] Error computing API base URL:', error);
        return 'http://localhost:8085'; // Fallback
    }
}

/**
 * Get the WebSocket base URL
 * Automatically uses ws:// or wss:// based on current protocol
 */
function getWebSocketBase() {
    try {
        const apiBase = getApiBase();
        // Replace http:// with ws:// or https:// with wss://
        const wsBase = apiBase.replace(/^http/, 'ws');
        console.log('[Config] WebSocket Base URL:', wsBase);
        return wsBase;
    } catch (error) {
        console.error('[Config] Error computing WebSocket base URL:', error);
        return 'ws://localhost:8085'; // Fallback
    }
}

// Lazy initialization to ensure window.location is available
let _apiBase = null;
let _wsBase = null;

function getApiBaseLazy() {
    try {
        // Always recompute if window.location is now available (for dynamic environments)
        // But cache the result to avoid repeated computation
        if (!_apiBase || (typeof window !== 'undefined' && window.location)) {
            const computed = getApiBase();
            if (computed && !computed.includes('undefined') && !computed.includes('null')) {
                _apiBase = computed;
            } else if (!_apiBase) {
                // Only use fallback if we don't have a cached value
                _apiBase = 'http://localhost:8085';
            }
        }
        return _apiBase || 'http://localhost:8085';
    } catch (error) {
        console.error('[Config] Error in getApiBaseLazy:', error);
        return _apiBase || 'http://localhost:8085'; // Fallback
    }
}

function getWebSocketBaseLazy() {
    try {
        if (!_wsBase) {
            _wsBase = getWebSocketBase();
        }
        return _wsBase;
    } catch (error) {
        console.error('[Config] Error in getWebSocketBaseLazy:', error);
        return 'ws://localhost:8085'; // Fallback
    }
}

export const CONFIG = {
    // API Configuration (lazy getters)
    get API_BASE() { return getApiBaseLazy(); },
    get WS_BASE() { return getWebSocketBaseLazy(); },
    
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
        SILENCE_DURATION: 1500, // Milliseconds of silence before auto-send (ms)
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
    'nl_NL': 'Dutch (Netherlands)',
    'uk_UA': 'Ukrainian (Ukraine)'
};

export const TTS_TO_SPEECH_LANG = {
    'de_DE': 'de-DE',
    'fr_FR': 'fr-FR',
    'en_US': 'en-US',
    'en_GB': 'en-GB',
    'es_ES': 'es-ES',
    'it_IT': 'it-IT',
    'pt_PT': 'pt-PT',
    'nl_NL': 'nl-NL',
    'uk_UA': 'uk-UA'
};
