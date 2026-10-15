import { computeSnapshotItemFigures, writeDepartmentSnapshot } from '../snapshotWriter';
import type { ProductResolution, SupplierResolution } from '../snapshotWriter';

// snapshotWriter.ts imports firebase SDK at module level; mock it so tests
// run without an initialised Firebase app.
jest.mock('../../firebase', () => ({ db: {} }));
// Shared mock batch used across tests
const mockBatch = {
  set: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
  commit: jest.fn().mockResolvedValue(undefined),
};
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  writeBatch: jest.fn(),
  deleteDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  Timestamp: { fromDate: jest.fn((d: Date) => d) },
}));
jest.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: null }) }));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Record<string, any> = {}) {
  return {
    _id: 'prod-1',
    _areaId: 'area-1',
    _areaName: 'Bar',
    name: 'Vodka 1L',
    lastCount: 10,
    costPrice: 25,
    parLevel: 12,
    productId: 'prod-1',
    ...overrides,
  };
}

function prevMap(entries: Record<string, number> = {}): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
}

// ── Suite 1: post-enrichment formula ─────────────────────────────────────────

describe('computeSnapshotItemFigures — post-enrichment formula', () => {
  it('expected = opening + received − sold', () => {
    const item = makeItem({ name: 'Vodka 1L', lastCount: 10 });
    const prev = prevMap({ 'vodka 1l': 8 });
    const invoiceLines = [[{ productName: 'Vodka 1L', qty: 6, unitCost: 25 }]];
    const salesLines = [{ name: 'vodka 1l', qtySold: 3 }];

    const { snapshotItems } = computeSnapshotItemFigures(
      [item], prev, 2, invoiceLines, salesLines,
    );

    const si = snapshotItems[0];
    expect(si.openingCount).toBe(8);
    expect(si.receivedQty).toBe(6);
    expect(si.soldQty).toBe(3);
    expect(si.expectedClosing).toBe(8 + 6 - 3);   // 11
    expect(si.unexplainedVarianceQty).toBe(10 - 11); // actualClosing(10) − expected(11) = −1
  });

  it('tier-1 (no invoices, no sales): unexplained === totalVarianceQty', () => {
    const item = makeItem({ name: 'Gin 1L', lastCount: 5 });
    const prev = prevMap({ 'gin 1l': 8 });

    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, [], []);

    const si = snapshotItems[0];
    expect(si.receivedQty).toBe(0);
    expect(si.soldQty).toBeNull();
    expect(si.totalVarianceQty).toBe(5 - 8); // −3
    expect(si.unexplainedVarianceQty).toBe(si.totalVarianceQty);
  });

  it('openingCount == null → defaults preserved, confidence low', () => {
    const item = makeItem({ name: 'Rum 1L', lastCount: 4 });
    // cycle 1: no prev snapshot
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, [], []);

    const si = snapshotItems[0];
    expect(si.openingCount).toBeNull();
    expect(si.expectedClosing).toBeNull();
    // unexplained defaults to total (actualClosing − 0)
    expect(si.unexplainedVarianceQty).toBe(si.totalVarianceQty);
    expect(si.varianceConfidence).toBe('low');
    expect(si.confidenceReason).toBe('First cycle for department');
  });

  it('cycle > 1 new product → openingCount null, confidenceReason "New product"', () => {
    const item = makeItem({ name: 'Tequila 1L', lastCount: 2 });
    // prevMap has no entry for this product
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 3, [], []);

    const si = snapshotItems[0];
    expect(si.openingCount).toBeNull();
    expect(si.confidenceReason).toMatch(/New product/);
  });
});

// ── Suite 2: invoice line field tolerance ─────────────────────────────────────

describe('computeSnapshotItemFigures — invoice line field tolerance', () => {
  const prev = prevMap({ 'whisky 1l': 10 });
  const item = makeItem({ name: 'Whisky 1L', lastCount: 16, productId: 'wh-1', _id: 'item-w' });

  it('subcollection shape: productId + qty + unitCost', () => {
    const lines = [[{ _docId: 'line-1', productId: 'wh-1', qty: 6, unitCost: 30 }]];
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, lines, []);
    expect(snapshotItems[0].receivedQty).toBe(6);
  });

  it('inline-array shape: productName + quantity + cost', () => {
    const lines = [[{ productName: 'Whisky 1L', quantity: 4, cost: 28 }]];
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, lines, []);
    expect(snapshotItems[0].receivedQty).toBe(4);
  });

  it('inline-array shape: name + qty + unitPrice', () => {
    const lines = [[{ name: 'Whisky 1L', qty: 3, unitPrice: 29 }]];
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, lines, []);
    expect(snapshotItems[0].receivedQty).toBe(3);
  });

  it('inline-array shape: name + qty + price fallback', () => {
    const lines = [[{ name: 'Whisky 1L', qty: 2, price: 27 }]];
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, lines, []);
    expect(snapshotItems[0].receivedQty).toBe(2);
  });

  it('accumulates qty across multiple invoices', () => {
    const lines = [
      [{ name: 'Whisky 1L', qty: 3, unitCost: 30 }],
      [{ productId: 'wh-1', qty: 5, unitCost: 30 }],
    ];
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, lines, []);
    expect(snapshotItems[0].receivedQty).toBe(8);
  });

  it('hasInvoices true when any invoice has lines', () => {
    const lines = [[{ name: 'Whisky 1L', qty: 1, unitCost: 30 }]];
    const { hasInvoices } = computeSnapshotItemFigures([item], prev, 2, lines, []);
    expect(hasInvoices).toBe(true);
  });

  it('hasInvoices false when all invoice arrays are empty', () => {
    const { hasInvoices } = computeSnapshotItemFigures([item], prev, 2, [[], []], []);
    expect(hasInvoices).toBe(false);
  });
});

