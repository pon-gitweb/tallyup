// Tests for commitInvoiceChanges â source-tagging (Phase P1) and the per-supplier
// invoiceHistory ledger (Phase P2 / completeness fix).
// Proposal types covered: priceChange, nearDuplicateMatch (all three sub-cases),
// newProduct, supplierLink (new link, existing link, legacy-same-supplier continue).

// ââ Firebase-admin mock âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Capture batch writes and direct doc writes in separate arrays so tests can
// assert on both code paths (batch for most types, individual awaits for supplierLink).
const mockBatchSets: Array<{ path: string; data: any }> = [];
const mockBatchUpdates: Array<{ path: string; data: any }> = [];
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

const mockDocSets: Array<{ path: string; data: any }> = [];
const mockDocUpdates: Array<{ path: string; data: any }> = [];

// Supplier snapshots: default { exists: false } â new-link path.
const mockSupplierGet = jest.fn().mockResolvedValue({ exists: false, data: () => ({}) });
// Product snapshots: default returns a product with no legacy supplierId and no
// prior weighted-average basis (undefined costPrice/costPriceQuantityBasis) â
// this is what makes every pre-P3a test's blend trivially collapse to newPrice.
// Tests that need a NON-trivial blend override this per-test.
let mockProductData: any = { supplierId: null, primarySupplierId: null, supplierName: null };
const mockProductGet = jest.fn(() => Promise.resolve({ exists: true, data: () => mockProductData }));

// Configurable per-test: products list for proposeInvoiceChanges's name-matching,
// and salesReports for quantityConfidence tagging. Neither existed before Phase
// P3a's tests â the generic collection mock always returned { docs: [] }, which
// meant proposeInvoiceChanges could never find a match and salesReports-overlap
// could never resolve true, for any test written against it.
let mockProductsListData: any[] = [];
let mockSalesReportsListData: any[] = [];

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
    collection: (path: string) => {
      if (path.endsWith('/salesReports')) {
        return {
          get: jest.fn(() => Promise.resolve({
            docs: mockSalesReportsListData.map((d) => ({ data: () => d })),
          })),
        };
      }
      if (path.endsWith('/products')) {
        return {
          limit: () => ({
            get: jest.fn(() => Promise.resolve({
              docs: mockProductsListData.map((d, i) => ({ id: d.id ?? `prod-${i}`, data: () => d })),
            })),
          }),
          get: jest.fn(() => Promise.resolve({
            docs: mockProductsListData.map((d, i) => ({ id: d.id ?? `prod-${i}`, data: () => d })),
          })),
          doc: (id?: string) => makeDocRef(`${path}/${id ?? '__auto__'}`),
        };
      }
      return {
        limit: () => ({ get: jest.fn().mockResolvedValue({ docs: [] }) }),
        get: jest.fn().mockResolvedValue({ docs: [] }),
        doc: (id?: string) => makeDocRef(`${path}/${id ?? '__auto__'}`),
      };
    },
  };
  return { firestore: Object.assign(jest.fn(() => db), { FieldValue }) };
});

import { commitInvoiceChanges, proposeInvoiceChanges, ProposedAction } from '../priceTracking';

// ââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function clearMocks() {
  mockBatchSets.length = 0;
  mockBatchUpdates.length = 0;
  mockBatchCommit.mockClear();
  mockDocSets.length = 0;
  mockDocUpdates.length = 0;
  mockProductData = { supplierId: null, primarySupplierId: null, supplierName: null };
  mockProductsListData = [];
  mockSalesReportsListData = [];
}

const VENUE_ID = 'venue-1';
const INVOICE_ID = 'inv-001';
const CTX = { supplierId: 'sup-1', supplierName: 'Acme', invoiceId: INVOICE_ID };

// ââ Suite: priceChange ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

describe('commitInvoiceChanges â priceChange', () => {
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
    expect(invHist!.data.lineTotal).toBe(198);        // 33 Ã 6
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    expect(invHist!.data.oldPrice).toBe(30);
    expect(invHist!.data.direction).toBe('increase');
    // No reasoning attached â not a supplier mismatch â wasPreferredSupplier: true
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
        supplierMismatch: true,       // â this supplier is NOT the preferred one
        preferredSupplierName: 'OtherSupplier',
        matchConfidence: 'moderate',
        matchScore: 0.8,
      },
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist!.data.wasPreferredSupplier).toBe(false);
    expect(invHist!.data.lineTotal).toBe(216);        // 18 Ã 12
  });
});

