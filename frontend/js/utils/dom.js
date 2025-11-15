// DOM utility functions

/**
 * Initialize DOM elements
 */
export function initElements() {
    return {
        // Forms
        ttsForm: document.getElementById('ttsForm'),
        streamForm: document.getElementById('streamForm'),
        chatForm: document.getElementById('chatForm'),
        
        // Inputs
        ttsText: document.getElementById('ttsText'),
        ttsLanguage: document.getElementById('ttsLanguage'),
        ttsSpeaker: document.getElementById('ttsSpeaker'),
        streamText: document.getElementById('streamText'),
        streamLanguage: document.getElementById('streamLanguage'),
        chatInput: document.getElementById('chatInput'),
        chatMicBtn: document.getElementById('chatMicBtn'),
        voiceModeToggleBtn: document.getElementById('voiceModeToggleBtn'),
        exitVoiceModeBtn: document.getElementById('exitVoiceModeBtn'),
        voiceMicButton: document.getElementById('voiceMicButton'),
        voiceMicCanvas: document.getElementById('voiceMicCanvas'),
        voiceResponseCanvas: document.getElementById('voiceResponseCanvas'),
        voiceResponseAudio: document.getElementById('voiceResponseAudio'),
        voiceMicStatus: document.getElementById('voiceMicStatus'),
        voiceResponseStatus: document.getElementById('voiceResponseStatus'),
        voiceTranscriptContainer: document.getElementById('voiceTranscriptContainer'),
        voiceTranscriptText: document.getElementById('voiceTranscriptText'),
        textInputWrapper: document.getElementById('textInputWrapper'),
        voiceModeWrapper: document.getElementById('voiceModeWrapper'),
        voiceModeLanguage: document.getElementById('voiceModeLanguage'),
        serverUrl: document.getElementById('serverUrl'),
        
        // Buttons
        ttsBtn: document.getElementById('ttsBtn'),
        streamBtn: document.getElementById('streamBtn'),
        chatBtn: document.getElementById('chatBtn'),
        downloadTtsBtn: document.getElementById('downloadTtsBtn'),
        clearChatBtn: document.getElementById('clearChatBtn'),
        exportChatBtn: document.getElementById('exportChatBtn'),
        
        // Status and Output
        ttsStatus: document.getElementById('ttsStatus'),
        streamStatus: document.getElementById('streamStatus'),
        chatStatus: document.getElementById('chatStatus'),
        serverStatus: document.getElementById('serverStatus'),
        serverInfo: document.getElementById('serverInfo'),
        
        // Audio and Media
        ttsAudio: document.getElementById('ttsAudio'),
        streamAudio: document.getElementById('streamAudio'),
        streamAudioContainer: document.getElementById('streamAudioContainer'),
        streamDownloadBtn: document.getElementById('streamDownloadBtn'),
        ttsSpectrogram: document.getElementById('ttsSpectrogram'),
        streamSpectrogram: document.getElementById('streamSpectrogram'),
        streamSpectrogramCanvas: document.getElementById('streamSpectrogramCanvas'),
        streamWaveform: document.getElementById('streamWaveform'),
        chatMessages: document.getElementById('chatMessages'),
        streamProgress: document.getElementById('streamProgress'),
        serverMetrics: document.getElementById('serverMetrics'),
        
        // Custom Audio Player
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
    
    // For chat button, keep icon visible, hide text
    if (button.id === 'chatBtn') {
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

