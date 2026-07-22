import { CANON, canonicalizeStatus, STATUS_GROUPS } from '../orderStatus';
import type { OrderRow } from '../orderStatus';

// ── Suite 1: CANON map ────────────────────────────────────────────────────────

describe('CANON map — read-tolerance aliases → submitted', () => {
  const submittedAliases = [
    'submitted', 'sent', 'placed', 'approved', 'awaiting',
    'processing', 'queued', 'holding', 'onhold', 'consolidating',
  ];
  for (const alias of submittedAliases) {
    it(`"${alias}" → "submitted"`, () => {
      expect(CANON[alias]).toBe('submitted');
    });
  }

  it('"received" → "received"', () => expect(CANON['received']).toBe('received'));
  it('"draft" → "draft"', () => expect(CANON['draft']).toBe('draft'));
  it('"cancelled" → "cancelled"', () => expect(CANON['cancelled']).toBe('cancelled'));
  it('"canceled" (US spelling) → "cancelled"', () => expect(CANON['canceled']).toBe('cancelled'));
});

// ── Suite 2: canonicalizeStatus ───────────────────────────────────────────────

describe('canonicalizeStatus', () => {
  it('maps status field aliases to canonical values', () => {
    expect(canonicalizeStatus('sent', null)).toBe('submitted');
    expect(canonicalizeStatus('placed', null)).toBe('submitted');
    expect(canonicalizeStatus('approved', null)).toBe('submitted');
    expect(canonicalizeStatus('awaiting', null)).toBe('submitted');
  });

  it('falls through to displayStatus when status is unknown', () => {
    expect(canonicalizeStatus('unknown_legacy_status', 'sent')).toBe('submitted');
  });

  it('defaults to "draft" when both fields are unknown', () => {
    expect(canonicalizeStatus('completely_unknown', 'also_unknown')).toBe('draft');
  });

  it('handles null/undefined inputs without throwing', () => {
    expect(canonicalizeStatus(null, null)).toBe('draft');
    expect(canonicalizeStatus(undefined, undefined)).toBe('draft');
  });

  it('is case-insensitive', () => {
    expect(canonicalizeStatus('SENT', null)).toBe('submitted');
    expect(canonicalizeStatus('Placed', null)).toBe('submitted');
  });
});

// ── Suite 3: STATUS_GROUPS ────────────────────────────────────────────────────

function row(status: string, extra: Partial<OrderRow> = {}): OrderRow {
  return { id: 'o1', status, ...extra };
}

describe('STATUS_GROUPS.submitted', () => {
  it('true for status === "submitted"', () => {
    expect(STATUS_GROUPS.submitted(row('submitted'))).toBe(true);
  });

  it('true when status is unknown but submittedAt is truthy (Timestamp)', () => {
    const r = row('', { submittedAt: { toMillis: () => 1700000000000 } });
    expect(STATUS_GROUPS.submitted(r)).toBe(true);
  });

  it('true when submittedAt is a plain numeric timestamp', () => {
    const r = row('', { submittedAt: 1700000000000 });
    expect(STATUS_GROUPS.submitted(r)).toBe(true);
  });

  it('false for status === "received"', () => {
    expect(STATUS_GROUPS.submitted(row('received'))).toBe(false);
  });

  it('false for status === "cancelled"', () => {
    expect(STATUS_GROUPS.submitted(row('cancelled'))).toBe(false);
  });

  it('false when status is empty and submittedAt is missing', () => {
    expect(STATUS_GROUPS.submitted(row(''))).toBe(false);
  });
});

describe('STATUS_GROUPS.drafts', () => {
  it('true for draft / pending / pending_merge', () => {
    expect(STATUS_GROUPS.drafts(row('draft'))).toBe(true);
    expect(STATUS_GROUPS.drafts(row('pending'))).toBe(true);
    expect(STATUS_GROUPS.drafts(row('pending_merge'))).toBe(true);
  });

  it('false for cancelled', () => {
    expect(STATUS_GROUPS.drafts(row('cancelled'))).toBe(false);
  });

  it('false for pending-approval (its own tab)', () => {
    expect(STATUS_GROUPS.drafts(row('pending-approval'))).toBe(false);
  });
});

describe('STATUS_GROUPS.received', () => {
  it('true for "received"', () => {
    expect(STATUS_GROUPS.received(row('received'))).toBe(true);
  });

  it('false for anything else', () => {
    expect(STATUS_GROUPS.received(row('submitted'))).toBe(false);
    expect(STATUS_GROUPS.received(row('draft'))).toBe(false);
  });
});
