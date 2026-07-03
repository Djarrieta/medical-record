# medical-records-2

Telegram bot que guarda, indexa y responde preguntas sobre documentos médicos usando IA. Construido con Bun, grammY, Qdrant, LangChain y DeepSeek.

## Setup

```bash
cp .env.example .env
# llena BOT_TOKEN, DEEPSEEK_API_KEY, QDRANT_URL
# y los usuarios autorizados: inline en USERS (JSON en una línea) o vía USERS_FILE
bun install
# iniciar contenedores (Qdrant + app)
sudo docker compose up -d --build
```

O sin Docker (solo app, requiere Qdrant externo):

```bash
bun start
```

## Uso

| Acción | Comportamiento |
|---|---|
| Enviar PDF | Guarda, extrae texto e indexa en Qdrant |
| Enviar foto | Guarda en disco |
| Enviar texto | Busca en documentos indexados y responde con IA (DeepSeek + RAG) |
| `/start` | Mensaje de bienvenida |

No hay comandos de gestión — todo se maneja automáticamente al enviar contenido.

## Arquitectura

```
src/
├── main.ts          # Entry point, inicializa todos los servicios
├── bot.ts           # BotApp — manejadores de grammY
├── config.ts        # Config tipada desde env vars
├── types.ts         # Interfaces compartidas
├── fileStore.ts     # FileStore — disco + SQLite (bun:sqlite)
├── pdfExtractor.ts  # PdfExtractor — extrae texto de PDFs con unpdf
├── llm.ts           # LlmProvider — singleton LangChain + DeepSeek
├── embedding.ts     # EmbeddingProvider — Transformers.js (e5-small, 384d)
├── vectorStore.ts   # QdrantStore — cliente Qdrant, colección "documents"
└── rag.ts           # RagService — retrieval + generación de respuestas
```

## Stack

- **Bot**: grammY v1
- **LLM**: DeepSeek vía LangChain (ChatOpenAI compatible)
- **Vector DB**: Qdrant (Cosine distance, 384-dim)
- **Embeddings**: Transformers.js (Xenova/multilingual-e5-small)
- **PDF**: unpdf
- **Persistencia**: SQLite (bun:sqlite) + disco
- **Docker**: app + qdrant containers

## Data

| Ruta | Contenido |
|---|---|
| `data/app.db` | Metadata de archivos y contraseñas de PDF (SQLite, WAL mode) |
| `data/files/` | Archivos guardados en disco |
| `data/qdrant/` | Índice vectorial de Qdrant |
| `data/models/` | Caché del modelo de embeddings |
