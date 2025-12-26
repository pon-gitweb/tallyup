#!/usr/bin/env bash
set -euo pipefail

DEP="${1:-}"
if [[ -z "$DEP" ]]; then
  echo "Usage: scripts/check-dep.sh <package-name>"
  exit 2
fi

echo "== Checking: $DEP =="
echo

SEARCH_RE="from ['\"]${DEP}['\"]|require\\(['\"]${DEP}['\"]\\)|['\"]${DEP}['\"]"

search_with_rg() {
  rg -n --hidden --no-ignore-vcs "$SEARCH_RE" . \
    -g'!node_modules/**' -g'!backups/**' -g'!tests-skipped/**' -g'!_archive/**' \
    -g'!functions/**' -g'!backend/functions/**' -g'!server/**' \
    -g'!**/*.bak' -g'!**/*.bak.*' -g'!**/*.backup.*' \
    || true
}

search_with_grep() {
  # portable fallback when ripgrep isn't installed
  grep -RInE \
    --exclude-dir=node_modules --exclude-dir=backups --exclude-dir=tests-skipped --exclude-dir=_archive \
    --exclude-dir=functions --exclude-dir=backend --exclude-dir=server \
    --exclude='*.bak' --exclude='*.bak.*' --exclude='*.backup.*' \
    "(from ['\"]${DEP}['\"]|require\\(['\"]${DEP}['\"]\\)|['\"]${DEP}['\"])" . \
    2>/dev/null || true
}

echo "-- code/config search --"
if command -v rg >/dev/null 2>&1; then
  search_with_rg
else
  echo "(rg not found; using grep fallback)"
  search_with_grep
fi

echo
echo "-- app.json / app.config.* / eas.json references --"
grep -InE "${DEP}" app.json app.config.* eas.json 2>/dev/null || echo "(no obvious expo config references found)"

echo
echo "-- npm ls (who depends on it) --"
npm ls "$DEP" --depth=1 2>/dev/null || echo "(not found in dependency tree at depth=1)"

echo
echo "== Done =="
