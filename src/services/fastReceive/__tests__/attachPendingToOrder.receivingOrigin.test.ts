/**
 * Tests for the receivingOrigin tagging in Pathway B (3c-i).
 *
 * Pathway B: invoice-first unplanned → attachPendingToOrder → finalizeReceiveFromCsv/Pdf
 * The receive module is mocked, so we verify that attachPendingToOrder passes
 * receivingOrigin: 'invoice-first' in the args object to whichever finalize
 * function it delegates to — that arg is then threaded into the invoice write
 * by receive.ts (covered by Pathway A tests).
 *
 * Follows the same jest.mock pattern as attachPendingToOrder.statusTransition.test.ts.
 */

// ── Top-level mocks ───────────────────────────────────────────────────────────

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

// ── Imports ───────────────────────────────────────────────────────────────────

import * as firestore from 'firebase/firestore';
import * as receiveModule from '../../../services/orders/receive';
import { attachPendingToOrder } from '../attachPendingToOrder';

const mockGetDoc      = firestore.getDoc  as jest.Mock;
const mockUpdateDoc   = firestore.updateDoc as jest.Mock;
const mockFinalizeCsv = receiveModule.finalizeReceiveFromCsv as jest.Mock;
const mockFinalizePdf = receiveModule.finalizeReceiveFromPdf as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnap(source: 'csv' | 'pdf' = 'csv') {
  return {
    exists: () => true,
    data: () => ({
      source,
      payload: {
        invoice: { source, storagePath: `test.${source}`, poNumber: null },
        lines: [{ name: 'Wine', qty: 12, unitPrice: 8 }],
      },
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Pathway B — attachPendingToOrder receivingOrigin tagging (3c-i)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateDoc.mockResolvedValue(undefined);
    mockFinalizeCsv.mockResolvedValue({ ok: true });
    mockFinalizePdf.mockResolvedValue({ ok: true });
  });

  it('B1: passes receivingOrigin:"invoice-first" to finalizeReceiveFromCsv for a CSV snapshot', async () => {
    mockGetDoc.mockResolvedValue(makeSnap('csv'));

    await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    expect(mockFinalizeCsv).toHaveBeenCalledTimes(1);
    const [args] = mockFinalizeCsv.mock.calls[0];
    expect(args).toMatchObject({ receivingOrigin: 'invoice-first' });
  });

  it('B2: passes receivingOrigin:"invoice-first" to finalizeReceiveFromPdf for a PDF snapshot', async () => {
    mockGetDoc.mockResolvedValue(makeSnap('pdf'));

    await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    expect(mockFinalizePdf).toHaveBeenCalledTimes(1);
    const [args] = mockFinalizePdf.mock.calls[0];
    expect(args).toMatchObject({ receivingOrigin: 'invoice-first' });
  });

  it('B3: receivingOrigin is exactly the string "invoice-first" (not "planned" or "packing-slip")', async () => {
    mockGetDoc.mockResolvedValue(makeSnap('csv'));
    await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    const [args] = mockFinalizeCsv.mock.calls[0];
    expect(args.receivingOrigin).toBe('invoice-first');
    expect(args.receivingOrigin).not.toBe('planned');
    expect(args.receivingOrigin).not.toBe('packing-slip');
  });

  it('B4: receivingOrigin is NOT passed when the pipeline fails early (snapshot missing)', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: undefined });

    const result = await attachPendingToOrder({ venueId: 'v1', pendingId: 'p1', orderId: 'o1' });

    expect(result.ok).toBe(false);
    expect(mockFinalizeCsv).not.toHaveBeenCalled();
    expect(mockFinalizePdf).not.toHaveBeenCalled();
  });
});
