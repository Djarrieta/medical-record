#!/usr/bin/env bash
set -e

NAME="${1:-}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SNAPSHOT_DIR="$(dirname "$(realpath "$0")")/.."

if [ -n "$NAME" ]; then
  SNAPSHOT_FILE="$SNAPSHOT_DIR/medical-record-snapshot-${TIMESTAMP}-${NAME}.tar.gz"
else
  SNAPSHOT_FILE="$SNAPSHOT_DIR/medical-record-snapshot-${TIMESTAMP}.tar.gz"
fi

echo "Freezing data to $(basename "$SNAPSHOT_FILE") ..."
echo "  Stopping containers..."
sudo docker compose down

echo "  Archiving data/ (excluding models/ -- re-downloadable)..."
tar czf "$SNAPSHOT_FILE" \
  --exclude='data/models' \
  -C "$(dirname "$(realpath "$0")")" data/

echo "  Starting containers..."
sudo docker compose up -d

echo "Done: $SNAPSHOT_FILE"
