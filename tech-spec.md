# Medical Record Telegram Bot — Project Plan

A system for personal medical records with two entry points: a **LAN-only web UI** for
uploading PDFs, images, and records (no Telegram file-size limit), and a **Telegram bot**
for asking natural-language questions about them. Answers are grounded strictly in the
uploaded documents using a Retrieval-Augmented Generation (RAG) pipeline.

The bot is a **personal records lookup tool only**. Typical uses:
- See how a value changes over time (e.g. "¿cómo ha cambiado mi colesterol?").
- Ask when something happened (e.g. "¿cuándo me hicieron este análisis?").
- Look up a result or fact recorded in a document.

It **never gives medical advice, interpretation, diagnosis, or recommendations** — it only
reports what is written in the user's own documents.

---

## 1. Goals & Scope

### In scope (MVP)
- **Upload via a LAN-only web UI:** drag-and-drop **PDF**, **images** (JPG/PNG), and text
  files; no Telegram 20 MB limit. Access is tied to a Telegram user via a one-time link.
- Also accept small files sent directly in Telegram, and `/addnote` to store typed text.
- Extract text from documents (native PDF text, **OCR** for scanned PDFs/images).
- Store and index document content per user.
- Answer questions in **Telegram**, grounded in the user's uploaded documents (RAG).
- Support **password-protected PDFs**: try the user's saved passwords, or prompt for one.
- Best-effort trends over time (e.g. cholesterol across reports) via retrieval — see §6.
- Answer timeline questions ("when did this happen / when was this test done").
- Cite which document/page an answer came from.
- **Allowlist-only access** (`ALLOWED_USER_IDS`); per-user data isolation (multi-user).
- **Spanish only:** all bot messages, prompts, OCR, and answers are in Spanish.

### Non-goals / disclaimers
- **No medical advice at any time:** no interpretation, diagnosis, treatment suggestions,
  or recommendations. The bot only reports facts found in the user's documents.
- If asked for advice/interpretation, the bot declines (in Spanish) and suggests
  consulting a healthcare professional.

---

## 2. High-Level Architecture

```
   Uploads (large / bulk)                      Q&A / management
┌─────────────────────┐                    ┌─────────────────────┐
│  Web UI (LAN-only)   │                    │   Telegram (bot)     │
│  drag-and-drop files │                    │   long-polling       │
└──────────┬──────────┘                    └──────────┬──────────┘
           │ one-time token → user_id                  │
           ▼                                           ▼
     ┌────────────────────────────────────────────────────────┐
     │                     Bot / App (Bun)                       │
     │      access control (allowlist) · consent · routing       │
     └───────────────────┬──────────────────────┬──────────────┘
                         │                        │
                         ▼                        ▼
            ┌────────────────────────┐   ┌────────────────────┐
            │   Ingestion pipeline   │   │      Q&A (RAG)      │
            │ unlock → extract → OCR │   │ embed query →      │
            │ → chunk → embed (local)│   │ retrieve → LLM     │
            └───────────┬────────────┘   └─────────┬──────────┘
                        ▼                           │
             ┌─────────────────────────┐            │
             │  SQLite + sqlite-vec     │◀───────────┘
             │  docs · vectors · meta   │  (per-user, filtered by user_id)
             │  + original files (disk) │
             └────────────┬────────────┘
                          │ minimal snippets
                          ▼
                   ┌───────────────┐
                   │ DeepSeek (LLM)│
                   └───────────────┘
```

**Flow:**
1. **Upload (web UI):** user sends `/upload` in Telegram → bot returns a time-limited,
   single-user link → user opens it on the LAN and drops files → server ingests them under
   that `user_id`. Small files can also be sent directly in Telegram; `/addnote` stores text.
2. **Ingestion:** detect type → (if a PDF is encrypted, unlock with a saved/asked password)
   → extract text (OCR scanned PDFs/images) → chunk → embed locally → store in SQLite +
   `sqlite-vec`, keyed by `user_id`. Runs in the background with progress updates.
3. **Q&A (Telegram, long-polling):** embed the query → retrieve top-k chunks for that user →
   build prompt → call DeepSeek → return a grounded answer with citations.

---

## 3. Tech Stack (proposed)

