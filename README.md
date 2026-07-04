# medical-records-2

Telegram bot que guarda, indexa y responde preguntas sobre documentos médicos usando IA. Construido con Bun, grammY, Qdrant, LangChain y DeepSeek.

## Setup

```bash
cp .env.example .env
# llena BOT_TOKEN, DEEPSEEK_API_KEY, QDRANT_URL
# y los usuarios autorizados: inline en USERS (JSON en una línea)
bun install
# iniciar contenedores (Qdrant + app)
sudo docker compose up -d --build
```

O sin Docker (solo app, requiere Qdrant externo):

```bash
bun start
```

## Uso

El bot es **conversacional, no basado en comandos** — `/start` es el único comando.

| Acción | Comportamiento |
|---|---|
| `/start` | Mensaje de bienvenida |
| Enviar PDF | Guarda, extrae texto (con fallback a OCR) e indexa en Qdrant |
| Enviar foto | Guarda como JPEG e indexa vía OCR |
| Enviar otro documento | Guarda en disco (no se indexa) |
| Enviar texto | Botones (**Subir**, **Archivos**, **Contraseña**, **Nota**, **Notas**), estados pendientes, o pregunta RAG (DeepSeek) |
| **Nota** | Guarda el siguiente mensaje como nota (buscable por RAG) |

Además:

- **Web UI** (`http://<host>:<WEB_PORT>`, por defecto 3000): carga drag-and-drop (evita el límite de 50MB de Telegram), administración de archivos/notas y edición de tags. SPA en React servida desde `web/dist/`.
- **Ingesta de email** (opcional): si `EMAIL_ENABLED=true`, un poller lee un buzón Gmail compartido; el correo reenviado por un usuario registrado se convierte en nota + adjuntos indexados. Ver AGENTS.md → "Email ingestion".

## Arquitectura

Clean Architecture ligera (puertos y adaptadores). Las dependencias apuntan hacia adentro: `infrastructure → application → domain`.

```
src/
├── main.ts               # Composition root: construye adaptadores y cablea use cases
├── domain/               # Núcleo puro: types.ts + ports.ts (interfaces), sin deps externas
├── application/          # Use cases: IndexPdf, IndexImage, IndexNote/UpdateNote/DeleteNote,
│                         #   AskQuestion (RAG), DeleteDocument, IngestEmail
└── infrastructure/       # Adaptadores que implementan los puertos:
    ├── telegram/         #   BotApp (grammY)
    ├── web/              #   servidor Bun + API JSON, sirve el SPA de web/dist/
    ├── llm/              #   DeepseekLlm, LlmTitler, LlmTagger
    ├── embedding/        #   TransformersEmbedder (e5-small, 384d)
    ├── vector/           #   QdrantVectorIndex (colección "documents")
    ├── pdf/ ocr/ text/   #   UnpdfTextExtractor, TesseractOcr, RecursiveChunker
    ├── persistence/      #   SQLite compartido (files, notes, passwords, processed_emails)
    ├── email/ google/    #   GmailApiSource + OAuth (poller de ingesta)
    └── session/          #   InMemorySessionStore (chat + token web con expiración)
```

`web/` es un SPA Vite + React + TypeScript independiente; se compila con `bun run build:web` y el output `web/dist/` se commitea (no se compila en el servidor).

## Stack

- **Bot**: grammY v1
- **LLM**: DeepSeek vía LangChain (ChatOpenAI compatible) — respuestas RAG, títulos y tags
- **Vector DB**: Qdrant (Cosine distance, 384-dim)
- **Embeddings**: Transformers.js (Xenova/multilingual-e5-small)
- **PDF / OCR**: unpdf + Tesseract
- **Email**: Gmail API (poller opcional, read-only)
- **Persistencia**: SQLite (bun:sqlite) + disco
- **Web**: Bun HTTP server + React (Vite) SPA
- **Docker**: app + qdrant containers

## Data

| Ruta | Contenido |
|---|---|
| `data/app.db` | SQLite (WAL): tablas `files`, `notes`, `passwords`, `processed_emails` |
| `data/files/` | Archivos guardados en disco (`<uuid>.<ext>`) |
| `data/qdrant/` | Índice vectorial de Qdrant |
| `data/models/` | Caché del modelo de embeddings |
