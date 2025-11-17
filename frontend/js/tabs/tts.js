// TTS Tab Module - Text-to-Speech functionality

import { CONFIG } from '../config.js';
import { generateTTS } from '../services/api.js';
import { setButtonState, showStatus } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';
import { base64ToBlob } from '../utils/audio.js';
import { setupAudioPlayer } from '../components/audioPlayer.js';
import { visualizeAudioSpectrogram } from '../components/spectrogram.js';
import { populateLanguageSelect, populateVoiceSelectForLanguage, parseVoiceKey, getDefaultVoiceForLanguage } from '../utils/voices.js';

/**
 * Initialize TTS tab
 * @param {Object} elements - DOM elements
 * @param {Object} state - State object with setCurrentAudioBlob and voiceDetails
 * @returns {Object} Tab handlers and cleanup functions
 */
export function initTtsTab(elements, state) {
    const { setCurrentAudioBlob, voiceDetails = [] } = state;
    
    // Populate language and voice dropdowns when voiceDetails are available
    function populateVoiceDropdowns() {
        if (!voiceDetails || voiceDetails.length === 0) return;
        
        // Populate language dropdown
        if (elements.ttsLanguage) {
            populateLanguageSelect(elements.ttsLanguage, voiceDetails);
            
            // Set up language change handler
            elements.ttsLanguage.addEventListener('change', handleLanguageChange);
            
            // Trigger initial population if a language is already selected
            if (elements.ttsLanguage.value) {
                handleLanguageChange();
            }
        }
    }
    
    // Handle language selection change
    function handleLanguageChange() {
        const selectedLang = elements.ttsLanguage?.value;
        const voiceSelect = elements.ttsVoice;
        
        if (!voiceSelect) return;
        
        if (!selectedLang) {
            // No language selected - disable voice dropdown
            voiceSelect.disabled = true;
            voiceSelect.innerHTML = '<option value="">Select language first...</option>';
            return;
        }
        
        // Enable voice dropdown and populate with voices for selected language
        voiceSelect.disabled = false;
        populateVoiceSelectForLanguage(voiceSelect, selectedLang, voiceDetails);
        
        // Auto-select default voice for the language
        const defaultVoice = getDefaultVoiceForLanguage(selectedLang, voiceDetails);
        if (defaultVoice && voiceSelect.querySelector(`option[value="${defaultVoice.key}"]`)) {
            voiceSelect.value = defaultVoice.key;
        }
    }
    
    // Populate dropdowns on initialization if voiceDetails are already loaded
    if (voiceDetails && voiceDetails.length > 0) {
        populateVoiceDropdowns();
    }
    
    // Show status message in the status container above audio player
    let statusTimeoutId = null;
    
    function showTtsStatus(type, message) {
        const statusWrapper = document.getElementById('ttsStatusMessageWrapper');
        const statusMessage = document.getElementById('ttsStatusMessage');
        
        if (!statusWrapper || !statusMessage) return;
        
        // Clear any existing timeout
        if (statusTimeoutId) {
            clearTimeout(statusTimeoutId);
            statusTimeoutId = null;
        }
        
        if (message) {
            statusMessage.className = `tts-status-message ${type}`;
            statusMessage.textContent = message;
            statusWrapper.style.display = 'flex';
            
            // Only auto-hide info messages (like "Generating..."), not success messages
            // Success messages stay until a new request is sent
            if (type === 'info') {
                // Info messages can auto-hide after a delay if needed
                // But for now, we'll keep them visible too
            }
        } else {
            hideTtsStatus();
        }
    }
    
    // Hide status message
    function hideTtsStatus() {
        // Clear any pending timeout
        if (statusTimeoutId) {
            clearTimeout(statusTimeoutId);
            statusTimeoutId = null;
        }
        
        const statusWrapper = document.getElementById('ttsStatusMessageWrapper');
        if (statusWrapper) {
            statusWrapper.style.display = 'none';
        }
    }
    
    // Set up character counter
    function setupCharacterCounter() {
        if (!elements.ttsText || !elements.ttsCharCount) return;
        
        // Auto-resize textarea (minimum 3 lines, max 200px)
        const minHeight = parseFloat(getComputedStyle(elements.ttsText).fontSize) * 1.6 * 3 + 16; // 3 lines + padding
        const autoResize = () => {
            elements.ttsText.style.height = 'auto';
            const newHeight = Math.max(minHeight, Math.min(elements.ttsText.scrollHeight, 200)); // min 3 lines, max 200px
            elements.ttsText.style.height = `${newHeight}px`;
        };
        
        elements.ttsText.addEventListener('input', () => {
            const count = elements.ttsText.value.length;
            elements.ttsCharCount.textContent = count;
            autoResize();
        });
        
        // Initial resize
        autoResize();
        elements.ttsCharCount.textContent = elements.ttsText.value.length;
    }
    
    // TTS Form Submission Handler
    async function handleTtsSubmit(e) {
        e.preventDefault();
        
        if (!elements.ttsText || !elements.ttsLanguage || !elements.ttsVoice) return;
        
        const text = elements.ttsText.value.trim();
        const selectedLang = elements.ttsLanguage.value;
        const voiceKey = elements.ttsVoice.value;
        
        if (!text) {
            showTtsStatus('error', 'Please enter some text to synthesize');
            return;
        }
        
        if (!selectedLang) {
            showTtsStatus('error', 'Please select a language');
            return;
        }
        
        if (!voiceKey) {
            showTtsStatus('error', 'Please select a voice');
            return;
        }
        
        // Parse voice key to get language and voice
        const { lang: language, voice } = parseVoiceKey(voiceKey);
        
        setButtonState(elements.ttsBtn, true, 'Generating...');
        showTtsStatus('info', 'Generating speech...');
        if (elements.ttsDownloadBtn) elements.ttsDownloadBtn.style.display = 'none';
        
        // Hide audio player wrapper
        const audioWrapper = document.getElementById('ttsAudioWrapper');
        if (audioWrapper) {
            audioWrapper.classList.add('hidden');
        } else if (elements.ttsAudioPlayer) {
            elements.ttsAudioPlayer.classList.add('hidden');
        }
        
        // Show welcome message again while generating (hide status if no audio yet)
        const welcomeMessage = document.querySelector('.tts-welcome-message');
        if (welcomeMessage) {
            welcomeMessage.style.display = 'flex';
        }
        
        if (elements.ttsSpectrogram) elements.ttsSpectrogram.classList.add('hidden');
        
        try {
            console.log('[TTS] Generating speech:', { text: text.substring(0, 50) + '...', language, voice, voiceKey });
            const data = await generateTTS(text, language, null, voice);
            console.log('[TTS] Response received:', { 
                hasAudio: !!data.audio_base64, 
                audioLength: data.audio_base64?.length || 0,
                duration: data.duration_ms,
                sampleRate: data.sample_rate 
            });
            
            // Validate response
            if (!data || !data.audio_base64) {
                throw new Error('Invalid response: missing audio data');
            }
            
            // Store audio blob for download
            const audioBlob = await base64ToBlob(data.audio_base64, 'audio/wav');
            if (setCurrentAudioBlob) {
                setCurrentAudioBlob(audioBlob);
            }
            
            // Hide welcome message and show audio player
            const welcomeMessage = document.querySelector('.tts-welcome-message');
            if (welcomeMessage) {
                welcomeMessage.style.display = 'none';
            }
            
            // Show status message above audio player
            const statusWrapper = document.getElementById('ttsStatusMessageWrapper');
            if (statusWrapper) {
                statusWrapper.style.display = 'flex';
            }
            
            // Show download button (using correct element name)
            if (elements.ttsDownloadBtn) {
                elements.ttsDownloadBtn.style.display = 'block';
            }
            
            // Show audio player wrapper FIRST (before generating waveform)
            // This ensures canvas has valid dimensions (offsetWidth > 0)
            const audioWrapper = document.getElementById('ttsAudioWrapper');
            if (audioWrapper) {
                audioWrapper.classList.remove('hidden');
            } else if (elements.ttsAudioPlayer) {
                elements.ttsAudioPlayer.classList.remove('hidden');
            }
            
            // Wait a frame to ensure DOM has updated and canvas dimensions are available
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // Set up custom audio player (now that wrapper is visible)
            console.log('[TTS] Setting up audio player...');
            await setupAudioPlayer(elements, data.audio_base64);
            console.log('[TTS] Audio player setup complete');
            
            // Scroll to audio player smoothly after everything is set up
            if (audioWrapper) {
                audioWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (elements.ttsAudioPlayer) {
                elements.ttsAudioPlayer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            // Set up real-time spectrogram visualization
            if (elements.ttsSpectrogram && elements.ttsSpectrogramCanvas && elements.ttsAudio) {
                console.log('[TTS] Setting up spectrogram visualization...');
                // Initialize canvas size
                const container = elements.ttsSpectrogram;
                const canvas = elements.ttsSpectrogramCanvas;
                const containerWidth = container.offsetWidth || 800;
                canvas.width = containerWidth;
                canvas.height = 300;
                
                // Show spectrogram container
                elements.ttsSpectrogram.classList.remove('hidden');
                
                // Wait for audio to be loaded before setting up visualization
                const setupSpectrogram = () => {
                    if (elements.ttsAudio.readyState >= 2) { // HAVE_CURRENT_DATA or higher
                        console.log('[TTS] Audio ready, initializing spectrogram');
                        visualizeAudioSpectrogram(canvas, elements.ttsAudio);
                    } else {
                        console.log('[TTS] Waiting for audio to load...');
                        // Wait for audio to load - use canplay for better compatibility
                        let spectrogramInitialized = false;
                        const loadHandler = () => {
                            if (spectrogramInitialized) return;
                            spectrogramInitialized = true;
                            console.log('[TTS] Audio can play, initializing spectrogram');
                            visualizeAudioSpectrogram(canvas, elements.ttsAudio);
                        };
                        elements.ttsAudio.addEventListener('canplay', loadHandler, { once: true });
                        elements.ttsAudio.addEventListener('loadeddata', loadHandler, { once: true });
                    }
                };
                
                setupSpectrogram();
            } else {
                console.warn('[TTS] Spectrogram elements not found:', {
                    spectrogram: !!elements.ttsSpectrogram,
                    canvas: !!elements.ttsSpectrogramCanvas,
                    audio: !!elements.ttsAudio
                });
            }
            
            // Show success status with audio info
            const duration = (data.duration_ms / 1000).toFixed(2);
            showTtsStatus('success', `Speech generated successfully! Duration: ${duration}s • Sample Rate: ${data.sample_rate}Hz`);
            
        } catch (error) {
            console.error('[TTS] Error:', error);
            console.error('[TTS] Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            let errorMsg = error.message;
            
            // Handle specific error types
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                errorMsg = 'Request timed out. Please try again with shorter text.';
            } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                errorMsg = 'Network error. Please check your connection and try again.';
            } else if (error.message.includes('Invalid response')) {
                errorMsg = 'Server returned invalid response. Please try again.';
            } else if (error.message.includes('audio')) {
                errorMsg = 'Failed to process audio data. Please try again.';
            }
            
            // Show error status
            showTtsStatus('error', `Error: ${errorMsg}`);
        } finally {
            setButtonState(elements.ttsBtn, false, 'Generate Speech');
        }
    }
    
    // Set up event listeners
    function setupEventListeners() {
        if (elements.ttsForm) {
            elements.ttsForm.addEventListener('submit', handleTtsSubmit);
        }
    }
    
    // Initialize
    setupCharacterCounter();
    setupEventListeners();
    
    // Return public API
        return {
            handleTtsSubmit,
            populateVoiceDropdown: populateVoiceDropdowns,
            setupCharacterCounter
        };
}

