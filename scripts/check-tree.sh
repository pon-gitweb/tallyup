#!/usr/bin/env bash
set -euo pipefail
root="src"
need=(
  "navigation/stacks/MainStack.tsx"
  "screens/dashboard/ExistingVenueDashboard.tsx"
  "screens/stock/DepartmentSelectionScreen.tsx"
  "screens/stock/AreaSelectionScreen.tsx"
  "screens/stock/StockTakeAreaInventoryScreen.tsx"
  "screens/setup/SetupWizard.tsx"
  "screens/settings/SettingsScreen.tsx"
  "screens/reports/ReportsScreen.tsx"
  "screens/reports/LastCycleSummaryScreen.tsx"
)
missing=0
for p in "${need[@]}"; do
  if [[ ! -f "$root/$p" ]]; then
    echo "MISSING: $root/$p"
    ((missing++)) || true
  fi
done
if [[ $missing -eq 0 ]]; then
  echo "✅ All critical files present."
else
  echo "⚠️  $missing missing (you can still run, but navigation may fail)."
fi
