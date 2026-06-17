# medical-records-2 — AGENTS.md

## Runtime & package manager

- **Bun** (not Node.js). Commands use `bun` everywhere.
- Install: `bun install`

## Key commands

| Action | Command |
|---|---|
| Start bot | `bun start` (runs `src/main.ts`) |
| Typecheck | `bun run typeCheck` (`bunx tsc --noEmit`) |

- **No test suite exists.** Zero test files. Validate changes with `bun run typeCheck`.

## Environment & secrets

- **`.env` contains bot token and API keys** — in `.gitignore`, never commit.
- `.env.example` shows the schema: `BOT_TOKEN`, `ALLOWED_USER_ID`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DATA_DIR`.

## Architecture

- **Single module** (not a monorepo). Entrypoint: `src/main.ts`.
- **Bot framework**: grammY v1 — `BotApp` class in `src/bot.ts`.
- **LLM**: LangChain `ChatOpenAI` via DeepSeek-compatible API — `LlmProvider` singleton in `src/llm.ts`.
- **File storage**: `FileStore` in `src/fileStore.ts` — saves files to `data/files/`, metadata in SQLite at `data/metadata.db` via `bun:sqlite` (WAL mode).
- **Config**: `Config` class in `src/config.ts` — typed config from env vars.
- **Types**: `BotConfig`, `FileRecord` interfaces in `src/types.ts`.

## Data persistence

- SQLite at `./data/metadata.db` (WAL mode, auto-created).
- Table: `files` — 7 columns (id, user_id, original_name, mime_type, size, path, created_at).
- Files stored on disk at `./data/files/<uuid>.<ext>`.
- `.gitignore` covers `data/*` except `data/files/.gitkeep`.

## Telegram bot commands

| Command | Handler location |
|---|---|
| `/start` | `src/bot.ts:33` |
| `/list` | `src/bot.ts:96` |
| `/get <id>` | `src/bot.ts:115` |
| `/delete <id>` | `src/bot.ts:138` |
| `/note <text>` | `src/bot.ts:156` |
| `:document` | `src/bot.ts:45` |
| `:photo` | `src/bot.ts:70` |

- Unauthorized users (not `ALLOWED_USER_ID`) get rejected at middleware (`src/bot.ts:19`).
- Bot catches errors globally via `bot.catch()` at `src/bot.ts:27`.

## Key patterns

- `LlmProvider` is a singleton — call `LlmProvider.getInstance(config)` to get the `ChatOpenAI` instance. Do NOT instantiate multiple LLM clients.
- `FileStore` writes files to disk and SQLite atomically within one method (`save`).
- Signal handling in `main.ts`: SIGINT/SIGTERM stop the bot gracefully.

## Future (planned)

Plan at [`PLAN.md`](PLAN.md) covers the PDF → Vector DB → RAG pipeline:
- PDF extraction via `unpdf`
- Vector DB via Qdrant (Docker, port 6333)
- Embeddings via Transformers.js (`Xenova/multilingual-e5-small`, 384-dim)
- RAG with DeepSeek for answer generation

## GitHub

- Username: **Djarrieta**
- Repo: `Djarrieta/medical-records-2` at `/home/dario/medical-records-2`
- Sibling repo: `Djarrieta/medical-record` (older version) at `/home/dario/medical-record`

## Server services

| Service | Container | Access | Details |
|---|---|---|---|
| **Medical Record Bot v1** | `medical-record-bot` | `http://REDACTED-HOST:3003` (Docker) | Older version at `/home/dario/medical-record` |