// ââ Suite: nearDuplicateMatch â price change âââââââââââââââââââââââââââââââââââ

describe('commitInvoiceChanges â nearDuplicateMatch price change', () => {
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
    expect(invHist!.data.lineTotal).toBe(264);        // 44 Ã 6
    expect(invHist!.data.direction).toBe('increase');
    expect(invHist!.data.oldPrice).toBe(40);
    // nearDuplicate: genuinely unknown without extra read
    expect(invHist!.data.wasPreferredSupplier).toBeNull();
  });
});

// ââ Suite: nearDuplicateMatch â same-price touch ââââââââââââââââââââââââââââââ

describe('commitInvoiceChanges â nearDuplicateMatch same-price touch', () => {
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
    expect(invHist!.data.lineTotal).toBe(105);        // 35 Ã 3
    expect(invHist!.data.wasPreferredSupplier).toBeNull();
    // Same-price sub-case omits direction
    expect(invHist!.data.direction).toBeUndefined();
    expect(invHist!.data.oldPrice).toBe(35);
  });
});

// ââ Suite: nearDuplicateMatch â first-time price ââââââââââââââââââââââââââââââ

describe('commitInvoiceChanges â nearDuplicateMatch first-time price', () => {
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
    expect(invHist!.data.lineTotal).toBe(76);         // 38 Ã 2
    expect(invHist!.data.direction).toBe('initial');
    expect(invHist!.data.oldPrice).toBeNull();
    expect(invHist!.data.wasPreferredSupplier).toBeNull();
  });
});

// ââ Suite: nearDuplicateMatch â single invoiceHistory call guarantee ââââââââââ

describe('commitInvoiceChanges â nearDuplicateMatch single invoiceHistory call', () => {
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

// ââ Suite: newProduct âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

describe('commitInvoiceChanges â newProduct', () => {
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
    expect(invHist!.data.lineTotal).toBe(132);        // 5.5 Ã 24
    expect(invHist!.data.direction).toBe('initial');
    expect(invHist!.data.oldPrice).toBeNull();
    // New product â this supplier is the sole/primary supplier
    expect(invHist!.data.wasPreferredSupplier).toBe(true);
  });
});

// ââ Suite: supplierLink â new link ââââââââââââââââââââââââââââââââââââââââââââ

describe('commitInvoiceChanges â supplierLink new link', () => {
  beforeEach(clearMocks);

  it('creates supplier doc and writes invoiceHistory with wasPreferredSupplier:true (no prior preferred)', async () => {
    // mockSupplierGet defaults { exists: false } â new-link path
    // mockProductGet defaults { supplierId: null, primarySupplierId: null } â hasPreferred = false
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
    expect(invHist!.data.lineTotal).toBe(48);         // 12 Ã 4
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    // No prior preferred supplier â this one becomes preferred
    expect(invHist!.data.wasPreferredSupplier).toBe(true);
  });
});

// ââ Suite: supplierLink â existing link update ââââââââââââââââââââââââââââââââ

describe('commitInvoiceChanges â supplierLink existing link update', () => {
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
    expect(invHist!.data.lineTotal).toBe(30);         // 15 Ã 2
    expect(invHist!.data.invoiceId).toBe(INVOICE_ID);
    expect(invHist!.data.wasPreferredSupplier).toBe(true);  // was already preferred
  });
});

// ââ Suite: supplierLink â legacy-same-supplier continue path ââââââââââââââââââ

