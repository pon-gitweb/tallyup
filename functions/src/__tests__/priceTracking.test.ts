// Tests for commitInvoiceChanges — source-tagging (Phase P1) and the per-supplier
// invoiceHistory ledger (Phase P2 / completeness fix).
// Proposal types covered: priceChange, nearDuplicateMatch (all three sub-cases),
// newProduct, supplierLink (new link, existing link, legacy-same-supplier continue).

// ── Firebase-admin mock ───────────────────────────────────────────────────────
// Capture batch writes and direct doc writes in separate arrays so tests can
// assert on both code paths (batch for most types, individual awaits for supplierLink).
const mockBatchSets: Array<{ path: string; data: any }> = [];
const mockBatchUpdates: Array<{ path: string; data: any }> = [];
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

const mockDocSets: Array<{ path: string; data: any }> = [];
const mockDocUpdates: Array<{ path: string; data: any }> = [];

// Supplier snapshots: default { exists: false } → new-link path.
const mockSupplierGet = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
// Product snapshots: default returns a product with no legacy supplierId.
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
      limit: () => ({ get: jest.fn().mockResolvedValue({ docs: [] }) }),
      get: jest.fn().mockResolvedValue({ docs: [] }),
      doc: (id?: string) => makeDocRef(`${path}/${id ?? '__auto__'}`),
    }),
  };
  return { firestore: Object.assign(jest.fn(() => db), { FieldValue }) };
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

// ── Suite: priceChange ────────────────────────────────────────────────────────

describe('commitInvoiceChanges — priceChange', () => {
  beforeEach(clearMocks);

  it('writes priceHistory, tags costPriceSource:invoice, and writes invoiceHistory with full fields', async () => {
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

    const priceHist = mockBatchSets.find(
      (s) => s.path.includes('prod-pc1') && s.path.includes('/priceHistory/')
    );
    expect(priceHist).toBeDefined();
    expect(priceHist!.data.source).toBe('invoice');
    expect(priceHist!.data.direction).toBe('increase');

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-pc1'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(33);

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('priceChange');
    expect(invHist!.data.productId).toBe('prod-pc1');
    expect(invHist!.data.productName).toBe('Aged Rum 700ml');
    expect(invHist!.data.supplierId).toBe('sup-1');
    expect(invHist!.data.supplierName).toBe('Acme');
    expect(invHist!.data.unitCost).toBe(33);
    expect(invHist!.data.lineTotal).toBe(198);        // 33 × 6
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    expect(invHist!.data.oldPrice).toBe(30);
    expect(invHist!.data.direction).toBe('increase');
    // No reasoning attached → not a supplier mismatch → wasPreferredSupplier: true
    expect(invHist!.data.wasPreferredSupplier).toBe(true);
  });

  it('marks wasPreferredSupplier:false when reasoning.supplierMismatch is true', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:priceChange:prod-pc2`,
      type: 'priceChange',
      productId: 'prod-pc2',
      productName: 'Wine 750ml',
      lineName: 'Wine',
      oldPrice: 15,
      newPrice: 18,
      changePercent: 20,
      direction: 'increase',
      qty: 12,
      caseSize: 12,
      reasoning: {
        isolatedVsTrend: 'isolated',
        similarChangesOnInvoice: 0,
        supplierMismatch: true,       // ← this supplier is NOT the preferred one
        preferredSupplierName: 'OtherSupplier',
        matchConfidence: 'moderate',
        matchScore: 0.8,
      },
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist!.data.wasPreferredSupplier).toBe(false);
    expect(invHist!.data.lineTotal).toBe(216);        // 18 × 12
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

    const priceHist = mockBatchSets.find(
      (s) => s.path.includes('prod-123') && s.path.includes('/priceHistory/')
    );
    expect(priceHist!.data.oldPrice).toBe(40);
    expect(priceHist!.data.newPrice).toBe(44);
    expect(priceHist!.data.direction).toBe('increase');
    expect(priceHist!.data.source).toBe('invoice');
    expect(priceHist!.data.invoiceId).toBe(INVOICE_ID);

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-123'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(44);

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('nearDuplicate');
    expect(invHist!.data.productId).toBe('prod-123');
    expect(invHist!.data.productName).toBe('Old Whisky 1L');
    expect(invHist!.data.supplierId).toBe('sup-1');
    expect(invHist!.data.supplierName).toBe('Acme');
    expect(invHist!.data.unitCost).toBe(44);
    expect(invHist!.data.lineTotal).toBe(264);        // 44 × 6
    expect(invHist!.data.direction).toBe('increase');
    expect(invHist!.data.oldPrice).toBe(40);
    // nearDuplicate: genuinely unknown without extra read
    expect(invHist!.data.wasPreferredSupplier).toBeNull();
  });
});

// ── Suite: nearDuplicateMatch — same-price touch ──────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch same-price touch', () => {
  beforeEach(clearMocks);

  it('no priceHistory, tags costPriceSource:invoice, writes invoiceHistory (no direction)', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:rum`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-456',
      candidateProductName: 'Rum 1L',
      lineName: 'Rum',
      existingPrice: 35,
      newPrice: 35,
      qty: 3,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    expect(mockBatchSets.find((s) => s.path.includes('/priceHistory/'))).toBeUndefined();

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-456'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('nearDuplicate');
    expect(invHist!.data.unitCost).toBe(35);
    expect(invHist!.data.lineTotal).toBe(105);        // 35 × 3
    expect(invHist!.data.wasPreferredSupplier).toBeNull();
    // Same-price sub-case omits direction
    expect(invHist!.data.direction).toBeUndefined();
    expect(invHist!.data.oldPrice).toBe(35);
  });
});

