// Audio utility functions

/**
 * Convert base64 to Blob
 */
export async function base64ToBlob(base64, mimeType) {
    const audioData = atob(base64);
    const bytes = new Uint8Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
        bytes[i] = audioData.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

/**
 * Convert f32 audio samples array to WAV base64
 */
export function convertF32ArrayToWavBase64(samples, sampleRate) {
    // Convert f32 samples to 16-bit PCM
    const pcm16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        // Clamp to [-1, 1] and convert to 16-bit integer
        const sample = Math.max(-1, Math.min(1, samples[i]));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    
    // Create WAV file
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcm16.length * 2; // 2 bytes per sample
    const fileSize = 36 + dataSize;
    
    // WAV header
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // RIFF header
    view.setUint8(0, 0x52); // 'R'
    view.setUint8(1, 0x49); // 'I'
    view.setUint8(2, 0x46); // 'F'
    view.setUint8(3, 0x46); // 'F'
    view.setUint32(4, fileSize, true); // File size - 8
    view.setUint8(8, 0x57); // 'W'
    view.setUint8(9, 0x41); // 'A'
    view.setUint8(10, 0x56); // 'V'
    view.setUint8(11, 0x45); // 'E'
    
    // fmt chunk
    view.setUint8(12, 0x66); // 'f'
    view.setUint8(13, 0x6D); // 'm'
    view.setUint8(14, 0x74); // 't'
    view.setUint8(15, 0x20); // ' '
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // Audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    view.setUint8(36, 0x64); // 'd'
    view.setUint8(37, 0x61); // 'a'
    view.setUint8(38, 0x74); // 't'
    view.setUint8(39, 0x61); // 'a'
    view.setUint32(40, dataSize, true);
    
    // PCM data
    const pcmView = new DataView(buffer, 44);
    for (let i = 0; i < pcm16.length; i++) {
        pcmView.setInt16(i * 2, pcm16[i], true); // Little-endian
    }
    
    // Convert to base64
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Play audio from base64 data
 */
export async function playAudio(audioElement, base64Data) {
    try {
        const audioBlob = await base64ToBlob(base64Data, 'audio/wav');
        const audioUrl = URL.createObjectURL(audioBlob);
        
        audioElement.src = audioUrl;
        audioElement.classList.remove('hidden');
        
        // Clean up previous URL
        if (audioElement.previousUrl) {
            URL.revokeObjectURL(audioElement.previousUrl);
        }
        audioElement.previousUrl = audioUrl;
        
    } catch (error) {
        console.error('Audio Playback Error:', error);
        throw new Error('Failed to play audio: ' + error.message);
    }
}

/**
 * Generate waveform visualization from audio blob
 */
export async function generateWaveform(audioBlob, canvas, height = null) {
    try {
        // Ensure canvas is visible and has valid dimensions
        if (!canvas || !canvas.parentElement) {
            console.warn('[Waveform] Canvas or parent element not found');
            return;
        }
        
        // Check if canvas is in a hidden container and wait for it to be visible
        const container = canvas.closest('.hidden');
        if (container && container.classList.contains('hidden')) {
            console.warn('[Waveform] Canvas is in hidden container, waiting for visibility...');
            // Wait for container to become visible
            await new Promise(resolve => {
                const checkVisibility = () => {
                    if (!container.classList.contains('hidden') && canvas.offsetWidth > 0) {
                        resolve();
                    } else {
                        requestAnimationFrame(checkVisibility);
                    }
                };
                // Start checking
                requestAnimationFrame(checkVisibility);
                // Timeout after 2 seconds
                setTimeout(() => {
                    console.warn('[Waveform] Timeout waiting for canvas visibility');
                    resolve();
                }, 2000);
            });
        }
        
        // Get canvas dimensions - ensure we have valid width
        // Wait a frame to ensure layout has settled
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        let width = canvas.offsetWidth;
        if (width === 0 || !width) {
            // Canvas might not be visible yet, try to get from parent or use default
            const parent = canvas.parentElement;
            if (parent && parent.offsetWidth > 0) {
                width = parent.offsetWidth;
                console.warn('[Waveform] Using parent width:', width);
            } else {
                // Try to get from container
                const waveformContainer = canvas.closest('.audio-waveform-container');
                if (waveformContainer && waveformContainer.offsetWidth > 0) {
                    width = waveformContainer.offsetWidth;
                    console.warn('[Waveform] Using container width:', width);
                } else {
                    width = 800; // Fallback to 800px
                    console.warn('[Waveform] Canvas width was 0, using fallback:', width);
                }
            }
        }
        
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        const ctx = canvas.getContext('2d');
        canvas.width = width;
        const canvasHeight = height || (canvas.height = canvas.offsetHeight || 60);
        
        // Store audio buffer and duration for seeking
        canvas._audioBuffer = audioBuffer;
        canvas._duration = audioBuffer.duration;
        
        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = canvasHeight / 2;
        
        // Clear with black background to match spectrogram styling
        ctx.fillStyle = '#000'; // Black background to match spectrogram
        ctx.fillRect(0, 0, width, canvasHeight);
        
        // Draw center line for reference (more visible)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, amp);
        ctx.lineTo(width, amp);
        ctx.stroke();
        
        // Create waveform path
        ctx.beginPath();
        ctx.moveTo(0, amp);
        
        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            
            for (let j = 0; j < step; j++) {
                const idx = (i * step) + j;
                if (idx < data.length) {
                    const datum = data[idx];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
            }
            
            ctx.lineTo(i, (1 + min) * amp);
            ctx.lineTo(i, (1 + max) * amp);
        }
        
        ctx.lineTo(width, amp);
        ctx.closePath();
        
        // Draw waveform with much brighter, more visible colors
        const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
        if (height) {
            // Streaming waveform colors - very bright and visible
            gradient.addColorStop(0, '#6366f1');      // Indigo - solid color
            gradient.addColorStop(0.5, '#8b5cf6');    // Purple - solid color
            gradient.addColorStop(1, '#a855f7');      // Purple - solid color
        } else {
            // TTS waveform colors - very bright and visible
            gradient.addColorStop(0, '#6366f1');      // Indigo - solid color
            gradient.addColorStop(0.5, '#a855f7');    // Purple - solid color
            gradient.addColorStop(1, '#14b8a6');      // Teal - solid color
        }
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Add subtle stroke for definition (much more subtle)
        ctx.strokeStyle = 'rgba(129, 140, 248, 0.3)'; // Very subtle indigo stroke
        ctx.lineWidth = 0.5;
        ctx.stroke();
        
        // Add very subtle highlight overlay for gentle 3D effect
        const highlightGradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
        highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.06)'); // Much more subtle
        highlightGradient.addColorStop(0.15, 'rgba(255, 255, 255, 0.03)');
        highlightGradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.01)');
        highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        // Apply subtle highlight overlay with soft blend
        ctx.globalCompositeOperation = 'overlay'; // More subtle than 'lighten'
        ctx.fillStyle = highlightGradient;
        ctx.fillRect(0, 0, width, canvasHeight);
        ctx.globalCompositeOperation = 'source-over';
        
    } catch (error) {
        console.error('Waveform generation error:', error);
    }
}

/**
 * Update waveform progress indicator
 */
export function updateWaveformProgress(canvas, container, currentTime, duration) {
    if (!canvas || !container || !duration) return;
    
    const progress = (currentTime / duration) * 100;
    
    // Update progress overlay
    container.style.setProperty('--progress', `${progress}%`);
    
    // Update or create progress line
    let progressLine = container.querySelector('.audio-waveform-progress-line');
    if (!progressLine) {
        progressLine = document.createElement('div');
        progressLine.className = 'audio-waveform-progress-line';
        container.appendChild(progressLine);
    }
    progressLine.style.left = `${progress}%`;
}

