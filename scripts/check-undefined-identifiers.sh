#!/usr/bin/env bash
# check:undefined: fails the build if tsc reports an identifier used without being
# defined or imported (TS2304 / TS2552): a ReferenceError at runtime.
# Exit 0: tsc ran and found none.  Exit 1: undefined identifiers found.
# Exit 2: tsc could not run or produced no usable diagnostics (never pass by default).
set -uo pipefail
cd "$(dirname "$0")/.."

TSC="node_modules/.bin/tsc"
if [ ! -x "$TSC" ] || [ ! -f tsconfig.json ]; then
  echo "check:undefined ERROR: $TSC or tsconfig.json missing. Run 'npm ci --ignore-scripts' first." >&2
  exit 2
fi

OUTPUT=$("$TSC" --noEmit 2>&1)
STATUS=$?
TOTAL=$(echo "$OUTPUT" | grep -c "error TS" || true)

if [ "$STATUS" -ne 0 ] && [ "$TOTAL" -eq 0 ]; then
  echo "check:undefined ERROR: tsc exited $STATUS but reported no diagnostics; treating as tool failure." >&2
  echo "$OUTPUT" | head -5 >&2
  exit 2
fi

MATCHES=$(echo "$OUTPUT" | grep -E "error TS(2304|2552)" || true)
if [ -n "$MATCHES" ]; then
  echo "check:undefined FAILED: undefined-identifier errors found:"
  echo "$MATCHES"
  exit 1
fi

echo "check:undefined passed: tsc ran (exit $STATUS, $TOTAL other diagnostics ignored); no TS2304/TS2552."
exit 0