| Concern            | Recommended choice                        | Alternatives |
|--------------------|-------------------------------------------|--------------|
| Runtime / language | **Bun + TypeScript**                      | Node.js, Deno |
| Telegram framework | **grammY** (long-polling; no public port)  | telegraf, node-telegram-bot-api |
| Upload web UI      | **Bun.serve** + **Hono** (LAN-only, token-gated) | Express, Fastify |
| PDF text extract   | **unpdf** (pdf.js core; supports password-protected PDFs) | pdfjs-dist, mupdf |
| PDF→image (for OCR)| **`pdf-to-img`** / `mupdf` (rasterize scanned pages) | pdfium |
| OCR (scans/images) | **tesseract.js** (Spanish lang `spa`) + `sharp` | Cloud OCR (Azure/Google Vision) |
| Embeddings         | **Local** via `transformers.js` (`Xenova/multilingual-e5-small`, 384-dim, cosine) | OpenAI, Cohere |
| Vector DB          | **`bun:sqlite` + `sqlite-vec`** (one embedded DB) | LanceDB, Chroma |
| LLM (Q&A)          | **DeepSeek** (`deepseek-chat`, OpenAI-compatible API) | local Ollama, OpenAI |
| Metadata/state DB  | **`bun:sqlite`** (same DB as vectors)     | PostgreSQL |
| Config/secrets     | **Bun env** (`.env` loaded natively)      | dotenv |
| Run / deploy       | **Docker** (`docker compose up`)          | bare Bun, PM2 |
| Packaging          | **Bun** (`bun install`, `package.json`)   | npm, pnpm |

> **LLM = DeepSeek** (`deepseek-chat`) via its OpenAI-compatible API for Q&A.
> **Embeddings run locally** with `transformers.js` (a multilingual model) because DeepSeek
> does not offer an embeddings endpoint — this also keeps document vectors on-device.
> Note: only the retrieved text chunks needed to answer a question are sent to DeepSeek; the
> full document corpus and embeddings never leave the host. Verify DeepSeek's data-retention
> terms, since PHI snippets are transmitted to their API.

---

## 4. Project Structure (target)

```
medical-record/
├── plan.md
├── README.md
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── bun.lock
├── src/
│   ├── index.ts                # entrypoint: starts the bot
│   ├── config.ts               # loads settings/secrets from env
│   ├── bot/
│   │   ├── handlers.ts         # command & message handlers
│   │   ├── access.ts           # allowlist + consent checks
│   │   └── keyboards.ts        # inline keyboards / UX
│   ├── web/
│   │   ├── server.ts           # Bun.serve + Hono: LAN-only upload UI + API
│   │   ├── tokens.ts           # one-time upload links tied to user_id
│   │   └── public/             # minimal HTML/JS drag-and-drop page
│   ├── ingestion/
│   │   ├── downloader.ts       # fetch files sent in Telegram
│   │   ├── intake.ts           # shared ingest entrypoint (web + telegram)
│   │   ├── extractors.ts       # PDF/image/text → raw text
│   │   ├── pdfUnlock.ts        # detect encrypted PDFs, try passwords
│   │   ├── pdfRender.ts        # rasterize scanned PDF pages → images for OCR
│   │   ├── ocr.ts              # tesseract.js OCR wrapper
│   │   └── chunker.ts          # split text into chunks
│   ├── rag/
│   │   ├── embeddings.ts       # embed text (local, e5)
│   │   ├── vectorstore.ts      # sqlite-vec wrapper (per-user)
│   │   └── qa.ts               # retrieve + prompt + LLM answer
│   └── storage/
│       ├── db.ts               # bun:sqlite: users(+consent), documents, vectors, audit log
│       └── passwords.ts        # per-user PDF password vault
├── data/                       # gitignored: sqlite+vectors, original files, model cache
└── tests/
    ├── extractors.test.ts
    ├── chunker.test.ts
    └── qa.test.ts
```

### Data model (schema sketch)

One `bun:sqlite` DB; every row is keyed by `user_id` and **all reads filter on it** (the core
isolation control). `content_hash` enables dedup of re-uploaded files.

```sql
users(user_id PK, consent_at, created_at)
documents(doc_id PK, user_id FK, filename, mime, content_hash, pages,
          status, created_at, UNIQUE(user_id, content_hash))
chunks(chunk_id PK, doc_id FK, user_id FK, page, text)
vectors(chunk_id FK, embedding FLOAT[384])      -- sqlite-vec virtual table (cosine)
pdf_passwords(id PK, user_id FK, password, last_used_at)   -- secret; never logged
audit_log(id PK, user_id FK, event, doc_id, created_at)    -- no document contents
```

---

## 5. Bot Commands & UX

