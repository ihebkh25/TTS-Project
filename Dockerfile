# Build stage
FROM rust:1.82-slim AS builder

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

# Copy workspace and all crates
COPY Cargo.toml Cargo.lock ./
COPY tts_core ./tts_core
COPY llm_core ./llm_core
COPY server ./server

# Build release binary
# Use sparse registry index to save space
ENV CARGO_NET_SPARSE_REGISTRY=true
RUN cargo build --release --bin server

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies (including espeak!)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    libespeak-ng1 \
    espeak-ng-data && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 appuser

# Copy binary from builder
COPY --from=builder /app/target/release/server /app/server

# Models are mounted as a volume at runtime (see docker-compose.yml)
# This avoids bloating the image and allows updating models without rebuilding

# Set ownership
RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 8085

ENV PORT=8085
ENV RUST_LOG=info

# Set PIPER_ESPEAKNG_DATA_DIRECTORY at runtime (finds espeak-ng-data directory dynamically)
CMD ["sh", "-c", "export PIPER_ESPEAKNG_DATA_DIRECTORY=$(find /usr/lib -type d -name 'espeak-ng-data' -exec dirname {} \\; | head -1) && exec /app/server"]
