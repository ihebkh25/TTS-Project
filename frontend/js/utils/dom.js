// DOM utility functions

/**
 * Initialize DOM elements
 */
export function initElements() {
    return {
        // Forms
        ttsForm: document.getElementById('ttsForm'),
        chatForm: document.getElementById('chatForm'),
        
        // Inputs
        ttsText: document.getElementById('ttsText'),
        ttsVoice: document.getElementById('ttsVoice'),
        ttsLanguage: document.getElementById('ttsLanguage'), // Language selector (first step)
        ttsResultsContent: document.getElementById('ttsResultsContent'),
        chatInput: document.getElementById('chatInput'),
        chatMicBtn: document.getElementById('chatMicBtn'),
        voiceModeToggleBtn: document.getElementById('voiceModeToggleBtn'),
        useVoiceModeBtn: document.getElementById('useVoiceModeBtn'),
        exitVoiceModeBtn: document.getElementById('exitVoiceModeBtn'),
        voiceInputSpectrogram: document.getElementById('voiceInputSpectrogram'),
        voiceModeControls: document.getElementById('voiceModeControls'),
        voiceModeStatusCompact: document.getElementById('voiceModeStatusCompact'),
        voiceModeLanguage: document.getElementById('voiceModeLanguage'),
        textInputWrapper: document.getElementById('textInputWrapper'),
        serverUrl: document.getElementById('serverUrl'),
        llmProvider: document.getElementById('llmProvider'),
        
        // Buttons
        ttsBtn: document.getElementById('ttsBtn'),
        chatBtn: document.getElementById('chatBtn'),
        clearChatBtn: document.getElementById('clearChatBtn'),
        exportChatBtn: document.getElementById('exportChatBtn'),
        
        // Status and Output (legacy status elements removed - using inline status messages now)
        chatStatus: document.getElementById('chatStatus'),
        serverStatus: document.getElementById('serverStatus'),
        llmStatus: document.getElementById('llmStatus'),
        serverInfo: document.getElementById('serverInfo'),
        
        // Audio and Media
        ttsAudio: document.getElementById('ttsAudio'),
        ttsSpectrogram: document.getElementById('ttsSpectrogram'),
        ttsSpectrogramCanvas: document.getElementById('ttsSpectrogramCanvas'),
        chatMessages: document.getElementById('chatMessages'),
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

        // Voice Chat tab elements
        voiceChatMicBtn: document.getElementById('voiceChatMicBtn'),
        voiceChatMicStatus: document.getElementById('voiceChatMicStatus'),
        voiceChatMicCanvas: document.getElementById('voiceMicCanvas'),
        voiceChatBotCanvas: document.getElementById('voiceResponseCanvas'),
        voiceBotSpectrogram: document.getElementById('voiceBotSpectrogram'),
        voiceChatStatus: document.getElementById('voiceChatStatus'),
        voiceChatVoice: document.getElementById('voiceChatVoice'),
        voiceChatLanguage: document.getElementById('voiceChatLanguage'), // Language selector (first step)
        voiceTranscriptContainer: document.getElementById('voiceTranscriptContainer'),
        voiceTranscriptText: document.getElementById('voiceTranscriptText'),
        voiceConversationLog: document.getElementById('voiceConversationLog'),
        
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
    
    // For chat and TTS buttons, keep icon visible, hide text, show spinner when disabled
    if (button.id === 'chatBtn' || button.id === 'ttsBtn') {
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

