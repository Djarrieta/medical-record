# Environment (.env) Change Log

Track here any change that affects `.env` / `.env.example` so the server config can be updated when pulling new code.

## 2026-06-18 — `ALLOWED_USER_ID` now supports multiple IDs

- **What changed:** `ALLOWED_USER_ID` went from a single Telegram user ID to a **comma-separated list** of IDs.
- **Action on server:** No rename needed (same variable). Optionally update the value to allow more users.
  - Single user (unchanged): `ALLOWED_USER_ID=123456`
  - Multiple users: `ALLOWED_USER_ID=123456,789012`
- **Notes:** Whitespace around IDs is trimmed; invalid/zero values are ignored. At least one valid ID is required or the bot fails to start.
- **Code:** `src/config.ts` (parsing), `src/types.ts` (`allowedUserIds: number[]`), `src/bot.ts` (auth middleware).
