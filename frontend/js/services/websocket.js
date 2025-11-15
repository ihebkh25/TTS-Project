// WebSocket service for streaming

import { CONFIG } from '../config.js';
import { convertF32ArrayToWavBase64, base64ToBlob } from '../utils/audio.js';
import { playAudio } from '../utils/audio.js';
import { generateWaveform } from '../utils/audio.js';

const { WS_BASE, STREAMING } = CONFIG;

/**
 * Start WebSocket stream for TTS
 */
export function startWebSocketStream(text, language, callbacks) {
    const encodedText = encodeURIComponent(text);
    const wsUrl = `${WS_BASE}/stream/${language}/${encodedText}`;
    
    let ws = null;
    let cleanup = null;
    
    return new Promise((resolve, reject) => {
        let reconnectAttempts = 0;
        const audioSamples = [];
        let sampleRate = STREAMING.DEFAULT_SAMPLE_RATE;
        let receivedChunks = 0;
        
        function connect() {
            ws = new WebSocket(wsUrl);
            
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
                    
                    if (data.status === 'complete') {
                        return;
                    }
                    
                    // Collect audio samples with memory limit
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
                    
                    // Handle mel spectrogram frames
                    if (data.mel && Array.isArray(data.mel)) {
                        callbacks.onMelFrame?.(data.mel);
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
                        
                        base64ToBlob(wavBase64, 'audio/wav').then(async blob => {
                            callbacks.onAudioBlob?.(blob);
                            await generateWaveform(blob, callbacks.waveformCanvas, 120);
                        });
                        
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

