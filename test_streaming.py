#!/usr/bin/env python3

"""
Test script for LLM streaming WebSocket endpoint
Usage: python3 test_streaming.py [message] [language] [conversation_id]
"""

import asyncio
import json
import sys
import time
import urllib.parse
from websockets.client import connect

SERVER_URL = "ws://localhost:8085"
MESSAGE = sys.argv[1] if len(sys.argv) > 1 else "Hello, how are you?"
LANGUAGE = sys.argv[2] if len(sys.argv) > 2 else "en_US"
CONVERSATION_ID = sys.argv[3] if len(sys.argv) > 3 else None

# Build WebSocket URL
params = {
    "message": MESSAGE,
    "language": LANGUAGE
}
if CONVERSATION_ID:
    params["conversation_id"] = CONVERSATION_ID

ws_url = f"{SERVER_URL}/ws/chat/stream?{urllib.parse.urlencode(params)}"

print(f"Connecting to: {ws_url}")
print(f"Message: {MESSAGE}")
print(f"Language: {LANGUAGE}")
if CONVERSATION_ID:
    print(f"Conversation ID: {CONVERSATION_ID}")
print("---\n")

token_count = 0
audio_chunk_count = 0
full_text = ""
start_time = None

async def test_streaming():
    global token_count, audio_chunk_count, full_text, start_time
    
    try:
        async with connect(ws_url) as websocket:
            print("✅ WebSocket connected\n")
            start_time = time.time()
            
            async for message in websocket:
                try:
                    data = json.loads(message)
                    
                    msg_type = data.get("type", "unknown")
                    
                    if msg_type == "status":
                        status = data.get("status", "")
                        msg = data.get("message", "")
                        print(f"📊 Status: {status} - {msg}")
                        if status == "complete":
                            text = data.get("text", full_text)
                            print(f"\n📝 Full text: {text}")
                    
                    elif msg_type == "token":
                        token_count += 1
                        token = data.get("token", "")
                        full_text = data.get("text", full_text)
                        print(token, end="", flush=True)
                    
                    elif msg_type == "audio_chunk":
                        audio_chunk_count += 1
                        audio_size = len(data.get("audio", "")) // 1024 if data.get("audio") else 0
                        sample_rate = data.get("sample_rate", 0)
                        print(f"\n🔊 Audio chunk #{audio_chunk_count} ({audio_size}KB, {sample_rate}Hz)")
                    
                    elif msg_type == "error":
                        print(f"\n❌ Error: {data.get('error', 'Unknown error')}")
                    
                    else:
                        print(f"\n⚠️  Unknown message type: {msg_type}", data)
                
                except json.JSONDecodeError as e:
                    print(f"\n❌ Error parsing message: {e}")
                    print(f"Raw data: {message[:200]}")
                except Exception as e:
                    print(f"\n❌ Error processing message: {e}")
    
    except Exception as e:
        print(f"\n❌ Connection error: {e}")
        return
    
    finally:
        if start_time:
            duration = time.time() - start_time
            print(f"\n---\n✅ Connection closed")
            print(f"   Duration: {duration:.2f}s")
            print(f"   Tokens received: {token_count}")
            print(f"   Audio chunks received: {audio_chunk_count}")
            print(f"   Full text length: {len(full_text)} characters")

if __name__ == "__main__":
    try:
        asyncio.run(test_streaming())
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(1)

