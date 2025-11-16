// Chat component

import { base64ToBlob } from '../utils/audio.js';
import { visualizeAudioSpectrogram } from './spectrogram.js';

// Cache template lookups (templates don't change)
let typingIndicatorTemplateCache = null;
function getTypingIndicatorTemplate() {
    if (!typingIndicatorTemplateCache) {
        typingIndicatorTemplateCache = document.getElementById('typingIndicatorTemplate');
    }
    return typingIndicatorTemplateCache;
}

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
            const SCROLL_NEAR_BOTTOM_THRESHOLD = 100; // Pixels from bottom to consider "near bottom"
            const isNearBottom = (scrollHeight - currentScroll - clientHeight) < SCROLL_NEAR_BOTTOM_THRESHOLD;
            
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
        const typingTemplate = getTypingIndicatorTemplate();
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
    
    // Clear any existing timeouts for this message element to prevent race conditions
    if (messageElement._updateTimeouts) {
        messageElement._updateTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        messageElement._updateTimeouts = [];
    } else {
        messageElement._updateTimeouts = [];
    }
    
    // Remove previous state classes
    messageElement.classList.remove('message-sending', 'message-generating');
    
    const messageContent = messageElement.querySelector('.message-content');
    if (!messageContent) return;
    
    if (state === 'sending') {
        messageElement.classList.add('message-sending');
    } else if (state === 'generating') {
        messageElement.classList.add('message-generating');
        // Remove fade classes if present
        messageContent.classList.remove('fade-in', 'fade-out');
        const typingTemplate = getTypingIndicatorTemplate();
        if (typingTemplate) {
            messageContent.innerHTML = '';
            const typingIndicator = typingTemplate.content.cloneNode(true);
            messageContent.appendChild(typingIndicator);
        } else {
            // Fallback
            messageContent.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
        }
    } else if (state === 'complete' && content) {
        // Smooth transition from typing indicator to content
        const typingIndicator = messageContent.querySelector('.typing-indicator');
        const wasGenerating = messageElement.classList.contains('message-generating');
        
        if (typingIndicator && wasGenerating) {
            // Fade out typing indicator first
            typingIndicator.classList.add('fade-out');
            
            // Wait for fade-out animation, then replace with content
            const timeout1 = setTimeout(() => {
                // Check if element still exists (might have been removed)
                if (!messageElement.parentNode) return;
                
                // Remove generating class and glow animation
                messageElement.classList.remove('message-generating');
                messageContent.textContent = content;
                messageContent.classList.add('fade-in');
                
                // Remove fade-in class after animation completes
                const timeout2 = setTimeout(() => {
                    if (messageContent && messageContent.parentNode) {
                        messageContent.classList.remove('fade-in');
                    }
                    // Remove timeout from array
                    if (messageElement._updateTimeouts) {
                        const index = messageElement._updateTimeouts.indexOf(timeout2);
                        if (index > -1) messageElement._updateTimeouts.splice(index, 1);
                    }
                }, 300);
                
                if (messageElement._updateTimeouts) {
                    messageElement._updateTimeouts.push(timeout2);
                }
            }, 200); // Match CSS transition duration
            
            messageElement._updateTimeouts.push(timeout1);
        } else {
            // No typing indicator or not generating, just update content with fade-in
            messageContent.textContent = content;
            messageContent.classList.add('fade-in');
            const timeout = setTimeout(() => {
                if (messageContent && messageContent.parentNode) {
                    messageContent.classList.remove('fade-in');
                }
                // Remove timeout from array
                if (messageElement._updateTimeouts) {
                    const index = messageElement._updateTimeouts.indexOf(timeout);
                    if (index > -1) messageElement._updateTimeouts.splice(index, 1);
                }
            }, 300);
            messageElement._updateTimeouts.push(timeout);
        }
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
    
    // Cleanup all timeouts and spectrograms before clearing
    const messages = container.querySelectorAll('.message');
    messages.forEach(message => {
        // Clear any pending timeouts
        if (message._updateTimeouts) {
            message._updateTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
            message._updateTimeouts = [];
        }
        
        // Cleanup spectrogram if present
        const audioElement = message.querySelector('audio.message-audio');
        if (audioElement && audioElement._spectrogramCleanup) {
            audioElement._spectrogramCleanup();
            audioElement._spectrogramCleanup = null;
        }
    });
    
    // Cleanup audio blob URLs before clearing (revoke all including current)
    cleanupAudioBlobUrls(container, true);
    
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
    // Cleanup blob URL after a short delay to ensure download started
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Cleanup all audio blob URLs in chat messages to prevent memory leaks
 * @param {HTMLElement} container - Container element with audio elements
 * @param {boolean} revokeCurrent - If true, also revoke current src (use when removing elements)
 */
export function cleanupAudioBlobUrls(container, revokeCurrent = false) {
    if (!container) return;
    
    const audioElements = container.querySelectorAll('audio.message-audio');
    audioElements.forEach(audio => {
        // Always revoke previous URLs (these are no longer in use)
        if (audio.previousUrl) {
            try {
                URL.revokeObjectURL(audio.previousUrl);
            } catch (e) {
                // URL may have already been revoked, ignore error
                console.warn('Error revoking previous audio URL:', e);
            }
            audio.previousUrl = null;
        }
        // Only revoke current src if explicitly requested (e.g., when clearing chat)
        if (revokeCurrent && audio.src && audio.src.startsWith('blob:')) {
            try {
                URL.revokeObjectURL(audio.src);
            } catch (e) {
                // URL may have already been revoked, ignore error
                console.warn('Error revoking current audio URL:', e);
            }
        }
    });
}

