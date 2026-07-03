# medical-records-2 — AGENTS.md

## Runtime & package manager

- **Bun** (not Node.js). Commands use `bun` everywhere.
- Install: `bun install`

## Key commands

| Action | Command |
|---|---|
| Start bot | `bun start` (runs `src/main.ts`) |
| Typecheck | `bun run typeCheck` (`bunx tsc --noEmit`) |
| Start containers | `./start.sh` — `git pull` + `sudo docker compose up -d --build` (full image rebuild) |
| Deploy code change | `./deploy.sh` — `git pull` + `docker compose restart app` (no rebuild; `src/` & `web/dist/` are bind-mounted) |
| Stop containers | `./stop.sh` — `sudo docker compose down` |
| Reset all data | `./reset.sh` — stops containers, deletes DB/files/Qdrant/models, rebuilds |

- **Web UI**: always starts on `http://<host>:<port>` (`WEB_PORT` defaults to `3000`) for drag-and-drop file upload (bypasses Telegram's 50MB limit). Password-protected if `WEB_PASSWORD` is set. The UI is a React SPA in `web/` built to `web/dist/` (committed); the Bun server in `src/infrastructure/web/webServer.ts` serves that static bundle + the JSON API.
- **Building the web UI**: `bun run build:web` (runs `vite build` inside `web/`). The build is **never run on the server** — `web/dist/` is committed, so deploy is just `git pull` + restart. Rebuild + commit `web/dist/` whenever you change anything under `web/src/`.
- **No test suite.** Validate changes with `bun run typeCheck`.
- **Never commit or push unless explicitly asked.** When the user requests code changes, make the edits and validate them, but do NOT run `git commit`/`git push` — only do so when the user explicitly says to commit/push/sync.
- **Reset DB**: when the user says "reestablece la base de datos", "resetea los datos", "limpia los datos" or similar, run `./reset.sh`.
- **Data is disposable — no backwards compatibility.** `./reset.sh` may be run at any time; deleting all existing data (DB, files, Qdrant, models) is always acceptable. Do NOT add migration code, legacy fallbacks, or data-preservation paths. Prefer the simplest implementation and let a reset wipe incompatible data (e.g. after an embedding-model or vector-dimension change).

## Environment & secrets

- **`.env` contains bot token and API keys** — in `.gitignore`, never commit.
- `.env.example` shows the schema: `BOT_TOKEN`, `USERS_FILE`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DATA_DIR`, `QDRANT_URL`, `EMBEDDING_MODEL`, and the optional email vars (`EMAIL_ENABLED`, `EMAIL_POLL_SECONDS`, `EMAIL_QUERY_DAYS`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER`).
- **User registry**: authorized users live in `users.json` (gitignored; `users.json.example` ships the schema `[{ id, name, email? }]`). `USERS_FILE` (default `./users.json`) points at it. `Config` loads it at boot and exposes `config.users` + `config.allowedUserIds`. This **replaces** the old `ALLOWED_USER_ID` env var. A user's `email` is the attribution key for forwarded mail.
- `DEEPSEEK_API_KEY` is optional — without it text questions return an error but file upload/indexing still work.
- `WEB_PORT`, `WEB_HOST`, `WEB_PASSWORD` configure the web UI for file upload (always started; `WEB_PORT` defaults to `3000`).

## Architecture

Lightweight Clean Architecture (ports & adapters). Dependencies point inward: `infrastructure → application → domain`.

