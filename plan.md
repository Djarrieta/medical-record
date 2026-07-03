# Plan: Email ingestion (Gmail → store + index)

Status: **Planning only — nothing implemented yet.**

## Goal

Periodically read the user's Gmail inbox. Each incoming email is evaluated
against an allowlist of sender addresses (managed like PDF passwords). For every
email whose sender is on the allowlist:

- **Store the email body text** so it is searchable via RAG (like a `Note`).
- **Store every PDF attachment** to disk and **index it into Qdrant** through the
  existing `IndexPdf` pipeline (extract → split → embed → index, with OCR + tag/title).

This keeps the dependency rule intact: a new `EmailSource` **driver** port feeds a
new `IngestEmail` **use case** that reuses existing use cases (`IndexPdf`) and a new
`IndexEmail` path. Concrete adapters are wired only in `src/main.ts`.

---

## Design overview (hexagonal fit)

```
Gmail  ──>  EmailSource (driver adapter, infra)
                  │  emits IncomingEmail[]
                  ▼
            IngestEmail (use case, application)
                  │
       ┌──────────┴───────────┐
       ▼                      ▼
  IndexEmail (text)      IndexPdf (per PDF attachment)
   - EmailRepository      - DocumentRepository.save()
   - embedAndIndex()      - existing pipeline + OCR + tags
```

Allowlist of senders mirrors `PasswordVault` exactly: a tiny port + a SQLite
adapter owning one table in the shared `data/app.db`, plus a web UI card.

---

## New domain (src/domain)

### `types.ts` — add

```ts
export interface IncomingEmail {
  // Stable provider id (Gmail message id) — used for dedup, never re-ingest.
  providerId: string;
  from: string;          // sender address, lowercased
  subject: string;
  body: string;          // plain-text body (HTML stripped)
  receivedAt: string;    // ISO date
  attachments: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

// Persisted, RAG-searchable email (separate from Note/FileRecord).
export interface EmailRecord {
  id: string;
  userId: number;
  providerId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  createdAt: string;
  tags: string[];
}
```

### `ports.ts` — add

```ts
// Allowlist of sender addresses to ingest. Mirrors PasswordVault's shape so the
// web UI can list/add/remove entries.
export interface EmailAllowlist {
  add(address: string): void;
  getAll(): string[];                                  // lowercased addresses
  list(): { id: number; address: string }[];
  remove(id: number): boolean;
  has(address: string): boolean;
  count(): number;
}

// Persists ingested emails (their text body). Embedded into Qdrant for RAG,
// like NoteRepository.
export interface EmailRepository {
  save(userId: number, email: IncomingEmail): EmailRecord;
  list(userId: number): EmailRecord[];
  get(id: string, userId: number): EmailRecord | null;
  // Dedup guard: returns true if this provider message was already ingested.
  existsByProviderId(userId: number, providerId: string): boolean;
  setTags(id: string, tags: string[]): void;
  listTags(userId: number): string[];
  delete(id: string, userId: number): boolean;
}

// Driver port: a source of new emails. Implemented by a Gmail adapter.
export interface EmailSource {
  // Returns emails newer than the last seen marker. Implementation handles
  // auth, paging, and "unread/after:<cursor>" filtering.
  fetchNew(): Promise<IncomingEmail[]>;
}
```

---

## New application use cases (src/application)

### `indexEmail.ts` — `IndexEmail`

Mirrors `IndexNote`:

1. `emails.save(userId, email)` → `EmailRecord`.
2. Build searchable text (`subject + "\n\n" + body`), `embedAndIndex(...)` under
   `emailRecord.id` (so delete can remove its vectors).
3. `safeGenerateTags(tagger, text)` → `emails.setTags` + `vectorIndex.setTags`.

Reuses `embedAndIndex`, `safeGenerateTags`, `safeGenerateTitle` exactly like notes.

### `ingestEmail.ts` — `IngestEmail` (orchestrator)

```ts
async run(userId: number): Promise<{ emails: number; pdfs: number }>
```