// ── Suite 3: STEP B flag logic ────────────────────────────────────────────────

describe('computeSnapshotItemFigures — STEP B flags', () => {
  it('likelyMissingInvoice fires when totalVarianceQty > 2 AND receivedQty === 0 AND baseline', () => {
    const item = makeItem({ name: 'Beer Case', lastCount: 15, productId: 'beer-1', _id: 'beer-1' });
    const prev = prevMap({ 'beer case': 10 });
    // no invoice lines → receivedQty stays 0; gain = 15 − 10 = 5 > 2

    const { snapshotItems, likelyMissingInvoices } = computeSnapshotItemFigures(
      [item], prev, 2, [], [],
    );
    expect(snapshotItems[0].likelyMissingInvoice).toBe(true);
    expect(snapshotItems[0].hasUnexplainedGain).toBe(true);
    expect(likelyMissingInvoices).toHaveLength(1);
    expect(likelyMissingInvoices[0].productId).toBe('beer-1');
  });

  it('likelyMissingInvoice does NOT fire when an invoice covered the gain', () => {
    const item = makeItem({ name: 'Beer Case', lastCount: 15, productId: 'beer-1', _id: 'beer-1' });
    const prev = prevMap({ 'beer case': 10 });
    // invoice covers the gain
    const lines = [[{ name: 'Beer Case', qty: 5, unitCost: 40 }]];

    const { snapshotItems, likelyMissingInvoices } = computeSnapshotItemFigures(
      [item], prev, 2, lines, [],
    );
    expect(snapshotItems[0].likelyMissingInvoice).toBe(false);
    expect(likelyMissingInvoices).toHaveLength(0);
  });

  it('likelyMissingInvoice does NOT fire without a baseline (cycle 1)', () => {
    const item = makeItem({ name: 'Beer Case', lastCount: 15 });

    const { snapshotItems, likelyMissingInvoices } = computeSnapshotItemFigures(
      [item], new Map(), 1, [], [],
    );
    expect(snapshotItems[0].likelyMissingInvoice).toBe(false);
    expect(likelyMissingInvoices).toHaveLength(0);
  });

  it('hasUnexplainedLoss keys off unexplainedVarianceQty < −2, not totalVarianceQty', () => {
    // Opening 10, lastCount 5, received 4 → expected = 10 + 4 = 14; unexplained = 5 − 14 = −9
    // totalVarianceQty = 5 − 10 = −5 (also < −2, but the FLAG must use unexplained)
    const item = makeItem({ name: 'Gin 1L', lastCount: 5 });
    const prev = prevMap({ 'gin 1l': 10 });
    const lines = [[{ name: 'Gin 1L', qty: 4, unitCost: 20 }]];

    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, lines, []);
    const si = snapshotItems[0];
    expect(si.unexplainedVarianceQty).toBe(5 - (10 + 4)); // −9
    expect(si.hasUnexplainedLoss).toBe(true);

    // Control: same numbers but with an invoice explaining it (unexplained = 0)
    const itemExplained = makeItem({ name: 'Gin 1L', lastCount: 5 });
    const linesExplained = [[{ name: 'Gin 1L', qty: 4, unitCost: 20 }]];
    // Wait — same scenario. Let's do a case where unexplained > −2 even though total < −2:
    // Opening 10, lastCount 8, received 0, no sales → total = 8−10 = −2 (NOT < −2)
    // Opening 10, lastCount 7, received 6 → expected = 16; actual = 7; unexplained = 7−16 = −9
    // total = 7−10 = −3 (< −2). Both flag here — use a case where ONLY unexplained < −2.
    // Opening 10, lastCount 8, received 6 → expected=16; unexplained=8−16=−8; total=8−10=−2 (not < −2)
    const itemTotalBorderline = makeItem({ name: 'Gin 1L', lastCount: 8 });
    const linesBorderline = [[{ name: 'Gin 1L', qty: 6, unitCost: 20 }]];
    const { snapshotItems: si2 } = computeSnapshotItemFigures(
      [itemTotalBorderline], prev, 2, linesBorderline, [],
    );
    expect(si2[0].totalVarianceQty).toBe(8 - 10);         // −2, NOT < −2
    expect(si2[0].unexplainedVarianceQty).toBe(8 - 16);   // −8, IS < −2
    expect(si2[0].hasUnexplainedLoss).toBe(true);
  });
});

// ── Suite: cycleNumber boundary (pins the > 1 → > 0 change) ──────────────────

describe('computeSnapshotItemFigures — cycleNumber boundary', () => {
  const item = makeItem({ name: 'Gin', lastCount: 10, costPrice: 30 });
  const prev = prevMap({ gin: 5 });

  it('cycle-0: openingCount is null regardless of prevItemMap content', () => {
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 0, [], []);
    expect(snapshotItems[0].openingCount).toBeNull();
  });

  it('cycle-1: openingCount reads from prevItemMap (prev snapshot was cycle-0)', () => {
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 1, [], []);
    expect(snapshotItems[0].openingCount).toBe(5);
  });

  it('cycle-2: openingCount reads from prevItemMap', () => {
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, [], []);
    expect(snapshotItems[0].openingCount).toBe(5);
  });

  it('cycle-1 with empty prevItemMap (no baseline written): openingCount is null', () => {
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, [], []);
    expect(snapshotItems[0].openingCount).toBeNull();
  });
});

// ── Suite: hasBaseline contract (pins what variance.ts guard reads) ───────────
// variance.ts: `if (!snapshot.dataCompleteness?.hasBaseline) continue`
// That field is written from computeSnapshotItemFigures's `hasBaseline` return value.

