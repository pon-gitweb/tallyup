#!/usr/bin/env bash
set -euo pipefail

# ---- helpers ----
header() { printf "\n// path: %s\n" "$1"; }
show() {
  local f="$1"
  if [ -f "$f" ]; then
    header "$f"
    cat "$f"
    printf "\n"
  fi
}

# find first match (case-insensitive) within src for a given basename (without extension)
# usage: find_one "src/types" "product" "ts tsx js jsx"
find_one() {
  local root="$1"; shift
  local base="$1"; shift
  local exts="${*:-ts tsx js jsx}"
  local f
  while IFS= read -r f; do
    echo "$f"
    return 0
  done < <(find "$root" -type f \( $(printf -- '-iname %s -o ' $(for e in $exts; do printf "%q" "*$base.$e"; done) | sed 's/ -o $//') \) | sort | head -n 1)
  return 1
}

# ---- SECTION 1: Product core ----
# Try both Product.ts and products.ts (and variants)
PROD_TYPES="$(find_one src/types product ts tsx js)"
[ -n "${PROD_TYPES:-}" ] && show "$PROD_TYPES" || true

# Primary product service
PROD_SERVICE="$(find_one src/services products ts tsx js)"
# If above was too generic, try specific path
[ -z "${PROD_SERVICE:-}" ] && PROD_SERVICE="src/services/products.ts"
[ -f "$PROD_SERVICE" ] && show "$PROD_SERVICE" || true

# ProductSupplierTools (and nested components under components/products)
while IFS= read -r f; do show "$f"; done < <(find src/components/products -type f -maxdepth 1 -iname 'ProductSupplierTools.*' 2>/dev/null || true)
# Also dump any form subcomponents used by EditProductScreen
if [ -f src/screens/setup/EditProductScreen.tsx ]; then
  # grep import paths that look local (./ or ../ or @/components)
  awk '/import .* from /{print}' src/screens/setup/EditProductScreen.tsx | sed -E "s@.*from ['\"]([^'\"]+)['\"].*@\1@" \
    | grep -E '^\./|\.\./|^@/|^src/' || true
  # resolve to files (basic heuristic)
  while IFS= read -r imp; do
    # try typical extensions/aliases
    for ext in tsx ts js jsx; do
      # normalize @/ to src/
      path="${imp/#@\//src/}"
      [ -f "$path.$ext" ] && show "$path.$ext"
      [ -f "$path/index.$ext" ] && show "$path/index.$ext"
    done
  done < <(awk '/import .* from /{print}' src/screens/setup/EditProductScreen.tsx | sed -E "s@.*from ['\"]([^'\"]+)['\"].*@\1@" | sort -u)
fi

# ---- SECTION 2: Suggested Orders (current files only, not .bak) ----
show src/services/orders/suggest.ts
show src/screens/orders/SuggestedOrderScreen.tsx
# If legacy math exists and is referenced
[ -f src/services/suggestMath.ts ] && show src/services/suggestMath.ts || true

# Also output the grep cross-check (paths only)
printf "\n# grep cross-check:\n"
echo '$ grep -R "buildSuggestedOrdersInMemory" -n src | sed -n "1,200p"'
grep -R "buildSuggestedOrdersInMemory" -n src | sed -n '1,200p' || true

# ---- SECTION 3: Global catalogs ----
show scripts/catalog/import-to-firestore.cjs
# helpers that read global_suppliers/*/items (scan components/services)
while IFS= read -r f; do
  if grep -q "global_suppliers" "$f"; then show "$f"; fi
done < <(find src -type f \( -iname '*.ts' -o -iname '*.tsx' -o -iname '*.js' -o -iname '*.jsx' \) | sort)

# ---- SECTION 4: Context & Firebase ----
show src/context/VenueProvider.tsx
show src/firebase/firebase.ts
show src/firebase.js

# ---- SECTION 5: Firestore rules ----
# try common locations
show firestore.rules
show firebase/firestore.rules
show config/firestore.rules

# ---- SECTION 6: Shared UI used by Products/Edit/Suggested ----
# dump shallow files in components/ui and any shared pickers/modals used by Products
for dir in src/components/ui src/components/common src/components/shared; do
  [ -d "$dir" ] || continue
  while IFS= read -r f; do show "$f"; done < <(find "$dir" -maxdepth 1 -type f \( -iname '*.ts' -o -iname '*.tsx' -o -iname '*.js' -o -iname '*.jsx' \) | sort)
done

# Heuristic: if ProductSupplierTools imports from components/products/*, dump those too
if [ -f src/components/products/ProductSupplierTools.tsx ]; then
  while IFS= read -r imp; do
    for ext in tsx ts js jsx; do
      p="${imp/#@\//src/}"
      [ -f "$p.$ext" ] && show "$p.$ext"
      [ -f "$p/index.$ext" ] && show "$p/index.$ext"
    done
  done < <(awk '/import .* from /{print}' src/components/products/ProductSupplierTools.tsx | sed -E "s@.*from ['\"]([^'\"]+)['\"].*@\1@" | grep '^src/components/products/' | sort -u || true)
fi