1. `emails = await source.fetchNew()`.
2. For each email:
   - Skip if `!allowlist.has(email.from)`.
   - Skip if `emailRepo.existsByProviderId(userId, email.providerId)` (dedup).
   - `await indexEmail.run({ userId, email })`.
   - For each PDF attachment (`mimeType === "application/pdf"`):
     - `repo.save(userId, filename, mimeType, content)` → `FileRecord`
       (dedup by sha256 already handled in `DocumentRepository.findByContent`).
     - `await indexPdf.run({ buffer, fileId, fileName, userId })`.
3. Return counts for logging / Telegram notification.

Non-PDF attachments: store via `repo.save` only (same as bot behavior for
non-PDF documents), no indexing.

---

## New infrastructure adapters (src/infrastructure)

### Persistence (shared `data/app.db`)

- `persistence/sqliteEmailAllowlist.ts` — `SqliteEmailAllowlist implements EmailAllowlist`.
  Table `email_allowlist (id, address, created_at)`. Copy `SqlitePasswordVault`
  structure; normalize `address` to lowercase/trim on `add`/`has`.
- `persistence/sqliteEmailRepository.ts` — `SqliteEmailRepository implements EmailRepository`.
  Table `emails (id, user_id, provider_id, from_addr, subject, body, received_at,
  created_at, tags)`. Unique index on `(user_id, provider_id)` for dedup. Copy
  `SqliteNoteRepository` patterns (tags stored as JSON text column).

### Email source: `infrastructure/email/`

Two viable Gmail strategies — **decide before building**:

**Option A — Gmail API (recommended).**
- `GmailApiSource implements EmailSource` using OAuth2 refresh token.
- Query `users.messages.list` with `q="is:unread"` (or `after:<epoch>` cursor),
  then `users.messages.get` (format=full) per id; decode base64url body + parts.
- Pros: robust, official, granular scopes (`gmail.readonly`), label/read-state
  control. Cons: one-time OAuth consent + storing a refresh token.
