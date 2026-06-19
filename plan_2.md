# Plan 2: Indexar imágenes vía OCR

## Objetivo
Que el sistema procese (OCR → chunk → embed → index) imágenes igual que ya hace
con PDFs, desde Telegram (fotos y documentos imagen) y desde la web.
Formatos: JPEG/PNG/TIFF/BMP/GIF (nativos de tesseract). HEIC/WEBP fuera de alcance.

## Diseño
1. Generalizar `TesseractOcr.extract` (src/infrastructure/ocr/tesseractOcr.ts) para
   detectar por magic bytes:
   - `%PDF-` → flujo actual (pdftoppm + tesseract por página).
   - si no → escribir imagen a temp y correr tesseract directo (ignora password).
   Sin cambiar la firma del port `Ocr`.
2. Nuevo use case `IndexImage` (src/application/indexImage.ts): ocr.extract →
   chunker.split → si vacío repo.setIndexed(false)+reason "empty"; si hay texto
   embed + vectorIndex.index + repo.setIndexed(true). Reusa Ocr, Chunker, Embedder,
   VectorIndex, DocumentRepository. Sin password ni TextExtractor.
3. Wiring en src/main.ts: construir IndexImage y pasarlo a BotApp y startWebServer.
4. Bot (src/infrastructure/telegram/botApp.ts):
   - `:photo`: tras guardar, indexar y reportar indexado/sin-texto.
   - `:document`: si mime empieza con "image/", enrutar a IndexImage.
5. Web (src/infrastructure/web/webServer.ts):
   - POST /upload: si mime empieza con "image/", indexar vía IndexImage.
   - Frontend: badges/estados de saved-files y cola tratan imágenes como indexables.

## Verificación
- `bun run typeCheck`
- Telegram: enviar foto de un documento → responde indexada; preguntar su contenido.
- Web: subir JPG/PNG escaneado → "Guardado e indexado"; imagen sin texto → aviso "empty".

## Decisiones
- Use case separado IndexImage (no extender IndexPdf): imágenes no usan password/textExtractor.
- Una sola impl OCR que detecta PDF vs imagen; el port `Ocr` no cambia.
- Sin HEIC/WEBP (no se toca Dockerfile).
