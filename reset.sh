#!/usr/bin/env bash
set -e

echo "Stopping containers..."
sudo docker compose down

echo "Removing SQLite database..."
rm -f data/metadata.db data/metadata.db-shm data/metadata.db-wal

echo "Removing uploaded files..."
find data/files/ -type f ! -name '.gitkeep' -delete

echo "Removing Qdrant storage..."
rm -rf data/qdrant/

echo "Removing models cache..."
rm -rf data/models/

echo "Reset complete. Rebuilding and starting..."
sudo docker compose up -d --build
