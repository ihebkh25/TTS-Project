// Main entry point for the TTS application

import { initElements } from './utils/dom.js';
import { setupTabs } from './utils/tabs.js';
import { populateLanguageSelects } from './utils/voices.js';
import { showToast } from './utils/toast.js';
import { updateServerStatus } from './utils/dom.js';
import { setupCustomAudioPlayer, downloadAudio } from './components/audioPlayer.js';
import { scrollChatToBottom } from './components/chat.js';
import { getVoices, getVoiceDetails, checkServerHealth } from './services/api.js';
import { initTtsTab } from './tabs/tts.js';
import { initStreamTab } from './tabs/stream.js';
import { initChatTab } from './tabs/chat.js';
import { initServerTab } from './tabs/server.js';
import { initVoiceChatTab } from './tabs/voice-chat.js';

// Global state
let elements = {};
let voices = []; // Simple language codes list (for voiceModeLanguage in chat tab)
let voiceDetails = []; // Full voice details (for TTS, Stream, Voice-chat tabs)
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
            // Use requestAnimationFrame to ensure DOM is ready
            await new Promise(resolve => requestAnimationFrame(resolve));
            elements = initElements();
            
            // Cleanup server tab when switching away from it
            const previousTab = document.querySelector('.tab-content.active[data-tab]');
            if (previousTab && previousTab.getAttribute('data-tab') === 'server' && tabName !== 'server' && window.serverTabCleanup) {
                window.serverTabCleanup();
                window.serverTabCleanup = null;
            }
            
            // Only initialize if not already initialized
            if (initializedTabs.has(tabName)) {
                // Populate voiceModeLanguage for chat tab if needed
                if (tabName === 'chat') {
                    populateVoiceModeLanguage();
                }
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
                // Populate voiceModeLanguage for dictating mode
                populateVoiceModeLanguage();
                initializedTabs.add(tabName);
                setTimeout(() => {
                    scrollChatToBottom(elements.chatMessages);
                }, 100);
            }
            if (tabName === 'voice-chat') {
                // Initialize voice chat tab
                const voiceState = {
                    get currentConversationId() { return currentConversationId; },
                    set currentConversationId(value) { currentConversationId = value; },
                    setCurrentConversationId,
                    voiceDetails
                };
                const voiceChatTab = initVoiceChatTab(elements, voiceState);
                // Populate voice dropdown for voice-chat tab
                if (voiceChatTab && voiceChatTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
                    voiceChatTab.populateVoiceDropdown();
                }
                initializedTabs.add(tabName);
            }
            
            if (tabName === 'server') {
                // Initialize server tab
                const serverTab = initServerTab(elements);
                // Store cleanup function for when tab changes
                if (serverTab && serverTab.cleanup) {
                    window.serverTabCleanup = serverTab.cleanup;
                }
                initializedTabs.add(tabName);
            }
            if (tabName === 'tts') {
                // Initialize TTS tab
                const ttsState = {
                    setCurrentAudioBlob,
                    voiceDetails
                };
                const ttsTab = initTtsTab(elements, ttsState);
                setupCustomAudioPlayer(elements);
                // Populate voice dropdown for TTS tab
                if (ttsTab && ttsTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
                    ttsTab.populateVoiceDropdown();
                }
                initializedTabs.add(tabName);
            }
            if (tabName === 'stream') {
                // Initialize stream tab
                const streamState = {
                    get isStreaming() { return isStreaming; },
                    set isStreaming(value) { isStreaming = value; },
                    get currentWebSocket() { return currentWebSocket; },
                    set currentWebSocket(value) { currentWebSocket = value; },
                    setCurrentStreamAudioBlob,
                    voiceDetails
                };
                const streamTab = initStreamTab(elements, streamState);
                // Populate voice dropdown for stream tab
                if (streamTab && streamTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
                    streamTab.populateVoiceDropdown();
                }
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
        
        // Populate voiceModeLanguage for chat tab if available
        populateVoiceModeLanguage();
        
        // Set up custom audio player
        setupCustomAudioPlayer(elements);
        
        // Initialize initial tab modules (tts is loaded by default)
        const ttsState = {
            setCurrentAudioBlob,
            voiceDetails
        };
        const ttsTab = initTtsTab(elements, ttsState);
        // Populate voice dropdown if voiceDetails are available
        if (ttsTab && ttsTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
            ttsTab.populateVoiceDropdown();
        }
        
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

// Populate voiceModeLanguage select (used only in chat tab for dictating mode)
function populateVoiceModeLanguage() {
    if (!voices || voices.length === 0) {
        return; // Silently return if voices not loaded yet
    }
    
    const currentElements = initElements();
    const voiceModeLanguage = currentElements.voiceModeLanguage;
    
    if (voiceModeLanguage) {
        populateLanguageSelects([voiceModeLanguage], voices);
    }
}

// Load voices from API
async function loadVoices() {
    try {
        voices = await getVoices();
        
        // Load voice details
        voiceDetails = await getVoiceDetails();
        
    } catch (error) {
        console.error('Error loading voices:', error);
        showToast('error', `Failed to load voices: ${error.message}`);
    }
}

// Set up download button handlers
function setupDownloadHandlers() {
    // TTS download button
    if (elements.ttsDownloadBtn) {
        elements.ttsDownloadBtn.addEventListener('click', () => {
            try {
                if (currentAudioBlob) {
                    downloadAudio(currentAudioBlob, `tts-${Date.now()}.wav`);
                    showToast('success', 'Audio downloaded successfully!');
                } else {
                    showToast('error', 'No audio to download');
                }
            } catch (error) {
                showToast('error', `Download failed: ${error.message}`);
            }
        });
    }
    
    // Stream download button
    if (elements.streamDownloadBtn) {
        elements.streamDownloadBtn.addEventListener('click', () => {
            try {
                if (currentStreamAudioBlob) {
                    downloadAudio(currentStreamAudioBlob, `stream-${Date.now()}.wav`);
                    showToast('success', 'Streaming audio downloaded successfully!');
                } else {
                    showToast('error', 'No audio to download');
                }
            } catch (error) {
                showToast('error', `Download failed: ${error.message}`);
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

// Resume TTS AudioContext if suspended (if it exists)
function resumeTtsAudioContext(elements) {
    if (elements?.ttsAudio?._audioContext) {
        const audioContext = elements.ttsAudio._audioContext;
        if (audioContext.state === 'suspended') {
            console.log('[Main] Resuming suspended AudioContext');
            audioContext.resume().catch(err => {
                console.warn('[Main] Error resuming AudioContext:', err);
            });
        }
    }
}

// Handle visibility change to resume AudioContext when tab becomes visible
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && elements?.ttsAudio) {
        // Check if TTS tab is active
        const ttsTab = document.querySelector('.tab-content.active[data-tab="tts"]');
        if (ttsTab) {
            resumeTtsAudioContext(elements);
        }
    }
});

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