- **Single module** (not a monorepo). Entrypoint / composition root: `src/main.ts` — the only place that constructs concrete adapters and wires them into use cases.
- **`src/domain/`** — pure core, no external deps. `types.ts` (`FileRecord`, `PendingPassword`, `Note`, `ChunkMetadata`, `SearchResult`) and `ports.ts` (interfaces: `DocumentRepository`, `TextExtractor`, `Chunker`, `Embedder`, `VectorIndex`, `PasswordVault`, `NoteRepository`, `Llm`).
- **`src/application/`** — use cases that orchestrate domain + ports: `IndexPdf` (`indexPdf.ts`, the single PDF→split→embed→index pipeline, shared by bot and web), `IndexImage`, `IndexNote`/`DeleteNote` (text notes), `AskQuestion` (`askQuestion.ts`, RAG), `DeleteDocument` (`deleteDocument.ts`, removes file + vectors).
- **`src/infrastructure/`** — adapters implementing the ports (see below).
- **Bot framework**: grammY v1 — `BotApp` class in `src/infrastructure/telegram/botApp.ts` (driver adapter; depends on use cases + `DocumentRepository`/`PasswordVault` ports).
- **LLM**: LangChain `ChatOpenAI` via DeepSeek-compatible API — `DeepseekLlm` (implements `Llm`) in `src/infrastructure/llm/deepseekLlm.ts`.
- **Shared SQLite**: all relational adapters share a single `bun:sqlite` database at `data/app.db` (WAL mode), opened once in `src/infrastructure/persistence/sqliteDatabase.ts` (`openAppDatabase`) and injected from `src/main.ts`. Each adapter still owns its own table(s) via `CREATE TABLE IF NOT EXISTS`.
- **File storage**: `SqliteDocumentRepository` (implements `DocumentRepository`) in `src/infrastructure/persistence/sqliteDocumentRepository.ts` — saves files to `data/files/`, metadata in the shared `data/app.db` (`files` table). Takes the shared `Database` + `dataDir` in its constructor.
- **PDF extraction**: `UnpdfTextExtractor` (implements `TextExtractor`) in `src/infrastructure/pdf/unpdfTextExtractor.ts` — uses `unpdf`.
- **Text splitting**: `RecursiveChunker` (implements `Chunker`) in `src/infrastructure/text/recursiveChunker.ts` — `RecursiveCharacterTextSplitter`, `chunkSize` 1000, `chunkOverlap` 200.
- **Embeddings**: `TransformersEmbedder` (implements `Embedder`) in `src/infrastructure/embedding/transformersEmbedder.ts` — `@huggingface/transformers` pipeline (`Xenova/multilingual-e5-small`, 384-dim), model cached in `data/models/`. Uses E5 prefixes: `passage: ` for indexing, `query: ` for search. The Qdrant collection's vector size is derived from the model at startup (`embedder.dimensions()`, probed once in `initialize()`) and passed into `QdrantVectorIndex`, so model and index can never drift; changing the model still requires `./reset.sh` to recreate the collection at the new dimension.
- **Vector DB**: `QdrantVectorIndex` (implements `VectorIndex`) in `src/infrastructure/vector/qdrantVectorIndex.ts` — Qdrant client, collection `documents`, Cosine distance.
- **RAG**: `AskQuestion` use case in `src/application/askQuestion.ts` — retrieves top-5 chunks via `Embedder` + `VectorIndex`, answers via the `Llm` port. Prompt forces plain-text Spanish replies (no markdown).
- **PDF passwords**: `SqlitePasswordVault` (implements `PasswordVault`) in `src/infrastructure/persistence/sqlitePasswordVault.ts` — remembers PDF passwords in the shared `data/app.db` (`passwords` table); tried automatically by `IndexPdf` on locked PDFs before prompting the user. Takes the shared `Database` in its constructor.
- **Notes**: free-form text notes live in their own `notes` table (`SqliteNoteRepository`, shared `app.db`), separate from documents. `IndexNote` (`src/application/indexNote.ts`) saves the note then chunks→embeds→indexes it in Qdrant under the note id (so RAG retrieves it); `DeleteNote` removes note + vectors. Created via the bot's **Nota** button.
- **Web server**: `src/infrastructure/web/webServer.ts` — Bun HTTP server that serves the built React SPA from `web/dist/` (static assets + `index.html` for the `/u/<userId>` entry route) and the JSON API (`/api/files`, `/api/notes`, `/upload`, tag PATCH, raw download); reuses the `IndexPdf`/`IndexImage`/`DeleteDocument`/`DeleteNote` use cases. Auth is per-request via `userId` + session `token` query params.
- **Web frontend**: `web/` — Vite + React + TypeScript SPA (drag-and-drop upload, saved-files admin, notes, tag editing/filtering). Build with `bun run build:web`; output `web/dist/` is committed and served by the Bun server (no server-side build, keeping the 4GB/Core-i3 box light). `web/` has its own `package.json`/`tsconfig.json`, isolated from the backend.

