# medical-record AGENTS.md

## Runtime & package manager

- **Node.js 22+** (not Bun). Commands use `npm`.
- Install: `npm install`
- Dev runner: `tsx` (TypeScript execute)
- Test runner: `vitest`

## Key commands

| Action | Command |
|---|---|
| Start production | `npm run start` (runs `tsx src/index.ts`) |
| Dev (watch mode) | `npm run dev` (`tsx watch src/index.ts`) |
| Run tests | `npm test` (`vitest run`) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |

## Deployment (Docker)

```bash
docker compose up --build
```

- Container name: `medical-record-bot`
- Web UI port: **3003** (LAN-only, token-gated)
- Volume mount: `./data:/app/data` (persists SQLite, vectors, uploads, model cache)
- Uses `node:22-slim` with `tesseract-ocr-spa` for OCR

## Environment & secrets

- `.env` contains secrets (Telegram token, DeepSeek key) — in `.gitignore`, never commit.
- `.env.example` shows the schema with all configurable vars.
- Required: `TELEGRAM_BOT_TOKEN`, `DEEPSEEK_API_KEY`, `ALLOWED_USER_IDS`.

## Architecture notes

- **Single module** (not a monorepo). Entrypoint: `src/index.ts`.
- **Bot framework**: grammy (Telegram long-polling, no inbound ports).
- **Web server**: Hono + `@hono/node-server` for LAN upload UI.
- **Storage**: `better-sqlite3` (replaces old `bun:sqlite`) + `sqlite-vec` for vector search.
- **Embeddings**: Local via `transformers.js` (`Xenova/multilingual-e5-small`, 384-dim).
- **LLM**: DeepSeek (`deepseek-chat`, OpenAI-compatible API). Only retrieved snippets sent.
- **RAG constants** live in `src/rag-config.ts` (split from `src/config.ts` to avoid early env validation).
- **Allowlist + consent** gate everything; data isolated per `user_id`.

## Key deps

| Package | Purpose |
|---|---|
| `grammy` | Telegram bot framework |
| `hono` + `@hono/node-server` | Web server (LAN upload UI) |
| `better-sqlite3` | SQLite driver |
| `sqlite-vec` | Vector search extension |
| `@huggingface/transformers` | Local embeddings |
| `tesseract.js` | OCR (PDF/image text extraction) |
| `pdf-to-img` / `unpdf` | PDF page rendering |
| `sharp` | Image processing |
| `tsx` | TypeScript execution for Node.js |
| `vitest` | Test runner |

## History

- **Migrated from Bun to Node.js 22+** (commits `6ee136e`, `11fa99d`). Notable changes:
  - `bun:sqlite` → `better-sqlite3`, `Bun.serve` → `@hono/node-server`, `bun test` → `vitest`
  - Port changed from 3002 → 3003
  - RAG constants split from `config.ts` into `rag-config.ts`
