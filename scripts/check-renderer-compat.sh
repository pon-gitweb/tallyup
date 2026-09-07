#!/usr/bin/env bash
# scripts/check-renderer-compat.sh
#
# Renderer-version compatibility guard.
#
# react-native bundles its own JS renderer (ReactNativeRenderer-prod.js) with a
# hardcoded strict-equality version check:
#
#   if ("19.1.0" !== React.version) throw Error('Incompatible React versions…')
#
# This check fires at module-load time in production — not just in dev mode — so
# a mismatch crashes the app on every launch. The peer-dependency range
# ("react": "^19.1.0") allows minor/patch bumps, but the bundled renderer
# requires an exact match.
#
# This script extracts that hardcoded version string directly from the installed
# node_modules and compares it against the installed react version. It catches
# the exact class of bug that broke builds 76 and 77:
#
#   react@19.1.4 installed + renderer requiring "19.1.0" = always crash
#
# Usage (run before every native build AND before every `eas update`):
#   ./scripts/check-renderer-compat.sh
#
# Exit codes:
#   0  — versions match, safe to build/publish
#   1  — mismatch detected, do NOT build or publish
#   2  — could not determine one or both versions (setup problem)
#
# CI: add this before `eas build` and `eas update` in your workflow.

set -euo pipefail

RENDERER_FILE="node_modules/react-native/Libraries/Renderer/implementations/ReactNativeRenderer-prod.js"
REACT_PKG="node_modules/react/package.json"

# ── Verify inputs exist ────────────────────────────────────────────────────────

if [[ ! -f "$RENDERER_FILE" ]]; then
  echo "❌ Cannot find renderer: $RENDERER_FILE"
  echo "   Run 'npm install' first."
  exit 2
fi

if [[ ! -f "$REACT_PKG" ]]; then
  echo "❌ Cannot find react package: $REACT_PKG"
  echo "   Run 'npm install' first."
  exit 2
fi

# ── Extract the renderer's required React version ──────────────────────────────
# The check in ReactNativeRenderer-prod.js looks exactly like:
#   if ("19.1.0" !== isomorphicReactPackageVersion)
# We extract the quoted version string from that specific pattern.

RENDERER_REQUIRED=$(python3 - <<'PYEOF'
import re, sys

with open("node_modules/react-native/Libraries/Renderer/implementations/ReactNativeRenderer-prod.js") as f:
    content = f.read()

# Match the strict-equality version guard: "X.Y.Z" !== isomorphicReactPackageVersion
m = re.search(r'"(\d+\.\d+\.\d+)"\s*!==\s*isomorphicReactPackageVersion', content)
if not m:
    sys.exit(2)

print(m.group(1))
PYEOF
)

if [[ $? -ne 0 ]] || [[ -z "$RENDERER_REQUIRED" ]]; then
  echo "❌ Could not extract required React version from renderer."
  echo "   The renderer file may have changed format — review $RENDERER_FILE manually."
  exit 2
fi

# ── Get the installed react version ───────────────────────────────────────────

INSTALLED_REACT=$(python3 -c "import json; print(json.load(open('$REACT_PKG'))['version'])" 2>/dev/null || echo "")

if [[ -z "$INSTALLED_REACT" ]]; then
  echo "❌ Could not read react version from $REACT_PKG."
  exit 2
fi

# ── Compare ────────────────────────────────────────────────────────────────────

echo "🔍 Checking React renderer version compatibility…"
echo "   Renderer requires react: $RENDERER_REQUIRED  (from ReactNativeRenderer-prod.js)"
echo "   Installed react:         $INSTALLED_REACT    (from node_modules/react/package.json)"

if [[ "$RENDERER_REQUIRED" == "$INSTALLED_REACT" ]]; then
  echo ""
  echo "✅ Versions match — safe to build and publish."
  exit 0
fi

echo ""
echo "🚨 RENDERER VERSION MISMATCH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Renderer requires: react@$RENDERER_REQUIRED (hardcoded strict-equality check)"
echo "  Installed:         react@$INSTALLED_REACT"
echo ""
echo "  Impact: ReactNativeRenderer-prod.js throws 'Incompatible React versions'"
echo "  on every production launch (module-load time, not just during render)."
echo "  This crash affects ALL users on ALL builds using this node_modules."
echo ""
echo "  Fix: pin react to the exact version the renderer requires."
echo "  In package.json → dependencies:"
echo "    \"react\": \"$RENDERER_REQUIRED\""
echo ""
echo "  Then:"
echo "    npm install"
echo "    ./scripts/check-renderer-compat.sh   # must pass before proceeding"
echo "    eas build --platform android --profile production --non-interactive"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 1
