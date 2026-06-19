FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:1-slim
WORKDIR /app
# OCR toolchain: poppler (pdftoppm) rasterizes PDF pages, tesseract reads them.
# Spanish + English language data covers the clinical documents we handle.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     poppler-utils tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
RUN mkdir -p /app/data/files /app/data/models
ENV TZ=America/Bogota
CMD ["bun", "src/main.ts"]