- Env: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`,
  `GMAIL_USER` (the mailbox address).

**Option B — IMAP.**
- `ImapEmailSource implements EmailSource` via an IMAP client (e.g. `imapflow`) +
  `mailparser` for MIME/attachment parsing.
- Requires a Google **App Password** (2FA) — `GMAIL_USER`, `GMAIL_APP_PASSWORD`.
- Pros: simpler auth, no OAuth dance. Cons: app passwords are coarse, less future-proof.

Either adapter must:
- Strip HTML → plain text for the body.
- Expose attachments as `{ filename, mimeType, content: Buffer }`.
- Track a cursor (last `internalDate` / UID) so `fetchNew()` only returns unseen
  mail. Persist the cursor in a small `kv`/`email_state` table or rely on the
  `emails.provider_id` dedup + an `after:` query.

### Cursor / scheduling

- A poller in `main.ts` (like the existing `setInterval` session sweep) calls
  `ingestEmail.run(userId)` every `EMAIL_POLL_SECONDS` (default e.g. 300s).
- Optionally notify the allowed user via `bot.notify(...)` with a summary
  (`N emails, M PDFs ingested`).

---

## Config (src/infrastructure/config.ts) — add

```
EMAIL_ENABLED=true|false           # master switch; off by default
EMAIL_PROVIDER=gmail-api|imap
EMAIL_POLL_SECONDS=300
EMAIL_USER_ID=<telegram id that owns ingested mail>   # which userId to attribute
# Gmail API:
GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER
# IMAP:
GMAIL_USER, GMAIL_APP_PASSWORD
```

Add the parsed fields to `BotConfig`. Keep email **disabled by default** so the
app still boots without Gmail credentials (mirror how `deepseekApiKey` is optional).

`.env.example`: document all new vars.

---

## Composition root (src/main.ts) — wire-up

1. Construct `const emailAllowlist = new SqliteEmailAllowlist(db);`
2. Construct `const emailRepo = new SqliteEmailRepository(db);`
3. `const indexEmail = new IndexEmail(chunker, embedder, vectorIndex, emailRepo, titler, tagger);`
4. If `cfg.emailEnabled`, construct the chosen `EmailSource` and
   `const ingestEmail = new IngestEmail(source, emailAllowlist, emailRepo, repo, indexEmail, indexPdf);`
5. Add an `setInterval(() => ingestEmail.run(cfg.emailUserId), cfg.emailPollMs)`,
   cleared on SIGINT/SIGTERM alongside the session sweep.

---

## Web UI (web/) — allowlist + ingested emails

Mirror the existing Passwords feature:

- Backend (`webServer.ts`): add JSON routes
  - `GET /api/email-allowlist`, `POST /api/email-allowlist`, `DELETE /api/email-allowlist/:id`
  - `GET /api/emails`, `DELETE /api/emails/:id`
  - (optional) `POST /api/email/sync` to trigger `ingestEmail.run` on demand.
- Frontend: new `components/EmailAllowlistCard.tsx` (copy `PasswordsCard.tsx`)
  and an emails list (copy `NotesCard.tsx`/`FilesCard.tsx`), tag-filterable.
- Rebuild + commit `web/dist/` (`bun run build:web`) per AGENTS.md.

Telegram (optional, later): "Correos" / allowlist management buttons mirroring
the **Contraseña** flow in `botApp.ts`.

---

## Data & reset

- New tables live in the shared `data/app.db`; auto-created via `CREATE TABLE IF NOT EXISTS`.
- Email PDF attachments are normal `FileRecord`s in `data/files/` + Qdrant — no
  special storage.
- **No migrations / no backwards-compat** (per AGENTS.md): `./reset.sh` wipes
  everything; that is acceptable.

---

## Build order (suggested)

1. Domain: add `IncomingEmail`, `EmailAttachment`, `EmailRecord` + ports
   (`EmailAllowlist`, `EmailRepository`, `EmailSource`).
2. Persistence: `SqliteEmailAllowlist`, `SqliteEmailRepository` (+ dedup index).
3. `IndexEmail` use case (clone `IndexNote`).
4. `IngestEmail` orchestrator (reuses `IndexPdf`, `DocumentRepository`).
5. `EmailSource` adapter (start with **one** provider — Gmail API recommended).
6. Config vars + `.env.example`; wire in `main.ts` with a poller (disabled unless
   `EMAIL_ENABLED`).
7. Web API routes + `EmailAllowlistCard` + emails list; `bun run build:web`.
8. `bun run typeCheck`; manual end-to-end test with one allowlisted sender.

---

## Open questions / decisions to confirm

1. **Auth strategy**: Gmail API (OAuth refresh token) vs IMAP (app password)?
2. **userId attribution**: all ingested mail belongs to a single configured
   `EMAIL_USER_ID`, or map sender→user somehow? (single user is simplest.)
3. **Read-state**: mark Gmail messages read / label them after ingest, or rely
   purely on the `provider_id` dedup table? (label avoids re-scanning the inbox.)
4. **Body for RAG**: index `subject + body`, or body only?
5. **Non-PDF attachments**: store only (current plan) vs also OCR images via the
   existing `IndexImage` pipeline?
6. **HTML emails**: which HTML→text approach (and whether to keep the original HTML).

---

## Future (not now): Telegram calendar event creation

Goal: from the Telegram bot, create an event in the user's Google Calendar
(e.g. a medical appointment, possibly inferred from an ingested email/PDF).
This is **out of scope for the first build** but the design above is shaped to
support it cheaply. Keep these hooks in mind so we don't paint ourselves into a
corner:

### Reuse Google auth
- If we pick **Gmail API (Option A)**, the same Google Cloud OAuth client and
  refresh-token flow can request the `https://www.googleapis.com/auth/calendar.events`
  scope alongside `gmail.readonly`. One consent, two capabilities.
- Centralize Google OAuth in a shared helper (e.g. `infrastructure/google/googleAuth.ts`)
  so both `GmailApiSource` and a future `GoogleCalendar` adapter pull tokens from
  one place. Plan the Gmail adapter to **not** hard-own the OAuth code.

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
- `GOOGLE_CALENDAR_ID` (default `primary`), and reuse the Gmail OAuth client
  (`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`) — so when
  granting Gmail consent, request the calendar scope at the same time to avoid a
  second consent later.

### Practical takeaway for the email build
- Choose **Gmail API (OAuth)** over IMAP if calendar is on the roadmap — IMAP
  (app password) gives no path to Calendar and would force a separate auth setup.
- Put OAuth token handling in a shared `google/` module from day one.
```