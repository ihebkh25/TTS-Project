#!/bin/bash

# Simple test script using curl and wscat (if available) or websocat

echo "Testing LLM Streaming WebSocket Endpoint"
echo "========================================="
echo ""

# Test 1: Check if server is running
echo "1. Checking if server is running..."
if curl -s http://localhost:8085/health > /dev/null 2>&1; then
    echo "   ✅ Server is running"
else
    echo "   ❌ Server is not running. Please start the server first."
    echo "   Run: cargo run --release -p server"
    exit 1
fi

echo ""
echo "2. Testing WebSocket endpoint..."

# Check if websocat is available
if command -v websocat &> /dev/null; then
    echo "   Using websocat..."
    MESSAGE="Hello, this is a test"
    LANGUAGE="en_US"
    URL="ws://localhost:8085/ws/chat/stream?message=$(echo -n "$MESSAGE" | jq -sRr @uri)&language=$LANGUAGE"
    echo "   URL: $URL"
    echo ""
    websocat "$URL" --text
elif command -v wscat &> /dev/null; then
    echo "   Using wscat..."
    MESSAGE="Hello, this is a test"
    LANGUAGE="en_US"
    URL="ws://localhost:8085/ws/chat/stream?message=$(echo -n "$MESSAGE" | jq -sRr @uri)&language=$LANGUAGE"
    echo "   URL: $URL"
    echo ""
    wscat -c "$URL"
else
    echo "   ⚠️  websocat or wscat not found. Install one of them:"
    echo "      - websocat: cargo install websocat"
    echo "      - wscat: npm install -g wscat"
    echo ""
    echo "   Or use the Python test script:"
    echo "      python3 test_streaming.py \"Hello, this is a test\" en_US"
    exit 1
fi