## Docker

- **Two containers**: `app` (bot) + `qdrant` (vector DB, port 6333).
- Qdrant is a required dependency — the bot won't start without it.
- `docker-compose.yml` mounts `./data` into both containers (bot uses `data/files`, `data/models`, `data/app.db`; Qdrant uses `data/qdrant/`).
- **No build step for the backend.** Bun runs TypeScript directly, so `src/` and `web/dist/` are bind-mounted into the `app` container. Code-only deploys are `./deploy.sh` (`git pull` + `docker compose restart app`, seconds, no image rebuild). A full `./start.sh --build` is only needed when dependencies (`package.json` / `bun.lock`) or the `Dockerfile` change — or the first time after the compose volumes change. `node_modules` stays baked in the image (not mounted).
- `TZ=America/Bogota` in Dockerfile.

## Telegram bot behavior

The bot is **conversational, not command-driven** — `/start` is the only command. Handlers live in `src/infrastructure/telegram/botApp.ts`.

| Action | Behavior |
|---|---|
| `/start` | Welcome message |
| Send PDF | Saves to disk + indexes via the `IndexPdf` use case (PDF→split→embed→Qdrant). Locked PDFs: tries known passwords from the `PasswordVault`, else prompts for one. |
| Send other document | Saved to disk only (not indexed) |
| Send photo | Saved as JPEG |
| Send text | Button labels first (**Subir**, **Archivos**, **Contraseña**, **Nota**, **Notas**, **Nuevo**), then pending states (password add, note, PDF password), otherwise an `AskQuestion` (RAG) call (requires `DEEPSEEK_API_KEY`) |
| **Nota** | Prompts for text; the next message is saved as a note via `IndexNote` (`pendingNote` set). |
| **Notas** | Lists notes with an inline 🗑️ button per note (callback `delnote:<id>` → `DeleteNote`). |

- Allowlist: authorized Telegram user IDs come from `config.allowedUserIds` (built from `users.json`); only those pass the auth middleware in `BotApp.registerMiddlewares()`.
- Text splitting lives in `RecursiveChunker`: `RecursiveCharacterTextSplitter`, `chunkSize` 1000, `chunkOverlap` 200 (`src/infrastructure/text/recursiveChunker.ts`).
- Pending password state is held in-memory per user (`pendingPasswords` map); successful passwords are persisted to the `PasswordVault` for reuse.

## Data persistence

- Single SQLite database at `./data/app.db` (WAL mode, auto-created) shared by all relational adapters.
- Table: `files` (`SqliteDocumentRepository`) — id, user_id, original_name, mime_type, size, path, created_at, indexed, sha256, title.
- Table: `passwords` (`SqlitePasswordVault`) — remembered PDF passwords.
- Table: `notes` (`SqliteNoteRepository`) — id, user_id, title, text, created_at.
- Files at `./data/files/<uuid>.<ext>`.
- Qdrant vector index at `./data/qdrant/`.
- Model cache at `./data/models/`.
- `.gitignore` covers `data/*` except `data/files/.gitkeep`.

## Key patterns

- **Dependency rule**: `domain/` has zero external deps; `application/` use cases depend only on `domain/ports.ts` interfaces; `infrastructure/` implements them. Concrete adapters are constructed and injected ONLY in `src/main.ts` (composition root).
- **Shared pipelines live in use cases, not adapters.** PDF indexing is the `IndexPdf` use case (used by both bot and web) — do not re-implement extract→split→embed→index inline.
- `TransformersEmbedder.initialize()` must be called before `embed()`/`embedQuery()` — happens once at startup in `src/main.ts`.
- `AskQuestion` (RAG) is only constructed when `DEEPSEEK_API_KEY` is set; it's passed as `null` to `BotApp` otherwise, so guard for that in handlers.
- Qdrant collection auto-created on first `ensureCollection()` call.
- Signal handling in `main.ts`: SIGINT/SIGTERM stop the bot gracefully.
