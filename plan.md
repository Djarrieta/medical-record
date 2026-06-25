# Plan: Email ingestion (Gmail → store + index)

Status: **Planning only — nothing implemented yet.** All open questions resolved
(see "Decisions" below).

## Goal

A **dedicated Gmail mailbox** that the bot polls. The registered users (me + my
wife) **forward** medical emails into this shared mailbox from the **personal
address listed for them in `users.json`**. The app polls the mailbox and, for
every email whose `From` address matches a registered user's `email`:

- **Attribute** the email and its attachments to that user's `user_id`
  (each user only sees their own files/notes — "folder" = `user_id`).
- **Process the email body as a Note** (existing `IndexNote` flow): stored +
  RAG-searchable, embedding `subject + body`.
- **Process every attachment exactly like a Telegram upload**:
  - **PDF** → `IndexPdf` (extract → split → embed → index, OCR + tag/title).
  - **Image** → `IndexImage` (OCR + tag/title).
  - **Other** → store only (no indexing), matching current bot behavior.

Mail whose `From` does **not** match any registered user's email is **ignored
silently**.

Attribution is **only** the `users.json` email match — there is **no separate
sender map, no extra email validation, and no email-related web UI**. Whatever
rules/filters/forwards a user sets up in their own mailbox are their concern; the
bot just sees a forwarded message arrive and processes it.

This keeps the dependency rule intact: a new `EmailSource` **driver** port feeds a
new `IngestEmail` **use case** that reuses the existing `IndexNote`, `IndexPdf`,
and `IndexImage` use cases. Concrete adapters are wired only in `src/main.ts`.

---

## Decisions (resolved)

| # | Topic | Decision |
|---|---|---|
| 1 | Auth | Gmail API (OAuth refresh token), shared `infrastructure/google/googleAuth.ts` (future Calendar reuse). |
| 2 | Attribution | **`users.json` email match only.** The forwarder's `From` is matched (lowercased/trimmed) against each registered user's `email`. **No SQLite sender map.** |
| 3 | Unmatched senders | **Ignore silently.** |
| 4 | Dedup | **Gmail `provider_id`** tracked in a tiny backend-only `processed_emails` table (`has`/`mark`). No read-state mutation. |
| 5 | Inbox query bound | `newer_than:<EMAIL_QUERY_DAYS>d` (default 7) + provider_id dedup. Mailbox left untouched. |
| 6 | Email body | Processed as a **Note** via existing `IndexNote`; searchable text = `subject + body`. |
| 7 | Attachments | PDF → `IndexPdf`, image → `IndexImage` (OCR), other → store only. Each attachment passes `findByContent` before `repo.save` (content dedup). |
| 8 | Note title | `IndexNote` already handles the title (LLM titler + fallback); ingestion passes `subject` as the title seed. |
| 9 | HTML→text | Use the **`html-to-text`** package. |
| 10 | Forwarded attachments | Assume attachments arrive as **normal inline MIME parts** (no `.eml` re-parsing). |
| 11 | UI / Telegram | **None.** No email web UI, no `/api/email*` routes, no Telegram buttons. Ingestion is fully automatic via the poller. |
| 12 | Scope | **Backend ingestion + poller only.** Email UI, manual sync route, Telegram buttons, and Calendar are **out of scope**. |
| 13 | User registry | **`users.json`** (gitignored) `[{ id: number, name: string, email?: string }, ...]` **replaces** the `ALLOWED_USER_ID` env var. Loaded by `Config` at boot; `config.allowedUserIds = users.map(u => u.id)`. **`email` is now the attribution key** for forwarded mail — a user with no `email` can still use the bot but cannot forward. A `users.json.example` ships in the repo. |

> ⚠️ **Operational note:** a user must forward from the exact address set in
> their `users.json` `email`. A forward from any other address is silently
> dropped.

