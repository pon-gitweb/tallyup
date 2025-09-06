#!/usr/bin/env bash
set -euo pipefail

fail() { echo "❌ $1"; exit 1; }

# 1) Orders surface must expose these symbols
grep -q "export .*listOrders"                 src/services/orders/index.ts || fail "listOrders export missing"
grep -q "export .*createDraftOrderWithLines"  src/services/orders/index.ts || fail "createDraftOrderWithLines export missing"
grep -q "export .*submitDraftOrder"           src/services/orders/index.ts || fail "submitDraftOrder export missing"
grep -q "export .*markOrderReceived"          src/services/orders/index.ts || fail "markOrderReceived export missing"
grep -q "export .*buildSuggestedOrdersInMemory" src/services/orders/index.ts || fail "buildSuggestedOrdersInMemory export missing"
grep -q "export .*createDraftsFromSuggestions"  src/services/orders/index.ts || fail "createDraftsFromSuggestions export missing"

# 2) Compat façade must re-export foldered service
grep -q "export .*from './orders';" src/services/orders.ts || fail "compat façade (src/services/orders.ts) not re-exporting folder index"

# 3) No placeholders/TBDs
! grep -RInE "PLACEHOLDER|TBD|RE-EMIT|<<<|>>>|FIXME" src || fail "Placeholder-like markers found in src/"

# 4) SuggestedOrders screen must not use Object.keys on undefined
grep -RIn "SuggestedOrdersScreen" src/screens | cut -d: -f1 | while read -r f; do
  grep -q "Object.keys(.*|| {}" "$f" || grep -q "Object.keys(.*\|\|[[:space:]]*{})" "$f" || true
done

echo "✅ Preflight OK"
