// Tests for commitInvoiceChanges — covers source-tagging and the per-supplier
// invoiceHistory ledger (Phase P2). Proposal types tested: priceChange,
// nearDuplicateMatch (all three sub-cases), newProduct, supplierLink (new + existing).

// ── Firebase-admin mock ───────────────────────────────────────────────────────
// Capture every batch.set() / batch.update() call and every direct doc.set() /
// doc.update() call so tests can assert on both batch and individual-await writes.
const mockBatchSets: Array<{ path: string; data: any }> = [];
const mockBatchUpdates: Array<{ path: string; data: any }> = [];
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

const mockDocSets: Array<{ path: string; data: any }> = [];
const mockDocUpdates: Array<{ path: string; data: any }> = [];

// Supplier link snaps: defaults to { exists: false } so the new-link code path runs.
const mockSupplierGet = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
const mockProductGet = jest.fn().mockResolvedValue({
  exists: true,
  data: () => ({ supplierId: null, primarySupplierId: null, supplierName: null }),
});

function makeDocRef(path: string) {
  return {
    path,
    get: () => (path.includes('/suppliers/') ? mockSupplierGet() : mockProductGet()),
    collection: (sub: string) => ({
      doc: (id?: string) => makeDocRef(`${path}/${sub}/${id ?? '__auto__'}`),
    }),
    update: jest.fn((data: any) => {
      mockDocUpdates.push({ path, data });
      return Promise.resolve();
    }),
    set: jest.fn((data: any) => {
      mockDocSets.push({ path, data });
      return Promise.resolve();
    }),
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
      doc: (id?: string) => makeDocRef(`${path}/${id ?? '__auto__'}`),
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
  mockDocSets.length = 0;
  mockDocUpdates.length = 0;
}

const VENUE_ID = 'venue-1';
const INVOICE_ID = 'inv-001';
const CTX = { supplierId: 'sup-1', supplierName: 'Acme', invoiceId: INVOICE_ID };

// ── Suite: priceChange — commit ───────────────────────────────────────────────

describe('commitInvoiceChanges — priceChange', () => {
  beforeEach(clearMocks);

  it('writes a priceHistory entry, tags costPriceSource:invoice, and writes invoiceHistory', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:priceChange:prod-pc1`,
      type: 'priceChange',
      productId: 'prod-pc1',
      productName: 'Aged Rum 700ml',
      lineName: 'Aged Rum',
      oldPrice: 30,
      newPrice: 33,
      changePercent: 10,
      direction: 'increase',
      qty: 6,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const priceHistEntry = mockBatchSets.find(
      (s) => s.path.includes('prod-pc1') && s.path.includes('/priceHistory/')
    );
    expect(priceHistEntry).toBeDefined();
    expect(priceHistEntry!.data.source).toBe('invoice');
    expect(priceHistEntry!.data.direction).toBe('increase');

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-pc1'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(33);

    // invoiceHistory written under the supplier subcollection
    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('priceChange');
    expect(invHist!.data.unitCost).toBe(33);
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    expect(invHist!.data.oldPrice).toBe(30);
    expect(invHist!.data.direction).toBe('increase');
  });
});

// ── Suite: nearDuplicateMatch — price change ───────────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch price change', () => {
  beforeEach(clearMocks);

  it('writes priceHistory, tags costPriceSource:invoice, and writes invoiceHistory', async () => {
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

    const priceHistEntry = mockBatchSets.find(
      (s) => s.path.includes('prod-123') && s.path.includes('/priceHistory/')
    );
    expect(priceHistEntry).toBeDefined();
    expect(priceHistEntry!.data.oldPrice).toBe(40);
    expect(priceHistEntry!.data.newPrice).toBe(44);
    expect(priceHistEntry!.data.direction).toBe('increase');
    expect(priceHistEntry!.data.source).toBe('invoice');
    expect(priceHistEntry!.data.invoiceId).toBe(INVOICE_ID);

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-123'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(44);

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('nearDuplicate');
    expect(invHist!.data.unitCost).toBe(44);
    expect(invHist!.data.direction).toBe('increase');
    expect(invHist!.data.oldPrice).toBe(40);
  });
});

// ── Suite: nearDuplicateMatch — same-price touch ──────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch same-price touch', () => {
  beforeEach(clearMocks);

  it('tags costPriceSource:invoice, no priceHistory entry, but writes invoiceHistory', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:rum`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-456',
      candidateProductName: 'Rum 1L',
      lineName: 'Rum',
      existingPrice: 35,
      newPrice: 35,  // same price → pctDiff === 0
      qty: 3,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    // No priceHistory entry for a same-price touch
    const priceHistEntry = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(priceHistEntry).toBeUndefined();

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-456'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');

    // invoiceHistory IS written even for same-price — records the invoice appearance
    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('nearDuplicate');
    expect(invHist!.data.unitCost).toBe(35);
    // Same-price sub-case omits direction
    expect(invHist!.data.direction).toBeUndefined();
    expect(invHist!.data.oldPrice).toBe(35);
  });
});

