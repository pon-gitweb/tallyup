/**
 * Tests for processHistoricalInvoiceLines (Handoff 5).
 *
 * Strategy: same firebase-admin mock pattern as priceTracking.test.ts —
 * captures batch.set / batch.update arrays and exposes configurable product +
 * salesReport lists.  Four suite groups:
 *
 *   1. Case 1 — matched product with existing costPrice
 *   2. Case 2 — matched product with no costPrice
 *   3. Case 3 — no matching product
 *   4. No-cross-contamination + fresh-invoice regression + mixed-lines
 */

// ── Firebase-admin mock ──────────────────────────────────────────────────────

const mockBatchSets: Array<{ path: string; data: any }> = [];
const mockBatchUpdates: Array<{ path: string; data: any }> = [];
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

let mockProductsListData: any[] = [];
let mockSalesReportsListData: any[] = [];
let mockVenueData: any = { country: 'NZ' };

function makeDocRef(path: string): any {
  return {
    path,
    id: path.split('/').pop() ?? '__auto__',
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => (path.includes('/venues/venue-') && path.split('/').length === 3
        ? mockVenueData
        : {}),
    }),
    collection: (sub: string) => ({
      doc: (id?: string) => makeDocRef(`${path}/${sub}/${id ?? '__auto__'}`),
      add: jest.fn((data: any) => {
        const ref = makeDocRef(`${path}/${sub}/__auto__`);
        mockBatchSets.push({ path: ref.path, data });
        return Promise.resolve(ref);
      }),
    }),
    update: jest.fn(),
    set: jest.fn(),
  };
}

function makeAutoRef(collectionPath: string) {
  const id = `auto-${Math.random().toString(36).slice(2, 8)}`;
  return makeDocRef(`${collectionPath}/${id}`);
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
      // Venue singleton
      if (path === 'venues') {
        return {
          doc: (id: string) => ({
            ...makeDocRef(`venues/${id}`),
            get: jest.fn().mockResolvedValue({ exists: true, data: () => mockVenueData }),
          }),
        };
      }
      // salesReports
      if (path.includes('/salesReports')) {
        return {
          get: jest.fn(() =>
            Promise.resolve({
              docs: mockSalesReportsListData.map((d) => ({ data: () => d })),
            })
          ),
        };
      }
      // products list (venue-scoped)
      if (path.includes('/products')) {
        return {
          limit: () => ({
            get: jest.fn(() =>
              Promise.resolve({
                docs: mockProductsListData.map((d, i) => ({
                  id: d.id ?? `prod-${i}`,
                  data: () => d,
                })),
              })
            ),
          }),
          get: jest.fn(() =>
            Promise.resolve({
              docs: mockProductsListData.map((d, i) => ({
                id: d.id ?? `prod-${i}`,
                data: () => d,
              })),
            })
          ),
          doc: (id?: string) => {
            const docPath = `${path}/${id ?? `auto-${Math.random().toString(36).slice(2, 8)}`}`;
            return makeDocRef(docPath);
          },
        };
      }
      // priceChangeFlags
      if (path.includes('/priceChangeFlags')) {
        return {
          doc: () => makeDocRef(`${path}/__flag__`),
        };
      }
      // fallback
      return {
        limit: () => ({ get: jest.fn().mockResolvedValue({ docs: [] }) }),
        get: jest.fn().mockResolvedValue({ docs: [] }),
        doc: (id?: string) => makeDocRef(`${path}/${id ?? '__auto__'}`),
      };
    },
  };

  return { firestore: Object.assign(jest.fn(() => db), { FieldValue }) };
});

import { processHistoricalInvoiceLines } from '../priceTracking';

// ── Helpers ──────────────────────────────────────────────────────────────────

function clearMocks() {
  mockBatchSets.length = 0;
  mockBatchUpdates.length = 0;
  mockBatchCommit.mockClear();
  mockProductsListData = [];
  mockSalesReportsListData = [];
  mockVenueData = { country: 'NZ' };
}

const VENUE = 'venue-test-1';
const SUPPLIER_ID = 'sup-hist-1';
const SUPPLIER_NAME = 'Historical Wines Co.';
const INVOICE_ID = 'inv-hist-001';
const INVOICE_DATE = '2024-01-15';

// Base opts shared across tests
const baseOpts = {
  venueId: VENUE,
  supplierId: SUPPLIER_ID,
  supplierName: SUPPLIER_NAME,
  invoiceId: INVOICE_ID,
  invoiceDocId: 'invdoc-1',
  invoiceDate: INVOICE_DATE,
};

