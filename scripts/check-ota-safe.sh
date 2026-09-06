#!/usr/bin/env bash
# scripts/check-ota-safe.sh
#
# Pre-publish guard: detects fingerprint drift between the last successful
# native Android build and the current OTA updates.
#
# Root-cause context: Android uses runtimeVersion {"policy":"fingerprint"}.
# A native-affecting change (package version, app.json owner/plugin, etc.)
# silently shifts the fingerprint so new OTA updates no longer reach installed
# devices — users stay on the old binary with no error, no notification.
# This happened twice in one session when (a) package-lock.json was gitignored
# so EAS resolved react to a different version, and (b) "owner" was added to
# app.json after the last native build.
#
# Usage (run BEFORE every `eas update`):
#   ./scripts/check-ota-safe.sh [--force]
#
#   --force  Skip the guard and proceed anyway (still prints the warning).
#
# Setup — after each successful Android build, record its fingerprint:
#   eas build:list --platform android --status finished --limit 1 --json \
#     | python3 -c "import json,sys; b=json.load(sys.stdin); print(b[0]['runtimeVersion'])" \
#     > .last-android-build-fingerprint
#   git add .last-android-build-fingerprint && git commit -m "chore: update android build fingerprint after rebuild"
#
# CI: add this script to your update workflow before eas update runs.
# The exit code is 0 (safe), 1 (drift — do not update), 2 (no baseline stored yet).

set -euo pipefail

BASELINE_FILE=".last-android-build-fingerprint"
FORCE=false

for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=true
done

# ── Baseline check ─────────────────────────────────────────────────────────────

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "⚠️  No baseline fingerprint found ($BASELINE_FILE)."
  echo "   After your next successful Android build, run:"
  echo ""
  echo "   eas build:list --platform android --status finished --limit 1 --json \\"
  echo "     | python3 -c \"import json,sys; b=json.load(sys.stdin); print(b[0]['runtimeVersion'])\" \\"
  echo "     > $BASELINE_FILE"
  echo "   git add $BASELINE_FILE && git commit -m 'chore: record android build fingerprint'"
  echo ""
  echo "   Proceeding without check (exit 2)."
  exit 2
fi

BASELINE_FP=$(cat "$BASELINE_FILE" | tr -d '[:space:]')

if [[ -z "$BASELINE_FP" ]]; then
  echo "⚠️  Baseline file is empty. Re-run the setup step above."
  exit 2
fi

# ── Current OTA fingerprint ────────────────────────────────────────────────────
# eas update computes the fingerprint using the same library as eas build.
# We query the most recent Android update on the production branch to get
# what fingerprint the OTA updates currently have.

echo "🔍 Checking Android fingerprint drift…"
echo "   Baseline (last build): $BASELINE_FP"

# Get the latest Android update fingerprint from the production branch.
# eas branch:list --json returns [{name, updates:[{platform, runtimeVersion,...}]}]
BRANCH_OUTPUT=$(eas branch:list --json 2>/dev/null || echo "[]")
CURRENT_FP=$(echo "$BRANCH_OUTPUT" | python3 -c "
import json, sys
try:
    branches = json.load(sys.stdin)
except Exception:
    sys.exit(3)
prod = next((b for b in branches if b.get('name') == 'production'), None)
if not prod:
    sys.exit(3)
# The updates array contains individual platform updates; find the android one.
android_updates = [u for u in (prod.get('updates') or []) if u.get('platform') == 'android']
if not android_updates:
    sys.exit(3)
# updates are sorted newest-first; take the first android entry.
rt = android_updates[0].get('runtimeVersion', '')
print(rt.strip())
" 2>/dev/null || echo "")

if [[ -z "$CURRENT_FP" ]]; then
  echo "   ⚠️  Could not read current OTA fingerprint from EAS (branch:list failed)."
  echo "   Skipping check — verify manually with: eas branch:list"
  exit 0
fi

echo "   Current OTA updates: $CURRENT_FP"

# ── Compare ────────────────────────────────────────────────────────────────────

if [[ "$BASELINE_FP" == "$CURRENT_FP" ]]; then
  echo ""
  echo "✅ Fingerprints match — OTA updates will reach installed devices."
  exit 0
fi

echo ""
echo "🚨 FINGERPRINT DRIFT DETECTED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Last Android build:  $BASELINE_FP"
echo "  Current OTA updates: $CURRENT_FP"
echo ""
echo "  A native-affecting change was made after the last build."
echo "  Publishing more OTA updates will NOT reach installed devices —"
echo "  they will be silently rejected (no error, no notification)."
echo ""
echo "  ✋ STOP. Run a native Android build first:"
echo "     eas build --platform android --profile production --non-interactive"
echo ""
echo "  After the build completes, update the baseline:"
echo "     eas build:list --platform android --status finished --limit 1 --json \\"
echo "       | python3 -c \"import json,sys; b=json.load(sys.stdin); print(b[0]['runtimeVersion'])\" \\"
echo "       > $BASELINE_FILE"
echo "     git add $BASELINE_FILE && git commit -m 'chore: record android build fingerprint'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$FORCE" == "true" ]]; then
  echo ""
  echo "⚠️  --force passed. Proceeding despite drift (you will lose Android reach)."
  exit 0
fi

exit 1
