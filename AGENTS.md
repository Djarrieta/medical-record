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

- **Web UI**: always starts on `http://<host>:<port>` (`WEB_PORT` defaults to `3000`) for drag-and-drop file upload (bypasses Telegram's 50MB limit). Password-protected if `WEB_PASSWORD` is set. See `src/webServer.ts`.
- **No test suite.** Validate changes with `bun run typeCheck`.
- **Reset DB**: when the user says "reestablece la base de datos", "resetea los datos", "limpia los datos" or similar, run `./reset.sh`.

## Environment & secrets

- **`.env` contains bot token and API keys** — in `.gitignore`, never commit.
- `.env.example` shows the schema: `BOT_TOKEN`, `ALLOWED_USER_ID`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DATA_DIR`, `QDRANT_URL`, `EMBEDDING_MODEL`.
- `DEEPSEEK_API_KEY` is optional — without it text questions return an error but file upload/indexing still work.
- `WEB_PORT`, `WEB_HOST`, `WEB_PASSWORD` configure the web UI for file upload (always started; `WEB_PORT` defaults to `3000`).

## Architecture

- **Single module** (not a monorepo). Entrypoint: `src/main.ts`.
- **Bot framework**: grammY v1 — `BotApp` class in `src/bot.ts`.
- **LLM**: LangChain `ChatOpenAI` via DeepSeek-compatible API — `LlmProvider` singleton in `src/llm.ts`.
- **File storage**: `FileStore` in `src/fileStore.ts` — saves files to `data/files/`, metadata in SQLite at `data/metadata.db` via `bun:sqlite` (WAL mode).
- **PDF extraction**: `PdfExtractor` in `src/pdfExtractor.ts` — uses `unpdf`.
- **Embeddings**: `EmbeddingProvider` in `src/embedding.ts` — `@huggingface/transformers` pipeline (`Xenova/multilingual-e5-small`, 384-dim), model cached in `data/models/`. Uses E5 prefixes: `passage: ` for indexing, `query: ` for search.
- **Vector DB**: `QdrantStore` in `src/vectorStore.ts` — Qdrant client, collection `documents`, Cosine distance.
- **RAG**: `RagService` in `src/rag.ts` — retrieves top-5 chunks via embedding + Qdrant, answers with DeepSeek. Prompt forces plain-text Spanish replies (no markdown).
- **PDF passwords**: `PasswordStore` in `src/passwordStore.ts` — remembers PDF passwords in SQLite at `data/passwords.db`; tried automatically on locked PDFs before prompting the user.
- **Web upload**: `src/webServer.ts` — Bun HTTP server serving an HTML drag-and-drop upload page, reusing the same PDF→embed→Qdrant pipeline.

## Docker

- **Two containers**: `app` (bot) + `qdrant` (vector DB, port 6333).
- Qdrant is a required dependency — the bot won't start without it.
- `docker-compose.yml` mounts `./data` into both containers (bot uses `data/files`, `data/models`, `data/metadata.db`; Qdrant uses `data/qdrant/`).
- `TZ=America/Bogota` in Dockerfile.

## Telegram bot behavior

The bot is **conversational, not command-driven** — `/start` is the only command. Handlers live in `src/bot.ts`.

| Action | Behavior |
|---|---|
| `/start` | Welcome message |
| Send PDF | Saves to disk + indexes via PDF→split→embed→Qdrant. Locked PDFs: tries known passwords from `PasswordStore`, else prompts for one. |
| Send other document | Saved to disk only (not indexed) |
| Send photo | Saved as JPEG |
| Send text | If awaiting a PDF password, treated as the password; otherwise a RAG question (requires `DEEPSEEK_API_KEY`) |

- Allowlist: `ALLOWED_USER_ID` is a comma-separated list of Telegram user IDs; only those pass the auth middleware in `BotApp.registerMiddlewares()`.
- Text splitting: `RecursiveCharacterTextSplitter`, `chunkSize` 1000, `chunkOverlap` 200 (`src/bot.ts`).
- Pending password state is held in-memory per user (`pendingPasswords` map); successful passwords are persisted to `PasswordStore` for reuse.

## Data persistence

- SQLite at `./data/metadata.db` (WAL mode, auto-created).
- Table: `files` — 7 columns (id, user_id, original_name, mime_type, size, path, created_at).
- PDF passwords in SQLite at `./data/passwords.db` (WAL mode, `PasswordStore`).
- Files at `./data/files/<uuid>.<ext>`.
- Qdrant vector index at `./data/qdrant/`.
- Model cache at `./data/models/`.
- `.gitignore` covers `data/*` except `data/files/.gitkeep`.

## Key patterns

- `LlmProvider` is a singleton — call `LlmProvider.getInstance(config)`. Do NOT instantiate multiple LangChain clients.
- `EmbeddingProvider.initialize()` must be called before `embed()`/`embedQuery()` — happens once at startup in `src/main.ts`.
- `RagService` is only constructed when `DEEPSEEK_API_KEY` is set; it's passed as `null` otherwise, so guard for that in bot/web handlers.
- Qdrant collection auto-created on first `ensureCollection()` call.
- Signal handling in `main.ts`: SIGINT/SIGTERM stop the bot gracefully.
