#!/usr/bin/env node

/**
 * Test script for LLM streaming WebSocket endpoint
 * Usage: node test_streaming.js [message] [language] [conversation_id]
 */

const WebSocket = require('ws');

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8085';
const MESSAGE = process.argv[2] || 'Hello, how are you?';
const LANGUAGE = process.argv[3] || 'en_US';
const CONVERSATION_ID = process.argv[4] || undefined;

// Build WebSocket URL
let wsUrl = `${SERVER_URL}/ws/chat/stream?message=${encodeURIComponent(MESSAGE)}&language=${LANGUAGE}`;
if (CONVERSATION_ID) {
    wsUrl += `&conversation_id=${encodeURIComponent(CONVERSATION_ID)}`;
}

console.log(`Connecting to: ${wsUrl}`);
console.log(`Message: ${MESSAGE}`);
console.log(`Language: ${LANGUAGE}`);
if (CONVERSATION_ID) {
    console.log(`Conversation ID: ${CONVERSATION_ID}`);
}
console.log('---\n');

const ws = new WebSocket(wsUrl);

let tokenCount = 0;
let audioChunkCount = 0;
let fullText = '';
let startTime = Date.now();

ws.on('open', () => {
    console.log('✅ WebSocket connected\n');
    startTime = Date.now();
});

ws.on('message', (data) => {
    try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
            case 'status':
                console.log(`📊 Status: ${message.status} - ${message.message || ''}`);
                if (message.status === 'complete') {
                    console.log(`\n📝 Full text: ${message.text || fullText}`);
                }
                break;
                
            case 'token':
                tokenCount++;
                fullText = message.text || fullText;
                process.stdout.write(message.token);
                break;
                
            case 'audio_chunk':
                audioChunkCount++;
                const audioSize = message.audio ? Math.round(message.audio.length / 1024) : 0;
                console.log(`\n🔊 Audio chunk #${audioChunkCount} (${audioSize}KB, ${message.sample_rate}Hz)`);
                break;
                
            case 'error':
                console.error(`\n❌ Error: ${message.error}`);
                break;
                
            default:
                console.log(`\n⚠️  Unknown message type: ${message.type}`, message);
        }
    } catch (error) {
        console.error(`\n❌ Error parsing message: ${error.message}`);
        console.error(`Raw data: ${data.toString().substring(0, 200)}`);
    }
});

ws.on('error', (error) => {
    console.error(`\n❌ WebSocket error: ${error.message}`);
});

ws.on('close', (code, reason) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n---\n✅ Connection closed`);
    console.log(`   Code: ${code}`);
    console.log(`   Reason: ${reason.toString() || 'Normal closure'}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Tokens received: ${tokenCount}`);
    console.log(`   Audio chunks received: ${audioChunkCount}`);
    console.log(`   Full text length: ${fullText.length} characters`);
    process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Interrupted by user');
    ws.close();
    process.exit(1);
});

// Timeout after 60 seconds
setTimeout(() => {
    console.log('\n\n⏱️  Timeout after 60 seconds');
    ws.close();
    process.exit(1);
}, 60000);

