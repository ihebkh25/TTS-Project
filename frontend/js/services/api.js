// API service for HTTP requests

import { CONFIG } from '../config.js';

// Ensure CONFIG is available
if (!CONFIG) {
    console.error('[API Service] CONFIG is not available!');
    throw new Error('CONFIG is not available');
}

const { REQUEST } = CONFIG;

// Get API_BASE lazily (will be computed when first accessed)
function getApiBase() {
    try {
        return CONFIG.API_BASE;
    } catch (error) {
        console.error('[API Service] Error getting API_BASE:', error);
        return 'http://localhost:8085'; // Fallback
    }
}

// Log API configuration on first use (not at module load)
let configLogged = false;
function logApiConfig() {
    if (!configLogged) {
        console.log('[API Service] Initialized with:', {
            API_BASE: getApiBase(),
            REQUEST_TIMEOUT: REQUEST?.TIMEOUT,
            REQUEST_LLM_TIMEOUT: REQUEST?.LLM_TIMEOUT,
            REQUEST_TTS_TIMEOUT: REQUEST?.TTS_TIMEOUT
        });
        configLogged = true;
    }
}


async function fetchWithErrorHandling(url, options = {}) {
    try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
    } catch (error) {
        // Handle specific error types
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            throw new Error('Request timed out. Please try again.');
        } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
            throw new Error('Network error. Please check your connection and try again.');
        }
        throw error;
    }
}


export async function checkServerHealth() {
    logApiConfig();
    const url = `${getApiBase()}/health`;
    console.log('[API] Checking server health at:', url);
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/plain',
            },
        });
        
        console.log('[API] Health check response:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries())
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'No error details');
            console.error('[API] Health check failed:', {
                status: response.status,
                statusText: response.statusText,
                errorText
            });
            throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        }
        
        const text = await response.text();
        console.log('[API] Health check successful:', text);
        return text;
    } catch (error) {
        console.error('[API] Health check error:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            url
        });
        
        // Handle network errors specifically
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            throw new Error(`Cannot connect to server at ${getApiBase()}. Is the server running?`);
        }
        throw error;
    }
}


export async function getVoices() {
    const response = await fetchWithErrorHandling(`${getApiBase()}/voices`);
    return await response.json();
}

/**
 * Get detailed voice information
 */
export async function getVoiceDetails() {
    const response = await fetchWithErrorHandling(`${getApiBase()}/voices/detail`);
    return await response.json();
}

/**
 * Generate TTS audio
 */
export async function generateTTS(text, language, speaker = null) {
    const requestBody = { text, language };
    if (speaker !== null) {
        requestBody.speaker = speaker;
    }
    
    console.log('[API] Generating TTS:', { 
        textLength: text.length, 
        language, 
        speaker,
        url: `${getApiBase()}/tts`
    });
    
    const response = await fetchWithErrorHandling(`${getApiBase()}/tts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST.TTS_TIMEOUT)
    });
    
    const data = await response.json();
    console.log('[API] TTS Response:', {
        hasAudio: !!data.audio_base64,
        audioLength: data.audio_base64?.length || 0,
        duration: data.duration_ms,
        sampleRate: data.sample_rate,
        keys: Object.keys(data)
    });
    
    // Validate response structure
    if (!data.audio_base64) {
        throw new Error('Invalid response: missing audio_base64 field');
    }
    if (typeof data.duration_ms !== 'number') {
        console.warn('[API] TTS response missing or invalid duration_ms');
    }
    if (typeof data.sample_rate !== 'number') {
        console.warn('[API] TTS response missing or invalid sample_rate');
    }
    
    return data;
}

/**
 * Send chat message
 */
export async function sendChatMessage(message, conversationId = null) {
    const requestBody = { message };
    if (conversationId) {
        requestBody.conversation_id = conversationId;
    }
    
    const response = await fetchWithErrorHandling(`${getApiBase()}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST.LLM_TIMEOUT)
    });
    
    return await response.json();
}

/**
 * Send voice chat message (with audio response)
 */
export async function sendVoiceChatMessage(message, language, conversationId = null) {
    const requestBody = { message, language };
    if (conversationId) {
        requestBody.conversation_id = conversationId;
    }
    
    const response = await fetchWithErrorHandling(`${getApiBase()}/voice-chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST.LLM_TIMEOUT)
    });
    
    return await response.json();
}

/**
 * Get server metrics
 */
export async function getServerMetrics() {
    const response = await fetchWithErrorHandling(`${getApiBase()}/metrics`);
    return await response.json();
}

