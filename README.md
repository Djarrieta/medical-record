# Medical Record Telegram Bot

Personal medical-records assistant with two entry points:

- **LAN-only web UI** for drag-and-drop uploads of PDFs, images and text (no Telegram 20 MB limit).
- **Telegram bot** for asking natural-language questions, answered **strictly from your own
  documents** (RAG) — in Spanish, with citations.

> ⚠️ This bot is a **records lookup tool only**. It never gives medical advice, interpretation,
> diagnosis, or recommendations. See [plan.md](plan.md) for the full design.

## How it works

```
Web UI (LAN) ─┐                            ┌─ Telegram (long-polling)
               ├─► Node.js app (allowlist + consent) ─┤
upload token ─┘        │                       └─ Q&A (RAG)
                       ▼
        ingestion: unlock → extract → OCR → chunk → embed (local)
                       ▼
        SQLite + sqlite-vec (per-user) ──► DeepSeek (minimal snippets only)
```

- **Embeddings** run locally (`transformers.js`, `multilingual-e5-small`, 384-dim, cosine).
- **Q&A** uses DeepSeek (`deepseek-chat`, OpenAI-compatible). Only the retrieved snippets are sent.
- **Storage** is one `better-sqlite3` DB (+ `sqlite-vec`), isolated per Telegram `user_id`.

## Requirements

- [Node.js](https://nodejs.org) 22+ (local dev) or **Docker** + Docker Compose (recommended).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- A [DeepSeek API key](https://platform.deepseek.com).
- For OCR outside Docker: Tesseract Spanish data is fetched by `tesseract.js` automatically; in
  Docker it is installed via `tesseract-ocr-spa`.

## Configuration

Copy the example env and fill it in (never commit `.env`):

```bash
cp .env.example .env
```

Required keys: `TELEGRAM_BOT_TOKEN`, `DEEPSEEK_API_KEY`, and `ALLOWED_USER_IDS`
(comma-separated Telegram numeric user IDs — the bot refuses everyone otherwise).
Get your numeric ID from [@userinfobot](https://t.me/userinfobot). See `.env.example` for all keys.

## Run

### Docker (recommended)

```bash
docker compose up --build
```

`./data` is mounted as a volume so the SQLite DB, vectors, original files, and the embedding-model
cache persist across restarts. The web UI is published on the **LAN only** (port 3000).

### Local dev

```bash
npm install
npm run dev      # watch mode
# or
npm run start
```

## Tests

```bash
npm test
npm run typecheck
```

(Network-free tests cover chunking, extraction dispatch, and message splitting.)

## Bot commands

| Command | What it does |
|---|---|
| `/start` | Welcome + consent prompt |
| `/help` | Usage help |
| *(any text)* | Ask a question, grounded in your documents |
| `/upload` | Get a time-limited LAN upload link |
| `/addnote <texto>` | Store a typed note |
| `/list` | List your documents |
| `/delete <id>` | Delete one document |
| `/reset` | Delete **all** your data |
| `/passwords`, `/addpassword <pwd>`, `/delpassword <id>` | PDF password vault |
| `/privacy` | What data is stored |

## Security notes

- **Allowlist + consent** gate everything; data is isolated per user.
- The upload UI is **LAN/VPN only**, token-gated (single-session, TTL-bound), and over plain HTTP
  on a trusted network (accepted MVP risk — use Tailscale/TLS before wider exposure).
- PDF passwords are secrets: never logged; the chat message for `/addpassword` is deleted after use.
- Minimal retrieved snippets (PHI) are sent to DeepSeek; embeddings and the full corpus stay local.
- Back up `./data` (it contains PHI — store encrypted and access-controlled).
