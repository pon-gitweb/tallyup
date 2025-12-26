#!/usr/bin/env bash
set -euo pipefail

DEP="${1:-}"
if [[ -z "$DEP" ]]; then
  echo "Usage: scripts/check-dep.sh <package-name>"
  exit 2
fi

echo "== Checking: $DEP =="
echo
echo "-- ripgrep (code/config) --"
rg -n --hidden --no-ignore-vcs \
  "from ['\"]${DEP}['\"]|require\\(['\"]${DEP}['\"]\\)|['\"]${DEP}['\"]" \
  . \
  -g'!node_modules/**' -g'!backups/**' -g'!functions/**' -g'!backend/functions/**' -g'!server/**' \
  || echo "(no direct imports/requires found)"

echo
echo "-- app.json / app.config.* / expo config references --"
rg -n --hidden --no-ignore-vcs \
  "${DEP}" \
  app.json app.config.* eas.json \
  2>/dev/null || echo "(no obvious expo config references found)"

echo
echo "-- npm ls (who depends on it) --"
npm ls "$DEP" --depth=1 2>/dev/null || echo "(not found in dependency tree at depth=1)"

echo
echo "== Done =="
