# Plan: PDF → Vector DB → Q&A Pipeline

Agregar capacidad de recibir PDFs por Telegram, extraer texto, indexar en Qdrant (vector DB), y responder preguntas sobre el contenido.

## Stack elegido

| Componente | Elección | Por qué |
|---|---|---|
| Vector DB | **Qdrant** (Docker) | Ya lo has usado en otros proyectos, maduro, API HTTP |
| Embeddings | **Transformers.js local** (`Xenova/multilingual-e5-small`) | Sin API key, funciona en Bun, offline, mismo approach que medical-record |
| PDF extraction | **unpdf** | Soporta Bun explícitamente, zero dependencies, serverless build |
| Qdrant client | **@qdrant/js-client-rest** (directo) | Más simple que LangChain wrapper, menos riesgo de incompatibilidad de versión |
| LLM | LangChain `ChatOpenAI` → DeepSeek (ya implementado) | Sin cambios |

## Pipeline

```
PDF por Telegram
  → BotApp recibe documento
  → FileStore.save() guarda en disco
  → PdfExtractor.extract(buffer) → texto plano
  → LangChain RecursiveCharacterTextSplitter → chunks
  → EmbeddingProvider.embed(texts) → vectores 384-dim
  → QdrantStore.index(chunks, vectors) → guarda en Qdrant

/ask <pregunta>
  → EmbeddingProvider.embed([query]) → vector query
  → QdrantStore.search(vector, topK=5) → chunks relevantes
  → RagService.answer(query, chunks) → prompt + DeepSeek
  → Responde al usuario
```

## Archivos nuevos

| Archivo | Clase | Rol |
|---|---|---|
| `src/pdfExtractor.ts` | `PdfExtractor` | Extrae texto de PDFs con `unpdf` |
| `src/vectorStore.ts` | `QdrantStore` | Crea collection, indexa chunks, busca por similitud |
| `src/rag.ts` | `RagService` | Q&A: embed query → search → prompt → DeepSeek |
| `src/embedding.ts` | `EmbeddingProvider` | Wrapper de transformers.js, embed textos y queries |
| `Dockerfile` | — | Build de la app Bun |
| `docker-compose.yml` | — | Servicios `app` + `qdrant` |
| `start.sh` | — | `docker compose up -d --build` |
| `stop.sh` | — | `docker compose down` |

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `bot.ts` | Handler de PDF → guarda + extrae + indexa. Nuevo comando `/ask` |
| `main.ts` | Crear PdfExtractor, EmbeddingProvider, QdrantStore, RagService, inyectar en BotApp |
| `config.ts` | Agregar `QDRANT_URL`, `EMBEDDING_MODEL` a `BotConfig` |
| `package.json` | Agregar `unpdf`, `@huggingface/transformers`, `@qdrant/js-client-rest` |
| `.env.example` | Agregar `QDRANT_URL=http://qdrant:6333` |
| `.gitignore` | Agregar `data/qdrant/`, `data/models/` |
| `.env` | Agregar `QDRANT_URL` |

## Dependencias nuevas

```json
{
  "dependencies": {
    "unpdf": "^1.6.2",
    "@huggingface/transformers": "^3.0.0",
    "@qdrant/js-client-rest": "^1.13.0"
  }
}
```

## Docker

```yaml
# docker-compose.yml
services:
  app:
    build: .
    env_file: .env
    environment:
      - QDRANT_URL=http://qdrant:6333
    volumes:
      - ./data:/app/data
    depends_on:
      qdrant:
        condition: service_healthy

  qdrant:
    image: qdrant/qdrant
    ports:
      - "6333:6333"
    volumes:
      - ./data/qdrant:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 5s
      retries: 5
```

## Notas

- DeepSeek **no tiene endpoint de embeddings** por ahora. Por eso usamos modelo local.
- El modelo `Xenova/multilingual-e5-small` produce vectores de **384 dimensiones**. La collection de Qdrant se crea con `size=384, distance=Cosine`.
- La primera vez que arranca la app, transformers.js descarga el modelo (~500MB). Se cachea en `data/models/`.
- Qdrant corre en contenedor Docker separado. `docker compose up -d` arranca todo.
- El bot actual (sin Docker) funciona con `bun start`. Con Docker, `./start.sh` reconstruye y arranca ambos servicios.
