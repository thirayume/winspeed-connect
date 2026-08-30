#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Usage: verify-upload.sh /path/file" >&2; exit 2; }

MANIFEST="$FILE.sha256"
if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: missing checksum manifest $MANIFEST" >&2
  exit 3
fi

cd "$(dirname "$FILE")"
sha256sum -c "$(basename "$MANIFEST")"