describe('computeSnapshotItemFigures — hasBaseline contract', () => {
  const item = makeItem({ name: 'Gin', lastCount: 10, costPrice: 30 });
  const prev = prevMap({ gin: 5 });

  it('cycle-0: hasBaseline is false — variance screen skips baseline docs', () => {
    const { hasBaseline } = computeSnapshotItemFigures([item], prev, 0, [], []);
    expect(hasBaseline).toBe(false);
  });

  it('cycle-1 with prevItemMap: hasBaseline is true — variance screen shows this cycle', () => {
    const { hasBaseline } = computeSnapshotItemFigures([item], prev, 1, [], []);
    expect(hasBaseline).toBe(true);
  });

  it('cycle-1 with empty prevItemMap (legacy first cycle): hasBaseline is false — skipped', () => {
    const { hasBaseline } = computeSnapshotItemFigures([item], new Map(), 1, [], []);
    expect(hasBaseline).toBe(false);
  });
});

// ── Suite: ProductResolution — mergedInto-aware matching ──────────────────────
//
// A same-area-conflict merge leaves the area item's productId pointing to the
// now-inactive product. Invoice lines and sales reports reference the survivor.
// Without ProductResolution the match fails; with it, the resolved id bridges
// the gap. Tests 1 and 3 pin the pre-fix broken behavior; 2, 4, 5 assert the fix.

describe('computeSnapshotItemFigures — ProductResolution (mergedInto chain)', () => {
  // Item left behind by a same-area-conflict merge: productId still points to
  // the old/inactive product, raw name is the old product's name.
  function makeConflictItem() {
    return makeItem({
      _id: 'area-item-x',
      name: 'Batch Old Fashioned',
      productId: 'old-id',   // inactive — mergedInto survivor-id
      lastCount: 5,
      costPrice: null,        // no stamped price → Tier 2 path via invoice
    });
  }

  const pr: ProductResolution = {
    resolvedIdById: { 'old-id': 'survivor-id' },
    resolvedIdByName: {
      'batch old fashioned': 'survivor-id', // old product name maps to survivor
      'old fashioned': 'survivor-id',       // survivor name maps to itself
    },
  };

  it('[pre-fix] invoice line with survivor id does NOT match item with old id (no PR)', () => {
    // Without ProductResolution only _rawProductId and name are checked.
    // Invoice line has survivor's id; item has old id; names differ → no match → receivedQty 0.
    const item = makeConflictItem();
    const lines = [[{ productId: 'survivor-id', qty: 6, unitCost: 18 }]];
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, lines, []);
    expect(snapshotItems[0].receivedQty).toBe(0);
  });

  it('[fixed] invoice line with survivor id matches item with old id via resolvedIdById', () => {
    const item = makeConflictItem();
    const lines = [[{ productId: 'survivor-id', qty: 6, unitCost: 18 }]];
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, lines, [], pr);
    expect(snapshotItems[0].receivedQty).toBe(6);
  });

  it('[pre-fix] sales line with survivor name does NOT match item whose _rawName is old name (no PR)', () => {
    // Sales lines carry no productId. Without PR, only _rawName is checked.
    // Sales line name is the survivor product's name; item's raw name is the old name → no match.
    const item = makeConflictItem();
    const salesLines = [{ name: 'old fashioned', qtySold: 3 }];
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, [], salesLines);
    expect(snapshotItems[0].soldQty).toBeNull();
  });

  it('[fixed] sales line with survivor name matches via resolvedIdByName → _resolvedProductId', () => {
    const item = makeConflictItem();
    const salesLines = [{ name: 'old fashioned', qtySold: 3 }];
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, [], salesLines, pr);
    expect(snapshotItems[0].soldQty).toBe(3);
  });

  it('[fixed-symmetric] invoice with old inactive id matches re-pointed item via symmetric resolution', () => {
    // Reverse direction: item already re-pointed to survivor-id (clean merge);
    // invoice was filed under the old id before the merge happened.
    // Before symmetric fix: si._resolvedProductId('survivor-id') !== lineProductId('old-id') → miss.
    // After: resolvedLineProductId('old-id') → 'survivor-id' === si._resolvedProductId → match.
    const item = makeItem({ productId: 'survivor-id', name: 'Old Fashioned', lastCount: 4, costPrice: null });
    const lines = [[{ productId: 'old-id', qty: 5, unitCost: 22 }]];
    const symmetricPr: ProductResolution = {
      resolvedIdById: { 'old-id': 'survivor-id', 'survivor-id': 'survivor-id' },
      resolvedIdByName: {},
    };
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, lines, [], symmetricPr);
    expect(snapshotItems[0].receivedQty).toBe(5);
  });

  it('multi-hop chain: item with grandparent id resolves to survivor via 2-hop PR', () => {
    // The resolveProductChain helper (called in the I/O wrapper) handles multi-hop.
    // Here we supply the already-walked result directly — confirms the computed
    // _resolvedProductId is used, not the raw productId, all the way to the match.
    const item = makeItem({
      name: 'Product X', productId: 'old-id-1', lastCount: 3, costPrice: null,
    });
    const multiHopPr: ProductResolution = {
      resolvedIdById: { 'old-id-1': 'survivor-id', 'old-id-2': 'survivor-id' },
      resolvedIdByName: {},
    };
    const lines = [[{ productId: 'survivor-id', qty: 4, unitCost: 10 }]];
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 1, lines, [], multiHopPr);
    expect(snapshotItems[0].receivedQty).toBe(4);
  });
});

// ── Suite: SupplierResolution — supplierId / supplierName stamping ─────────────
//
// Part A of the supplier-spend fix: computeSnapshotItemFigures now accepts a
// SupplierResolution parameter and stamps supplierId / supplierName from the
// resolved product's catalogue entry onto each snapshot item.
//
// Write site 1 of 2 (snapshot items): verified here via the pure function.
// Write site 2 of 2 (findings.poDiscrepancies): supplierId added alongside the
// existing supplierName in writeDepartmentSnapshot's I/O path (simple field
// addition on orderData.supplierId, which is already in scope).

