// Spectrogram visualization component

import { CONFIG } from '../config.js';

const { STREAMING } = CONFIG;

/**
 * Initialize streaming spectrogram canvas
 */
export function initStreamSpectrogram(canvas, container) {
    if (!canvas) return null;
    
    const containerWidth = container?.offsetWidth || 800;
    canvas.width = containerWidth;
    canvas.height = 300;
    
    const ctx = canvas.getContext('2d');
    const melFrames = [];
    
    // Clear canvas with black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    return { ctx, melFrames };
}

/**
 * Visualize mel frame in real-time
 */
export function visualizeMelFrame(spectrogramState, melFrame) {
    if (!spectrogramState || !melFrame || melFrame.length === 0) return;
    
    const { ctx, melFrames, canvas } = spectrogramState;
    if (!ctx || !canvas) return;
    
    const n_mels = melFrame.length;
    const frameWidth = STREAMING.FRAME_WIDTH;
    const melHeight = canvas.height;
    
    // Add frame to accumulation
    melFrames.push([...melFrame]);
    
    // Keep only last N frames that fit on canvas
    const maxFrames = Math.floor(canvas.width / frameWidth);
    if (melFrames.length > maxFrames) {
        melFrames.shift(); // Remove oldest frame
    }
    
    // Limit mel frames to prevent memory issues
    if (melFrames.length > STREAMING.MAX_MEL_FRAMES) {
        melFrames.shift();
    }
    
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw all accumulated frames
    const binHeight = melHeight / n_mels;
    melFrames.forEach((frame, frameIndex) => {
        const x = frameIndex * frameWidth;
        
        // Normalize mel values for visualization (per-frame normalization)
        const min = Math.min(...frame);
        const max = Math.max(...frame);
        const range = max - min || 1;
        
        // Draw each mel bin
        for (let i = 0; i < n_mels; i++) {
            const value = frame[i];
            const normalized = (value - min) / range;
            
            // Use a colormap (blue to cyan to green)
            const hue = 240 - (normalized * 120); // Blue (240) to Cyan (120)
            const saturation = 100;
            const lightness = 20 + (normalized * 60); // Dark to bright
            
            ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            ctx.fillRect(x, melHeight - (i + 1) * binHeight, frameWidth, binHeight);
        }
    });
}

/**
 * Display static spectrogram image
 */
export function displaySpectrogram(container, base64Data) {
    if (!container) return;
    
    container.innerHTML = `
        <div class="spectrogram-wrapper">
            <h4>Mel Spectrogram:</h4>
            <img src="data:image/png;base64,${base64Data}" alt="Spectrogram" loading="lazy" class="spectrogram-image">
        </div>
    `;
}

