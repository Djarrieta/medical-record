#!/usr/bin/env bash
#
# Delete all saved data (SQLite DB) and restart the containers.
#
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Stopping containers..."
docker compose down

echo "==> Deleting SQLite database..."
rm -f data/medical-record.sqlite data/medical-record.sqlite-shm data/medical-record.sqlite-wal

echo "==> (Re)starting containers..."
docker compose up -d

echo "==> Done."
