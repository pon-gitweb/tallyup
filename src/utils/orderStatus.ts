// Canonical order status mapping and group predicates.
// Extracted from OrdersScreen for testability — import from here, not from the screen.

export type OrderRow = {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status: string;
  displayStatus?: string | null;
  rawStatus?: string | null;
  poNumber?: string | null;
  createdAt?: any;
  createdAtClientMs?: number | null;
  submittedAt?: any;
  receivedAt?: any;
  linesCount?: number | null;
  total?: number | null;
  submitHoldUntil?: number | null;
  cutoffAt?: number | null;
  deptScope?: string[] | string | null;
  informal?: boolean;
};

export const CANON: Record<string, string> = {
  draft: 'draft',
  pending: 'pending',
  'pending-approval': 'pending-approval',
  'pending_approval': 'pending-approval',
  'pending_merge': 'pending_merge',
  submitted: 'submitted',
  sent: 'submitted',
  placed: 'submitted',
  approved: 'submitted',
  awaiting: 'submitted',
  processing: 'submitted',
  queued: 'submitted',
  holding: 'submitted',
  onhold: 'submitted',
  consolidating: 'submitted',
  received: 'received',
  'partially_received': 'received',
  invoiced: 'received',
  complete: 'received',
  closed: 'received',
  canceled: 'cancelled',
  cancelled: 'cancelled',
};

const _reportedUnknown = new Set<string>();

function _reportUnknownOnce(raw: string) {
  if (_reportedUnknown.has(raw)) return;
  _reportedUnknown.add(raw);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../services/crashReporting').captureError(
      new Error(`unknown order status: ${raw}`), 'orders:unknownStatus'
    );
  } catch {}
}

export function canonicalizeStatus(statusRaw: any, displayRaw: any): string {
  const s = String(statusRaw ?? '').toLowerCase().trim();
  if (s && CANON[s]) return CANON[s];
  const d = String(displayRaw ?? '').toLowerCase().trim();
  if (d && CANON[d]) return CANON[d];
  // Non-empty unrecognised status → 'unknown' (shown in Submitted tab, read-only)
  const raw = s || d;
  if (raw) {
    _reportUnknownOnce(raw);
    return 'unknown';
  }
  // Empty/missing status defaults to draft
  return 'draft';
}

export const STATUS_GROUPS = {
  drafts: (r: OrderRow) => {
    const s = (r.status || '').toLowerCase().trim();
    if (s === 'cancelled') return false;
    if (s === 'unknown') return false;
    return s === 'draft' || s === 'pending' || s === 'pending_merge';
  },
  pending: (r: OrderRow) => {
    const s = (r.status || '').toLowerCase().trim();
    return s === 'pending-approval';
  },
  submitted: (r: OrderRow) => {
    const s = (r.status || '').toLowerCase().trim();
    const hasSubmittedAt = !!(r.submittedAt && (r.submittedAt.toMillis?.() || Number(r.submittedAt)));
    if (s === 'cancelled') return false;
    if (s === 'received') return false;
    // Unknown status shown in Submitted tab (read-only)
    if (s === 'unknown') return true;
    return s === 'submitted' || hasSubmittedAt;
  },
  received: (r: OrderRow) => {
    const s = (r.status || '').toLowerCase().trim();
    return s === 'received';
  },
};
