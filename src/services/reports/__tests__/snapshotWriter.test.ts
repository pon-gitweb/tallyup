import { computeSnapshotItemFigures } from '../snapshotWriter';

// snapshotWriter.ts imports firebase SDK at module level; mock it so tests
// run without an initialised Firebase app.
jest.mock('../../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({}));
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
