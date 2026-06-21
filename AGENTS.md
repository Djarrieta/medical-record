# medical-records-2 — AGENTS.md

## Runtime & package manager

- **Bun** (not Node.js). Commands use `bun` everywhere.
- Install: `bun install`

## Key commands

| Action | Command |
|---|---|
| Start bot | `bun start` (runs `src/main.ts`) |
| Authorize mail | `bun run auth:mail` (one-time OAuth2 consent for Outlook/Hotmail; stores refresh token in `data/graph-token.json`) |
| Typecheck | `bun run typeCheck` (`bunx tsc --noEmit`) |
| Start containers | `./start.sh` — `sudo docker compose up -d --build` |
| Stop containers | `./stop.sh` — `sudo docker compose down` |
| Reset all data | `./reset.sh` — stops containers, deletes DB/files/Qdrant/models, rebuilds |

- **Web UI**: always starts on `http://<host>:<port>` (`WEB_PORT` defaults to `3000`) for drag-and-drop file upload (bypasses Telegram's 50MB limit). Password-protected if `WEB_PASSWORD` is set. See `src/infrastructure/web/webServer.ts`.
- **No test suite.** Validate changes with `bun run typeCheck`.
- **Reset DB**: when the user says "reestablece la base de datos", "resetea los datos", "limpia los datos" or similar, run `./reset.sh`.

## Environment & secrets

- **`.env` contains bot token and API keys** — in `.gitignore`, never commit.
- `.env.example` shows the schema: `BOT_TOKEN`, `ALLOWED_USER_ID`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DATA_DIR`, `QDRANT_URL`, `EMBEDDING_MODEL`.
- `DEEPSEEK_API_KEY` is optional — without it text questions return an error but file upload/indexing still work.
- `WEB_PORT`, `WEB_HOST`, `WEB_PASSWORD` configure the web UI for file upload (always started; `WEB_PORT` defaults to `3000`).
- **Mail ingestion is optional**: `GRAPH_CLIENT_ID` (+ one-time `bun run auth:mail`) enables polling Outlook/Hotmail for attachments/bodies. Without it the feature stays off (like `DEEPSEEK_API_KEY`). Related: `GRAPH_AUTHORITY` (`consumers`), `GRAPH_TOKEN_PATH`, `MAIL_POLL_SECONDS`, `MAIL_USER_ID`.

## Architecture

Lightweight Clean Architecture (ports & adapters). Dependencies point inward: `infrastructure → application → domain`.

- **Single module** (not a monorepo). Entrypoint / composition root: `src/main.ts` — the only place that constructs concrete adapters and wires them into use cases.
- **`src/domain/`** — pure core, no external deps. `types.ts` (`FileRecord`, `PendingPassword`, `Note`, `MailMessage`, `MailAttachment`, `ChunkMetadata`, `SearchResult`) and `ports.ts` (interfaces: `DocumentRepository`, `TextExtractor`, `Chunker`, `Embedder`, `VectorIndex`, `PasswordVault`, `NoteRepository`, `SenderAllowlist`, `MailSource`, `ProcessedMessages`, `Llm`).
- **`src/application/`** — use cases that orchestrate domain + ports: `IndexPdf` (`indexPdf.ts`, the single PDF→split→embed→index pipeline, shared by bot and web), `IndexImage`, `IndexNote`/`DeleteNote` (text notes), `AskQuestion` (`askQuestion.ts`, RAG), `DeleteDocument` (`deleteDocument.ts`, removes file + vectors), `IngestMail` (`ingestMail.ts`, email → documents/notes).
- **`src/infrastructure/`** — adapters implementing the ports (see below).
- **Bot framework**: grammY v1 — `BotApp` class in `src/infrastructure/telegram/botApp.ts` (driver adapter; depends on use cases + `DocumentRepository`/`PasswordVault` ports).
- **LLM**: LangChain `ChatOpenAI` via DeepSeek-compatible API — `DeepseekLlm` (implements `Llm`) in `src/infrastructure/llm/deepseekLlm.ts`.
- **Shared SQLite**: all relational adapters share a single `bun:sqlite` database at `data/app.db` (WAL mode), opened once in `src/infrastructure/persistence/sqliteDatabase.ts` (`openAppDatabase`) and injected from `src/main.ts`. Each adapter still owns its own table(s) via `CREATE TABLE IF NOT EXISTS`. `migrateLegacyDatabases` does a one-time import of legacy `data/metadata.db`/`data/passwords.db` into `app.db` (renames them `*.migrated` when done).
- **File storage**: `SqliteDocumentRepository` (implements `DocumentRepository`) in `src/infrastructure/persistence/sqliteDocumentRepository.ts` — saves files to `data/files/`, metadata in the shared `data/app.db` (`files` table). Takes the shared `Database` + `dataDir` in its constructor.
- **PDF extraction**: `UnpdfTextExtractor` (implements `TextExtractor`) in `src/infrastructure/pdf/unpdfTextExtractor.ts` — uses `unpdf`.
- **Text splitting**: `RecursiveChunker` (implements `Chunker`) in `src/infrastructure/text/recursiveChunker.ts` — `RecursiveCharacterTextSplitter`, `chunkSize` 1000, `chunkOverlap` 200.
- **Embeddings**: `TransformersEmbedder` (implements `Embedder`) in `src/infrastructure/embedding/transformersEmbedder.ts` — `@huggingface/transformers` pipeline (`Xenova/multilingual-e5-small`, 384-dim), model cached in `data/models/`. Uses E5 prefixes: `passage: ` for indexing, `query: ` for search.
- **Vector DB**: `QdrantVectorIndex` (implements `VectorIndex`) in `src/infrastructure/vector/qdrantVectorIndex.ts` — Qdrant client, collection `documents`, Cosine distance.
- **RAG**: `AskQuestion` use case in `src/application/askQuestion.ts` — retrieves top-5 chunks via `Embedder` + `VectorIndex`, answers via the `Llm` port. Prompt forces plain-text Spanish replies (no markdown).
- **PDF passwords**: `SqlitePasswordVault` (implements `PasswordVault`) in `src/infrastructure/persistence/sqlitePasswordVault.ts` — remembers PDF passwords in the shared `data/app.db` (`passwords` table); tried automatically by `IndexPdf` on locked PDFs before prompting the user. Takes the shared `Database` in its constructor.
- **Notes**: free-form text notes live in their own `notes` table (`SqliteNoteRepository`, shared `app.db`), separate from documents. `IndexNote` (`src/application/indexNote.ts`) saves the note then chunks→embeds→indexes it in Qdrant under the note id (so RAG retrieves it); `DeleteNote` removes note + vectors. Created via the bot's **Nota** button or as email bodies.
- **Sender allowlist**: `SqliteSenderAllowlist` (implements `SenderAllowlist`, shared `app.db`, `senders` table) — user-controlled list of allowed email senders. `matches()` supports exact addresses and `@domain` suffix matches. Managed from the bot's **Correos** button.
- **Mail ingestion**: `OutlookGraphMailSource` (implements `MailSource`) in `src/infrastructure/mail/outlookGraphMailSource.ts` — Microsoft Graph `GET /me/messages` (paginated, `$expand=attachments`) using a delegated OAuth2 refresh token (plain `fetch`, no `@azure/msal-node`; the rotating refresh token is persisted to `data/graph-token.json`). `SqliteProcessedMessages` (`processed_messages` table) dedups handled message ids. `IngestMail` (`src/application/ingestMail.ts`): PDF/image attachments → `IndexPdf`/`IndexImage` (body dropped); attachment-less messages → `IndexNote`. Polled on an interval in `main.ts`. `src/auth-mail.ts` is the one-time `bun run auth:mail` consent helper (auth-code + PKCE, local redirect).
- **Web upload**: `src/infrastructure/web/webServer.ts` — Bun HTTP server serving an HTML drag-and-drop upload page; reuses the `IndexPdf`/`DeleteDocument` use cases.

## Docker

- **Two containers**: `app` (bot) + `qdrant` (vector DB, port 6333).
- Qdrant is a required dependency — the bot won't start without it.
- `docker-compose.yml` mounts `./data` into both containers (bot uses `data/files`, `data/models`, `data/app.db`; Qdrant uses `data/qdrant/`).
- `TZ=America/Bogota` in Dockerfile.

## Telegram bot behavior

The bot is **conversational, not command-driven** — `/start` is the only command. Handlers live in `src/infrastructure/telegram/botApp.ts`.

| Action | Behavior |
|---|---|
| `/start` | Welcome message |
| Send PDF | Saves to disk + indexes via the `IndexPdf` use case (PDF→split→embed→Qdrant). Locked PDFs: tries known passwords from the `PasswordVault`, else prompts for one. |
| Send other document | Saved to disk only (not indexed) |
| Send photo | Saved as JPEG |
| Send text | Button labels first (**Subir**, **Archivos**, **Contraseña**, **Nota**, **Notas**, **Correos**, **Nuevo**), then pending states (password add, note, sender add/remove, PDF password), otherwise an `AskQuestion` (RAG) call (requires `DEEPSEEK_API_KEY`) |
| **Nota** | Prompts for text; the next message is saved as a note via `IndexNote` (`pendingNote` set). |
| **Notas** | Lists notes with an inline 🗑️ button per note (callback `delnote:<id>` → `DeleteNote`). |
| **Correos** | Inline submenu (Agregar/Quitar/Listar) to manage the `SenderAllowlist` (`pendingSenderAdd`/`pendingSenderRemove` states). |

- Allowlist: `ALLOWED_USER_ID` is a comma-separated list of Telegram user IDs; only those pass the auth middleware in `BotApp.registerMiddlewares()`.
- Text splitting lives in `RecursiveChunker`: `RecursiveCharacterTextSplitter`, `chunkSize` 1000, `chunkOverlap` 200 (`src/infrastructure/text/recursiveChunker.ts`).
- Pending password state is held in-memory per user (`pendingPasswords` map); successful passwords are persisted to the `PasswordVault` for reuse.

## Data persistence

- Single SQLite database at `./data/app.db` (WAL mode, auto-created) shared by all relational adapters.
- Table: `files` (`SqliteDocumentRepository`) — id, user_id, original_name, mime_type, size, path, created_at, indexed, sha256, title.
- Table: `passwords` (`SqlitePasswordVault`) — remembered PDF passwords.
- Table: `notes` (`SqliteNoteRepository`) — id, user_id, title, text, created_at.
- Table: `senders` (`SqliteSenderAllowlist`) — allowed email senders (exact address or `@domain`).
- Table: `processed_messages` (`SqliteProcessedMessages`) — ingested mail message ids (dedup).
- Mail OAuth refresh token at `./data/graph-token.json` (auto-rotated; created by `bun run auth:mail`).
- Legacy `data/metadata.db`/`data/passwords.db` are auto-migrated into `app.db` on startup, then renamed `*.migrated`.
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
