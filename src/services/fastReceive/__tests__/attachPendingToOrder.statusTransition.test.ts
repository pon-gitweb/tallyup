/**
 * Tests for the status-transition fix in attachPendingToOrder.
 *
 * The fix: once the finalize-receive pipeline completes successfully,
 * attachPendingToOrder now writes { status: 'received', displayStatus: 'received' }
 * to the order document.  Without this, retroactive orders sat permanently in
 * STATUS_GROUPS.submitted ("orders awaiting arrival").
 *
 * Strategy:
 *   Suite A — test STATUS_GROUPS predicates directly (pure, no mocking needed)
 *             to prove the emitted status value lands in the correct UI bucket.
 *   Suite B — mock Firebase and the orders/receive module at the module level
 *             (jest.mock hoisted to top) to verify the correct updateDoc payload
 *             is emitted on success, and withheld on failure.
 *
 * Follows the jest.mock-at-top-level pattern already used in this project
 * (see src/services/__tests__/reset.test.ts).
 */

// ── Top-level mocks — hoisted by Jest before any imports ─────────────────────

jest.mock('firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('firebase/firestore', () => ({
  getFirestore:    jest.fn(() => ({})),
  doc:             jest.fn((_db: any, ...path: string[]) => ({ _path: path.join('/') })),
  getDoc:          jest.fn(),
  updateDoc:       jest.fn().mockResolvedValue(undefined),
  serverTimestamp: jest.fn(() => 'SERVER_TS'),
}));

jest.mock('../../../services/orders/receive', () => ({
  finalizeReceiveFromCsv: jest.fn(),
  finalizeReceiveFromPdf: jest.fn(),
}));

// ── Imports (resolved after mocks are in place) ───────────────────────────────

import * as firestore from 'firebase/firestore';
import * as receiveModule from '../../../services/orders/receive';
import { attachPendingToOrder } from '../attachPendingToOrder';
import { STATUS_GROUPS } from '../../../utils/orderStatus';

const mockUpdateDoc     = firestore.updateDoc     as jest.Mock;
const mockGetDoc        = firestore.getDoc        as jest.Mock;
const mockFinalizeCsv   = receiveModule.finalizeReceiveFromCsv as jest.Mock;

/** A minimal valid snapshot payload (CSV source). */
function makeSnap(overrides: Partial<{ exists: boolean; source: string }> = {}) {
  const exists = overrides.exists !== false;
  return {
    exists: () => exists,
    data: exists
      ? () => ({
          source: overrides.source ?? 'csv',
          payload: {
            invoice: { source: 'csv', storagePath: 'test.csv', poNumber: null },
            lines: [{ name: 'Beer', qty: 6, unitPrice: 3.50 }],
          },
        })
      : undefined,
  };
}

// ── Suite A: STATUS_GROUPS classification ─────────────────────────────────────

describe('STATUS_GROUPS — retroactive order status after fix', () => {
  it('A1: status "received" is classified as received (visible in received tab)', () => {
    expect(STATUS_GROUPS.received({ id: 'o1', status: 'received' })).toBe(true);
  });

  it('A2: status "received" is NOT classified as submitted (leaves "awaiting arrival")', () => {
    expect(STATUS_GROUPS.submitted({ id: 'o1', status: 'received' })).toBe(false);
  });

  it('A3: status "submitted" still classified as submitted — pathway A unchanged', () => {
    expect(STATUS_GROUPS.submitted({ id: 'o1', status: 'submitted' })).toBe(true);
    expect(STATUS_GROUPS.received({ id: 'o1', status: 'submitted' })).toBe(false);
  });

  it('A4: both status and displayStatus "received" together — classification stable', () => {
    expect(STATUS_GROUPS.received({ id: 'o1', status: 'received', displayStatus: 'received' })).toBe(true);
    expect(STATUS_GROUPS.submitted({ id: 'o1', status: 'received', displayStatus: 'received' })).toBe(false);
  });
});

// ── Suite B: attachPendingToOrder — received status write ─────────────────────

describe('attachPendingToOrder — received status write', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: updateDoc succeeds
    mockUpdateDoc.mockResolvedValue(undefined);
  });

  it('B1: writes status:received + displayStatus:received to the order on success', async () => {
    mockGetDoc.mockResolvedValue(makeSnap());
    mockFinalizeCsv.mockResolvedValue({ ok: true });

    await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    // Find the updateDoc call that targets the order document with status:'received'
    const receivedCall = mockUpdateDoc.mock.calls.find(
      ([ref, payload]: [any, any]) =>
        (ref?._path || '').includes('orders/o1') &&
        payload?.status === 'received',
    );

    expect(receivedCall).toBeDefined();
    expect(receivedCall![1]).toMatchObject({ status: 'received', displayStatus: 'received' });
  });

  it('B2: does NOT write received status when pipeline returns ok:false', async () => {
    mockGetDoc.mockResolvedValue(makeSnap());
    mockFinalizeCsv.mockResolvedValue({ ok: false, error: 'reconcile failed' });

    const result = await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    expect(result.ok).toBe(false);

    const receivedWrite = mockUpdateDoc.mock.calls.find(
      ([_ref, payload]: [any, any]) => payload?.status === 'received',
    );
    expect(receivedWrite).toBeUndefined();
  });

  it('B3: does NOT write received status when snapshot is missing', async () => {
    mockGetDoc.mockResolvedValue(makeSnap({ exists: false }));

    const result = await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    expect(result.ok).toBe(false);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('B4: returns ok:true on success (regression — return shape unchanged)', async () => {
    mockGetDoc.mockResolvedValue(makeSnap());
    mockFinalizeCsv.mockResolvedValue({ ok: true });

    const result = await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    expect(result.ok).toBe(true);
  });
});