describe('computeSnapshotItemFigures — SupplierResolution (supplierId stamping)', () => {
  const pr: ProductResolution = {
    resolvedIdById: { 'prod-1': 'prod-1' },
    resolvedIdByName: {},
  };

  const sr: SupplierResolution = {
    supplierInfoByProductId: {
      'prod-1': { supplierId: 'sup-abc', supplierName: 'Acme Beverages' },
    },
  };

  it('stamps supplierId and supplierName from SupplierResolution onto snapshot item', () => {
    const item = makeItem({ productId: 'prod-1', _id: 'prod-1' });
    const { snapshotItems } = computeSnapshotItemFigures(
      [item], new Map(), 1, [], [], pr, sr,
    );

    expect(snapshotItems[0].supplierId).toBe('sup-abc');
    expect(snapshotItems[0].supplierName).toBe('Acme Beverages');
  });

  it('falls back to null supplierId/supplierName when SupplierResolution is empty (safe degrade)', () => {
    const item = makeItem({ productId: 'prod-1', _id: 'prod-1' });
    const { snapshotItems } = computeSnapshotItemFigures(
      [item], new Map(), 1, [], [],
    );

    expect(snapshotItems[0].supplierId).toBeNull();
    expect(snapshotItems[0].supplierName).toBeNull();
  });

  it('stamps null when productId is absent (item not linked to a product)', () => {
    const item = makeItem({ productId: undefined, _id: 'area-item-x' });
    const { snapshotItems } = computeSnapshotItemFigures(
      [item], new Map(), 1, [], [], pr, sr,
    );

    expect(snapshotItems[0].supplierId).toBeNull();
    expect(snapshotItems[0].supplierName).toBeNull();
  });

  it('resolves through a mergedInto chain: inactive product id → survivor supplier info', () => {
    // The item's productId points to the inactive product; ProductResolution
    // walks it to the survivor; SupplierResolution carries the survivor's info.
    const chainPr: ProductResolution = {
      resolvedIdById: { 'old-prod': 'new-prod' },
      resolvedIdByName: {},
    };
    const chainSr: SupplierResolution = {
      supplierInfoByProductId: {
        'old-prod': { supplierId: 'sup-old', supplierName: 'Old Supplier' },
        'new-prod': { supplierId: 'sup-new', supplierName: 'New Supplier' },
      },
    };
    const item = makeItem({ productId: 'old-prod', _id: 'area-item-y' });
    const { snapshotItems } = computeSnapshotItemFigures(
      [item], new Map(), 1, [], [], chainPr, chainSr,
    );

    // _resolvedProductId = 'new-prod' (walked via resolvedIdById)
    // → supplier info comes from new-prod, not old-prod
    expect(snapshotItems[0].supplierId).toBe('sup-new');
    expect(snapshotItems[0].supplierName).toBe('New Supplier');
  });
});

// ── Suite: writeDepartmentSnapshot integration — primarySupplierId/primarySupplierName ──
//
// The unit tests above verify computeSnapshotItemFigures in isolation using a
// SupplierResolution built by the caller.  The blind spot they leave: whether
// writeDepartmentSnapshot itself reads the correct Firestore field names
// (primarySupplierId / primarySupplierName) when building that SupplierResolution.
//
// This suite exercises writeDepartmentSnapshot end-to-end against a minimal fake
// Firestore, asserting that a product document with primarySupplierId/primarySupplierName
// set results in a snapshot item that has the matching supplierId/supplierName.

describe('writeDepartmentSnapshot — primarySupplierId/primarySupplierName stamped to snapshot items', () => {
  // Access the jest.fn() instances wired up by jest.mock above.
  // jest.requireMock returns the exact same mock object, type-cast for convenience.
  const ff = jest.requireMock('firebase/firestore') as {
    getDocs: jest.Mock;
    getDoc: jest.Mock;
    setDoc: jest.Mock;
    writeBatch: jest.Mock;
    collection: jest.Mock;
    doc: jest.Mock;
    query: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
  };

  // Minimal fake QuerySnapshot — supports multiple forEach passes.
  function fakeQSnap(docs: Array<{ id: string; dataObj: Record<string, any> }>) {
    const fakeDocs = docs.map(({ id, dataObj }) => ({ id, data: () => dataObj }));
    return {
      docs: fakeDocs,
      empty: fakeDocs.length === 0,
      size: fakeDocs.length,
      forEach: (fn: (d: any) => void) => fakeDocs.forEach(fn),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    // Stub shape-only helpers (return values don't matter — just need to not throw)
    ff.collection.mockReturnValue({ _ref: 'coll' });
    ff.doc.mockReturnValue({ _ref: 'doc' });
    ff.query.mockReturnValue({ _ref: 'query' });
    ff.where.mockReturnValue({ _ref: 'where' });
    ff.orderBy.mockReturnValue({ _ref: 'orderBy' });
    ff.limit.mockReturnValue({ _ref: 'limit' });

    // getDocs call order inside writeDepartmentSnapshot:
    //   1. products collection  → one product with primarySupplierId/primarySupplierName
    //   2. areas collection     → one area (no startedAt → cycleStart stays null,
    //                             so invoice/sales/PO blocks are all skipped)
    //   3. items in area-1      → one item linked to prod-abc
    //   4. all departments      → just the current dept (no extra snapshot getDocs)
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([{
        id: 'prod-abc',
        dataObj: {
          name: 'Test Beer',
          active: true,
          mergedInto: null,
          primarySupplierId: 'sup-xyz',
          primarySupplierName: 'Acme Beverages',
        },
      }]))
      .mockResolvedValueOnce(fakeQSnap([{
        id: 'area-1',
        dataObj: { name: 'Main Bar' },  // no startedAt/completedAt
      }]))
      .mockResolvedValueOnce(fakeQSnap([{
        id: 'item-1',
        dataObj: { name: 'Test Beer', productId: 'prod-abc', lastCount: 5 },
      }]))
      .mockResolvedValueOnce(fakeQSnap([{
        id: 'd1',
        dataObj: { name: 'Bar Dept' },
      }]));

    // getDoc call order:
    //   1. department document
    //   2. previous cycle snapshot (cycle-0) — doesn't exist
    //   3. existing snapshot doc (oldChunkCount) — first write, doesn't exist
    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Bar Dept' }) })
      .mockResolvedValueOnce({ exists: () => false, data: () => null })
      .mockResolvedValueOnce({ exists: () => false, data: () => null });

    ff.setDoc.mockResolvedValue(undefined);
    mockBatch.set.mockReset();
    mockBatch.delete.mockReset();
    mockBatch.commit.mockReset().mockResolvedValue(undefined);
    ff.writeBatch.mockReturnValue(mockBatch);
  });

  it('stamps supplierId/supplierName from product doc primarySupplierId/primarySupplierName', async () => {
    await writeDepartmentSnapshot('v1', 'd1', 1);

    // Dept snapshot is written via writeBatch; latestSnapshot uses setDoc
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    expect(ff.setDoc).toHaveBeenCalledTimes(1); // latestSnapshot only

    // batch.set call 0 = snapshot doc
    const [, snapshotData] = mockBatch.set.mock.calls[0];
    expect(snapshotData.items).toHaveLength(1);
    expect(snapshotData.items[0].supplierId).toBe('sup-xyz');
    expect(snapshotData.items[0].supplierName).toBe('Acme Beverages');
    expect(snapshotData.itemCount).toBe(1);
    expect(snapshotData.itemChunkCount).toBe(1);
  });
});

