// API service for HTTP requests

import { CONFIG } from '../config.js';

// Ensure CONFIG is available
if (!CONFIG) {
    console.error('[API Service] CONFIG is not available!');
    throw new Error('CONFIG is not available');
}

const { REQUEST } = CONFIG;

// Request deduplication cache
const pendingRequests = new Map();

// Response cache with TTL
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(url, options = {}) {
    const method = options.method || 'GET';
    const body = options.body || '';
    return `${method}:${url}:${body}`;
}

function isCacheable(method, url) {
    // Only cache GET requests for static data
    if (method !== 'GET') return false;
    // Cache voices endpoints
    return url.includes('/voices') || url.includes('/health');
}

async function getCachedResponse(cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL) {
        responseCache.delete(cacheKey);
        return null;
    }
    
    // Recreate response from cached data
    return new Response(cached.data, {
        status: cached.status,
        statusText: cached.statusText,
        headers: cached.headers
    });
}

async function setCachedResponse(cacheKey, response) {
    // Clone response data before caching
    const data = await response.clone().arrayBuffer();
    const headers = {};
    response.headers.forEach((value, key) => {
        headers[key] = value;
    });
    
    responseCache.set(cacheKey, {
        data: data,
        status: response.status,
        statusText: response.statusText,
        headers: headers,
        timestamp: Date.now()
    });
}

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
        const apiBase = getApiBase();
        console.log('[API Service] Initialized with:', {
            API_BASE: apiBase,
            REQUEST_TIMEOUT: REQUEST?.TIMEOUT,
            REQUEST_TTS_TIMEOUT: REQUEST?.TTS_TIMEOUT,
            windowLocation: typeof window !== 'undefined' ? window.location.href : 'N/A',
            hostname: typeof window !== 'undefined' ? window.location.hostname : 'N/A',
            port: typeof window !== 'undefined' ? window.location.port : 'N/A'
        });
        configLogged = true;
    }
}


async function fetchWithErrorHandling(url, options = {}) {
    const method = options.method || 'GET';
    const cacheKey = getCacheKey(url, options);
    
    // Check cache for GET requests
    if (isCacheable(method, url)) {
        const cached = await getCachedResponse(cacheKey);
        if (cached) {
            return cached;
        }
    }
    
    // Check for duplicate pending requests
    if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey);
    }
    
    // Create request promise
    const requestPromise = (async () => {
        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => {
                    // Try to get text if JSON fails
                    return response.text().then(text => ({ error: text || `HTTP ${response.status}` }));
                });
                const errorMsg = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
                console.error('[API] Request failed:', { url, status: response.status, error: errorMsg });
                throw new Error(errorMsg);
            }
            
            // Cache successful GET responses (don't await to avoid blocking)
            if (isCacheable(method, url)) {
                // Clone response before caching so we can still return the original
                const responseClone = response.clone();
                setCachedResponse(cacheKey, responseClone).catch(err => {
                    console.warn('[API] Failed to cache response:', err);
                });
            }
            
            return response;
        } catch (error) {
            console.error('[API] Fetch error:', {
                url,
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // Handle specific error types
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                throw new Error('Request timed out. Please try again.');
            } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                const apiBase = getApiBase();
                throw new Error(`Cannot connect to server at ${apiBase}. Is the server running? Check browser console for CORS errors.`);
            }
            throw error;
        } finally {
            // Remove from pending requests
            pendingRequests.delete(cacheKey);
        }
    })();
    
    // Store pending request
    pendingRequests.set(cacheKey, requestPromise);
    
    return requestPromise;
}


export async function checkServerHealth() {
    logApiConfig();
    const apiBase = getApiBase();
    const url = `${apiBase}/health`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/plain',
            },
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'No error details');
            console.error('[API] Health check failed:', {
                status: response.status,
                statusText: response.statusText,
                errorText,
                url
            });
            throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        }
        
        const text = await response.text();
        return text;
    } catch (error) {
        console.error('[API] Health check error:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            url,
            apiBase,
            errorType: error.constructor.name
        });
        
        // Handle network errors specifically
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            const detailedError = `Cannot connect to server at ${apiBase}. ` +
                `Error: ${error.message}. ` +
                `Please check: 1) Server is running, 2) CORS is configured, 3) URL is correct.`;
            console.error('[API] Connection error details:', {
                apiBase,
                url,
                originalError: error.message,
                suggestion: 'Check browser console for CORS errors'
            });
            throw new Error(detailedError);
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
 * @param {string} text - Text to synthesize
 * @param {string} language - Language code (e.g., "en_US")
 * @param {number|null} speaker - Speaker ID (legacy, optional)
 * @param {string|null} voice - Voice ID (e.g., "norman") or full key (e.g., "en_US:norman")
 */
export async function generateTTS(text, language, speaker = null, voice = null) {
    const requestBody = { text, language };
    
    // Support both new voice parameter and legacy speaker parameter
    if (voice !== null && voice !== undefined) {
        // If voice contains ":", it's a full key, extract just the voice part
        if (voice.includes(':')) {
            const [, voiceId] = voice.split(':', 2);
            requestBody.voice = voiceId;
        } else {
            requestBody.voice = voice;
        }
    } else if (speaker !== null && speaker !== undefined) {
        // Legacy support
        requestBody.speaker = speaker;
    }
    
    const response = await fetchWithErrorHandling(`${getApiBase()}/tts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST.TTS_TIMEOUT)
    });
    
    const data = await response.json();
    
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
 * Get server metrics
 */
export async function getServerMetrics() {
    const response = await fetchWithErrorHandling(`${getApiBase()}/metrics`);
    return await response.json();
}

