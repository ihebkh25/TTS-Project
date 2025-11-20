// DOM utility functions

/**
 * Initialize DOM elements
 */
export function initElements() {
    return {
        // Forms
        ttsForm: document.getElementById('ttsForm'),
        
        // Inputs
        ttsText: document.getElementById('ttsText'),
        ttsVoice: document.getElementById('ttsVoice'),
        ttsLanguage: document.getElementById('ttsLanguage'), // Language selector (first step)
        ttsResultsContent: document.getElementById('ttsResultsContent'),
        textInputWrapper: document.getElementById('textInputWrapper'),
        
        // Buttons
        ttsBtn: document.getElementById('ttsBtn'),
        
        // Status and Output (legacy status elements removed - using inline status messages now)
        serverStatus: document.getElementById('serverStatus'),
        serverInfo: document.getElementById('serverInfo'),
        
        // Audio and Media
        ttsAudio: document.getElementById('ttsAudio'),
        ttsSpectrogram: document.getElementById('ttsSpectrogram'),
        ttsSpectrogramCanvas: document.getElementById('ttsSpectrogramCanvas'),
        serverMetrics: document.getElementById('serverMetrics'),
        
        // Custom Audio Player - TTS
        ttsAudioPlayer: document.getElementById('ttsAudioPlayer'),
        ttsPlayPause: document.getElementById('ttsPlayPause'),
        ttsProgress: document.getElementById('ttsProgress'),
        ttsWaveform: document.getElementById('ttsWaveform'),
        ttsDownloadBtn: document.getElementById('ttsDownloadBtn'),
        ttsSpeed: document.getElementById('ttsSpeed'),
        ttsCurrentTime: document.querySelector('#ttsAudioPlayer .current-time'),
        ttsDuration: document.querySelector('#ttsAudioPlayer .duration'),
        
        // Groups
        speakerGroup: document.getElementById('speakerGroup'),
        ttsCharCount: document.getElementById('ttsCharCount'),
        
        // Toast container
        toastContainer: document.getElementById('toastContainer')
    };
}

/**
 * Set button state (disabled/enabled, text, spinner)
 */
export function setButtonState(button, disabled, text) {
    if (!button) return;
    button.disabled = disabled;
    
    const btnText = button.querySelector('.btn-text');
    const btnSpinner = button.querySelector('.btn-spinner');
    const sendIcon = button.querySelector('.send-icon');
    
    // For the TTS button, keep icon visible, hide text, show spinner when disabled
    if (button.id === 'ttsBtn') {
        if (btnSpinner) {
            if (disabled) {
                btnSpinner.classList.remove('hidden');
                if (sendIcon) sendIcon.classList.add('hidden');
            } else {
                btnSpinner.classList.add('hidden');
                if (sendIcon) sendIcon.classList.remove('hidden');
            }
        }
    } else {
        // For other buttons, use text
        if (btnText) {
            btnText.textContent = text;
        } else {
            button.textContent = text;
        }
        
        if (btnSpinner) {
            if (disabled) {
                btnSpinner.classList.remove('hidden');
            } else {
                btnSpinner.classList.add('hidden');
            }
        }
    }
}

/**
 * Show status message in an element
 */
export function showStatus(element, type, message) {
    if (!element) return;
    element.innerHTML = `<div class="status status-${type}">${message}</div>`;
}

/**
 * Update server status badge
 */
export function updateServerStatus(element, status, text) {
    if (!element) return;
    element.innerHTML = `<span class="status-dot"></span><span>${text}</span>`;
    element.className = `status-badge ${status}`;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