> ⚠️ **Trust caveat:** the `From` header is reliable in practice for
> Gmail-to-Gmail forwards but is spoofable in general. Anyone who knows the
> dedicated mailbox address could forward content in. Treat the mailbox as
> semi-private (don't publish it).

> ⚠️ **Deploy note:** this adds new npm deps (`googleapis`, `html-to-text`), so
> the first deploy needs a full image rebuild (`./start.sh --build`), **not**
> `./deploy.sh` (per AGENTS.md). Code-only deploys afterward stay on `./deploy.sh`.

---

## Design overview (hexagonal fit)

```
Gmail (shared mailbox)  ──>  GmailApiSource (driver adapter, infra)
                                  │  emits IncomingEmail[]
                                  ▼
                            IngestEmail (use case, application)
                                  │  resolve From → userId via users.json email map
                                  │  skip if no match or provider_id already processed
                ┌─────────────────┼──────────────────────┐
                ▼                 ▼                        ▼
         IndexNote (body)    IndexPdf (PDF parts)   IndexImage (image parts)
          - NoteRepository      - DocumentRepository    - DocumentRepository
          - existing pipeline    - existing pipeline      - existing pipeline (OCR)
```

The email body reuses `IndexNote`, so emails are **already first-class in RAG**
(notes are indexed in the same Qdrant collection) — **no `AskQuestion` change is
needed**. OAuth tokens come from a shared `google/googleAuth.ts` helper so
`GmailApiSource` (and a future `GoogleCalendar` adapter) never hard-own the
OAuth code.

---

## New domain (src/domain)

### `types.ts` — add

```ts
export interface IncomingEmail {
  providerId: string;    // Gmail message id — used for dedup, never re-ingest.
  from: string;          // forwarder address, lowercased/trimmed
  subject: string;
  body: string;          // plain-text body (HTML stripped via html-to-text)
  receivedAt: string;    // ISO date
  attachments: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;       // Buffer is already used across domain ports
}
```

No `EmailRecord` / `EmailRepository`: the body is stored as a `Note` and each
attachment as a `FileRecord`, reusing the existing `notes` / `files` tables.

### `ports.ts` — add

```ts
// Driver port: a source of new emails. Implemented by GmailApiSource.
export interface EmailSource {
  // Recent emails within the configured day-window. Dedup is handled downstream
  // (ProcessedEmailLog), so this may return mail already ingested. The
  // implementation handles auth, paging, HTML→text and attachment decoding.
  fetchRecent(): Promise<IncomingEmail[]>;
}

// Tiny dedup log so the poller never re-ingests the same Gmail message.
export interface ProcessedEmailLog {
  has(providerId: string): boolean;
  mark(providerId: string): void;
}
```

The forwarder→userId lookup is **not** a port — it is plain config data from
`users.json`, passed into `IngestEmail` as a `Map<string, number>` (lowercased
email → userId).

---

## New application use case (src/application)

### `ingestEmail.ts` — `IngestEmail` (orchestrator)

```ts
constructor(
  private readonly source: EmailSource,
  private readonly emailToUserId: Map<string, number>, // built from users.json
  private readonly processed: ProcessedEmailLog,
  private readonly repo: DocumentRepository,
  private readonly indexNote: IndexNote,
  private readonly indexPdf: IndexPdf,
  private readonly indexImage: IndexImage,
) {}

async run(): Promise<{ emails: number; pdfs: number; images: number; others: number }>
```

1. `incoming = await source.fetchRecent()`.
2. For each email:
   - `userId = emailToUserId.get(email.from)`. **Skip silently if undefined**
     (the `From` is not a registered user's address).
   - **Skip if** `processed.has(email.providerId)` (already ingested).
   - If the body has content:
     `await indexNote.run({ text: email.subject + "\n\n" + email.body, userId, title: email.subject })`
     — reuses the Note pipeline (title fallback + tags + RAG indexing).
   - For each attachment, dedup content then route by type:
     - `existing = repo.findByContent(content, userId)` → if found, reuse its id,
       skip a second `save`.
     - else `rec = await repo.save(userId, filename, mimeType, content)`.
     - **PDF** (`mimeType === "application/pdf"`):
       `await indexPdf.run({ buffer: content, fileId: rec.id, fileName: filename, userId })`.
     - **Image** (`mimeType.startsWith("image/")`):
       `await indexImage.run({ buffer: content, fileId: rec.id, fileName: filename, userId })`.
     - **Other**: stored only (the `save` above), no indexing.
   - `processed.mark(email.providerId)` **after** successful processing, so a
     crash mid-email lets the next poll retry it.
3. Return counts for logging.

No `IndexEmail` / `DeleteEmail` use cases: the body is an ordinary `Note`
(deletable via the existing `DeleteNote`) and attachments are ordinary
`FileRecord`s (deletable via the existing `DeleteDocument`).

---

## New infrastructure adapters (src/infrastructure)

### Google auth: `infrastructure/google/googleAuth.ts`

- Shared OAuth2 client factory: reads `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
  `GMAIL_REFRESH_TOKEN`, returns an authorized `google.auth.OAuth2` client.
  Used by `GmailApiSource` now and a future `GoogleCalendar` adapter later (one
  consent, two capabilities). Request `gmail.readonly` scope (and reserve
  `calendar.events` for later).

### Email source: `infrastructure/email/gmailApiSource.ts`

- `GmailApiSource implements EmailSource` using the shared OAuth client.
- `fetchRecent()`:
  - `gmail.users.messages.list({ userId: "me", q: "newer_than:<EMAIL_QUERY_DAYS>d" })`,
    paging through all ids.
  - `gmail.users.messages.get({ id, format: "full" })` per id.
  - Extract `From`: parse the `Display Name <addr@x.com>` form down to the
    angle-bracketed address only (regex `/<([^>]+)>/` with fallback to the whole
    header), then `lowercased/trimmed`. `Subject`, `Date` → `receivedAt` (ISO).
  - Body: prefer `text/plain` part; else take `text/html` and run it through
    **`html-to-text`**. Decode base64url.
  - Attachments: walk MIME parts, fetch `messages.attachments.get` for parts with
    an `attachmentId`, decode to `Buffer` → `{ filename, mimeType, content }`.
  - Read-state and labels are **not** modified.

### Persistence (shared `data/app.db`)

- `persistence/sqliteProcessedEmails.ts` — `SqliteProcessedEmails implements ProcessedEmailLog`.
  Table `processed_emails (provider_id TEXT PRIMARY KEY, processed_at)`.
  `has` = `SELECT 1`; `mark` = `INSERT OR IGNORE`.
- **No** sender-map or email tables: bodies live in `notes`, attachments in `files`.

### OAuth helper script: `scripts/google-auth.ts`

- One-time, run manually (`bun run scripts/google-auth.ts`): opens the consent
  URL, exchanges the code, prints the `GMAIL_REFRESH_TOKEN` to paste into `.env`.
  Not part of the running app; pure setup convenience.

### Poller / scheduling (main.ts)

- **Self-rescheduling `setTimeout`** with an in-flight flag — not `setInterval`.
  A poll cycle (Gmail fetch + PDF OCR + LLM tagging) can easily exceed
  `EMAIL_POLL_SECONDS`, so overlapping runs are a real risk; the pattern below
  guarantees one run at a time:

  ```ts
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;
  const schedule = () => { pollTimer = setTimeout(tick, cfg.emailPollMs); };
  const tick = async () => {
    if (polling) { schedule(); return; }
    polling = true;
    try { await ingestEmail.run(); }
    catch (err) { console.error("Email poll failed:", err); }
    finally { polling = false; schedule(); }
  };
  schedule();
  ```

  SIGINT/SIGTERM handlers `clearTimeout(pollTimer)` alongside the session sweep.
- Optional: `bot.notify(...)` summary — **deferred** for now; counts are logged.
  (`bot.notify` already exists.)

---

## Config (src/infrastructure/config.ts) — add

```
EMAIL_ENABLED=true|false           # master switch; off by default
EMAIL_POLL_SECONDS=300
EMAIL_QUERY_DAYS=7                  # Gmail "newer_than:Nd" window
USERS_FILE=./users.json            # path to the user registry (Decision #13)
# Gmail API (shared with future Calendar):
GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER
```

- Add parsed fields to `BotConfig`. Keep email **disabled by default** so the app
  boots without Gmail credentials (mirror how `deepseekApiKey` is optional).
- **Drop `ALLOWED_USER_ID`** from `.env` / `.env.example` / `Config`. Instead:
  - `Config` reads `USERS_FILE` (default `./users.json`), parses
    `[{ id, name, email? }, ...]`, and exposes both:
    - `config.users: UserRecord[]` (full records, used to build the email map).
    - `config.allowedUserIds: number[] = users.map(u => u.id)` (unchanged shape,
      so [src/infrastructure/telegram/botApp.ts](src/infrastructure/telegram/botApp.ts#L79)
      keeps working).
  - Throw if the file is missing or has zero entries (mirror today's
    `ALLOWED_USER_ID is required` check).
- Add `users.json` to `.gitignore`; ship `users.json.example` with the schema.
- `.env.example`: add the new vars; remove `ALLOWED_USER_ID`.

---

## Composition root (src/main.ts) — wire-up

`indexNote`, `indexPdf`, `indexImage`, and `repo` already exist in `main.ts` and
are reused as-is. **No `AskQuestion`, `webServer`, or `botApp` changes.**

1. `let ingestEmail: IngestEmail | null = null;`
2. If `cfg.emailEnabled`:
   - `const auth = createGoogleAuth(cfg);`
   - `const source = new GmailApiSource(auth, cfg.emailQueryDays);`
   - `const processed = new SqliteProcessedEmails(db);`
   - `const emailToUserId = new Map(cfg.users.filter(u => u.email).map(u => [u.email!.toLowerCase().trim(), u.id]));`
   - `ingestEmail = new IngestEmail(source, emailToUserId, processed, repo, indexNote, indexPdf, indexImage);`
   - Schedule the self-rescheduling `setTimeout` poller (see Poller section);
     stash `pollTimer` so it can be cleared on SIGINT/SIGTERM.

---

## Data & reset

- One new table (`processed_emails`) lives in the shared `data/app.db`,
  auto-created via `CREATE TABLE IF NOT EXISTS`.
- Email bodies are ordinary `notes`; attachments are ordinary `FileRecord`s in
  `data/files/` + Qdrant — no special storage.
- **No migrations / no backwards-compat** (per AGENTS.md): `./reset.sh` wipes
  everything; that is acceptable.

---

## Build order (suggested)

1. **User registry**: `users.json.example`, add `users.json` to `.gitignore`,
   update `Config` to load it (with `email`) and drop `ALLOWED_USER_ID`. Run
   `bun run typeCheck` to make sure nothing else referenced the env var.
2. Domain: add `IncomingEmail`, `EmailAttachment` + ports (`EmailSource`,
   `ProcessedEmailLog`).
3. Persistence: `SqliteProcessedEmails` (`processed_emails` table).
4. `IngestEmail` orchestrator (reuses `IndexNote`, `IndexPdf`, `IndexImage`;
   explicit `findByContent` dedup; `processed.has` / `mark`).
5. `infrastructure/google/googleAuth.ts` + `infrastructure/email/gmailApiSource.ts`
   (with `From` angle-bracket parsing).
6. `scripts/google-auth.ts` one-time refresh-token helper.
7. Config vars + `.env.example`; wire in `main.ts` with the self-rescheduling
   `setTimeout` poller (disabled unless `EMAIL_ENABLED`).
8. Add deps (`googleapis`, `html-to-text`); **first deploy = `./start.sh --build`**.
9. `bun run typeCheck`; manual end-to-end test: set one user's `email`, forward
   an email with a PDF + an image from that exact address, confirm attribution
   (note + files land in that user's folder), indexing, and tags.

---

## Future (not now): Telegram calendar event creation

Goal: from the Telegram bot, create an event in the user's Google Calendar
(e.g. a medical appointment, possibly inferred from an ingested email/PDF).
**Out of scope for this build**, but the design above is shaped to support it:

### Reuse Google auth
- The shared `infrastructure/google/googleAuth.ts` already centralizes OAuth.
  When granting Gmail consent, also request the
  `https://www.googleapis.com/auth/calendar.events` scope — one consent, two
  capabilities. A future `GoogleCalendar` adapter pulls tokens from the same place.

### New port (domain/ports.ts) — add later
```ts
export interface CalendarEvent {
  title: string;
  description?: string;
  start: string;          // ISO datetime
  end?: string;           // ISO datetime; default start + 1h
  location?: string;
}

export interface Calendar {
  createEvent(event: CalendarEvent): Promise<{ id: string; htmlLink: string }>;
}
```

### New use case (application) — add later
- `createCalendarEvent.ts` — `CreateCalendarEvent` takes free-form text (a bot
  message), uses the existing `Llm` to extract `{ title, start, end, location }`
  (structured/function-calling, like `LlmTagger`), then calls `Calendar.createEvent`.
- Could also be exposed as an LLM `Tool` (see the `Tool` interface in `ports.ts`)
  so the agentic `AskQuestion` flow can schedule events conversationally.

### Driver (Telegram) — add later
- A **Calendario** button + pending-state flow in `botApp.ts` mirroring the
  **Nota** flow: prompt for the event text, confirm the parsed datetime, then
  create it and reply with the `htmlLink`.

### Config — reserve names now
- `GOOGLE_CALENDAR_ID` (default `primary`), reusing the Gmail OAuth client
  (`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`).
