#!/usr/bin/env bash
set -e
# Light deploy for code-only changes (src/, web/dist/). These are bind-mounted
# into the container, so there's no image rebuild — we just reload the Bun
# process with the pulled source. Use ./start.sh instead when dependencies
# (package.json / bun.lock) or the Dockerfile change.
git pull
docker compose up -d
docker compose restart app
