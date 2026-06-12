# syntax=docker/dockerfile:1

FROM node:22-slim AS base
WORKDIR /app

# System deps: Spanish OCR data for tesseract, plus libs sharp/canvas may need at runtime + build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-spa \
    ca-certificates \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (cached layer).
COPY package.json package-lock.json ./
RUN npm install

# App source.
COPY tsconfig.json ./
COPY src ./src

# Data dir (mounted as a volume in compose): sqlite, vectors, uploads, model cache.
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data \
    MODEL_CACHE_DIR=/app/data/models \
    NODE_ENV=production

EXPOSE 3003

CMD ["npx", "tsx", "src/index.ts"]
