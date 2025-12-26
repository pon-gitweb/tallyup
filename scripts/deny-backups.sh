#!/usr/bin/env bash
set -euo pipefail

# Block committing backup/swap/temp artifacts
PATTERN='(\.bak(\.|$)|\.backup(\.|$)|\.orig$|\.old$|~$|\.swp$|\.swo$|\.tmp$|\.broken\.|\.stale\.|\.my-new$|\.pre-)'

bad="$(git diff --cached --name-only | grep -E "$PATTERN" || true)"

if [[ -n "$bad" ]]; then
  echo "❌ Refusing commit: backup/swap/temp files staged:"
  echo "$bad"
  echo
  echo "Remove them from staging (or delete them), then retry."
  exit 1
fi

echo "✅ No backup artifacts staged."
