// Main entry point for the TTS application

import { initElements } from './utils/dom.js';
import { setupTabs } from './utils/tabs.js';
import { populateLanguageSelects } from './utils/voices.js';
import { showToast } from './utils/toast.js';
import { showStatus, updateServerStatus } from './utils/dom.js';
import { setupCustomAudioPlayer, downloadAudio } from './components/audioPlayer.js';
import { scrollChatToBottom } from './components/chat.js';
import { getVoices, getVoiceDetails, checkServerHealth } from './services/api.js';
import { initTtsTab } from './tabs/tts.js';
import { initStreamTab } from './tabs/stream.js';
import { initChatTab } from './tabs/chat.js';
import { initServerTab } from './tabs/server.js';

// Global state
let elements = {};
let voices = [];
let voiceDetails = [];
let currentAudioBlob = null;
let currentStreamAudioBlob = null;
let currentConversationId = null;
let isStreaming = false;
let currentWebSocket = null;
const initializedTabs = new Set(); // Track initialized tabs

// State management functions
function setCurrentAudioBlob(blob) {
    currentAudioBlob = blob;
}

function setCurrentStreamAudioBlob(blob) {
    currentStreamAudioBlob = blob;
}

function setCurrentConversationId(id) {
    currentConversationId = id;
}

// Initialize the application
async function init() {
    try {
        // Show loading indicator
        const loadingIndicator = document.getElementById('loadingIndicator');
        const loadingStatus = document.getElementById('loadingStatus');
        const appContainer = document.getElementById('appContainer');
        
        function updateLoadingStatus(text) {
            if (loadingStatus) loadingStatus.textContent = text;
            console.log('[Main]', text);
        }
        
        updateLoadingStatus('Starting initialization...');
        console.log('[Main] TTS Project Frontend Initializing...');
        console.log('[Main] Window location:', {
            href: window.location.href,
            hostname: window.location.hostname,
            port: window.location.port,
            protocol: window.location.protocol
        });
        
        updateLoadingStatus('Initializing DOM elements...');
        // Initialize DOM elements
        elements = initElements();
        console.log('[Main] DOM elements initialized:', Object.keys(elements).length, 'elements');
        
        updateLoadingStatus('Setting up tabs...');
        // Set up tabs (this will load tab HTML files)
        await setupTabs(async (tabName, tabContent) => {
            // Re-initialize elements after tab content is loaded
            elements = initElements();
            
            // Only initialize if not already initialized
            if (initializedTabs.has(tabName)) {
                return;
            }
            
            if (tabName === 'chat') {
                // Initialize chat tab
                const chatState = {
                    get currentConversationId() { return currentConversationId; },
                    set currentConversationId(value) { currentConversationId = value; },
                    setCurrentConversationId
                };
                initChatTab(elements, chatState);
                initializedTabs.add(tabName);
                setTimeout(() => {
                    scrollChatToBottom(elements.chatMessages);
                }, 100);
            }
            if (tabName === 'server') {
                // Initialize server tab
                initServerTab(elements);
                initializedTabs.add(tabName);
            }
            if (tabName === 'tts') {
                // Initialize TTS tab
                const ttsState = {
                    setCurrentAudioBlob,
                    voiceDetails
                };
                initTtsTab(elements, ttsState);
                setupCustomAudioPlayer(elements);
                initializedTabs.add(tabName);
            }
            if (tabName === 'stream') {
                // Initialize stream tab
                const streamState = {
                    get isStreaming() { return isStreaming; },
                    set isStreaming(value) { isStreaming = value; },
                    get currentWebSocket() { return currentWebSocket; },
                    set currentWebSocket(value) { currentWebSocket = value; },
                    setCurrentStreamAudioBlob
                };
                initStreamTab(elements, streamState);
                initializedTabs.add(tabName);
            }
        });
        
        updateLoadingStatus('Checking server status...');
        // Check server status on load
        await checkServerStatus();
        
        updateLoadingStatus('Loading voices...');
        // Load voices dynamically (must be before tab initialization for voiceDetails)
        await loadVoices();
        
        // Initialize initial tab (tts) after tabs are loaded
        // Re-initialize elements after tab content is loaded
        elements = initElements();
        
        // Set up custom audio player
        setupCustomAudioPlayer(elements);
        
        // Initialize initial tab modules (tts is loaded by default)
        const ttsState = {
            setCurrentAudioBlob,
            voiceDetails
        };
        initTtsTab(elements, ttsState);
        
        updateLoadingStatus('Setting up handlers...');
        // Set up download button handlers
        setupDownloadHandlers();
        
        // Hide loading indicator and show app
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
        
        console.log('[Main] Frontend initialized successfully');
        updateLoadingStatus('Ready!');
    } catch (error) {
        console.error('[Main] Initialization error:', error);
        console.error('[Main] Error stack:', error.stack);
        console.error('[Main] Error name:', error.name);
        console.error('[Main] Error message:', error.message);
        
        // Try to update status if elements are available
        try {
            if (elements && elements.serverStatus) {
                updateServerStatus(elements.serverStatus, 'disconnected', 'Initialization Failed');
            }
        } catch (e) {
            console.error('[Main] Failed to update server status:', e);
        }
        
        // Try to show toast, but don't fail if it doesn't work
        try {
            if (typeof showToast === 'function') {
                showToast('error', `Initialization failed: ${error.message}`);
            } else {
                alert(`Initialization failed: ${error.message}\n\nCheck console for details.`);
            }
        } catch (e) {
            console.error('[Main] Failed to show toast:', e);
            alert(`Initialization failed: ${error.message}\n\nCheck console for details.`);
        }
    }
}

