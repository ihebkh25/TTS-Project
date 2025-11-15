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
    
    // Store canvas reference for visualizeMelFrame
    return { ctx, melFrames, canvas };
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
 * Visualize audio spectrogram in real-time using FFT
 * @param {HTMLCanvasElement} canvas - Canvas element to draw on
 * @param {HTMLAudioElement} audioElement - Audio element to analyze
 */
export function visualizeAudioSpectrogram(canvas, audioElement) {
    if (!canvas || !audioElement) {
        console.warn('[Spectrogram] Missing canvas or audio element');
        return;
    }
    
    console.log('[Spectrogram] Setting up visualization for audio element');
    
    // Clean up any existing visualization
    if (audioElement._spectrogramCleanup) {
        console.log('[Spectrogram] Cleaning up previous visualization');
        audioElement._spectrogramCleanup();
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('[Spectrogram] Failed to get canvas context');
        return;
    }
    
    // Clear canvas initially
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Reuse existing AudioContext or create new one
    let audioContext = audioElement._audioContext;
    let source = audioElement._audioSource;
    let analyser = audioElement._audioAnalyser;
    
    if (!audioContext || audioContext.state === 'closed') {
        console.log('[Spectrogram] Creating new AudioContext');
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioElement._audioContext = audioContext;
        
        // createMediaElementSource can only be called once per audio element
        // Check if source already exists
        if (!source) {
            try {
                source = audioContext.createMediaElementSource(audioElement);
                audioElement._audioSource = source;
                console.log('[Spectrogram] Created new MediaElementSource');
            } catch (error) {
                console.error('[Spectrogram] Error creating media element source:', error);
                // If source already exists, we need to reuse the existing one
                // This can happen if the audio element was already connected
                return;
            }
        } else {
            console.log('[Spectrogram] Reusing existing MediaElementSource');
        }
        
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        audioElement._audioAnalyser = analyser;
        
        // Connect the audio graph
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        console.log('[Spectrogram] Audio graph connected');
    } else {
        console.log('[Spectrogram] Reusing existing AudioContext');
        // Make sure analyser exists
        if (!analyser) {
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;
            audioElement._audioAnalyser = analyser;
            if (source) {
                source.connect(analyser);
                analyser.connect(audioContext.destination);
            }
        }
    }
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    let animationFrame = null;
    
    function draw() {
        if (audioElement.paused || audioElement.ended) {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
            // Draw final state
            drawSpectrogramFrame(ctx, canvas, dataArray, null);
            return;
        }
        
        analyser.getByteFrequencyData(dataArray);
        drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
        
        animationFrame = requestAnimationFrame(draw);
    }
    
    // Handle play event
    const playHandler = () => {
        console.log('[Spectrogram] Play event triggered');
        // Resume AudioContext if suspended (required by some browsers)
        if (audioContext.state === 'suspended') {
            console.log('[Spectrogram] Resuming suspended AudioContext');
            audioContext.resume().catch(err => {
                console.error('[Spectrogram] Error resuming AudioContext:', err);
            });
        }
        draw();
    };
    
    // Handle pause event
    const pauseHandler = () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
    };
    
    // Handle ended event
    const endedHandler = () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        drawSpectrogramFrame(ctx, canvas, dataArray, null);
    };
    
    audioElement.addEventListener('play', playHandler);
    audioElement.addEventListener('pause', pauseHandler);
    audioElement.addEventListener('ended', endedHandler);
    
    // Store cleanup function
    audioElement._spectrogramCleanup = () => {
        audioElement.removeEventListener('play', playHandler);
        audioElement.removeEventListener('pause', pauseHandler);
        audioElement.removeEventListener('ended', endedHandler);
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
    };
    
    // If audio is already playing, start visualization immediately
    if (!audioElement.paused && !audioElement.ended) {
        playHandler();
    }
}

/**
 * Draw spectrogram frame
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Uint8Array} dataArray - Frequency data array
 * @param {AnalyserNode|null} analyser - Analyser node (null for final state)
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

