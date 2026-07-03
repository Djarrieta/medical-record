#!/usr/bin/env bash
set -e

SNAPSHOT_DIR="$(dirname "$(realpath "$0")")/.."

if [ $# -eq 0 ]; then
  echo "Available snapshots:"
  ls -1t "$SNAPSHOT_DIR"/medical-record-snapshot-*.tar.gz 2>/dev/null | while read -r f; do
    echo "  $(basename "$f")"
  done
  echo
  echo "Usage: $0 <snapshot-name>"
  echo "  (use full filename or a unique prefix)"
  exit 1
fi

QUERY="$1"

if [ -f "$SNAPSHOT_DIR/$QUERY" ]; then
  SNAPSHOT_FILE="$SNAPSHOT_DIR/$QUERY"
else
  MATCHES=$(ls "$SNAPSHOT_DIR"/medical-record-snapshot-*.tar.gz 2>/dev/null | xargs -r basename -a | grep -F "$QUERY" || true)
  COUNT=$(echo "$MATCHES" | grep -c . || true)
  if [ "$COUNT" -eq 0 ]; then
    echo "No snapshot matches '$QUERY'"
    exit 1
  elif [ "$COUNT" -gt 1 ]; then
    echo "Multiple snapshots match '$QUERY':"
    echo "$MATCHES"
    exit 1
  fi
  SNAPSHOT_FILE="$SNAPSHOT_DIR/$MATCHES"
fi

echo "Thawing $(basename "$SNAPSHOT_FILE") ..."
echo "  Stopping containers..."
sudo docker compose down

echo "  Restoring data/ (models/ preserved if present)..."
tar xzf "$SNAPSHOT_FILE" -C "$(dirname "$(realpath "$0")")"

echo "  Starting containers..."
sudo docker compose up -d

echo "Done."
