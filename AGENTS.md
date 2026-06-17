# medical-records-2 — AGENTS.md

## Runtime & package manager

- **Bun** (not Node.js). Commands use `bun` everywhere.
- Install: `bun install`

## Key commands

| Action | Command |
|---|---|
| Start bot | `bun start` (runs `src/main.ts`) |
| Typecheck | `bun run typeCheck` (`bunx tsc --noEmit`) |
| Start containers | `./start.sh` — `sudo docker compose up -d --build` |
| Stop containers | `./stop.sh` — `sudo docker compose down` |
| Reset all data | `./reset.sh` — stops containers, deletes DB/files/Qdrant/models, rebuilds |

- **Web UI**: if `WEB_PORT` is set, a web interface starts on `http://<host>:<port>` for drag-and-drop file upload (bypasses Telegram's 50MB limit). Password-protected if `WEB_PASSWORD` is set.
- **No test suite.** Validate changes with `bun run typeCheck`.
- **Reset DB**: when the user says "reestablece la base de datos", "resetea los datos", "limpia los datos" or similar, run `./reset.sh`.

## Environment & secrets

- **`.env` contains bot token and API keys** — in `.gitignore`, never commit.
- `.env.example` shows the schema: `BOT_TOKEN`, `ALLOWED_USER_ID`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DATA_DIR`, `QDRANT_URL`, `EMBEDDING_MODEL`.
- `DEEPSEEK_API_KEY` is optional — without it `/ask` returns an error but file upload/download work.
- `WEB_PORT`, `WEB_HOST`, `WEB_PASSWORD` configure the optional web UI for file upload.

## Architecture

- **Single module** (not a monorepo). Entrypoint: `src/main.ts`.
- **Bot framework**: grammY v1 — `BotApp` class in `src/bot.ts`.
- **LLM**: LangChain `ChatOpenAI` via DeepSeek-compatible API — `LlmProvider` singleton in `src/llm.ts`.
- **File storage**: `FileStore` in `src/fileStore.ts` — saves files to `data/files/`, metadata in SQLite at `data/metadata.db` via `bun:sqlite` (WAL mode).
- **PDF extraction**: `PdfExtractor` in `src/pdfExtractor.ts` — uses `unpdf`.
- **Embeddings**: `EmbeddingProvider` in `src/embedding.ts` — Transformers.js (`Xenova/multilingual-e5-small`, 384-dim), model cached in `data/models/`.
- **Vector DB**: `QdrantStore` in `src/vectorStore.ts` — Qdrant client, collection `documents`, Cosine distance.
- **RAG**: `RagService` in `src/rag.ts` — retrieves top-5 chunks via embedding + Qdrant, answers with DeepSeek.

## Docker

- **Two containers**: `app` (bot) + `qdrant` (vector DB, port 6333).
- Qdrant is a required dependency — the bot won't start without it.
- `docker-compose.yml` mounts `./data` into both containers (bot uses `data/files`, `data/models`, `data/metadata.db`; Qdrant uses `data/qdrant/`).
- `TZ=America/Bogota` in Dockerfile.

## Telegram bot commands

| Command | Location | Notes |
|---|---|---|
| `/start` | `src/bot.ts:53` | Welcome message |
| Send PDF/document | `src/bot.ts:66` | Saves + indexes via PDF→embed→Qdrant pipeline |
| Send photo | `src/bot.ts:112` | Saves as JPEG |
| `/list` | `src/bot.ts:138` | Paginated (40 per message) |
| `/get <id>` | `src/bot.ts:157` | Downloads file |
| `/delete <id>` | `src/bot.ts:180` | Deletes file + disk |
| `/note <text>` | `src/bot.ts:198` | Saves text as `.txt` file |
| `/ask <question>` | `src/bot.ts:219` | RAG query — requires `DEEPSEEK_API_KEY` |

- Single-user: only `ALLOWED_USER_ID` passes the middleware (`src/bot.ts:39`).

## Data persistence

- SQLite at `./data/metadata.db` (WAL mode, auto-created).
- Table: `files` — 7 columns (id, user_id, original_name, mime_type, size, path, created_at).
- Files at `./data/files/<uuid>.<ext>`.
- Qdrant vector index at `./data/qdrant/`.
- Model cache at `./data/models/`.
- `.gitignore` covers `data/*` except `data/files/.gitkeep`.

## Key patterns

- `LlmProvider` is a singleton — call `LlmProvider.getInstance(config)`. Do NOT instantiate multiple LangChain clients.
- `EmbeddingProvider.initialize()` must be called before `embed()`/`embedQuery()` — happens once at startup in `main.ts:43`.
- Qdrant collection auto-created on first `ensureCollection()` call.
- Signal handling in `main.ts`: SIGINT/SIGTERM stop the bot gracefully.
