// Tests for commitInvoiceChanges — covers the four new source-tagging write sites
// (nearDuplicateMatch price change, same-price touch, first-time price; newProduct priceHistory).
// proposeInvoiceChanges first-time and priceChange were already tagged before Phase P1.

// ── Firebase-admin mock ───────────────────────────────────────────────────────
// Capture every batch.set() and batch.update() call so we can assert on them.
const mockBatchSets: Array<{ path: string; data: any }> = [];
const mockBatchUpdates: Array<{ path: string; data: any }> = [];
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

// Supplier link snaps: return { exists: false } by default so supplierLink
// proposals fall into the "new link" branch without complex read mocks.
const mockSupplierGet = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
const mockProductGet = jest.fn().mockResolvedValue({
  exists: true,
  data: () => ({ supplierId: null, primarySupplierId: null, supplierName: null }),
});

// doc(path) factory — returns an object whose shape matches what priceTracking.ts uses.
function makeDocRef(path: string) {
  return {
    path,
    get: () => (path.includes('/suppliers/') ? mockSupplierGet() : mockProductGet()),
    collection: (sub: string) => ({
      doc: () => makeDocRef(`${path}/${sub}/__auto__`),
    }),
    update: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
  };
}

jest.mock('firebase-admin', () => {
  const FieldValue = {
    serverTimestamp: jest.fn(() => '__ts__'),
  };

  const batchMock = {
    set: jest.fn((ref: any, data: any) => {
      mockBatchSets.push({ path: ref.path ?? String(ref), data });
    }),
    update: jest.fn((ref: any, data: any) => {
      mockBatchUpdates.push({ path: ref.path ?? String(ref), data });
    }),
    commit: mockBatchCommit,
  };

  const db = {
    batch: () => batchMock,
    doc: (path: string) => makeDocRef(path),
    collection: (path: string) => ({
      limit: () => ({
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }),
      get: jest.fn().mockResolvedValue({ docs: [] }),
      doc: () => makeDocRef(`${path}/__auto__`),
    }),
  };

  return {
    firestore: Object.assign(jest.fn(() => db), { FieldValue }),
  };
});

import { commitInvoiceChanges, ProposedAction } from '../priceTracking';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearMocks() {
  mockBatchSets.length = 0;
  mockBatchUpdates.length = 0;
  mockBatchCommit.mockClear();
}

const VENUE_ID = 'venue-1';
const INVOICE_ID = 'inv-001';
const CTX = { supplierId: 'sup-1', supplierName: 'Acme', invoiceId: INVOICE_ID };

// ── Suite: nearDuplicateMatch — price change ───────────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch price change', () => {
  beforeEach(clearMocks);

  it('writes a priceHistory entry and tags costPriceSource: "invoice"', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:oldwhisky`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-123',
      candidateProductName: 'Old Whisky 1L',
      lineName: 'Old Whisky',
      existingPrice: 40,
      newPrice: 44,
      qty: 6,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    // priceHistory entry must be present
    const histEntry = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(histEntry).toBeDefined();
    expect(histEntry!.data.oldPrice).toBe(40);
    expect(histEntry!.data.newPrice).toBe(44);
    expect(histEntry!.data.direction).toBe('increase');
    expect(histEntry!.data.source).toBe('invoice');
    expect(histEntry!.data.invoiceId).toBe(INVOICE_ID);

    // Product update must include costPriceSource
    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-123'));
    expect(productUpdate).toBeDefined();
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(44);
  });
});

// ── Suite: nearDuplicateMatch — same-price touch ──────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch same-price touch', () => {
  beforeEach(clearMocks);

  it('tags costPriceSource: "invoice" without a priceHistory entry', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:rum`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-456',
      candidateProductName: 'Rum 1L',
      lineName: 'Rum',
      existingPrice: 35,
      newPrice: 35,     // same price → pctDiff === 0
      qty: 3,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    // No priceHistory entry for a same-price touch
    const histEntry = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(histEntry).toBeUndefined();

    // Product update must still tag costPriceSource
    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-456'));
    expect(productUpdate).toBeDefined();
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
  });
});

// ── Suite: nearDuplicateMatch — first-time price ──────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch first-time price', () => {
  beforeEach(clearMocks);

  it('writes an initial priceHistory entry and tags costPriceSource: "invoice"', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:gin`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-789',
      candidateProductName: 'Gin 700ml',
      lineName: 'Gin',
      existingPrice: null,  // no prior price
      newPrice: 38,
      qty: 2,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const histEntry = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(histEntry).toBeDefined();
    expect(histEntry!.data.oldPrice).toBeNull();
    expect(histEntry!.data.newPrice).toBe(38);
    expect(histEntry!.data.direction).toBe('initial');
    expect(histEntry!.data.source).toBe('invoice');

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-789'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(38);
  });
});

// ── Suite: newProduct — priceHistory entry ────────────────────────────────────

describe('commitInvoiceChanges — newProduct priceHistory', () => {
  beforeEach(clearMocks);

  it('writes an initial priceHistory entry alongside the product doc', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:newProduct:newbeer`,
      type: 'newProduct',
      lineName: 'New Beer 330ml',
      unitPrice: 5.5,
      qty: 24,
      caseSize: 24,
      supplierId: 'sup-1',
      supplierName: 'Acme',
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    // One batch.set for the product doc
    const productSet = mockBatchSets.find(
      (s) => !s.path.includes('/priceHistory/') && !s.path.includes('/suppliers/')
    );
    expect(productSet).toBeDefined();
    expect(productSet!.data.costPriceSource).toBe('invoice');

    // One batch.set for the initial priceHistory
    const histEntry = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(histEntry).toBeDefined();
    expect(histEntry!.data.newPrice).toBe(5.5);
    expect(histEntry!.data.direction).toBe('initial');
    expect(histEntry!.data.source).toBe('invoice');
    expect(histEntry!.data.oldPrice).toBeNull();
  });
});