describe('commitInvoiceChanges â supplierLink legacy-same-supplier continue path', () => {
  beforeEach(clearMocks);

  it('updates supplier, writes invoiceHistory with wasPreferredSupplier:true, then continues', async () => {
    // snap.exists = false (new-link branch) but the product has a legacy supplierId
    // that matches the proposal supplier â the continue path fires.
    // mockSupplierGet handles both supplierRef.get() and legacySubRef.get():
    //   call 1 â snap.exists = false (enters !snap.exists block)
    //   call 2 â legacySubSnap.exists = false (triggers legacySubRef.set)
    // (default mock already returns { exists: false } for all supplier calls)
    mockProductGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        supplierId: 'sup-1',         // legacySupplierId = 'sup-1'
        primarySupplierId: null,     // hasPrimarySet = false â enters legacy block
        supplierName: 'Acme',
      }),
    });

    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:supplierLink:prod-legacy:sup-1`,
      type: 'supplierLink',
      productId: 'prod-legacy',
      productName: 'Legacy Product',
      supplierId: 'sup-1',           // matches legacySupplierId â continue path
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
    expect(invHist!.data.lineTotal).toBe(60);         // 20 Ã 3
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

    // Phase P3a â this sub-case NEVER touched product.costPrice before. The
    // legacy product had no prior costPrice/costPriceQuantityBasis at all, so
    // the blend trivially collapses to the new invoice's own price/qty.
    // Two separate .update() calls target this same product path here (the
    // legacy backfill's primarySupplierId update, then this one) â filter
    // specifically for the one carrying costPrice, not just the first match.
    const productUpdate = mockDocUpdates.find(
      (u) => u.path === 'venues/venue-1/products/prod-legacy' && u.data.costPrice !== undefined
    );
    expect(productUpdate).toBeDefined();
    expect(productUpdate!.data.costPrice).toBe(20);
    expect(productUpdate!.data.costPriceQuantityBasis).toBe(3);
    expect(productUpdate!.data.quantityConfidence).toBe('estimated_no_sales');
  });
});

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Phase P3a â periodic weighted-average costing (see
// price-provenance-supplier-history-scope.md Â§8/Â§8a). Everything below tests
// the ACTUAL blend math through the real commitInvoiceChanges/
// proposeInvoiceChanges functions â not the standalone reproduction script
// used during development. Every pre-existing test above passes its blend
// trivially (mock product has no prior costPrice, so priorQty collapses to 0),
// which is correct but does not prove the non-trivial blend path works at all.
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

// ââ Suite: priceChange â genuine non-trivial weighted-average blend ââââââââââ

describe('commitInvoiceChanges â priceChange weighted-average blend (non-trivial)', () => {
  beforeEach(clearMocks);

  it('blends 100 units @ $10.00 (prior) with 24 units @ $12.50 (new) to ~$10.48', async () => {
    mockProductData = {
      costPrice: 10,
      costPriceQuantityBasis: 100,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
      primarySupplierId: 'sup-1',
      primarySupplierName: 'Acme',
    };

    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:priceChange:prod-wac1`,
      type: 'priceChange',
      productId: 'prod-wac1',
      productName: 'Aged Rum 700ml',
      lineName: 'Aged Rum',
      oldPrice: 10,
      newPrice: 12.5,
      changePercent: 25,
      direction: 'increase',
      qty: 24,
      caseSize: null,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-wac1'));
    expect(productUpdate).toBeDefined();
    // (100*10 + 24*12.5) / 124 = 1300/124 = 10.483870... â rounded to 4dp
    expect(productUpdate!.data.costPrice).toBeCloseTo(10.4839, 4);
    expect(productUpdate!.data.costPriceQuantityBasis).toBe(124);

    // priceHistory records the BLENDED value, not the raw invoice price â
    // priceHistory is the "official cost basis" trail (Â§2), invoiceHistory
    // (checked below) is the raw per-invoice observation trail.
    const priceHist = mockBatchSets.find((s) => s.path.includes('/priceHistory/'));
    expect(priceHist!.data.newPrice).toBeCloseTo(10.4839, 4);

    // invoiceHistory records the RAW invoice-observed price (12.50), not the blend.
    const invHist = mockBatchSets.find((s) => s.path.includes('/invoiceHistory/'));
    expect(invHist!.data.unitCost).toBe(12.5);
  });

  it('a tiny purchase against a huge existing holding barely moves the average', async () => {
    mockProductData = {
      costPrice: 10,
      costPriceQuantityBasis: 1000,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
    };
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:priceChange:prod-wac2`,
      type: 'priceChange',
      productId: 'prod-wac2',
      productName: 'Bulk Item',
      lineName: 'Bulk Item',
      oldPrice: 10,
      newPrice: 100,
      changePercent: 900,
      direction: 'increase',
      qty: 1,
      caseSize: null,
    };
    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);
    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-wac2'));
    // (1000*10 + 1*100) / 1001 = 10100/1001 â 10.0899
    expect(productUpdate!.data.costPrice).toBeCloseTo(10.0899, 3);
    expect(productUpdate!.data.costPrice).toBeLessThan(10.1);
  });
});

// ââ Suite: regression test for the null-priorPrice bug found and fixed during
// development â priorPrice being null must NOT be treated as $0, which would
// wrongly drag the blended average toward zero for unpriced prior stock. ââââ

describe('commitInvoiceChanges â priceChange null priorPrice regression', () => {
  beforeEach(clearMocks);

  it('does not drag the average toward $0 when prior costPrice is null but a quantity basis exists', async () => {
    // This specific combination (a quantity basis with NO price) shouldn't
    // occur from normal use of this system, but defends against exactly the
    // bug that was found and fixed: treating null price as $0 would have
    // given (50*0 + 10*20)/60 = $3.33 here instead of the correct $20.
    mockProductData = {
      costPrice: null,
      costPriceQuantityBasis: 50,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
    };
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:priceChange:prod-nullreg`,
      type: 'priceChange',
      productId: 'prod-nullreg',
      productName: 'Regression Test Item',
      lineName: 'Regression Test Item',
      oldPrice: 0,
      newPrice: 20,
      changePercent: 0,
      direction: 'increase',
      qty: 10,
      caseSize: null,
    };
    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);
    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-nullreg'));
    expect(productUpdate!.data.costPrice).toBe(20);
    // Quantity basis correctly ignores the unpriced prior 50 units, not 60.
    expect(productUpdate!.data.costPriceQuantityBasis).toBe(10);
  });
});

