#!/usr/bin/env bash
# Exits 1 if tsc reports any "Cannot find name" errors (TS2304 / TS2552).
# These indicate a real missing import or undefined identifier — not merely
# a type mismatch — and must be zero before every native build and eas update.
set -euo pipefail

OUTPUT=$(npx tsc --noEmit 2>&1 || true)
MATCHES=$(echo "$OUTPUT" | grep -E "error TS(2304|2552)" || true)

if [ -n "$MATCHES" ]; then
  echo "check:undefined FAILED — undefined-identifier errors found:"
  echo "$MATCHES"
  exit 1
fi

echo "check:undefined passed — no TS2304/TS2552 errors."
exit 0
