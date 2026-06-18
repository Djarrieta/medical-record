# Environment (.env) Change Log

Track here any change that affects `.env` / `.env.example` so the server config can be updated when pulling new code.

## 2026-06-18 — Web UI file admin + view/download (no env change)

- **What changed:** Rebuilt the web upload page into a file-administration UI and fixed a metadata bug.
  - New endpoint `GET /api/files/:id/raw` serves a stored file inline (or `?download=1` to download); password-gated via the `password` query param when `WEB_PASSWORD` is set.
  - UI now lists saved files with type icon, type label, size, upload date, an "Indexado" badge for PDFs, plus search, a file count, **Ver** (open file) and **Eliminar** (with confirm) actions.
  - **Bug fix:** `FileStore.list()`/`get()` returned raw snake_case DB columns, so file names/types showed blank and downloads/deletes relied on undefined fields; rows are now mapped to camelCase `FileRecord`.
- **Action on server:** None — **no `.env` / `.env.example` changes**. Existing `WEB_PORT`, `WEB_HOST`, `WEB_PASSWORD` continue to work unchanged. Just pull and restart.
- **Code:** `src/webServer.ts` (endpoint + redesigned page), `src/fileStore.ts` (`mapRow` mapping).

## 2026-06-18 — `ALLOWED_USER_ID` now supports multiple IDs

- **What changed:** `ALLOWED_USER_ID` went from a single Telegram user ID to a **comma-separated list** of IDs.
- **Action on server:** No rename needed (same variable). Optionally update the value to allow more users.
  - Single user (unchanged): `ALLOWED_USER_ID=123456`
  - Multiple users: `ALLOWED_USER_ID=123456,789012`
- **Notes:** Whitespace around IDs is trimmed; invalid/zero values are ignored. At least one valid ID is required or the bot fails to start.
- **Code:** `src/config.ts` (parsing), `src/types.ts` (`allowedUserIds: number[]`), `src/bot.ts` (auth middleware).
