#!/usr/bin/env bash
set -e

echo "Stopping containers..."
sudo docker compose down

echo "Removing SQLite database..."
rm -f data/app.db data/app.db-shm data/app.db-wal
rm -f data/metadata.db* data/passwords.db*

echo "Removing uploaded files..."
find data/files/ -type f ! -name '.gitkeep' -delete

echo "Removing Qdrant storage..."
rm -rf data/qdrant/

echo "Removing models cache..."
rm -rf data/models/

echo "Reset complete. Rebuilding and starting..."
sudo docker compose up -d --build
