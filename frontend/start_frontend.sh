#!/bin/bash

# TTS Project Frontend Startup Script
echo "🎵 TTS Project - Frontend Startup"
echo "================================="

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if TTS server is running
echo "🔍 Checking if TTS server is running..."
if curl -s http://localhost:8085/health > /dev/null 2>&1; then
    echo "✅ TTS server is running on port 8085"
else
    echo "⚠️  TTS server is not running on port 8085"
    echo "💡 Start the TTS server first:"
    echo "   cargo run --release -p server"
    echo ""
    echo "🔄 Starting frontend anyway (you can start TTS server later)..."
fi

echo ""
echo "🌐 Starting frontend server on port 8083..."
echo "🔗 Frontend will be available at: http://localhost:8083"
echo "📁 Serving from: $SCRIPT_DIR"
echo ""

# Start the frontend server
python3 serve_frontend.py --port 8083