// ── Suite: nearDuplicateMatch — first-time price ──────────────────────────────

describe('commitInvoiceChanges — nearDuplicateMatch first-time price', () => {
  beforeEach(clearMocks);

  it('writes initial priceHistory, tags costPriceSource:invoice, writes invoiceHistory', async () => {
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:gin`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-789',
      candidateProductName: 'Gin 700ml',
      lineName: 'Gin',
      existingPrice: null,
      newPrice: 38,
      qty: 2,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const priceHist = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(priceHist!.data.oldPrice).toBeNull();
    expect(priceHist!.data.newPrice).toBe(38);
    expect(priceHist!.data.direction).toBe('initial');
    expect(priceHist!.data.source).toBe('invoice');

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-789'));
    expect(productUpdate!.data.costPriceSource).toBe('invoice');
    expect(productUpdate!.data.costPrice).toBe(38);

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist!.data.type).toBe('nearDuplicate');
    expect(invHist!.data.productId).toBe('prod-789');
    expect(invHist!.data.unitCost).toBe(38);
    expect(invHist!.data.lineTotal).toBe(76);         // 38 × 2
    expect(invHist!.data.direction).toBe('initial');
    expect(invHist!.data.oldPrice).toBeNull();
    expect(invHist!.data.wasPreferredSupplier).toBeNull();
  });
});

// ── Suite: nearDuplicateMatch — single invoiceHistory call guarantee ──────────

describe('commitInvoiceChanges — nearDuplicateMatch single invoiceHistory call', () => {
  beforeEach(clearMocks);

  it('writes exactly one invoiceHistory entry regardless of sub-case', async () => {
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

// ── Suite: newProduct ─────────────────────────────────────────────────────────

describe('commitInvoiceChanges — newProduct', () => {
  beforeEach(clearMocks);

  it('writes product doc, priceHistory, and invoiceHistory with wasPreferredSupplier:true', async () => {
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
      (s) => !s.path.includes('/priceHistory/')
           && !s.path.includes('/suppliers/')
           && !s.path.includes('/invoiceHistory/')
    );
    expect(productSet!.data.costPriceSource).toBe('invoice');

    const priceHist = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(priceHist!.data.newPrice).toBe(5.5);
    expect(priceHist!.data.direction).toBe('initial');
    expect(priceHist!.data.source).toBe('invoice');

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('newProduct');
    expect(invHist!.data.productName).toBe('New Beer 330ml');
    expect(invHist!.data.supplierId).toBe('sup-1');
    expect(invHist!.data.supplierName).toBe('Acme');
    expect(invHist!.data.unitCost).toBe(5.5);
    expect(invHist!.data.lineTotal).toBe(132);        // 5.5 × 24
    expect(invHist!.data.direction).toBe('initial');
    expect(invHist!.data.oldPrice).toBeNull();
    // New product → this supplier is the sole/primary supplier
    expect(invHist!.data.wasPreferredSupplier).toBe(true);
  });
});

// ── Suite: supplierLink — new link ────────────────────────────────────────────

describe('commitInvoiceChanges — supplierLink new link', () => {
  beforeEach(clearMocks);

  it('creates supplier doc and writes invoiceHistory with wasPreferredSupplier:true (no prior preferred)', async () => {
    // mockSupplierGet defaults { exists: false } → new-link path
    // mockProductGet defaults { supplierId: null, primarySupplierId: null } → hasPreferred = false
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

    const supplierSet = mockDocSets.find(
      (s) => s.path.includes('/suppliers/') && !s.path.includes('/invoiceHistory/')
    );
    expect(supplierSet).toBeDefined();
    expect(supplierSet!.data.supplierId).toBe('sup-1');

    const invHist = mockDocSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('supplierLink');
    expect(invHist!.data.productId).toBe('prod-existing');
    expect(invHist!.data.productName).toBe('Existing Product');
    expect(invHist!.data.supplierId).toBe('sup-1');
    expect(invHist!.data.supplierName).toBe('Acme');
    expect(invHist!.data.unitCost).toBe(12);
    expect(invHist!.data.lineTotal).toBe(48);         // 12 × 4
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    // No prior preferred supplier → this one becomes preferred
    expect(invHist!.data.wasPreferredSupplier).toBe(true);
  });
});

// ── Suite: supplierLink — existing link update ────────────────────────────────

describe('commitInvoiceChanges — supplierLink existing link update', () => {
  beforeEach(clearMocks);

  it('updates supplier doc and writes invoiceHistory reflecting existing isPreferred flag', async () => {
    // snap.exists = true, and this supplier is already the preferred one
    mockSupplierGet.mockResolvedValueOnce({ exists: true, data: () => ({ isPreferred: true }) });

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

    const supplierUpdate = mockDocUpdates.find(
      (u) => u.path.includes('/suppliers/') && !u.path.includes('/invoiceHistory/')
    );
    expect(supplierUpdate!.data.unitCost).toBe(15);

    const invHist = mockDocSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('supplierLink');
    expect(invHist!.data.unitCost).toBe(15);
    expect(invHist!.data.caseSize).toBe(6);
    expect(invHist!.data.lineTotal).toBe(30);         // 15 × 2
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    expect(invHist!.data.wasPreferredSupplier).toBe(true);  // was already preferred
  });
});

// ── Suite: supplierLink — legacy-same-supplier continue path ──────────────────

describe('commitInvoiceChanges — supplierLink legacy-same-supplier continue path', () => {
  beforeEach(clearMocks);

  it('updates supplier, writes invoiceHistory with wasPreferredSupplier:true, then continues', async () => {
    // snap.exists = false (new-link branch) but the product has a legacy supplierId
    // that matches the proposal supplier → the continue path fires.
    // mockSupplierGet handles both supplierRef.get() and legacySubRef.get():
    //   call 1 → snap.exists = false (enters !snap.exists block)
    //   call 2 → legacySubSnap.exists = false (triggers legacySubRef.set)
    // (default mock already returns { exists: false } for all supplier calls)
    mockProductGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        supplierId: 'sup-1',         // legacySupplierId = 'sup-1'
        primarySupplierId: null,     // hasPrimarySet = false → enters legacy block
        supplierName: 'Acme',
      }),
    });

    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:supplierLink:prod-legacy:sup-1`,
      type: 'supplierLink',
      productId: 'prod-legacy',
      productName: 'Legacy Product',
      supplierId: 'sup-1',           // matches legacySupplierId → continue path
      supplierName: 'Acme',
      unitCost: 20,
      caseSize: null,
      wouldBecomePreferred: false,
      qty: 3,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    // The continue path does supplierRef.update (not .set), then writes invoiceHistory, then continue.
    // So mockDocSets has: legacySubRef.set + invoiceHistory.set (NOT a main supplierRef.set)
    // and mockDocUpdates has: supplierRef.update + product primarySupplierId.update
    const invHist = mockDocSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist).toBeDefined();
    expect(invHist!.data.type).toBe('supplierLink');
    expect(invHist!.data.productId).toBe('prod-legacy');
    expect(invHist!.data.supplierId).toBe('sup-1');
    expect(invHist!.data.unitCost).toBe(20);
    expect(invHist!.data.lineTotal).toBe(60);         // 20 × 3
    // This IS the legacy preferred supplier being updated
    expect(invHist!.data.wasPreferredSupplier).toBe(true);

    // Confirm the bottom-of-try invoiceHistory write was NOT reached (continue was hit):
    // only one invoiceHistory entry total
    const allInvHist = mockDocSets.filter((s) => s.path.includes('/invoiceHistory/'));
    expect(allInvHist).toHaveLength(1);

    // Confirm the main invoice-import supplierRef.set did NOT run (continue path prevents it).
    // The legacy migration legacySubRef.set does run (same path, addedBy:'migration'),
    // but not the invoice-import set which carries agreedPrice.
    const invoiceImportSet = mockDocSets.find(
      (s) => s.path.includes('/suppliers/') && !s.path.includes('/invoiceHistory/')
             && s.data.addedBy === 'invoice-import'
    );
    expect(invoiceImportSet).toBeUndefined();

    // The legacy migration set ran (addedBy:'migration')
    const migrationSet = mockDocSets.find(
      (s) => s.path.includes('/suppliers/') && !s.path.includes('/invoiceHistory/')
             && s.data.addedBy === 'migration'
    );
    expect(migrationSet).toBeDefined();
  });
});
