// Chat component

import { base64ToBlob } from '../utils/audio.js';
import { visualizeAudioSpectrogram } from './spectrogram.js';

/**
 * Scroll chat to bottom
 */
export function scrollChatToBottom(container, force = false) {
    if (!container) return;
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;
            const maxScroll = scrollHeight - clientHeight;
            
            const currentScroll = container.scrollTop;
            const isNearBottom = (scrollHeight - currentScroll - clientHeight) < 100;
            
            if (force || isNearBottom) {
                container.scrollTo({
                    top: scrollHeight,
                    behavior: force ? 'smooth' : 'auto'
                });
                container.scrollTop = scrollHeight;
            }
        });
    });
}

/**
 * Add chat message
 */
export function addChatMessage(container, sender, message, audioBase64 = null, state = 'complete') {
    if (!container) return null;
    
    const messageClass = sender === 'user' ? 'user' : 'bot';
    
    // Create wrapper div
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';
    
    // Create container div
    const messageContainer = document.createElement('div');
    messageContainer.className = `message-container ${messageClass}`;
    
    // Create message element
    const messageElement = document.createElement('div');
    messageElement.className = `message ${messageClass}`;
    
    if (state === 'sending') {
        messageElement.classList.add('message-sending');
    } else if (state === 'generating') {
        messageElement.classList.add('message-generating');
    }
    
    // Create message content
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    if (state === 'generating') {
        // Show typing indicator for generating messages (using template)
        const typingTemplate = document.getElementById('typingIndicatorTemplate');
        if (typingTemplate) {
            const typingIndicator = typingTemplate.content.cloneNode(true);
            messageContent.appendChild(typingIndicator);
        } else {
            // Fallback
        messageContent.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
        }
    } else {
        messageContent.textContent = message;
    }
    
    messageElement.appendChild(messageContent);
    
    // Add audio player for bot messages with audio
    if (sender === 'bot' && audioBase64) {
        const audioWrapper = document.createElement('div');
        audioWrapper.className = 'message-audio-wrapper';
        
        const audioElement = document.createElement('audio');
        audioElement.controls = true;
        audioElement.className = 'message-audio';
        
        // Convert base64 to blob URL
        base64ToBlob(audioBase64, 'audio/wav').then(blob => {
            const audioUrl = URL.createObjectURL(blob);
            audioElement.src = audioUrl;
            if (audioElement.previousUrl) {
                URL.revokeObjectURL(audioElement.previousUrl);
            }
            audioElement.previousUrl = audioUrl;
            scrollChatToBottom(container, true);
        }).catch(err => {
            console.error('Error creating audio blob:', err);
        });
        
        audioWrapper.appendChild(audioElement);
        messageElement.appendChild(audioWrapper);
    }
    
    // Assemble structure
    messageContainer.appendChild(messageElement);
    messageWrapper.appendChild(messageContainer);
    
    // Remove welcome message if it exists
    const welcomeMessage = container.querySelector('.message.welcome');
    if (welcomeMessage && sender === 'user') {
        const welcomeWrapper = welcomeMessage.closest('.message-wrapper');
        if (welcomeWrapper) {
            welcomeWrapper.remove();
        }
    }
    
    // Append to messages container
    container.appendChild(messageWrapper);
    
    // Scroll to bottom
    scrollChatToBottom(container, true);
    
    return messageElement;
}

/**
 * Update message state
 */
export function updateMessageState(messageElement, state, content = null) {
    if (!messageElement) return;
    
    // Remove previous state classes
    messageElement.classList.remove('message-sending', 'message-generating');
    
    const messageContent = messageElement.querySelector('.message-content');
    if (!messageContent) return;
    
    if (state === 'sending') {
        messageElement.classList.add('message-sending');
    } else if (state === 'generating') {
        messageElement.classList.add('message-generating');
        const typingTemplate = document.getElementById('typingIndicatorTemplate');
        if (typingTemplate) {
            messageContent.innerHTML = '';
            const typingIndicator = typingTemplate.content.cloneNode(true);
            messageContent.appendChild(typingIndicator);
        } else {
            // Fallback
        messageContent.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
        }
    } else if (state === 'complete' && content) {
        messageContent.textContent = content;
    }
}

/**
 * Add spectrogram to message
 */
export function addMessageSpectrogram(messageElement, audioElement, audioBase64) {
    if (!messageElement || !audioElement) return;
    
    // Create spectrogram container
    const spectrogramWrapper = document.createElement('div');
    spectrogramWrapper.className = 'message-spectrogram-wrapper';
    
    const canvas = document.createElement('canvas');
    canvas.className = 'message-spectrogram-canvas';
    canvas.width = 600;
    canvas.height = 200;
    
    spectrogramWrapper.appendChild(canvas);
    
    // Insert before audio wrapper
    const audioWrapper = messageElement.querySelector('.message-audio-wrapper');
    if (audioWrapper) {
        messageElement.insertBefore(spectrogramWrapper, audioWrapper);
    } else {
        messageElement.appendChild(spectrogramWrapper);
    }
    
    // Visualize audio when it plays
    visualizeAudioSpectrogram(canvas, audioElement);
}

/**
 * Clear chat
 */
export function clearChat(container) {
    if (!container) return;
    
    container.innerHTML = '';
    
    // Add welcome message back
    const welcomeWrapper = document.createElement('div');
    welcomeWrapper.className = 'message-wrapper';
    
    const welcomeContainer = document.createElement('div');
    welcomeContainer.className = 'message-container bot';
    
    const welcomeMessage = document.createElement('div');
    welcomeMessage.className = 'message bot welcome';
    welcomeMessage.textContent = '👋 Hello! I\'m your AI assistant. Ask me anything!';
    
    welcomeContainer.appendChild(welcomeMessage);
    welcomeWrapper.appendChild(welcomeContainer);
    container.appendChild(welcomeWrapper);
    
    // Scroll to top
    container.scrollTop = 0;
}

/**
 * Export chat
 */
export function exportChat(container) {
    if (!container) return;
    
    const messages = Array.from(container.querySelectorAll('.message'))
        .map(msg => msg.textContent)
        .join('\n');
    
    const blob = new Blob([messages], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

