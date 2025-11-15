// Chat component

import { base64ToBlob } from '../utils/audio.js';

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
        // Show typing indicator for generating messages
        messageContent.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
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
        messageContent.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
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
 * Visualize audio spectrogram in real-time
 */
function visualizeAudioSpectrogram(canvas, audioElement) {
    const ctx = canvas.getContext('2d');
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaElementSource(audioElement);
    const analyser = audioContext.createAnalyser();
    
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    
    let animationFrame = null;
    
    function draw() {
        if (audioElement.paused || audioElement.ended) {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
            // Draw final state
            drawSpectrogramFrame(ctx, canvas, dataArray, 0);
            audioContext.close();
            return;
        }
        
        analyser.getByteFrequencyData(dataArray);
        drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
        
        animationFrame = requestAnimationFrame(draw);
    }
    
    audioElement.addEventListener('play', () => {
        draw();
    });
    
    audioElement.addEventListener('pause', () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
    });
}

/**
 * Draw spectrogram frame
 */
function drawSpectrogramFrame(ctx, canvas, dataArray, analyser) {
    const width = canvas.width;
    const height = canvas.height;
    const bufferLength = dataArray.length;
    
    // Clear with gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0a0a0a');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    if (!analyser) return;
    
    const barCount = Math.min(bufferLength, 256); // Limit bars for performance
    const barWidth = width / barCount;
    
    for (let i = 0; i < barCount; i++) {
        const barHeight = (dataArray[i] / 255) * height * 0.9;
        const x = (i / barCount) * width;
        const y = height - barHeight;
        
        // Create gradient for each bar
        const barGradient = ctx.createLinearGradient(x, y, x, height);
        const intensity = dataArray[i] / 255;
        
        // Color mapping: blue (low) -> cyan -> green -> yellow -> red (high)
        let hue, saturation, lightness;
        if (intensity < 0.25) {
            hue = 240; // Blue
            saturation = 100;
            lightness = 30 + intensity * 40;
        } else if (intensity < 0.5) {
            hue = 200; // Cyan
            saturation = 100;
            lightness = 50 + (intensity - 0.25) * 30;
        } else if (intensity < 0.75) {
            hue = 150; // Green
            saturation = 100;
            lightness = 60 + (intensity - 0.5) * 20;
        } else {
            hue = 60 - (intensity - 0.75) * 60; // Yellow to Red
            saturation = 100;
            lightness = 70;
        }
        
        barGradient.addColorStop(0, `hsl(${hue}, ${saturation}%, ${lightness}%)`);
        barGradient.addColorStop(1, `hsl(${hue}, ${saturation}%, ${lightness * 0.3}%)`);
        
        ctx.fillStyle = barGradient;
        ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
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

