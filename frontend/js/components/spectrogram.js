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
    
    // Store decoded audio buffer for seeking analysis
    let decodedAudioBuffer = null;
    let bufferDecodePromise = null;
    
    // Decode audio buffer when available
    const decodeAudioBuffer = async () => {
        if (decodedAudioBuffer || bufferDecodePromise) {
            return bufferDecodePromise || Promise.resolve(decodedAudioBuffer);
        }
        
        if (!audioElement.src) return null;
        
        bufferDecodePromise = (async () => {
            try {
                const response = await fetch(audioElement.src);
                const arrayBuffer = await response.arrayBuffer();
                const tempContext = new (window.AudioContext || window.webkitAudioContext)();
                decodedAudioBuffer = await tempContext.decodeAudioData(arrayBuffer);
                tempContext.close();
                return decodedAudioBuffer;
            } catch (error) {
                console.warn('[Spectrogram] Could not decode audio buffer:', error);
                return null;
            }
        })();
        
        return bufferDecodePromise;
    };
    
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
        analyser.smoothingTimeConstant = 0.3; // Lower value = more responsive, less smooth
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
            analyser.smoothingTimeConstant = 0.8; // Lower value = more responsive, less smooth
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
    let lastSeekTime = 0;
    let seekUpdateTimeout = null;
    
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
            audioContext.resume().then(() => {
                // Start animation loop immediately after resuming
                if (!animationFrame && !audioElement.paused && !audioElement.ended) {
                    draw();
                }
            }).catch(err => {
                console.error('[Spectrogram] Error resuming AudioContext:', err);
            });
        } else {
            // Start animation loop immediately
            if (!animationFrame && !audioElement.paused && !audioElement.ended) {
                draw();
            }
        }
    };
    
    // Handle pause event
    const pauseHandler = () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        // Update spectrogram to show current position when paused
        if (analyser) {
            analyser.getByteFrequencyData(dataArray);
            drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
        }
    };
    
    // Function to analyze audio buffer at specific time
    async function analyzeBufferAtTime(time) {
        if (!decodedAudioBuffer) {
            await decodeAudioBuffer();
        }
        
        if (!decodedAudioBuffer) return null;
        
        const sampleRate = decodedAudioBuffer.sampleRate;
        const startSample = Math.floor(time * sampleRate);
        const fftSize = 2048;
        
        if (startSample >= decodedAudioBuffer.length) return null;
        
        // Get samples from buffer
        const channelData = decodedAudioBuffer.getChannelData(0);
        const endSample = Math.min(startSample + fftSize, decodedAudioBuffer.length);
        const samples = channelData.slice(startSample, endSample);
        
        // Pad to fftSize if needed
        const paddedSamples = new Float32Array(fftSize);
        paddedSamples.set(samples, 0);
        
        // Use OfflineAudioContext to analyze
        try {
            const offlineContext = new OfflineAudioContext(1, fftSize, sampleRate);
            const source = offlineContext.createBufferSource();
            const buffer = offlineContext.createBuffer(1, fftSize, sampleRate);
            buffer.copyToChannel(paddedSamples, 0);
            source.buffer = buffer;
            
            const tempAnalyser = offlineContext.createAnalyser();
            tempAnalyser.fftSize = fftSize;
            source.connect(tempAnalyser);
            tempAnalyser.connect(offlineContext.destination);
            
            source.start(0);
            await offlineContext.startRendering();
            
            const result = new Uint8Array(tempAnalyser.frequencyBinCount);
            tempAnalyser.getByteFrequencyData(result);
            
            return result;
        } catch (error) {
            console.warn('[Spectrogram] Error analyzing buffer:', error);
            return null;
        }
    }
    
    // Handle seek event (when currentTime changes, e.g., via slider)
    const seekHandler = () => {
        lastSeekTime = Date.now();
        // Update spectrogram when seeking, especially when paused
        if (audioElement.paused && !audioElement.ended) {
            // Clear any pending timeout
            if (seekUpdateTimeout) {
                clearTimeout(seekUpdateTimeout);
            }
            
            // When seeking while paused, analyze the audio buffer at that position
            seekUpdateTimeout = setTimeout(async () => {
                if (audioElement.paused && audioElement.currentTime !== undefined) {
                    try {
                        const seekData = await analyzeBufferAtTime(audioElement.currentTime);
                        if (seekData) {
                            // Copy to main data array
                            const copyLength = Math.min(seekData.length, dataArray.length);
                            for (let i = 0; i < copyLength; i++) {
                                dataArray[i] = seekData[i];
                            }
                            drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
                        } else if (analyser) {
                            // Fallback to analyser
                            analyser.getByteFrequencyData(dataArray);
                            drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
                        }
                    } catch (error) {
                        console.warn('[Spectrogram] Error in seek handler:', error);
                        // Fallback to analyser
                        if (analyser) {
                            analyser.getByteFrequencyData(dataArray);
                            drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
                        }
                    }
                }
            }, 50);
        }
    };
    
    // Handle timeupdate event (fires during seeking and playback)
    const timeUpdateHandler = () => {
        const timeSinceSeek = Date.now() - lastSeekTime;
        // Update spectrogram during seeking when paused (within 500ms of seek)
        // This provides smoother updates while dragging the slider
        if (audioElement.paused && !audioElement.ended && timeSinceSeek < 500) {
            // Throttle updates to avoid excessive redraws
            if (seekUpdateTimeout) {
                clearTimeout(seekUpdateTimeout);
            }
            seekUpdateTimeout = setTimeout(async () => {
                if (audioElement.paused && audioElement.currentTime !== undefined) {
                    try {
                        const seekData = await analyzeBufferAtTime(audioElement.currentTime);
                        if (seekData) {
                            // Copy to main data array
                            const copyLength = Math.min(seekData.length, dataArray.length);
                            for (let i = 0; i < copyLength; i++) {
                                dataArray[i] = seekData[i];
                            }
                            drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
                        } else if (analyser) {
                            // Fallback to analyser
                            analyser.getByteFrequencyData(dataArray);
                            drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
                        }
                    } catch (error) {
                        // Fallback to analyser on error
                        if (analyser) {
                            analyser.getByteFrequencyData(dataArray);
                            drawSpectrogramFrame(ctx, canvas, dataArray, analyser);
                        }
                    }
                }
            }, 16); // ~60fps update rate
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
    
    // Start decoding buffer in background when audio loads
    const loadHandler = () => {
        if (audioElement.src) {
            decodeAudioBuffer().catch(err => console.warn('[Spectrogram] Buffer decode error:', err));
        }
    };
    
    if (audioElement.readyState >= 2) {
        // Audio already loaded
        loadHandler();
    } else {
        audioElement.addEventListener('loadeddata', loadHandler, { once: true });
    }
    
    audioElement.addEventListener('play', playHandler);
    audioElement.addEventListener('pause', pauseHandler);
    audioElement.addEventListener('seeked', seekHandler);
    audioElement.addEventListener('timeupdate', timeUpdateHandler);
    audioElement.addEventListener('ended', endedHandler);
    
    // Store cleanup function
    audioElement._spectrogramCleanup = () => {
        audioElement.removeEventListener('play', playHandler);
        audioElement.removeEventListener('pause', pauseHandler);
        audioElement.removeEventListener('seeked', seekHandler);
        audioElement.removeEventListener('timeupdate', timeUpdateHandler);
        audioElement.removeEventListener('ended', endedHandler);
        audioElement.removeEventListener('loadeddata', loadHandler);
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        if (seekUpdateTimeout) {
            clearTimeout(seekUpdateTimeout);
            seekUpdateTimeout = null;
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