// ── Suite 1: Case 1 — matched product with existing costPrice ─────────────────

describe('processHistoricalInvoiceLines — Case 1: matched + costPrice exists', () => {
  beforeEach(clearMocks);

  const EXISTING_PRICE = 25.00;
  const INVOICE_PRICE = 27.50;   // +10% → should flag

  const product = {
    id: 'prod-c1',
    name: 'Sauvignon Blanc 750ml',
    costPrice: EXISTING_PRICE,
    costPriceUpdatedAt: '__ts__',
    costPriceSource: 'invoice',
    primarySupplierId: SUPPLIER_ID,
  };

  const line = {
    name: 'Sauvignon Blanc 750ml',
    qty: 12,
    unitPrice: INVOICE_PRICE,
    caseSize: null,
  };

  it('never touches the costPrice field (no batch.update on product)', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const productUpdates = mockBatchUpdates.filter((u) =>
      u.path.includes(`/products/prod-c1`) && !u.path.includes('/suppliers/')
    );
    expect(productUpdates).toHaveLength(0);
  });

  it('writes an invoiceHistory entry tagged isHistoricalBackfill + price_protected', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const histEntry = mockBatchSets.find(
      (s) =>
        s.path.includes(`/products/prod-c1/suppliers/${SUPPLIER_ID}/invoiceHistory/`) &&
        s.data.historicalScenario === 'price_protected'
    );
    expect(histEntry).toBeDefined();
    expect(histEntry!.data.isHistoricalBackfill).toBe(true);
    expect(histEntry!.data.invoiceDate).toBe(INVOICE_DATE);
    expect(histEntry!.data.unitCost).toBe(INVOICE_PRICE);
  });

  it('writes a priceChangeFlags conflict entry when diff > 1%', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const flag = mockBatchSets.find(
      (s) =>
        s.path.includes('/priceChangeFlags/') &&
        s.data.flagReason === 'historical_invoice_conflict'
    );
    expect(flag).toBeDefined();
    expect(flag!.data.productId).toBe('prod-c1');
    expect(flag!.data.oldPrice).toBe(EXISTING_PRICE);
    expect(flag!.data.newPrice).toBe(INVOICE_PRICE);
    expect(flag!.data.status).toBe('pending');
    expect(flag!.data.acknowledgedBy).toBeNull();
    expect(flag!.data.proposedHistoricalInvoiceDate).toBe(INVOICE_DATE);
  });

  it('does NOT write a priceChangeFlags entry when diff ≤ 1%', async () => {
    const samePriceProduct = { ...product, costPrice: 27.10 }; // ~1.47% — just over threshold
    // Use a price that is within 1%
    const samePriceProduct2 = { ...product, costPrice: 27.45 }; // ~0.18% — under threshold
    mockProductsListData = [samePriceProduct2];
    const sameLine = { ...line, unitPrice: 27.50 };
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [sameLine] });

    const flags = mockBatchSets.filter(
      (s) => s.path.includes('/priceChangeFlags/') && s.data.flagReason === 'historical_invoice_conflict'
    );
    expect(flags).toHaveLength(0);
  });

  it('commits the batch when ops > 0', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

// ── Suite 2: Case 2 — matched product, no costPrice set ───────────────────────

describe('processHistoricalInvoiceLines — Case 2: matched + no costPrice', () => {
  beforeEach(clearMocks);

  const INVOICE_PRICE = 18.00;

  const product = {
    id: 'prod-c2',
    name: 'Pinot Noir 750ml',
    costPrice: 0,          // zero → treated as "not set"
    primarySupplierId: null,
  };

  const line = {
    name: 'Pinot Noir 750ml',
    qty: 6,
    unitPrice: INVOICE_PRICE,
    caseSize: 6,
  };

  it('updates costPrice on the product (batch.update)', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const update = mockBatchUpdates.find((u) => u.path.includes('/products/prod-c2'));
    expect(update).toBeDefined();
    expect(update!.data.costPrice).toBeDefined();
    expect(typeof update!.data.costPrice).toBe('number');
  });

  it('tags costPriceSource as "historical-invoice" on product update', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const update = mockBatchUpdates.find((u) => u.path.includes('/products/prod-c2'));
    expect(update!.data.costPriceSource).toBe('historical-invoice');
  });

  it('writes an invoiceHistory entry tagged price_set_first_time', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const histEntry = mockBatchSets.find(
      (s) =>
        s.path.includes(`/products/prod-c2/suppliers/${SUPPLIER_ID}/invoiceHistory/`) &&
        s.data.historicalScenario === 'price_set_first_time'
    );
    expect(histEntry).toBeDefined();
    expect(histEntry!.data.isHistoricalBackfill).toBe(true);
    expect(histEntry!.data.invoiceDate).toBe(INVOICE_DATE);
  });

  it('does NOT write a priceChangeFlags entry', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const flags = mockBatchSets.filter(
      (s) => s.path.includes('/priceChangeFlags/') && s.data.flagReason === 'historical_invoice_conflict'
    );
    expect(flags).toHaveLength(0);
  });

  it('writes a priceHistory entry with source "historical-invoice"', async () => {
    mockProductsListData = [product];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const hist = mockBatchSets.find(
      (s) =>
        s.path.includes('/products/prod-c2/priceHistory/') &&
        s.data.source === 'historical-invoice' &&
        s.data.isHistoricalBackfill === true
    );
    expect(hist).toBeDefined();
  });
});

