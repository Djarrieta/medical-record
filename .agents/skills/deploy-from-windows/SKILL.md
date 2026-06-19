---
name: deploy-from-windows
description: Apply when working on this repo from the Windows laptop and changes need to reach the running app. The app does NOT run locally on Windows — it runs in Docker on the Linux server (REDACTED-HOST). Triggers on "deploy", "redeploy", "run on the server", "apply my changes", "rebuild", "push to prod", or after editing source that must take effect. Workflow: commit + push from Windows, then SSH to the server, git pull, and run ./start.sh.
---

# Deploy from the Windows laptop

This laptop is for **editing only**. The app runs in Docker on the Linux server,
so any code change must be synced to the server and rebuilt there to take effect.

## Server facts

- Host: `dario@REDACTED-HOST`
- Repo path on server: `/home/dario/medical-record`
- SSH + sudo password: prompt the user / they will provide it. Do not hardcode secrets in committed files.
- The repo on the server is owned by root, so git and docker commands need `sudo`.
- `./start.sh` runs `sudo docker compose up -d --build` (rebuild + restart, detached).

## Deploy workflow (do these in order)

1. **Validate locally** before shipping:
   ```pwsh
   bun run typeCheck
   ```

2. **Commit + push** from Windows:
   ```pwsh
   git add -A
   git commit -m "<message>"
   git push
   ```

3. **Pull + rebuild on the server** over SSH. Because the server repo is
   root-owned, run git and compose under sudo. One-shot command:
   ```pwsh
   ssh -t dario@REDACTED-HOST "cd /home/dario/medical-record && sudo git pull && sudo ./start.sh"
   ```
   `sudo` will prompt for the password on the server (use `ssh -t` to get a TTY).

4. **Verify** the containers came up and check logs:
   ```pwsh
   ssh -t dario@REDACTED-HOST "cd /home/dario/medical-record && sudo docker compose logs --tail=60 app"
   ```

## Gotchas

- **Dubious ownership**: first git op may fail with
  `detected dubious ownership`. Fix once with:
  `sudo git config --global --add safe.directory /home/dario/medical-record`.
- **`sudo: a terminal is required`**: use `ssh -t` (TTY) so sudo can prompt,
  or pipe the password with `echo <pw> | sudo -S <cmd>`.
- A successful deploy ends with `Container medical-record-app Started` and
  `medical-record-qdrant Healthy`.
- Rebuilds that touch the Dockerfile (e.g. new apt packages) take longer.