// ── Suite 9: writer chunking ──────────────────────────────────────────────────

describe('writeDepartmentSnapshot — item chunking', () => {
  const ff = jest.requireMock('firebase/firestore') as {
    getDocs: jest.Mock;
    getDoc: jest.Mock;
    setDoc: jest.Mock;
    writeBatch: jest.Mock;
    collection: jest.Mock;
    doc: jest.Mock;
    query: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
  };

  function fakeQSnap(docs: Array<{ id: string; dataObj: Record<string, any> }>) {
    const fakeDocs = docs.map(({ id, dataObj }) => ({ id, data: () => dataObj }));
    return {
      docs: fakeDocs,
      empty: fakeDocs.length === 0,
      size: fakeDocs.length,
      forEach: (fn: (d: any) => void) => fakeDocs.forEach(fn),
    };
  }

  function makeAreaItems(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `item-${i}`,
      dataObj: { name: `Product ${i}`, lastCount: 1, productId: `prod-${i}` },
    }));
  }

  function setupMocks(itemCount: number, oldChunkCount = 0) {
    jest.clearAllMocks();
    ff.collection.mockReturnValue({ _ref: 'coll' });
    ff.doc.mockReturnValue({ _ref: 'doc' });
    ff.query.mockReturnValue({ _ref: 'query' });
    ff.where.mockReturnValue({ _ref: 'where' });
    ff.orderBy.mockReturnValue({ _ref: 'orderBy' });
    ff.limit.mockReturnValue({ _ref: 'limit' });

    // getDocs: products, areas, items (in area), all-departments
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([]))                  // products
      .mockResolvedValueOnce(fakeQSnap([{ id: 'area-1', dataObj: { name: 'Main' } }]))
      .mockResolvedValueOnce(fakeQSnap(makeAreaItems(itemCount)))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'd1', dataObj: { name: 'Dept' } }]));

    // getDoc: dept doc, prev snapshot (missing), existing snapshot (oldChunkCount)
    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Dept' }) })
      .mockResolvedValueOnce({ exists: () => false, data: () => null })
      .mockResolvedValueOnce({
        exists: () => oldChunkCount > 0,
        data: () => oldChunkCount > 0 ? { itemChunkCount: oldChunkCount } : null,
      });

    ff.setDoc.mockResolvedValue(undefined);
    mockBatch.set.mockReset();
    mockBatch.delete.mockReset();
    mockBatch.commit.mockReset().mockResolvedValue(undefined);
    ff.writeBatch.mockReturnValue(mockBatch);
  }

  it('570 items: doc.items keeps 200, itemCount=570, itemChunkCount=3, 3 chunk writes', async () => {
    setupMocks(570);
    await writeDepartmentSnapshot('v1', 'd1', 1);

    // batch.set call 0 = snapshot doc
    const [, snapData] = mockBatch.set.mock.calls[0];
    expect(snapData.items).toHaveLength(200);      // legacy field capped at 200
    expect(snapData.itemCount).toBe(570);
    expect(snapData.itemChunkCount).toBe(3);

    // batch.set calls 1-3 = chunk docs (index 0, 1, 2)
    expect(mockBatch.set.mock.calls).toHaveLength(4); // 1 snap + 3 chunks
    const chunk0 = mockBatch.set.mock.calls[1][1];
    const chunk1 = mockBatch.set.mock.calls[2][1];
    const chunk2 = mockBatch.set.mock.calls[3][1];
    expect(chunk0.index).toBe(0);
    expect(chunk0.items).toHaveLength(200);
    expect(chunk1.index).toBe(1);
    expect(chunk1.items).toHaveLength(200);
    expect(chunk2.index).toBe(2);
    expect(chunk2.items).toHaveLength(170);
  });

  it('stale chunk cleanup: old 4 chunks reduced to 3 → deletes chunk doc "003"', async () => {
    // Use cycleNumber=1 so the fallback getDocs path (cycleNumber > 1) is not triggered,
    // keeping the getDocs mock call count predictable.
    setupMocks(570, 4); // oldChunkCount=4
    await writeDepartmentSnapshot('v1', 'd1', 1);

    // batch.delete should be called once for chunk index 3
    expect(mockBatch.delete.mock.calls).toHaveLength(1);
  });

  it('≤200 items: no chunks written beyond snapshot doc', async () => {
    setupMocks(50);
    await writeDepartmentSnapshot('v1', 'd1', 1);

    const [, snapData] = mockBatch.set.mock.calls[0];
    expect(snapData.items).toHaveLength(50);
    expect(snapData.itemCount).toBe(50);
    expect(snapData.itemChunkCount).toBe(1); // one chunk even for ≤200 items
    expect(mockBatch.set.mock.calls).toHaveLength(2); // snap doc + 1 chunk
  });
});