// ── Suite 3: Case 3 — no matching product (create new) ───────────────────────

describe('processHistoricalInvoiceLines — Case 3: no matching product', () => {
  beforeEach(clearMocks);

  const INVOICE_PRICE = 22.50;

  const line = {
    name: 'Obscure Gin 700ml',
    qty: 4,
    unitPrice: INVOICE_PRICE,
    caseSize: null,
  };

  it('creates a new product document', async () => {
    mockProductsListData = []; // no existing products
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const newProduct = mockBatchSets.find(
      (s) =>
        s.path.includes(`venues/${VENUE}/products/`) &&
        !s.path.includes('/suppliers/') &&
        !s.path.includes('/priceHistory/') &&
        !s.path.includes('/invoiceHistory/') &&
        s.data.name === 'Obscure Gin 700ml'
    );
    expect(newProduct).toBeDefined();
    expect(newProduct!.data.costPrice).toBe(INVOICE_PRICE);
    expect(newProduct!.data.costPriceSource).toBe('historical-invoice');
    expect(newProduct!.data.inductionStatus).toBe('pending');
  });

  it('tags new product gstPercent 15 for NZ venue', async () => {
    mockProductsListData = [];
    mockVenueData = { country: 'NZ' };
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const newProduct = mockBatchSets.find(
      (s) => s.data.name === 'Obscure Gin 700ml' && typeof s.data.gstPercent === 'number'
    );
    expect(newProduct!.data.gstPercent).toBe(15);
  });

  it('tags new product gstPercent 10 for AU venue', async () => {
    mockProductsListData = [];
    mockVenueData = { country: 'AU' };
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const newProduct = mockBatchSets.find(
      (s) => s.data.name === 'Obscure Gin 700ml' && typeof s.data.gstPercent === 'number'
    );
    expect(newProduct!.data.gstPercent).toBe(10);
  });

  it('writes a supplier subdoc for the new product', async () => {
    mockProductsListData = [];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const supplierDoc = mockBatchSets.find(
      (s) =>
        s.path.includes(`/suppliers/${SUPPLIER_ID}`) &&
        !s.path.includes('/invoiceHistory/')
    );
    expect(supplierDoc).toBeDefined();
    expect(supplierDoc!.data.supplierId).toBe(SUPPLIER_ID);
    expect(supplierDoc!.data.agreedPriceSource).toBe('historical-invoice');
  });

  it('writes an invoiceHistory entry tagged product_created', async () => {
    mockProductsListData = [];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const histEntry = mockBatchSets.find(
      (s) =>
        s.path.includes('/invoiceHistory/') &&
        s.data.historicalScenario === 'product_created'
    );
    expect(histEntry).toBeDefined();
    expect(histEntry!.data.isHistoricalBackfill).toBe(true);
    expect(histEntry!.data.invoiceDate).toBe(INVOICE_DATE);
  });

  it('does NOT write a priceChangeFlags entry', async () => {
    mockProductsListData = [];
    await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });

    const flags = mockBatchSets.filter((s) => s.path.includes('/priceChangeFlags/'));
    expect(flags).toHaveLength(0);
  });

  it('returns autoProductMap with the new product id', async () => {
    mockProductsListData = [];
    const result = await processHistoricalInvoiceLines({ ...baseOpts, lines: [line] });
    expect(Object.keys(result.autoProductMap)).toContain('Obscure Gin 700ml');
  });
});

// ── Suite 4: Cross-contamination, fresh-invoice regression, mixed lines ───────

