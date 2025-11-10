# Fast Receive → Attach Pending Snapshot to Submitted Order (QA)

## Happy path (CSV snapshot, no PO)
1) Stock Control → Fast Receives (Pending) → pick a pending item → “Attach to Submitted Order”.
2) In the modal, choose a real Submitted order.
3) Expect: “Invoice attached and sent for reconciliation.”
4) The pending card updates to `Status: attached`.
5) Firestore doc shows `attachedOrderId` and `attachedAt` (check console).

## PDF snapshot path (same flow)
1) Pending snapshot created from PDF (no PO match).
2) Attach to Submitted order from the modal.
3) Expect identical success message and status/fields as CSV path.

## Failure paths
- Finalizer returns not ok → Alert: “Attach failed …”
- Invalid/tampered payload (`payload.invoice` missing or `lines` not an array) → Alert: “Invalid snapshot payload”
- Any unexpected error → surfaces Alert with error message.

## No orders available
- Modal shows: “No submitted orders found.”

## Non-goals / No regressions
- CSV/PDF/manual receive tunnels remain untouched.
- Orders buckets (Draft / Submitted / Received) intact and unchanged.

## Smoke test commands (manual)
- Open: Stock Control → Fast Receives (Pending).
- Create a pending snapshot by uploading CSV/PDF via “Fast Receive (Scan / Upload)”.
- Attach to a known Submitted order (create one if needed).
- Verify reconciliation kicks off and doc is marked `attached`.

## Rollback
Use git to revert the three files changed for this feature:
- src/services/fastReceive/attachPendingToOrder.ts
- src/services/orders/listSubmittedOrders.ts
- src/screens/stock/FastReceivesReviewPanel.tsx