// Load voices from API
async function loadVoices() {
    try {
        voices = await getVoices();
        
        // Populate language selects
        const selects = [elements.ttsLanguage, elements.streamLanguage, elements.voiceModeLanguage].filter(Boolean);
        populateLanguageSelects(selects, voices);
        
        // Load voice details
        voiceDetails = await getVoiceDetails();
        
    } catch (error) {
        console.error('Error loading voices:', error);
        showStatus(elements.serverInfo, 'error', `Failed to load voices: ${error.message}`);
    }
}

// Set up download button handlers
function setupDownloadHandlers() {
    // TTS download button
    if (elements.downloadTtsBtn) {
        elements.downloadTtsBtn.addEventListener('click', () => {
            try {
                if (currentAudioBlob) {
                    downloadAudio(currentAudioBlob, `tts-${Date.now()}.wav`);
                    showStatus(elements.ttsStatus, 'success', 'Audio downloaded!');
                    showToast('success', 'Audio downloaded successfully!');
                } else {
                    showStatus(elements.ttsStatus, 'error', 'No audio to download');
                }
            } catch (error) {
                showStatus(elements.ttsStatus, 'error', error.message);
            }
        });
    }
    
    // Stream download button
    if (elements.streamDownloadBtn) {
        elements.streamDownloadBtn.addEventListener('click', () => {
            try {
                if (currentStreamAudioBlob) {
                    downloadAudio(currentStreamAudioBlob, `stream-${Date.now()}.wav`);
                    showStatus(elements.streamStatus, 'success', 'Audio downloaded!');
                    showToast('success', 'Streaming audio downloaded successfully!');
                } else {
                    showStatus(elements.streamStatus, 'error', 'No audio to download');
                }
            } catch (error) {
                showStatus(elements.streamStatus, 'error', error.message);
            }
        });
    }
}

// Server Status Functions (called from main init)
async function checkServerStatus() {
    console.log('[Main] Checking server status...');
    try {
        const healthResponse = await checkServerHealth();
        console.log('[Main] Server health check passed:', healthResponse);
        if (elements.serverStatus) {
            updateServerStatus(elements.serverStatus, 'connected', 'Server Connected');
        }
        // Only show toast if elements are initialized
        if (elements && elements.toastContainer) {
            showToast('success', 'Server connected');
        }
    } catch (error) {
        console.error('[Main] Server Status Error:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        if (elements.serverStatus) {
            updateServerStatus(elements.serverStatus, 'disconnected', 'Server Disconnected');
        }
        // Only show toast if elements are initialized
        if (elements && elements.toastContainer) {
            showToast('error', `Server connection failed: ${error.message}`);
        } else {
            console.error('Server connection failed:', error.message);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

