// WebSocket service for streaming

import { CONFIG } from '../config.js';
import { convertF32ArrayToWavBase64, base64ToBlob, generateWaveform } from '../utils/audio.js';

const { STREAMING } = CONFIG;

// Start WebSocket stream for TTS
export function startWebSocketStream(text, language, voice = null, callbacks) {
    const encodedText = encodeURIComponent(text);
    let wsUrl = `${CONFIG.WS_BASE}/stream/${language}/${encodedText}`;
    // Add voice as query parameter if provided
    if (voice) {
        wsUrl += `?voice=${encodeURIComponent(voice)}`;
    }
    
    let ws = null;
    let cleanup = null;
    
    return new Promise((resolve, reject) => {
        let reconnectAttempts = 0;
        const audioSamples = [];
        let sampleRate = STREAMING.DEFAULT_SAMPLE_RATE;
        let receivedChunks = 0;
        let streamMetadata = null;
        let startTime = null;
        let lastChunkTime = null;
        
        function connect() {
            ws = new WebSocket(wsUrl);
            startTime = performance.now();
            
            ws.onopen = () => {
                reconnectAttempts = 0;
                callbacks.onOpen?.();
            };
            
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.error) {
                        throw new Error(data.error);
                    }
                    
                    // Handle different message types
                    const messageType = data.type || (data.status ? 'status' : 'chunk');
                    
                    switch (messageType) {
                        case 'metadata':
                            // Initial metadata message
                            streamMetadata = {
                                sampleRate: data.sample_rate || STREAMING.DEFAULT_SAMPLE_RATE,
                                totalSamples: data.total_samples || 0,
                                estimatedDuration: data.estimated_duration || 0,
                                totalChunks: data.total_chunks || 0,
                                hopSize: data.hop_size || 256
                            };
                            sampleRate = streamMetadata.sampleRate;
                            callbacks.onMetadata?.(streamMetadata);
                            break;
                            
                        case 'status':
                            // Status updates (synthesizing, streaming, complete)
                            if (data.status === 'complete') {
                                return; // Handled in onclose
                            }
                            callbacks.onStatus?.(data.status, data.message);
                            break;
                            
                        case 'chunk':
                            // Audio chunk with progress metadata
                            lastChunkTime = performance.now();
                            
                            if (data.audio && Array.isArray(data.audio)) {
                                if (audioSamples.length + data.audio.length > STREAMING.MAX_AUDIO_SAMPLES) {
                                    console.warn('Audio sample limit reached, stopping stream');
                                    callbacks.onError?.('Stream too long. Maximum audio length exceeded.');
                                    ws.close();
                                    return;
                                }
                                
                                audioSamples.push(...data.audio);
                                receivedChunks++;
                                
                                // Calculate metrics
                                const metrics = {
                                    chunk: data.chunk || receivedChunks,
                                    totalChunks: data.total_chunks || streamMetadata?.totalChunks || 0,
                                    progress: data.progress || 0,
                                    timestamp: data.timestamp || 0,
                                    duration: data.duration || 0,
                                    offset: data.offset || 0,
                                    chunksPerSecond: startTime ? receivedChunks / ((lastChunkTime - startTime) / 1000) : 0,
                                    estimatedTimeRemaining: streamMetadata && data.progress > 0 
                                        ? (streamMetadata.estimatedDuration * (100 - data.progress) / 100)
                                        : null
                                };
                                
                                callbacks.onProgress?.(receivedChunks, metrics);
                            }
                            
                            // Handle mel spectrogram frames
                            if (data.mel && Array.isArray(data.mel)) {
                                callbacks.onMelFrame?.(data.mel);
                            }
                            break;
                            
                        default:
                            // Legacy format support (backward compatibility)
                            if (data.audio && Array.isArray(data.audio)) {
                                if (audioSamples.length + data.audio.length > STREAMING.MAX_AUDIO_SAMPLES) {
                                    console.warn('Audio sample limit reached, stopping stream');
                                    callbacks.onError?.('Stream too long. Maximum audio length exceeded.');
                                    ws.close();
                                    return;
                                }
                                
                                audioSamples.push(...data.audio);
                                receivedChunks++;
                                callbacks.onProgress?.(receivedChunks);
                            }
                            
                            if (data.mel && Array.isArray(data.mel)) {
                                callbacks.onMelFrame?.(data.mel);
                            }
                            break;
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                    callbacks.onError?.(error.message);
                }
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket Error:', error);
            };
            
            ws.onclose = (event) => {
                // Attempt reconnection if needed
                if (callbacks.isStreaming?.() && audioSamples.length === 0 && 
                    reconnectAttempts < STREAMING.RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    callbacks.onReconnecting?.(reconnectAttempts, STREAMING.RECONNECT_ATTEMPTS);
                    
                    setTimeout(() => {
                        if (callbacks.isStreaming?.()) {
                            connect();
                        }
                    }, STREAMING.RECONNECT_DELAY * reconnectAttempts);
                    return;
                }
                
                // Process final audio
                if (callbacks.isStreaming?.() && audioSamples.length > 0) {
                    try {
                        const wavBase64 = convertF32ArrayToWavBase64(audioSamples, sampleRate);
                        
                        // Generate waveform if canvas is provided
                        if (callbacks.waveformCanvas) {
                            base64ToBlob(wavBase64, 'audio/wav').then(async blob => {
                                callbacks.onAudioBlob?.(blob);
                                try {
                                    await generateWaveform(blob, callbacks.waveformCanvas, 120);
                                } catch (waveformError) {
                                    console.warn('Error generating waveform:', waveformError);
                                }
                            });
                        } else {
                            // Still call onAudioBlob even without waveform canvas
                            base64ToBlob(wavBase64, 'audio/wav').then(blob => {
                                callbacks.onAudioBlob?.(blob);
                            });
                        }
                        
                        callbacks.onComplete?.(wavBase64, receivedChunks, audioSamples.length);
                    } catch (error) {
                        console.error('Error converting audio:', error);
                        callbacks.onError?.(`Error converting audio: ${error.message}`);
                    }
                } else if (callbacks.isStreaming?.()) {
                    if (reconnectAttempts >= STREAMING.RECONNECT_ATTEMPTS) {
                        callbacks.onError?.('Connection failed after multiple retry attempts.');
                    } else {
                        callbacks.onError?.('No audio data received from stream.');
                    }
                }
                
                callbacks.onClose?.();
                resolve(cleanup);
            };
        }
        
        connect();
        
        // Store cleanup function
        cleanup = () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        };
    });
}