// ── Suite 8: baseline fallback + no-baseline variance ─────────────────────────

describe('computeSnapshotItemFigures — baseline fallback and no-baseline variance', () => {
  it('baseline fallback: baselineCycleNumber param sets confidenceReason to "Baseline from cycle {m}"', () => {
    const item = makeItem({ name: 'Rum 1L', lastCount: 8 });
    const prev = prevMap({ 'rum 1l': 5 }); // fallback from cycle 3 (not cycle 4)

    const { snapshotItems } = computeSnapshotItemFigures(
      [item], prev, 5, [], [],
      undefined, undefined,
      3, // baselineCycleNumber — cycle-4 was missing, using cycle-3
    );

    const si = snapshotItems[0];
    expect(si.openingCount).toBe(5);
    expect(si.totalVarianceQty).toBe(3); // 8 − 5
    expect(si.confidenceReason).toBe('Baseline from cycle 3');
  });

  it('no-baseline items have totalVarianceQty = 0 regardless of actualClosing', () => {
    // New product in cycle 4: not in prevMap → openingCount null
    const item = makeItem({ name: 'New Gin', lastCount: 12, costPrice: 30 });

    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 4, [], []);

    const si = snapshotItems[0];
    expect(si.openingCount).toBeNull();
    expect(si.isNewProduct).toBe(true);
    expect(si.totalVarianceQty).toBe(0);
    expect(si.totalVarianceDollars).toBe(0);
    expect(si.unexplainedVarianceQty).toBe(0);
  });
});

// ── Suite: product-level aggregation (spec item-6 writer tests) ───────────────
//
// computeSnapshotItemFigures now receives PRE-AGGREGATED items (one per product,
// lastCount = sum across areas, _areas attached).  These tests verify the
// writer-level contract: productId-keyed prevItemMap, areas/varianceReliable on
// output, and correct variance when stock moves between areas.

describe('computeSnapshotItemFigures — productId-keyed prevItemMap + areas output', () => {
  // Simulate what the writer sends after aggregating 3 area rows for one product.
  function makeAggregatedItem(overrides: Record<string, any> = {}) {
    return {
      _id: 'prod-ac',
      productId: 'prod-ac',
      name: 'André Clouet',
      lastCount: 10,          // sum: 3 + 5 + 2
      costPrice: 20,
      parLevel: 6,
      _areaId: null,          // null for multi-area
      _areaName: 'Bar, Cellar, Fridge',
      _areas: [
        { areaId: 'a1', areaName: 'Bar',    actualClosing: 3 },
        { areaId: 'a2', areaName: 'Cellar', actualClosing: 5 },
        { areaId: 'a3', areaName: 'Fridge', actualClosing: 2 },
      ],
      ...overrides,
    };
  }

  // Spec test 1: product in 3 areas → one item, actual = sum, opening = prev total, correct variance
  it('spec test 1: productId-keyed prevItemMap gives correct opening and variance', () => {
    const item = makeAggregatedItem();
    // prevItemMap keyed by productId (as writer now builds it)
    const prev = prevMap({ 'prod-ac': 8 });
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, [], []);
    const si = snapshotItems[0];
    expect(si.actualClosing).toBe(10);   // sum of areas
    expect(si.openingCount).toBe(8);     // from productId-keyed map
    expect(si.totalVarianceQty).toBe(2); // 10 − 8
    expect(si.varianceReliable).toBe(true);
  });

  it('spec test 1: areas[] breakdown preserved from _areas on rawItem', () => {
    const item = makeAggregatedItem();
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 2, [], []);
    expect(snapshotItems[0].areas).toHaveLength(3);
    expect(snapshotItems[0].areas[0]).toMatchObject({ areaId: 'a1', areaName: 'Bar', actualClosing: 3 });
  });

  it('spec test 1: varianceReliable: true for product items from writer', () => {
    const item = makeAggregatedItem();
    const { snapshotItems } = computeSnapshotItemFigures([item], new Map(), 2, [], []);
    expect(snapshotItems[0].varianceReliable).toBe(true);
  });

  // Spec test 2: stock moved between areas — same total → zero variance
  it('spec test 2: stock moved between areas gives zero variance when totals equal', () => {
    // Previous cycle: product had 10 across areas. This cycle: same 10, different distribution.
    const item = makeAggregatedItem({ lastCount: 10 }); // sum still 10
    const prev = prevMap({ 'prod-ac': 10 });
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, [], []);
    expect(snapshotItems[0].totalVarianceQty).toBe(0);
    expect(snapshotItems[0].unexplainedVarianceQty).toBe(0);
  });

  // Spec test 5: parLevel from product doc
  it('spec test 5: parLevel passed through from aggregated item', () => {
    const item = makeAggregatedItem({ parLevel: 12 });
    const prev = prevMap({ 'prod-ac': 8 });
    const { snapshotItems } = computeSnapshotItemFigures([item], prev, 2, [], []);
    expect(snapshotItems[0].parLevel).toBe(12);
    expect(snapshotItems[0].belowPAR).toBe(true); // actualClosing 10 < parLevel 12
  });

  it('no _areas on item: areas null, varianceReliable undefined (backward compat)', () => {
    const plain = makeItem({ name: 'Vodka' });
    const { snapshotItems } = computeSnapshotItemFigures([plain], new Map(), 2, [], []);
    expect(snapshotItems[0].areas).toBeNull();
    expect(snapshotItems[0].varianceReliable).toBeUndefined();
  });
});

