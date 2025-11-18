# Multi-stage build for optimized Rust backend

# Stage 1: Dependencies cache layer
FROM rust:1.82-slim AS deps
WORKDIR /app

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    ca-certificates \
    build-essential \
    libclang-dev \
    clang \
    cmake \
    git \
    libespeak-ng-dev \
    espeak-ng && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files first for better layer caching
COPY Cargo.toml Cargo.lock ./
COPY tts_core/Cargo.toml ./tts_core/
COPY llm_core/Cargo.toml ./llm_core/
COPY server/Cargo.toml ./server/

# Create a dummy source to build dependencies
RUN mkdir -p tts_core/src llm_core/src server/src && \
    echo "fn main() {}" > server/src/main.rs && \
    echo "" > tts_core/src/lib.rs && \
    echo "" > llm_core/src/lib.rs

# Build dependencies only (this layer will be cached)
ENV CARGO_NET_SPARSE_REGISTRY=true
RUN cargo build --release --bin server && \
    rm -rf server/src/main.rs tts_core/src/lib.rs llm_core/src/lib.rs && \
    rm -f target/release/server && \
    rm -rf target/release/deps/server-* && \
    rm -rf target/release/deps/libtts_core-* && \
    rm -rf target/release/deps/libllm_core-*

# Stage 2: Build the actual application
FROM deps AS builder
WORKDIR /app

# Copy source code
COPY tts_core ./tts_core
COPY llm_core ./llm_core
COPY server ./server

# Build the release binary with optimizations
# The dependencies are already built, so this will be faster
ENV CARGO_NET_SPARSE_REGISTRY=true
RUN touch server/src/main.rs tts_core/src/lib.rs llm_core/src/lib.rs && \
    cargo build --release --bin server

# Stage 3: Runtime image
FROM debian:bookworm-slim

WORKDIR /app

# Install only runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    libespeak-ng1 \
    espeak-ng-data && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

# Create non-root user for security
RUN useradd -m -u 1000 appuser && \
    mkdir -p /app/models && \
    chown -R appuser:appuser /app

# Copy binary from builder
COPY --from=builder --chown=appuser:appuser /app/target/release/server /app/server

# Copy models (read-only)
COPY --chown=appuser:appuser models /app/models

USER appuser

EXPOSE 8085

ENV PORT=8085
ENV RUST_LOG=info

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD sh -c "wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1"

# Set PIPER_ESPEAKNG_DATA_DIRECTORY at runtime
CMD ["sh", "-c", "export PIPER_ESPEAKNG_DATA_DIRECTORY=$(find /usr/lib -type d -name 'espeak-ng-data' -exec dirname {} \\; | head -1) && exec /app/server"]