// ââ Suite: same price still grows the quantity basis (nearDuplicateMatch) ââââ

describe('commitInvoiceChanges â nearDuplicateMatch same-price still grows quantity basis', () => {
  beforeEach(clearMocks);

  it('keeps the blended price effectively unchanged but grows the basis when a matching price arrives', async () => {
    mockProductData = {
      costPrice: 8,
      costPriceQuantityBasis: 200,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
    };
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:nearDuplicateMatch:prod-samegrow`,
      type: 'nearDuplicateMatch',
      candidateProductId: 'prod-samegrow',
      candidateProductName: 'Stable Price Item',
      lineName: 'Stable Price Item',
      existingPrice: 8,
      newPrice: 8, // within the 1% same-price threshold
      qty: 50,
      caseSize: null,
    };
    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);
    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-samegrow'));
    expect(productUpdate).toBeDefined();
    // (200*8 + 50*8) / 250 = 8 exactly â price unchanged
    expect(productUpdate!.data.costPrice).toBe(8);
    // But the basis grew from 200 to 250 â this is the point of this test.
    expect(productUpdate!.data.costPriceQuantityBasis).toBe(250);
  });
});

// ââ Suite: quantityConfidence tagging from sales-report overlap âââââââââââââ

describe('commitInvoiceChanges â quantityConfidence tagging', () => {
  beforeEach(clearMocks);

  it('tags estimated_with_sales when a sales report overlaps the window since the last basis update', async () => {
    mockProductData = {
      costPrice: 10,
      costPriceQuantityBasis: 100,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
    };
    mockSalesReportsListData = [
      { report: { period: { start: '2026-08-05', end: '2026-08-20' } } },
    ];
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:priceChange:prod-withsales`,
      type: 'priceChange',
      productId: 'prod-withsales',
      productName: 'Item With Sales Data',
      lineName: 'Item With Sales Data',
      oldPrice: 10,
      newPrice: 11,
      changePercent: 10,
      direction: 'increase',
      qty: 12,
      caseSize: null,
    };
    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);
    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-withsales'));
    expect(productUpdate!.data.quantityConfidence).toBe('estimated_with_sales');
  });

  it('tags estimated_no_sales when no sales report overlaps the window', async () => {
    mockProductData = {
      costPrice: 10,
      costPriceQuantityBasis: 100,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
    };
    mockSalesReportsListData = [
      { report: { period: { start: '2026-06-01', end: '2026-06-30' } } }, // well before the window
    ];
    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:priceChange:prod-nosales`,
      type: 'priceChange',
      productId: 'prod-nosales',
      productName: 'Item Without Sales Data',
      lineName: 'Item Without Sales Data',
      oldPrice: 10,
      newPrice: 11,
      changePercent: 10,
      direction: 'increase',
      qty: 12,
      caseSize: null,
    };
    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);
    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-nosales'));
    expect(productUpdate!.data.quantityConfidence).toBe('estimated_no_sales');
  });
});

// ââ Suite: supplierLink now blends into product.costPrice â the core scope
// expansion this whole phase was about. Previously this never touched
// costPrice at all, regardless of preferred-supplier status. ââââââââââââââââ

describe('commitInvoiceChanges â supplierLink blends into costPrice even for an alternative supplier', () => {
  beforeEach(clearMocks);

  it('a genuinely alternative (non-preferred) supplier purchase still moves the blended cost', async () => {
    // sup-1 is already preferred; this proposal is from sup-2, an alternative.
    mockProductData = {
      costPrice: 15,
      costPriceQuantityBasis: 40,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
      primarySupplierId: 'sup-1',
      primarySupplierName: 'Acme',
    };
    mockSupplierGet.mockResolvedValueOnce({ exists: false, data: () => ({}) });

    const proposal: ProposedAction = {
      id: `${INVOICE_ID}:supplierLink:prod-altsup:sup-2`,
      type: 'supplierLink',
      productId: 'prod-altsup',
      productName: 'Multi-Supplier Item',
      supplierId: 'sup-2',
      supplierName: 'Backup Supplier',
      unitCost: 18,
      caseSize: null,
      wouldBecomePreferred: false,
      qty: 10,
    };

    await commitInvoiceChanges(VENUE_ID, [proposal], CTX);

    const productUpdate = mockDocUpdates.find(
      (u) => u.path === 'venues/venue-1/products/prod-altsup' && u.data.costPrice !== undefined
    );
    expect(productUpdate).toBeDefined();
    // (40*15 + 10*18) / 50 = (600+180)/50 = 15.6 â this is the number that
    // NEVER would have been computed before Phase P3a; supplierLink silently
    // recorded the purchase but left costPrice untouched entirely.
    expect(productUpdate!.data.costPrice).toBeCloseTo(15.6, 4);
    expect(productUpdate!.data.costPriceQuantityBasis).toBe(50);
    // primarySupplierId must NOT change â sup-1 is still preferred, this was
    // an alternative-supplier purchase, not a preference change.
    expect(productUpdate!.data.primarySupplierId).toBeUndefined();
  });
});

// ââ Suite: proposeInvoiceChanges â sites 1 & 2, previously entirely untested
// in this file (only commitInvoiceChanges was imported/tested before). âââââââ

describe('proposeInvoiceChanges â samePriceTouch grows quantity basis', () => {
  beforeEach(clearMocks);

  it('same price arriving still grows the quantity basis via the automatic (non-proposal) path', async () => {
    mockProductsListData = [{
      id: 'prod-propose1',
      name: 'Aged Rum 700ml',
      costPrice: 10,
      costPriceQuantityBasis: 100,
      costPriceBasisAt: { toDate: () => new Date('2026-08-01T00:00:00Z') },
    }];

    const result = await proposeInvoiceChanges({
      venueId: VENUE_ID,
      lines: [{ name: 'Aged Rum 700ml', qty: 12, unitPrice: 10 }], // same price
      supplierId: 'sup-1',
      supplierName: 'Acme',
      invoiceId: INVOICE_ID,
    });

    // Same price â automatic path, no proposal generated for this line.
    expect(result.proposals.find((p) => p.type === 'priceChange')).toBeUndefined();

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-propose1'));
    expect(productUpdate).toBeDefined();
    expect(productUpdate!.data.costPrice).toBe(10);
    // (100*10 + 12*10)/112 = 10 exactly, but the basis must still grow.
    expect(productUpdate!.data.costPriceQuantityBasis).toBe(112);
  });
});

describe('proposeInvoiceChanges â firstTime establishes the initial quantity basis', () => {
  beforeEach(clearMocks);

  it('a brand-first price on an existing-but-unpriced product establishes the basis for future recomputes', async () => {
    mockProductsListData = [{
      id: 'prod-propose2',
      name: 'Never Priced Item',
      // No costPrice at all yet â this is the "first-time" automatic path.
    }];

    await proposeInvoiceChanges({
      venueId: VENUE_ID,
      lines: [{ name: 'Never Priced Item', qty: 8, unitPrice: 22 }],
      supplierId: 'sup-1',
      supplierName: 'Acme',
      invoiceId: INVOICE_ID,
    });

    const productUpdate = mockBatchUpdates.find((u) => u.path.includes('prod-propose2'));
    expect(productUpdate).toBeDefined();
    expect(productUpdate!.data.costPrice).toBe(22);
    expect(productUpdate!.data.costPriceQuantityBasis).toBe(8);
    expect(productUpdate!.data.quantityConfidence).toBe('estimated_no_sales');
  });
});
