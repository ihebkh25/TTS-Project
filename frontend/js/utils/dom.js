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
        ttsVoice: document.getElementById('ttsVoice'),
        ttsLanguage: document.getElementById('ttsLanguage'), // Language selector (first step)
        ttsSpeaker: document.getElementById('ttsSpeaker'), // Legacy, may not exist
        streamText: document.getElementById('streamText'),
        ttsResultsContent: document.getElementById('ttsResultsContent'),
        streamVoice: document.getElementById('streamVoice'),
        streamLanguage: document.getElementById('streamLanguage'), // Language selector (first step)
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
        
        // Buttons
        ttsBtn: document.getElementById('ttsBtn'),
        streamBtn: document.getElementById('streamBtn'),
        chatBtn: document.getElementById('chatBtn'),
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
        streamDownloadBtn: document.getElementById('streamDownloadBtn'),
        ttsSpectrogram: document.getElementById('ttsSpectrogram'),
        ttsSpectrogramCanvas: document.getElementById('ttsSpectrogramCanvas'),
        streamSpectrogram: document.getElementById('streamSpectrogram'),
        streamSpectrogramCanvas: document.getElementById('streamSpectrogramCanvas'),
        streamWaveform: document.getElementById('streamWaveform'),
        chatMessages: document.getElementById('chatMessages'),
        streamProgress: document.getElementById('streamProgress'),
        streamMetrics: document.getElementById('streamMetrics'),
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
        
        // Custom Audio Player - Stream
        streamAudioPlayer: document.getElementById('streamAudioPlayer'),
        streamPlayPause: document.getElementById('streamPlayPause'),
        streamProgressSlider: document.getElementById('streamProgressSlider'),
        streamSpeed: document.getElementById('streamSpeed'),
        streamCurrentTime: document.getElementById('streamCurrentTime'),
        streamDuration: document.getElementById('streamDuration'),

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
        streamCharCount: document.getElementById('streamCharCount'),
        
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