// ── Suite: writeDepartmentSnapshot — resolved productId grouping (Item 1) ─────

describe('writeDepartmentSnapshot — resolved productId grouping', () => {
  const ff = jest.requireMock('firebase/firestore') as {
    getDocs: jest.Mock;
    getDoc: jest.Mock;
    setDoc: jest.Mock;
    writeBatch: jest.Mock;
    collection: jest.Mock;
    doc: jest.Mock;
    query: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
  };

  function fakeQSnap(docs: Array<{ id: string; dataObj: Record<string, any> }>) {
    const fakeDocs = docs.map(({ id, dataObj }) => ({ id, data: () => dataObj }));
    return {
      docs: fakeDocs,
      empty: fakeDocs.length === 0,
      size: fakeDocs.length,
      forEach: (fn: (d: any) => void) => fakeDocs.forEach(fn),
    };
  }

  function setupCommonMocks() {
    ff.collection.mockReturnValue({ _ref: 'coll' });
    ff.doc.mockReturnValue({ _ref: 'doc' });
    ff.query.mockReturnValue({ _ref: 'query' });
    ff.where.mockReturnValue({ _ref: 'where' });
    ff.orderBy.mockReturnValue({ _ref: 'orderBy' });
    ff.limit.mockReturnValue({ _ref: 'limit' });
    ff.setDoc.mockResolvedValue(undefined);
    mockBatch.set.mockReset();
    mockBatch.delete.mockReset();
    mockBatch.commit.mockReset().mockResolvedValue(undefined);
    ff.writeBatch.mockReturnValue(mockBatch);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
  });

  it('two area rows with different raw productIds that resolve to same product → one snapshot item', async () => {
    // prod-old mergedInto prod-new; the writer should group them under prod-new
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'prod-new', dataObj: { name: 'Wine', active: true, mergedInto: null, parLevel: 6 } },
        { id: 'prod-old', dataObj: { name: 'Wine Old', active: false, mergedInto: 'prod-new' } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'area-1', dataObj: { name: 'Bar' } },
        { id: 'area-2', dataObj: { name: 'Cellar' } },
      ]))
      // items in area-1 (prod-new)
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i1', dataObj: { name: 'Wine', productId: 'prod-new', lastCount: 4 } },
      ]))
      // items in area-2 (prod-old — same product, different raw id)
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i2', dataObj: { name: 'Wine Old', productId: 'prod-old', lastCount: 6 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'd1', dataObj: { name: 'Bar Dept' } }]));

    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Bar Dept' }) })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    await writeDepartmentSnapshot('v1', 'd1', 1);

    const [, snapshotData] = mockBatch.set.mock.calls[0];
    expect(snapshotData.items).toHaveLength(1);
    expect(snapshotData.items[0].actualClosing).toBe(10); // 4 + 6
  });

  it('row without productId groups with a same-named row via two-pass nameToProductId', async () => {
    // Two area rows: one has live productId 'prod-beer', one has no productId but same name.
    // Pass 1 records name→'prod-beer'; pass 2 keys the no-productId row to 'prod-beer' too.
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'prod-beer', dataObj: { name: 'Beer', active: true, mergedInto: null } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'area-1', dataObj: { name: 'Bar' } },
        { id: 'area-2', dataObj: { name: 'Fridge' } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i1', dataObj: { name: 'Beer', productId: 'prod-beer', lastCount: 3 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i2', dataObj: { name: 'Beer', lastCount: 5 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'd1', dataObj: { name: 'Bar Dept' } }]));

    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Bar Dept' }) })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    await writeDepartmentSnapshot('v1', 'd1', 1);

    const [, snapshotData] = mockBatch.set.mock.calls[0];
    expect(snapshotData.items).toHaveLength(1);
    expect(snapshotData.items[0].actualClosing).toBe(8); // 3 + 5
    expect(snapshotData.items[0].productId).toBe('prod-beer');
  });

  it('ambiguous name: 2 distinct survivors + 1 unlinked row → 3 items; unlinked has varianceReliable false', async () => {
    // prod-champ-a and prod-champ-b are distinct live survivors with the same name 'Champagne'.
    // Because two survivors share the name, the name is ambiguous and nameToProductId does NOT
    // include 'champagne'. The unlinked row (no productId) cannot be attributed and gets
    // its own group with varianceReliable: false and ambiguousName: true.
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'prod-champ-a', dataObj: { name: 'Champagne', active: true, mergedInto: null } },
        { id: 'prod-champ-b', dataObj: { name: 'Champagne', active: true, mergedInto: null } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'area-1', dataObj: { name: 'Bar' } },
        { id: 'area-2', dataObj: { name: 'Cellar' } },
        { id: 'area-3', dataObj: { name: 'Storage' } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i1', dataObj: { name: 'Champagne', productId: 'prod-champ-a', lastCount: 3 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i2', dataObj: { name: 'Champagne', productId: 'prod-champ-b', lastCount: 5 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i3', dataObj: { name: 'Champagne', lastCount: 2 } }, // no productId
      ]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'd1', dataObj: { name: 'Bar Dept' } }]));

    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Bar Dept' }) })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    await writeDepartmentSnapshot('v1', 'd1', 1);

    const [, snapshotData] = mockBatch.set.mock.calls[0];
    expect(snapshotData.items).toHaveLength(3);

    const itemA = snapshotData.items.find((i: any) => i.productId === 'prod-champ-a');
    const itemB = snapshotData.items.find((i: any) => i.productId === 'prod-champ-b');
    const itemUnlinked = snapshotData.items.find((i: any) => i.productId == null);

    expect(itemA).toBeDefined();
    expect(itemA.actualClosing).toBe(3);
    expect(itemA.varianceReliable).toBe(true);

    expect(itemB).toBeDefined();
    expect(itemB.actualClosing).toBe(5);
    expect(itemB.varianceReliable).toBe(true);

    expect(itemUnlinked).toBeDefined();
    expect(itemUnlinked.actualClosing).toBe(2);
    expect(itemUnlinked.varianceReliable).toBe(false);
    expect(itemUnlinked.ambiguousName).toBe(true);
  });

  it('André Clouet: 4 rows (1 live productId + 3 stale area-row ids), same name → 1 item', async () => {
    // Spec test for the two-pass aggregation:
    // Back Bar row has live productId 'eK07Fw'; Kitchen/Fridge/Fruit rows have stale ids.
    // Pass 1: records 'andré clouet' → 'eK07Fw'.
    // Pass 2: stale rows look up nameToProductId['andré clouet'] = 'eK07Fw' → all group together.
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'eK07Fw', dataObj: { name: 'André Clouet', active: true, mergedInto: null } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'back-bar',    dataObj: { name: 'Back Bar' } },
        { id: 'kitchen',     dataObj: { name: 'Kitchen' } },
        { id: 'fridge',      dataObj: { name: 'Fridge' } },
        { id: 'fruit-fridge', dataObj: { name: 'Fruit fridge' } },
      ]))
      // items in each area — stale ids are not in the products collection
      .mockResolvedValueOnce(fakeQSnap([{ id: 'eK07Fw',  dataObj: { name: 'André Clouet', productId: 'eK07Fw', lastCount: 3 } }]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'stale-1', dataObj: { name: 'André Clouet', productId: 'stale-1', lastCount: 2 } }]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'stale-2', dataObj: { name: 'André Clouet', productId: 'stale-2', lastCount: 4 } }]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'stale-3', dataObj: { name: 'André Clouet', productId: 'stale-3', lastCount: 1 } }]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'd1', dataObj: { name: 'Bar Dept' } }]));

    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Bar Dept' }) })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    await writeDepartmentSnapshot('v1', 'd1', 1);

    const [, snapshotData] = mockBatch.set.mock.calls[0];
    expect(snapshotData.items).toHaveLength(1);
    expect(snapshotData.items[0].actualClosing).toBe(10); // 3+2+4+1
    expect(snapshotData.items[0].productId).toBe('eK07Fw');
    expect(snapshotData.items[0].areas).toHaveLength(4);
  });
});

