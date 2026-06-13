#!/usr/bin/env bash
#
# Pull the latest code and rebuild/restart the Docker containers.
#
set -euo pipefail

# Run from the directory this script lives in (the repo root).
cd "$(dirname "$0")"

echo "==> Pulling latest changes..."
git pull

echo "==> Rebuilding and (re)starting containers..."
docker compose up --build -d

echo "==> Done. Current status:"
docker compose ps