describe('processHistoricalInvoiceLines — no cross-contamination + regression', () => {
  beforeEach(clearMocks);

  it('Case 1 never leaks costPrice update into Case 2 line in same call', async () => {
    const protectedProduct = {
      id: 'prod-protected',
      name: 'Protected Rum 700ml',
      costPrice: 40.00,  // case 1 — must never change
      primarySupplierId: SUPPLIER_ID,
    };
    const unpricedProduct = {
      id: 'prod-unpriced',
      name: 'Unpriced Vodka 700ml',
      costPrice: 0,      // case 2 — price should be set
    };
    mockProductsListData = [protectedProduct, unpricedProduct];

    const lines = [
      { name: 'Protected Rum 700ml', qty: 6, unitPrice: 45.00, caseSize: null },
      { name: 'Unpriced Vodka 700ml', qty: 3, unitPrice: 32.00, caseSize: null },
    ];
    await processHistoricalInvoiceLines({ ...baseOpts, lines });

    // Case 1 product must have zero batch.updates on its root doc
    const protectedUpdates = mockBatchUpdates.filter((u) =>
      u.path.includes('/products/prod-protected') &&
      !u.path.includes('/suppliers/')
    );
    expect(protectedUpdates).toHaveLength(0);

    // Case 2 product must have a batch.update setting costPrice
    const unpricedUpdate = mockBatchUpdates.find((u) =>
      u.path.includes('/products/prod-unpriced')
    );
    expect(unpricedUpdate).toBeDefined();
    expect(unpricedUpdate!.data.costPriceSource).toBe('historical-invoice');
  });

  it('fresh invoice regression — proposeInvoiceChanges NOT called here; function returns empty proposals', async () => {
    // processHistoricalInvoiceLines always returns proposals: []
    // (fresh invoices use proposeInvoiceChanges directly and never reach this function)
    mockProductsListData = [];
    const result = await processHistoricalInvoiceLines({
      ...baseOpts,
      lines: [{ name: 'Test Wine', qty: 6, unitPrice: 20, caseSize: null }],
    });
    expect(result.proposals).toHaveLength(0);
  });

  it('mixed-lines document — non-product lines (freight) excluded, only product lines processed', async () => {
    const product = {
      id: 'prod-mix',
      name: 'Chardonnay 750ml',
      costPrice: 0,
    };
    mockProductsListData = [product];

    const lines = [
      { name: 'Chardonnay 750ml', qty: 6, unitPrice: 19.50, caseSize: null },
      { name: 'Freight Charge', qty: 1, unitPrice: 15.00, caseSize: null, isFreight: true },
      { name: 'Deposit Bottles', qty: 6, unitPrice: 0.20, caseSize: null, isDeposit: true },
    ];
    await processHistoricalInvoiceLines({ ...baseOpts, lines });

    // Only the Chardonnay should create writes — freight / deposit are classified as non-product
    // (classifyLine uses name heuristics — "Freight Charge" and "Deposit" are excluded)
    // At minimum: one update for Chardonnay (Case 2 price set)
    const chardUpdate = mockBatchUpdates.find((u) => u.path.includes('/products/prod-mix'));
    expect(chardUpdate).toBeDefined();

    // No new-product doc created for freight or deposit lines
    const freightProduct = mockBatchSets.find(
      (s) =>
        s.data.name === 'Freight Charge' ||
        s.data.name === 'Deposit Bottles'
    );
    expect(freightProduct).toBeUndefined();
  });

  it('returns correct shape — autoApplied.linked, proposals (empty), autoProductMap, excludedLines', async () => {
    mockProductsListData = [];
    const result = await processHistoricalInvoiceLines({
      ...baseOpts,
      lines: [{ name: 'New Spirit', qty: 3, unitPrice: 55, caseSize: null }],
    });
    expect(result).toHaveProperty('autoApplied');
    expect(result).toHaveProperty('proposals');
    expect(result).toHaveProperty('autoProductMap');
    expect(result).toHaveProperty('excludedLines');
    expect(Array.isArray(result.proposals)).toBe(true);
    expect(Array.isArray(result.excludedLines)).toBe(true);
  });

  it('empty priced lines — no batch commit, returns zero linked', async () => {
    mockProductsListData = [];
    const result = await processHistoricalInvoiceLines({
      ...baseOpts,
      lines: [
        { name: 'Freight', qty: 1, unitPrice: 0, caseSize: null },   // unitPrice=0 → excluded
      ],
    });
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(result.autoApplied.linked).toBe(0);
  });
});
