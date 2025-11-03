#!/usr/bin/env bash
set -euo pipefail

echo "== TallyUp usage audit =="
echo "Working dir: $(pwd)"
mkdir -p .analysis

# 0) Optional: dev tools (skip by: SKIP_NPM_INSTALL=1 .analysis/run-usage-audit.sh)
if [[ "${SKIP_NPM_INSTALL:-0}" != "1" ]]; then
  echo "Installing dev analyzers (unimported, knip, ts-prune, madge)…"
  npm i -D unimported knip ts-prune madge >/dev/null 2>&1 || npm i -D unimported knip ts-prune madge
fi

# 1) Metro bundle (android) + sourcemap
echo "Bundling once via react-native (android) to extract used files…"
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output .analysis/index.android.bundle \
  --sourcemap-output .analysis/index.android.bundle.map

# 2) Extract "USED_BY_METRO" from sourcemap (excluding node_modules)
node - <<'EON'
const fs = require('fs');
const map = JSON.parse(fs.readFileSync('.analysis/index.android.bundle.map','utf8'));
const used = [...new Set(map.sources)]
  .filter(Boolean)
  .filter(p => !p.includes('node_modules'))
  .map(p => p.replace(/^\.?\//,''))
  .filter(p => p.startsWith('src/'));
used.sort();
fs.writeFileSync('.analysis/USED_BY_METRO.txt', used.join('\n')+'\n');
console.log('Wrote .analysis/USED_BY_METRO.txt with', used.length, 'files');
EON

# 3) List all tracked files under src
git ls-files 'src/**' | sort > .analysis/ALL_SRC.txt

# 4) Files NOT included by Metro bundle
sort .analysis/USED_BY_METRO.txt > .analysis/USED.sorted.txt
sort .analysis/ALL_SRC.txt       > .analysis/ALL.sorted.txt
comm -23 .analysis/ALL.sorted.txt .analysis/USED.sorted.txt > .analysis/NOT_USED_BY_METRO.txt

# 5) Static analyzers (hints)
echo "Running unimported (unused files)…"
npx unimported --flow type-only --ignore-path .gitignore \
  | tee .analysis/unimported.txt || true

echo "Running ts-prune (unused exports)…"
npx ts-prune | tee .analysis/ts-prune.txt || true

echo "Running knip (project usage)…"
npx knip --typescript | tee .analysis/knip.txt || true

echo "Running madge (orphans + graph)…"
npx madge src --extensions ts,tsx,js,jsx --ts-config tsconfig.json --orphans \
  | tee .analysis/madge-orphans.txt || true

# Graph outputs (DOT always; SVG only if graphviz available)
npx madge src --extensions ts,tsx,js,jsx --ts-config tsconfig.json --dot > .analysis/deps-graph.dot || true
if command -v dot >/dev/null 2>&1; then
  dot -Tsvg .analysis/deps-graph.dot -o .analysis/deps-graph.svg || true
fi

# 6) Summary
echo ""
echo "===== SUMMARY ====="
echo -n "Metro USED count: "; wc -l < .analysis/USED_BY_METRO.txt | tr -d ' '
echo -n "All src files:    "; wc -l < .analysis/ALL_SRC.txt | tr -d ' '
echo -n "NOT USED (Metro): "; wc -l < .analysis/NOT_USED_BY_METRO.txt | tr -d ' '
echo ""
echo "Reports written to .analysis/:"
printf "  - USED_BY_METRO.txt\n  - NOT_USED_BY_METRO.txt\n  - unimported.txt\n  - ts-prune.txt\n  - knip.txt\n  - madge-orphans.txt\n  - deps-graph.dot%s\n" "$(command -v dot >/dev/null 2>&1 && echo ' (and deps-graph.svg)')"
echo ""
echo "Next step (manual, safe): review NOT_USED_BY_METRO.txt + unimported.txt + madge-orphans.txt,"
echo "build a curated list to archive (don’t bulk move blindly)."
echo ""
echo "Tip: to skip npm install on subsequent runs: SKIP_NPM_INSTALL=1 .analysis/run-usage-audit.sh"
