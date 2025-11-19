// Main entry point for the TTS application

import { initElements } from './utils/dom.js';
import { setupTabs } from './utils/tabs.js';
import { populateLanguageSelects } from './utils/voices.js';
import { showToast } from './utils/toast.js';
import { updateServerStatus } from './utils/dom.js';
import { setupCustomAudioPlayer, downloadAudio } from './components/audioPlayer.js';
import { scrollChatToBottom } from './components/chat.js';
import { getVoices, getVoiceDetails, checkServerHealth } from './services/api.js';
import { CONFIG } from './config.js';
// Lazy load tab modules for better performance
const tabModules = {
    'tts': () => import('./tabs/tts.js'),
    'chat': () => import('./tabs/chat.js'),
    'server': () => import('./tabs/server.js'),
    'voice-chat': () => import('./tabs/voice-chat.js'),
};

// Global state
let elements = {};
let voices = []; // Simple language codes list (for voiceModeLanguage in chat tab)
let voiceDetails = []; // Full voice details (for TTS, Voice-chat tabs)
let currentAudioBlob = null;
let currentConversationId = null;
const initializedTabs = new Set(); // Track initialized tabs

// State management functions
function setCurrentAudioBlob(blob) {
    currentAudioBlob = blob;
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
            
            // Show/hide LLM provider selector based on active tab
            updateLlmProviderVisibility(tabName);
            
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
            
            // Lazy load and initialize tab modules
            if (tabModules[tabName]) {
                try {
                    const module = await tabModules[tabName]();
                    
                    if (tabName === 'chat') {
                        const chatState = {
                            get currentConversationId() { return currentConversationId; },
                            set currentConversationId(value) { currentConversationId = value; },
                            setCurrentConversationId
                        };
                        module.initChatTab(elements, chatState);
                        populateVoiceModeLanguage();
                        initializedTabs.add(tabName);
                        setTimeout(() => {
                            scrollChatToBottom(elements.chatMessages);
                        }, 100);
                    } else if (tabName === 'voice-chat') {
                        const voiceState = {
                            get currentConversationId() { return currentConversationId; },
                            set currentConversationId(value) { currentConversationId = value; },
                            setCurrentConversationId,
                            voiceDetails
                        };
                        const voiceChatTab = module.initVoiceChatTab(elements, voiceState);
                        if (voiceChatTab && voiceChatTab.populateVoiceDropdown && voiceDetails && voiceDetails.length > 0) {
                            voiceChatTab.populateVoiceDropdown();
                        }
                        initializedTabs.add(tabName);
                    } else if (tabName === 'server') {
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
        
        // Populate voiceModeLanguage for chat tab if available
        populateVoiceModeLanguage();
        
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
        
        // Set up LLM provider selector (async - will sync with backend)
        await setupLlmProviderSelector();
        
        // Make updateLlmProviderVisibility globally available for tab switching
        window.updateLlmProviderVisibility = updateLlmProviderVisibility;
        
        // Set initial visibility based on default tab (tts)
        updateLlmProviderVisibility('tts');
        
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

// Show/hide LLM provider selector and status based on active tab
function updateLlmProviderVisibility(tabName) {
    const llmProviderSelector = document.querySelector('.llm-provider-selector');
    const llmStatus = document.getElementById('llmStatus');
    
    // Show only for AI-related tabs
    const aiTabs = ['chat', 'voice-chat'];
    if (aiTabs.includes(tabName)) {
        if (llmProviderSelector) {
            llmProviderSelector.style.display = 'flex';
        }
        if (llmStatus) {
            llmStatus.style.display = 'inline-flex';
            // Check LLM status when showing (non-blocking, instant check)
            checkLlmStatus().catch(err => {
                console.warn('[Main] LLM status check error (non-blocking):', err);
            });
        }
    } else {
        if (llmProviderSelector) {
            llmProviderSelector.style.display = 'none';
        }
        if (llmStatus) {
            llmStatus.style.display = 'none';
        }
    }
}

// Set up download button handlers
async function setupLlmProviderSelector() {
    if (!elements.llmProvider) return;
    
    // Query the backend to get the actual provider being used
    try {
        const response = await fetch(`${CONFIG.API_BASE}/llm/provider`);
        if (response.ok) {
            const data = await response.json();
            const actualProvider = data.provider || 'ollama';
            // Sync the selector with the actual backend provider
            if (elements.llmProvider) {
                elements.llmProvider.value = actualProvider;
            }
            // Update localStorage to match backend
            localStorage.setItem('llmProvider', actualProvider);
            console.log(`[Main] Backend LLM provider: ${actualProvider}, model: ${data.model || 'unknown'}`);
        } else {
            // Fallback to saved preference if API fails
            const savedProvider = localStorage.getItem('llmProvider') || 'ollama';
            if (elements.llmProvider) {
                elements.llmProvider.value = savedProvider;
            }
        }
    } catch (error) {
        console.warn('[Main] Failed to fetch backend LLM provider, using saved preference:', error);
        // Fallback to saved preference
        const savedProvider = localStorage.getItem('llmProvider') || 'ollama';
        if (elements.llmProvider) {
            elements.llmProvider.value = savedProvider;
        }
    }
    
    // Ensure default is set if not already set
    if (!localStorage.getItem('llmProvider')) {
        localStorage.setItem('llmProvider', 'ollama');
    }
    
    // Initially hide the selector (will be shown when AI tabs are active)
    const llmProviderSelector = document.querySelector('.llm-provider-selector');
    if (llmProviderSelector) {
        llmProviderSelector.style.display = 'none';
    }
    
    // LLM provider selector is hidden since we only support Ollama
    // Keep the event listener for compatibility but it won't be triggered
    if (elements.llmProvider) {
        elements.llmProvider.addEventListener('change', async (e) => {
            // Always use Ollama - this should not be triggered since selector is hidden
            const selectedProvider = 'ollama';
            localStorage.setItem('llmProvider', selectedProvider);
            
            // Check LLM status
            if (elements.llmStatus && elements.llmStatus.style.display !== 'none') {
                await checkLlmStatus();
            }
        });
    }
}

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

// Check LLM provider status with retry logic
async function checkLlmStatus(retries = 2) {
    const llmStatus = elements.llmStatus;
    if (!llmStatus) return;
    
    // Get the actual backend provider, not just the frontend selector
    let provider = 'ollama';
    try {
        const response = await fetch(`${CONFIG.API_BASE}/llm/provider`);
        if (response.ok) {
            const data = await response.json();
            provider = data.provider || 'ollama';
            // Sync the selector with actual backend provider
            if (elements.llmProvider && elements.llmProvider.value !== provider) {
                elements.llmProvider.value = provider;
                localStorage.setItem('llmProvider', provider);
            }
        } else {
            // Fallback to selector value if API fails
            provider = elements.llmProvider?.value || localStorage.getItem('llmProvider') || 'ollama';
        }
    } catch (error) {
        console.warn('[Main] Failed to fetch backend provider, using selector value:', error);
        // Fallback to selector value
        provider = elements.llmProvider?.value || localStorage.getItem('llmProvider') || 'ollama';
    }
    
    const providerName = 'Local (Ollama)';
    
    // Update status to checking
    updateServerStatus(llmStatus, 'disconnected', 'Checking LLM...');
    
    // For Ollama, use fast availability check instead of full chat request
    if (provider === 'ollama') {
        try {
            // Quick check: just verify backend server is up and LLM provider endpoint works
            // This is instant - no need to wait for actual LLM response
            const providerResponse = await fetch(`${CONFIG.API_BASE}/llm/provider`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000) // 2 second timeout for instant check
            });
            
            if (providerResponse.ok) {
                const data = await providerResponse.json().catch(() => ({}));
                // If we can get the provider info, assume LLM is ready
                // The actual chat will work or fail when user tries to use it
                if (data.provider === 'ollama') {
                    updateServerStatus(llmStatus, 'connected', `${providerName} Ready`);
                    return;
                }
            }
            
            // Fallback: if provider endpoint fails, check basic health
            const healthResponse = await fetch(`${CONFIG.API_BASE}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            
            if (healthResponse.ok) {
                // Server is up, assume LLM is ready (will fail gracefully if not)
                updateServerStatus(llmStatus, 'connected', `${providerName} Ready`);
            } else {
                updateServerStatus(llmStatus, 'disconnected', `${providerName} Server Down`);
            }
        } catch (error) {
            // On any error, assume it's ready but might fail on actual use
            // This matches the old behavior where there was no checking
            console.warn('[Main] LLM status check failed (assuming ready):', error);
            updateServerStatus(llmStatus, 'connected', `${providerName} Ready`);
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

