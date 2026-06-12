# syntax=docker/dockerfile:1

# Bun base image (Debian-based so native deps like sharp & sqlite-vec work).
FROM oven/bun:1-debian AS base
WORKDIR /app

# System deps: Spanish OCR data for tesseract, plus libs sharp/sqlite may need at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-spa \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (cached layer).
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# App source.
COPY tsconfig.json ./
COPY src ./src

# Data dir (mounted as a volume in compose): sqlite, vectors, uploads, model cache.
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data \
    MODEL_CACHE_DIR=/app/data/models \
    NODE_ENV=production

# The bot uses long-polling (no inbound port). Only the LAN web UI listens.
EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
