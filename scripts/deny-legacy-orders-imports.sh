#!/usr/bin/env bash
set -euo pipefail

# Block committing legacy orders imports from UI layers.
# UI code should import from `src/domain/orders` instead.
TARGETS_REGEX='^(src/(screens|components)/.*\.(ts|tsx|js|jsx))$'
BAD_IMPORT_REGEX='(from\s+["'\''](\.\./)+services/orders/|from\s+["'\'']src/services/orders/)'

staged="$(git diff --cached --name-only || true)"
bad_files=""

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" =~ $TARGETS_REGEX ]]; then
    # Only scan staged version of the file (not working tree)
    content="$(git show ":$f" 2>/dev/null || true)"
    if echo "$content" | grep -E -n "$BAD_IMPORT_REGEX" >/dev/null 2>&1; then
      bad_files+="$f"$'\n'
    fi
  fi
done <<< "$staged"

if [[ -n "$bad_files" ]]; then
  echo "❌ Refusing commit: legacy orders imports detected in UI files."
  echo
  echo "Fix by importing from:  src/domain/orders"
  echo
  echo "Files:"
  echo "$bad_files"
  echo
  echo "Tip: replace e.g. '../../services/orders/suggestAI' with 'src/domain/orders'."
  exit 1
fi

echo "✅ No legacy orders imports staged in src/screens or src/components."