| Command / action      | Behavior |
|-----------------------|----------|
| `/start`              | Welcome message + privacy disclaimer + consent prompt |
| `/help`               | How to use the bot |
| *Send a text question*| Answer grounded in the user's documents, with citations |
| `/upload`             | Get a time-limited, single-user link to the LAN upload UI |
| *Send a small file*   | Ingest directly (within Telegram's 20 MB limit); larger files go via the web UI |
| `/addnote <text>`     | Store typed text as a record (distinguishes notes from questions) |
| `/list`               | List the user's uploaded documents |
| `/passwords`          | Show the PDF password vault (entries masked) |
| `/addpassword <pwd>`  | Add a candidate PDF password to try when unlocking |
| `/delpassword <id>`   | Remove a saved password |
| `/delete <id>`        | Delete a specific document and its embeddings |
| `/reset`              | Delete **all** the user's data (right to erasure) |
| `/privacy`            | Show the privacy policy / what data is stored |

UX notes:
- Show a "typing…" / "processing…" indicator during ingestion and Q&A.
- For long answers, format with bullet points and bold the key findings.
- **Split replies over Telegram's 4096-character limit** into multiple messages (keep
  citations/disclaimer with the relevant part).
- Always append a short disclaimer to medical answers.
- When a password is sent in chat, delete that message after use and confirm (it's sensitive).

---

## 6. RAG Pipeline Details

1. **Chunking:** ~300–400 token chunks with ~50–80 token overlap (kept under the embedding
   model's 512-token limit, measured with the **e5 model's own tokenizer**, not a word/char
   approximation); keep page/source metadata.
2. **Embedding:** batch-embed chunks with the local e5 model (prefix passages with
   `"passage: "` and queries with `"query: "`); store vectors + metadata (user_id, doc_id, page).
3. **Retrieval:** top-k (e.g. k=4–6) by cosine similarity, filtered by `user_id`.
4. **Prompting:** system prompt (in Spanish) sets role: "answer strictly from the provided
   context; respond in Spanish; if the info isn't in the documents, say so; **never give
   medical advice, interpretation, or recommendations** — only report what the documents
   say." Inject retrieved chunks + question.
5. **Citation:** include source doc name + page in the response.
6. **Guardrails:** refuse to fabricate; explicitly say when info isn't in the documents;
   decline any request for advice/interpretation and suggest seeing a professional.
7. **Trends/timeline (best-effort):** handled by retrieving multiple relevant chunks and
   letting the LLM read off the values/dates. No structured extraction in the MVP, so trends
   across many documents may be incomplete — the bot should say when it can't be sure.
8. **API resilience:** DeepSeek calls use a request **timeout**, a few **retries with
   backoff** on transient/rate-limit errors, and a clear Spanish fallback message if the LLM
   is unreachable (the local-LLM mode is the longer-term fallback).

---

## 7. Password-Protected PDFs

Medical PDFs are often encrypted, frequently with the user's national ID as the password
(but not always). Handling:

- **Password vault per user:** users save one or more candidate passwords via `/addpassword`,
  stored in a per-user `pdf_passwords` table isolated by `user_id`.
- **Unlock flow on upload:**
  1. Detect whether the PDF is encrypted.
  2. Try each saved password in turn (most-recently-used first).
  3. If one works, decrypt and continue ingestion; remember which one worked.
  4. If none works, ask the user to send the password in chat; on success, offer to save it.
- **Open vs. owner password:** only the open/user password is needed to read text; also handle
  PDFs that open freely but restrict copying.
- **Sensitive data:** passwords (and IDs used as passwords) are secrets — never log them, and
  delete the chat message containing a typed password after use.
- **Failure:** if a PDF can't be unlocked, report it clearly and skip ingestion (no partial index).

---

## 8. Document Upload (Web UI)

Telegram bots can only **download files up to 20 MB**, too small for many medical PDFs.
To lift this, uploading is done through a **LAN-only web UI**; Telegram stays for Q&A and
management. The UI is tied to a Telegram identity, so there's no separate login system.

- **Flow:**
  1. User sends `/upload` in Telegram.
  2. Bot replies with a **time-limited link** (e.g. `http://<home-server>:3000/u/<token>`).
  3. The token maps to the user's `user_id` and is **single-session, TTL-bound**: it stays
     valid for the whole upload session (multiple files) until it expires after a few minutes.
  4. User opens the link on the **same LAN**, drag-and-drops one or more files.
  5. Files are ingested under that `user_id` with live progress; results queryable in Telegram.
- **Bulk:** supports multiple files per session (the original ask: load several, then query).
- **Auth/exposure:** the UI binds to the LAN only (or a private VPN such as Tailscale) — **never
  exposed publicly**. Tokens are random, short-lived, single-session, single-user, and
  rate-limited; uploads are accepted only for allowlisted users.
- **Transport:** uploads go over **plain HTTP on the trusted LAN** (no TLS) — an accepted MVP
  risk; move to a VPN (Tailscale) or TLS before any wider exposure (see §9).
- **Dedup:** each file is **content-hashed (e.g. SHA-256)** on intake; identical re-uploads are
  skipped (or flagged) so retrieval and trends aren't skewed by duplicate chunks.
- **Processing:** ingestion runs through a **serial in-process queue (one job at a time)** to
  bound CPU/OCR load on the home-server; the UI shows live per-file progress.
- **No Telegram size cap:** files go straight to the home-server, bounded only by disk.
- **Same pipeline:** web and Telegram uploads share one ingestion path (`intake.ts`).

> Future option: a self-hosted local Bot API server could raise Telegram's own limit to 2 GB
> and keep uploads fully in-chat, if the web UI ever feels unnecessary.

---

## 9. Security & Privacy

This is the most important section given PHI is involved.

- **Access control:** allowlist-only via `ALLOWED_USER_IDS`; non-listed users are refused.
- **Consent:** require explicit consent on `/start` (stored as a flag) before storing anything.
- **Isolation:** every query/retrieval is filtered by Telegram `user_id`; never cross users.
- **Web UI safety:** LAN-only/VPN, never public; one-time, short-lived, single-user upload
  tokens; uploads accepted only for allowlisted users.
- **Encryption at rest:** deferred for the MVP (personal use); rely on host/volume access
  controls. Revisit before any shared/production deployment. Original files are kept (not purged).
- **Encryption in transit:** Telegram API is HTTPS and LLM API calls are over TLS. **The LAN
  upload UI is plain HTTP** (no TLS) — accepted MVP risk on a trusted private network; switch
  to a VPN (Tailscale) or TLS before any shared/wider deployment.
- **Data minimization:** store only what's needed; allow `/delete` and `/reset` (erasure).
- **Retention policy:** original files are **kept indefinitely** (for citations/re-OCR);
  deletion is user-driven via `/delete` and `/reset`. No automatic time-based deletion.
- **Secrets:** never commit tokens/keys; use `.env` (gitignored) + `.env.example`.
- **PDF password vault:** stored per user to unlock encrypted PDFs; treat as secrets, never
  log, and delete chat messages that contain typed passwords. Encrypt when at-rest encryption is added.
- **Audit log:** record ingestion/deletion events (without logging document contents).
- **Backups:** back up the `data/` volume on a schedule (e.g. periodic snapshot/copy of the
  SQLite DB + original files). Backups contain PHI — store them access-controlled and
  encrypted; verify restore works.
- **LLM data handling:** Q&A uses **DeepSeek (cloud)**, so minimal retrieved PHI snippets are
  sent to their API; embeddings and the full corpus stay local. A local-LLM (Ollama) mode can
  be added later for fully on-device operation.
- **Disclaimer:** the bot is informational only, not a medical device or advice source.

> Compliance (HIPAA/GDPR) may apply depending on use. Document the legal basis before
> any real-world / production deployment.

---

## 10. Setup & Configuration

`.env` keys (see `.env.example`):
```
TELEGRAM_BOT_TOKEN=

LLM_PROVIDER=deepseek                 # deepseek | openai | local
DEEPSEEK_API_KEY=                     # from https://platform.deepseek.com
DEEPSEEK_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat

EMBEDDING_PROVIDER=local              # local (transformers.js) | openai
EMBEDDING_MODEL=Xenova/multilingual-e5-small
MODEL_CACHE_DIR=./data/models         # cache the embedding model (persist/bundle)

# Web upload UI (LAN-only — do NOT expose publicly)
WEB_UI_ENABLED=true
WEB_HOST=0.0.0.0
WEB_PORT=3000
WEB_BASE_URL=http://home-server:3000  # used to build /upload links
UPLOAD_TOKEN_TTL_MIN=10

DATA_DIR=./data
ALLOWED_USER_IDS=                     # REQUIRED: comma-separated allowlist

# Limits (sensible defaults)
RATE_LIMIT_QA_PER_HOUR=30             # max questions per user per hour
MAX_UPLOAD_MB=200                     # per-file upload cap (web UI)
INGEST_CONCURRENCY=1                  # serial in-process ingestion queue
```

Prereqs:
- **Docker** + Docker Compose (primary way to run the app)
- **Bun** 1.x (only needed for local dev outside Docker)
- Spanish OCR data for `tesseract.js` (`spa`) — bundled in the image
- A **DeepSeek API key** (https://platform.deepseek.com)
- The local **embedding model** (e5) — baked into the image or cached on the `data/` volume,
  so the first run works without fetching from the internet
- `sqlite-vec` **Linux** extension binary in the image, loaded via `bun:sqlite`
  `loadExtension` at startup (declare a **384-dim, cosine** vector table)
- A way to reach the **web UI on the LAN** (same network, or a private VPN like Tailscale)

Get a bot token from **@BotFather** on Telegram.

### Running with Docker
```
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN, etc.
docker compose up --build # builds the Bun image and starts the bot
```
The `data/` directory is mounted as a volume so the SQLite DB, vector store, original files,
and the embedding-model cache persist across restarts. The web UI port is published on the
**LAN only**.

> **Hosting:** runs on a personal home-server with **long-polling** (no inbound port for the
> bot). Only the LAN web UI listens locally. Keep the host on a private network/VPN, restrict
> who can reach port 3000, and back up the `data/` volume (note: backups contain PHI — store
> them access-controlled, ideally encrypted).

### Local dev (without Docker)
```
bun install
bun run src/index.ts      # or: bun --watch src/index.ts
```

---

## 11. Implementation Roadmap

- [ ] **M0 — Scaffold:** Bun project (`package.json`, `tsconfig.json`), `Dockerfile`,
  `docker-compose.yml`, `.env.example`, `.gitignore`/`.dockerignore`, config loader.
- [ ] **M1 — Bot base:** long-polling; **allowlist + consent**; `/start`, `/help`.
- [ ] **M2 — Web upload UI:** `/upload` one-time links, LAN-only Hono server, drag-and-drop,
  shared `intake.ts`; small-file upload in Telegram + `/addnote`.
- [ ] **M3 — Ingestion:** PDF text + **encrypted-PDF unlock**; **scanned-PDF rasterize + OCR**;
  image OCR; chunking; background progress.
- [ ] **M4 — Vector store:** local embeddings (cached) + `sqlite-vec` (384-dim, cosine);
  per-user indexing; `/list`, `/delete`, `/reset`.
- [ ] **M5 — Q&A:** retrieval + DeepSeek answer with citations + disclaimers + guardrails.
- [ ] **M6 — Hardening & tests:** per-user rate limiting, audit log, password-vault safeguards,
  UX polish, `bun test`, README.

---

## 12. Open Questions / Decisions

Resolved: multi-user; **allowlist-only** access; DeepSeek cloud for Q&A + local embeddings;
vector store = `sqlite-vec`; keep original files; encryption-at-rest deferred for the MVP;
personal **home-server** with **long-polling**; **no auto-deletion TTL**; **uploads via a
LAN-only web UI** (Telegram for Q&A); plain text via **`/addnote`**; **scanned PDFs are OCR'd**.

Still open:
1. **Trends quality:** is best-effort RAG enough, or add structured lab-value extraction later?
2. **Web UI reach:** plain LAN binding vs. a private VPN (e.g. Tailscale) for off-home access.

Newly resolved: documents are **always in Spanish** (OCR stays `spa`-only); upload tokens are
**single-session, TTL-bound**; LAN upload transport is **plain HTTP** (accepted MVP risk);
ingestion uses a **serial in-process queue**; uploads are **content-hash deduplicated**; and
rate/cost limits use defaults (`RATE_LIMIT_QA_PER_HOUR=30`, `MAX_UPLOAD_MB=200`).

---

## 13. Risks

- **Privacy/legal:** mishandling PHI. Mitigation: allowlist, per-user isolation, local embeddings,
  send only minimal retrieved snippets to DeepSeek, consent, user-driven erasure.
- **Web UI exposure:** an upload endpoint holding PHI. Mitigation: LAN/VPN only, never public;
  short-lived single-user tokens; rate-limit; allowlisted users only.
- **Stored PDF passwords/IDs:** sensitive secrets in the vault. Mitigation: never log, delete chat
  messages with typed passwords, restrict access; encrypt the vault when at-rest encryption is added.
- **Large files & OCR time:** big/scanned PDFs are slow. Mitigation: background processing with
  progress, page caps, allow re-upload.
- **OCR quality:** poor scans → bad text. Mitigation: send as a file (not a compressed photo),
  preprocess, allow re-upload.
- **Trends incompleteness:** best-effort RAG may miss values across many docs. Mitigation: state
  uncertainty; consider structured extraction later.
- **Hallucination:** ungrounded answers. Mitigation: strict prompts, citations, "not found" fallback.
- **Third-party LLM exposure:** PHI snippets sent to DeepSeek. Mitigation: minimize context,
  verify retention terms, offer a local-LLM mode later.
- **Cost/abuse:** multi-user DeepSeek usage. Mitigation: per-user rate limits / quotas.
```
