# Web frontend (`web/`)

The web UI is a standalone Vite + React + TypeScript SPA. It has its own [package.json](./package.json) and [tsconfig.json](./tsconfig.json), isolated from the Bun backend.

## The `web/dist/` rule (most important)

- `web/dist/` is a **committed build artifact** — the Bun server serves it directly from disk and the build is **never run on the server**.
- After changing **anything** under `web/src/` (or `index.html`, `vite.config.ts`), you MUST rebuild and commit the updated `web/dist/`. Run from the repo root:
  ```bash
  bun run build:web   # runs `bun install && vite build` inside web/
  ```
- Editing `web/src/` without rebuilding `web/dist/` means your change **never reaches production** — deploy is just `git pull` + restart, with no build step.
- Do not hand-edit files in `web/dist/`; they are generated. Change the source and rebuild.

## Conventions

- Validate types with `bun run typecheck` inside `web/` (or `bunx tsc --noEmit`). There is no test suite.
- Keep the SPA light — this runs on a 4GB / Core-i3 box. Prefer the two existing React deps (`react`, `react-dom`); avoid adding heavy libraries.
- The SPA talks only to the backend JSON API in [webServer.ts](../src/infrastructure/web/webServer.ts) (`/api/files`, `/api/notes`, `/upload`, tag PATCH, raw download). Auth is per-request via `userId` + session `token` query params — preserve that when adding calls.
- New API calls go through [api.ts](./src/api.ts); shared types live in [types.ts](./src/types.ts).

See the root [AGENTS.md](../AGENTS.md) for the full backend architecture.