// ── Suite: nearDuplicateMatch — first-time price ──────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch first-time price', () => {
  beforeEach(clearMocks);

  it('writes initial priceHistory, tags costPriceSource:invoice, and writes invoiceHistory', async () => {
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

    const priceHistEntry = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(priceHistEntry).toBeDefined();
    expect(priceHistEntry!.data.oldPrice).toBeNull();
    expect(priceHistEntry!.data.newPrice).toBe(38);
    expect(priceHistEntry!.data.direction).toBe('initial');
    expect(priceHistEntry!.data.source).toBe('invoice');

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-789'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(38);

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('nearDuplicate');
    expect(invHist!.data.unitCost).toBe(38);
    expect(invHist!.data.direction).toBe('initial');
    expect(invHist!.data.oldPrice).toBeNull();
  });
});

// ── Suite: nearDuplicateMatch — single invoiceHistory call guarantee ──────────

describe('commitInvoiceChanges — nearDuplicateMatch invoiceHistory single-call guarantee', () => {
  beforeEach(clearMocks);

  it('writes exactly one invoiceHistory entry regardless of sub-case', async () => {
    // Use the price-change sub-case; same guarantee holds for the other two
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:vodka`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-vdk',
      candidateProductName: 'Vodka 1L',
      lineName: 'Vodka',
      existingPrice: 25,
      newPrice: 28,
      qty: 12,
      caseSize: 12,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const invHistEntries = mockBatchSets.filter((s) => s.path.includes('/invoiceHistory/'));
    expect(invHistEntries).toHaveLength(1);
  });
});

// ── Suite: newProduct — priceHistory + invoiceHistory ────────────────────────

describe('commitInvoiceChanges — newProduct priceHistory + invoiceHistory', () => {
  beforeEach(clearMocks);

  it('writes product doc, priceHistory, and invoiceHistory with type:newProduct', async () => {
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

    const productSet = mockBatchSets.find(
      (s) => !s.path.includes('/priceHistory/') && !s.path.includes('/suppliers/') && !s.path.includes('/invoiceHistory/')
    );
    expect(productSet).toBeDefined();
    expect(productSet!.data.costPriceSource).toBe('invoice');

    const priceHistEntry = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(priceHistEntry).toBeDefined();
    expect(priceHistEntry!.data.newPrice).toBe(5.5);
    expect(priceHistEntry!.data.direction).toBe('initial');
    expect(priceHistEntry!.data.source).toBe('invoice');

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('newProduct');
    expect(invHist!.data.unitCost).toBe(5.5);
    expect(invHist!.data.direction).toBe('initial');
    expect(invHist!.data.oldPrice).toBeNull();
  });
});

// ── Suite: supplierLink — new link ────────────────────────────────────────────

describe('commitInvoiceChanges — supplierLink new link', () => {
  beforeEach(clearMocks);

  it('creates supplier doc and writes an invoiceHistory entry with type:supplierLink', async () => {
    // mockSupplierGet defaults to { exists: false } → new-link path
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:supplierLink:prod-existing:sup-1`,
      type: 'supplierLink',
      productId: 'prod-existing',
      productName: 'Existing Product',
      supplierId: 'sup-1',
      supplierName: 'Acme',
      unitCost: 12,
      caseSize: null,
      wouldBecomePreferred: true,
      qty: 4,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    // Supplier doc created via direct .set()
    const supplierSet = mockDocSets.find(
      (s) => s.path.includes('/suppliers/') && !s.path.includes('/invoiceHistory/')
    );
    expect(supplierSet).toBeDefined();
    expect(supplierSet!.data.supplierId).toBe('sup-1');

    // invoiceHistory entry written via direct .set() (not batch — outside batch loop)
    const invHist = mockDocSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('supplierLink');
    expect(invHist!.data.unitCost).toBe(12);
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    expect(invHist!.data.qty).toBe(4);
  });
});

// ── Suite: supplierLink — existing link update ────────────────────────────────

describe('commitInvoiceChanges — supplierLink existing link update', () => {
  beforeEach(clearMocks);

  it('updates supplier doc and writes an invoiceHistory entry with type:supplierLink', async () => {
    // Override to snap.exists = true for this one test
    mockSupplierGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });

    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:supplierLink:prod-existing:sup-1`,
      type: 'supplierLink',
      productId: 'prod-existing',
      productName: 'Existing Product',
      supplierId: 'sup-1',
      supplierName: 'Acme',
      unitCost: 15,
      caseSize: 6,
      wouldBecomePreferred: false,
      qty: 2,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    // Supplier updated via direct .update()
    const supplierUpdate = mockDocUpdates.find(
      (u) => u.path.includes('/suppliers/') && !u.path.includes('/invoiceHistory/')
    );
    expect(supplierUpdate).toBeDefined();
    expect(supplierUpdate!.data.unitCost).toBe(15);

    // invoiceHistory written
    const invHist = mockDocSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('supplierLink');
    expect(invHist!.data.unitCost).toBe(15);
    expect(invHist!.data.caseSize).toBe(6);
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
  });
});