// ── Suite: writeDepartmentSnapshot — PAR from product doc (Item 2) ────────────

describe('writeDepartmentSnapshot — PAR from product doc', () => {
  const ff = jest.requireMock('firebase/firestore') as {
    getDocs: jest.Mock;
    getDoc: jest.Mock;
    setDoc: jest.Mock;
    writeBatch: jest.Mock;
    collection: jest.Mock;
    doc: jest.Mock;
    query: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
  };

  function fakeQSnap(docs: Array<{ id: string; dataObj: Record<string, any> }>) {
    const fakeDocs = docs.map(({ id, dataObj }) => ({ id, data: () => dataObj }));
    return {
      docs: fakeDocs,
      empty: fakeDocs.length === 0,
      size: fakeDocs.length,
      forEach: (fn: (d: any) => void) => fakeDocs.forEach(fn),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    ff.collection.mockReturnValue({ _ref: 'coll' });
    ff.doc.mockReturnValue({ _ref: 'doc' });
    ff.query.mockReturnValue({ _ref: 'query' });
    ff.where.mockReturnValue({ _ref: 'where' });
    ff.orderBy.mockReturnValue({ _ref: 'orderBy' });
    ff.limit.mockReturnValue({ _ref: 'limit' });
    ff.setDoc.mockResolvedValue(undefined);
    mockBatch.set.mockReset();
    mockBatch.delete.mockReset();
    mockBatch.commit.mockReset().mockResolvedValue(undefined);
    ff.writeBatch.mockReturnValue(mockBatch);
  });

  it('parLevel from product doc overrides area-row parLevel', async () => {
    // Product doc has parLevel: 15; area row has parLevel: 5 (stale)
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'prod-gin', dataObj: { name: 'Gin', active: true, mergedInto: null, parLevel: 15 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'area-1', dataObj: { name: 'Bar' } }]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i1', dataObj: { name: 'Gin', productId: 'prod-gin', lastCount: 8, parLevel: 5 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'd1', dataObj: { name: 'Bar Dept' } }]));

    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Bar Dept' }) })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    await writeDepartmentSnapshot('v1', 'd1', 1);

    const [, snapshotData] = mockBatch.set.mock.calls[0];
    expect(snapshotData.items[0].parLevel).toBe(15); // product doc wins
    expect(snapshotData.items[0].belowPAR).toBe(true); // 8 < 15
  });

  it('falls back to area-row parLevel when product doc has none', async () => {
    ff.getDocs
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'prod-wine', dataObj: { name: 'Wine', active: true, mergedInto: null } }, // no parLevel
      ]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'area-1', dataObj: { name: 'Bar' } }]))
      .mockResolvedValueOnce(fakeQSnap([
        { id: 'i1', dataObj: { name: 'Wine', productId: 'prod-wine', lastCount: 10, parLevel: 8 } },
      ]))
      .mockResolvedValueOnce(fakeQSnap([{ id: 'd1', dataObj: { name: 'Bar Dept' } }]));

    ff.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ name: 'Bar Dept' }) })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });

    await writeDepartmentSnapshot('v1', 'd1', 1);

    const [, snapshotData] = mockBatch.set.mock.calls[0];
    expect(snapshotData.items[0].parLevel).toBe(8); // fallback to area row
  });
});
