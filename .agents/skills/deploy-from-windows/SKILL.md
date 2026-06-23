---
name: deploy-from-windows
description: Apply when working on this repo from the Windows laptop and changes need to reach the running app. The app does NOT run locally on Windows — it runs in Docker on a Linux server. Triggers on "deploy", "redeploy", "run on the server", "apply my changes", "rebuild", "push to prod", or after editing source that must take effect. Workflow: build the web UI on Windows (if web/src changed), commit + push, then SSH to the server and run ./deploy.sh for code changes (git pull + restart, no image rebuild) or ./start.sh when dependencies/Dockerfile change.
---

# Deploy from the Windows laptop

This laptop is for **editing and building the web UI only**. The app runs in
Docker on the Linux server, so any code change must be synced there to take
effect. Because Bun runs TypeScript directly and `src/` + `web/dist/` are
bind-mounted into the container, **code changes don't need an image rebuild** —
a `git pull` + container `restart` is enough (`./deploy.sh`, seconds). A full
image rebuild (`./start.sh`) is only needed when dependencies (`package.json` /
`bun.lock`) or the `Dockerfile` change.

The web UI is **never built on the server** (it's a low-spec box). The Vite
build output `web/dist/` is committed, so the web UI must be rebuilt **on
Windows** and committed whenever anything under `web/src/` changes.

## Server facts

- Connection details live in the gitignored `.env` file (never commit them):
  `DEPLOY_USER`, `DEPLOY_HOST`, `DEPLOY_PATH`. Read them from `.env` at deploy time.
- SSH target is `"$DEPLOY_USER@$DEPLOY_HOST"`; repo path on server is `$DEPLOY_PATH`.
- SSH + sudo password: prompt the user / they will provide it. Do not hardcode secrets in committed files.
- The repo on the server is owned by root, so git and docker commands need `sudo`.
- `./deploy.sh` runs `git pull && docker compose up -d && docker compose restart app` (no image rebuild) — the fast path for code-only changes (`src/`, `web/dist/`).
- `./start.sh` runs `git pull && docker compose up -d --build` (full image rebuild + restart, detached) — needed only when dependencies or the Dockerfile change, or the first deploy after the compose volumes changed.

## Deploy workflow (do these in order)

1. **Build the web UI** if anything under `web/src/` changed (skip otherwise).
   This regenerates the committed `web/dist/` bundle that the server serves:
   ```pwsh
   bun run build:web
   ```

2. **Validate locally** before shipping:
   ```pwsh
   bun run typeCheck
   ```

3. **Commit + push** from Windows (include the rebuilt `web/dist/` if you ran
   the web build):
   ```pwsh
   git add -A
   git commit -m "<message>"
   git push
   ```

4. **Deploy on the server** over SSH. Because the server repo is root-owned,
   run the script under sudo. Load the deploy target from `.env` first, then run
   a one-shot command.

   For **code-only changes** (`src/`, `web/dist/`) — the common case, takes
   seconds (no image rebuild):
   ```pwsh
   $env:DEPLOY_USER,$null,$env:DEPLOY_HOST = (Select-String '^DEPLOY_(USER|HOST)=' .env).Line -replace '.*=' ; $t = (Get-Content .env | Select-String '^DEPLOY_PATH=').Line -replace '.*='
   ssh -t "$env:DEPLOY_USER@$env:DEPLOY_HOST" "cd $t && sudo ./deploy.sh"
   ```

   When **dependencies (`package.json` / `bun.lock`) or the `Dockerfile`
   changed** (or the first deploy after the compose volumes changed), do a full
   rebuild instead:
   ```pwsh
   ssh -t "$env:DEPLOY_USER@$env:DEPLOY_HOST" "cd $t && sudo ./start.sh"
   ```
   Both scripts `git pull` themselves. `sudo` will prompt for the password on
   the server (use `ssh -t` to get a TTY).

5. **Verify** the containers came up and check logs (reuse the `.env` values):
   ```pwsh
   ssh -t "$env:DEPLOY_USER@$env:DEPLOY_HOST" "cd $t && sudo docker compose logs --tail=60 app"
   ```

## Gotchas

- **Stale web UI**: if you changed `web/src/` but forgot `bun run build:web`,
  the server will serve the old bundle (the build never runs on the server).
  Rebuild, re-commit `web/dist/`, and redeploy.
- **First deploy after compose/volume changes**: run `./start.sh` once so the
  container is recreated with the new bind-mounts; afterwards `./deploy.sh` is
  enough for code changes.
- **Dubious ownership**: first git op may fail with
  `detected dubious ownership`. Fix once with:
  `sudo git config --global --add safe.directory $DEPLOY_PATH`.
- **`sudo: a terminal is required`**: use `ssh -t` (TTY) so sudo can prompt,
  or pipe the password with `echo <pw> | sudo -S <cmd>`.
- A successful deploy ends with `Container medical-record-app Started` and
  `medical-record-qdrant Healthy`.
- Rebuilds that touch the Dockerfile (e.g. new apt packages) take longer.
