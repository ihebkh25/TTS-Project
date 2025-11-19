// Main entry point for the TTS application

import { initElements } from './utils/dom.js';
import { setupTabs } from './utils/tabs.js';
import { populateLanguageSelects } from './utils/voices.js';
import { showToast } from './utils/toast.js';
import { updateServerStatus } from './utils/dom.js';
import { setupCustomAudioPlayer, downloadAudio } from './components/audioPlayer.js';
import { getVoices, getVoiceDetails, checkServerHealth } from './services/api.js';
import { CONFIG } from './config.js';
// Lazy load tab modules for better performance
const tabModules = {
    'tts': () => import('./tabs/tts.js'),
    'server': () => import('./tabs/server.js'),
};

// Global state
let elements = {};
let voiceDetails = []; // Full voice details (for TTS tab)
let currentAudioBlob = null;
const initializedTabs = new Set(); // Track initialized tabs

// State management functions
function setCurrentAudioBlob(blob) {
    currentAudioBlob = blob;
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
        }
        
        updateLoadingStatus('Starting initialization...');
        
        updateLoadingStatus('Initializing DOM elements...');
        // Initialize DOM elements
        elements = initElements();
        
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
                return;
            }
            
            // Lazy load and initialize tab modules
            if (tabModules[tabName]) {
                try {
                    const module = await tabModules[tabName]();
                    
                    if (tabName === 'server') {
                        const serverTab = module.initServerTab(elements);
                        if (serverTab && serverTab.cleanup) {
                            window.serverTabCleanup = serverTab.cleanup;
                        }
                        initializedTabs.add(tabName);
                    } else if (tabName === 'tts') {
                        const ttsState = {
                            setCurrentAudioBlob,
                            voiceDetails
                        };
                        const ttsTab = module.initTtsTab(elements, ttsState);
                        setupCustomAudioPlayer(elements);
                        if (ttsTab && ttsTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
                            ttsTab.populateVoiceDropdown();
                        }
                        initializedTabs.add(tabName);
                    }
                } catch (error) {
                    console.error(`[Main] Failed to load tab module ${tabName}:`, error);
                    showToast('error', `Failed to load ${tabName} tab: ${error.message}`);
                }
            }
        });
        
        updateLoadingStatus('Checking server status...');
        // Check server status on load
        await checkServerStatus();
        
        updateLoadingStatus('Loading voices...');
        // Load voices dynamically (must be before tab initialization for voiceDetails)
        await loadVoices();
        
        // Re-initialize elements after voices are loaded
        elements = initElements();
        
        // Set up custom audio player
        setupCustomAudioPlayer(elements);
        
        // Initialize initial tab (tts) if not already initialized by the callback
        // The callback in setupTabs should have initialized it, but voices weren't loaded yet
        // So we need to re-initialize it now that voices are available
        if (!initializedTabs.has('tts')) {
            try {
                const ttsModule = await tabModules['tts']();
                const ttsState = {
                    setCurrentAudioBlob,
                    voiceDetails
                };
                const ttsTab = ttsModule.initTtsTab(elements, ttsState);
                // Populate voice dropdown if voiceDetails are available
                if (ttsTab && ttsTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
                    ttsTab.populateVoiceDropdown();
                }
                initializedTabs.add('tts');
            } catch (error) {
                console.error('[Main] Failed to load initial TTS tab:', error);
                showToast('error', `Failed to load TTS tab: ${error.message}`);
            }
        } else {
            // Tab was already initialized, but voices weren't loaded yet
            // Re-initialize to populate voice dropdown
            try {
                const ttsModule = await tabModules['tts']();
                const ttsState = {
                    setCurrentAudioBlob,
                    voiceDetails
                };
                // Re-initialize to get updated tab instance with voice details
                const ttsTab = ttsModule.initTtsTab(elements, ttsState);
                if (ttsTab && ttsTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
                    ttsTab.populateVoiceDropdown();
                }
            } catch (error) {
                console.error('[Main] Failed to re-initialize TTS tab with voices:', error);
            }
        }
        
        updateLoadingStatus('Setting up handlers...');
        // Set up download button handlers
        setupDownloadHandlers();
        
        // Hide loading indicator and show app
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
        
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
    
}

// Server Status Functions (called from main init)
async function checkServerStatus() {
    try {
        const healthResponse = await checkServerHealth();
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

