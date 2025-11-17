#!/bin/bash
# Test runner script for TTS project

set -e

echo "🧪 Running TTS Project Tests"
echo "============================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}❌ Cargo not found. Please install Rust first.${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Running unit tests...${NC}"
cargo test --package tts_core --package llm_core --package server --lib || {
    echo -e "${RED}❌ Unit tests failed${NC}"
    exit 1
}

echo -e "${GREEN}✅ Unit tests passed${NC}"

echo -e "${YELLOW}🔗 Running integration tests...${NC}"
cargo test --package server --test integration || {
    echo -e "${RED}❌ Integration tests failed${NC}"
    exit 1
}

echo -e "${GREEN}✅ Integration tests passed${NC}"

echo -e "${YELLOW}🎯 Running end-to-end tests...${NC}"
cargo test --package server --test e2e || {
    echo -e "${RED}❌ End-to-end tests failed${NC}"
    exit 1
}

echo -e "${GREEN}✅ End-to-end tests passed${NC}"

echo -e "${GREEN}🎉 All tests passed!${NC}"

