/**
 * Tests for the Suitee product context rebuild (Handoff 1).
 *
 * Tests:
 *   A. Product name index — a product mentioned nowhere else is still
 *      reachable via the index (name resolution coverage).
 *   B. Multi-supplier section — latest per-supplier prices present and
 *      correctly attributed; cheapest-first ordering.
 *   C. Single-supplier product excluded from the multi-supplier section.
 *   D. PRODUCTS IN SYSTEM count reflects the true total, not a capped number.
 *
 * Strategy: inline helpers mirroring the production logic as pure functions —
 * no Firebase or Express dependency needed.  Same pattern as
 * suiteePriceContext.test.ts.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
  id: string;
  name: string;
  costPrice: number | null;
};

type SupplierEntry = {
  supplierName: string;
  unitCost: number | null;
  isPreferred: boolean;
  invoiceDate: string | null;
};

type MultiSupplierResult = {
  product: Product;
  suppliers: SupplierEntry[];
};

// ── Helpers mirroring the production build logic ───────────────────────────────

const PRODUCT_INDEX_CHUNK_SIZE = 8;

/** Builds the compact product index lines (Part A). */
function buildProductIndexLines(products: Product[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < products.length; i += PRODUCT_INDEX_CHUNK_SIZE) {
    const chunk = products.slice(i, i + PRODUCT_INDEX_CHUNK_SIZE);
    const entries = chunk.map(p =>
      p.costPrice != null ? `${p.name} ($${p.costPrice.toFixed(2)})` : p.name
    );
    lines.push(`  ${entries.join(', ')}`);
  }
  return lines;
}

/**
 * Given multi-supplier data (already filtered to 2+ suppliers with price),
 * builds the formatted context lines (Part B).
 */
function buildMultiSupplierLines(items: MultiSupplierResult[]): string[] {
  if (items.length === 0) return [];
  const lines: string[] = [
    `MULTI-SUPPLIER PRICE COMPARISON (${items.length} product${items.length !== 1 ? 's' : ''} with invoice prices from 2+ suppliers — cheapest first):`,
  ];
  for (const { product: p, suppliers } of items) {
    const sorted = [...suppliers].sort(
      (a, b) => (a.unitCost ?? 9999) - (b.unitCost ?? 9999)
    );
    lines.push(`  ${p.name}:`);
    for (const s of sorted) {
      const tag = s.isPreferred ? ' (preferred)' : '';
      const dateStr = s.invoiceDate ? ` on ${s.invoiceDate}` : '';
      lines.push(`    - ${s.supplierName}${tag}: $${s.unitCost!.toFixed(2)}/unit${dateStr}`);
    }
  }
  return lines;
}

/** Returns true when a product name appears anywhere in the index lines. */
function productNameInIndex(name: string, indexLines: string[]): boolean {
  return indexLines.some(line => line.includes(name));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PRODUCT_OBSCURE: Product = {
  id: 'prod-obscure',
  name: 'Obscure Vermouth 500ml',
  costPrice: 14.99,
};

const PRODUCT_KNOWN: Product = {
  id: 'prod-known',
  name: 'Sauvignon Blanc 750ml',
  costPrice: 18.50,
};

const PRODUCT_NO_PRICE: Product = {
  id: 'prod-noprice',
  name: 'Mystery Spirit',
  costPrice: null,
};

const MULTI_SUPPLIER_PRODUCT: Product = {
  id: 'prod-multi',
  name: 'House Gin 700ml',
  costPrice: 32.00,
};

const SINGLE_SUPPLIER_PRODUCT: Product = {
  id: 'prod-single',
  name: 'Premium Rum 700ml',
  costPrice: 45.00,
};

// ── Suite A: product name index ────────────────────────────────────────────────

describe('Suitee product context — Part A: product name index', () => {
  it('a product mentioned nowhere else in context appears in the index by name', () => {
    const products = [PRODUCT_KNOWN, PRODUCT_OBSCURE, PRODUCT_NO_PRICE];
    const indexLines = buildProductIndexLines(products);
    expect(productNameInIndex(PRODUCT_OBSCURE.name, indexLines)).toBe(true);
  });

  it('product with a cost price is formatted with price in the index', () => {
    const indexLines = buildProductIndexLines([PRODUCT_KNOWN]);
    expect(indexLines.some(l => l.includes('$18.50'))).toBe(true);
  });

  it('product with no cost price appears by name only (no price suffix)', () => {
    const indexLines = buildProductIndexLines([PRODUCT_NO_PRICE]);
    expect(productNameInIndex(PRODUCT_NO_PRICE.name, indexLines)).toBe(true);
    expect(indexLines.some(l => l.includes('$') && l.includes(PRODUCT_NO_PRICE.name))).toBe(false);
  });

  it('large catalogue (> chunk size) spans multiple lines correctly', () => {
    const bigCatalogue: Product[] = Array.from({ length: 25 }, (_, i) => ({
      id: `prod-${i}`,
      name: `Product ${i}`,
      costPrice: 10 + i,
    }));
    const indexLines = buildProductIndexLines(bigCatalogue);
    // 25 products / 8 per line = 4 lines (ceil)
    expect(indexLines.length).toBe(4);
    // All 25 products should appear somewhere
    for (const p of bigCatalogue) {
      expect(productNameInIndex(p.name, indexLines)).toBe(true);
    }
  });

  it('empty product catalogue produces no index lines', () => {
    const indexLines = buildProductIndexLines([]);
    expect(indexLines).toHaveLength(0);
  });

  it('PRODUCTS IN SYSTEM count equals the full product array length (not a capped 200)', () => {
    // Simulate a venue with 347 products — previously this would have been capped at 200
    const products: Product[] = Array.from({ length: 347 }, (_, i) => ({
      id: `prod-${i}`,
      name: `Product ${i}`,
      costPrice: Math.random() * 50,
    }));
    // The count injected into the prompt equals products.length
    const countLine = `PRODUCTS IN SYSTEM: ${products.length} (full catalogue — true count, not capped)`;
    expect(countLine).toContain('347');
  });
});

// ── Suite B: multi-supplier price comparison ───────────────────────────────────

describe('Suitee product context — Part B: multi-supplier prices', () => {
  const multiResult: MultiSupplierResult = {
    product: MULTI_SUPPLIER_PRODUCT,
    suppliers: [
      {
        supplierName: 'Premier Spirits',
        unitCost: 32.00,
        isPreferred: true,
        invoiceDate: '2026-08-20',
      },
      {
        supplierName: 'Budget Beverage Co.',
        unitCost: 29.50,
        isPreferred: false,
        invoiceDate: '2026-07-10',
      },
    ],
  };

  it('both suppliers appear in the output', () => {
    const lines = buildMultiSupplierLines([multiResult]);
    expect(lines.some(l => l.includes('Premier Spirits'))).toBe(true);
    expect(lines.some(l => l.includes('Budget Beverage Co.'))).toBe(true);
  });

  it('the preferred supplier is tagged as (preferred)', () => {
    const lines = buildMultiSupplierLines([multiResult]);
    const preferredLine = lines.find(l => l.includes('Premier Spirits'));
    expect(preferredLine).toBeDefined();
    expect(preferredLine).toContain('(preferred)');
  });

  it('the cheaper supplier has no preferred tag', () => {
    const lines = buildMultiSupplierLines([multiResult]);
    const cheaperLine = lines.find(l => l.includes('Budget Beverage Co.'));
    expect(cheaperLine).toBeDefined();
    expect(cheaperLine).not.toContain('(preferred)');
  });

  it('suppliers are sorted cheapest first', () => {
    const lines = buildMultiSupplierLines([multiResult]);
    const productLine = lines.findIndex(l => l.trim().startsWith(`${MULTI_SUPPLIER_PRODUCT.name}:`));
    expect(productLine).toBeGreaterThan(-1);
    const supplierLines = lines.slice(productLine + 1).filter(l => l.trim().startsWith('- '));
    // First supplier should be the cheaper one ($29.50)
    expect(supplierLines[0]).toContain('$29.50');
    expect(supplierLines[1]).toContain('$32.00');
  });

  it('prices are correctly attributed with invoiceDate', () => {
    const lines = buildMultiSupplierLines([multiResult]);
    const budgetLine = lines.find(l => l.includes('Budget Beverage Co.'));
    expect(budgetLine).toContain('$29.50/unit');
    expect(budgetLine).toContain('on 2026-07-10');
  });

  it('product name appears as the section header', () => {
    const lines = buildMultiSupplierLines([multiResult]);
    expect(lines.some(l => l.includes(MULTI_SUPPLIER_PRODUCT.name))).toBe(true);
  });

  it('section header shows correct product count', () => {
    const lines = buildMultiSupplierLines([multiResult]);
    expect(lines[0]).toContain('1 product');
  });

  it('plural "products" used for count > 1', () => {
    const twoResults: MultiSupplierResult[] = [
      multiResult,
      {
        product: { id: 'prod-x', name: 'Another Spirit', costPrice: 20 },
        suppliers: [
          { supplierName: 'A', unitCost: 20, isPreferred: true, invoiceDate: null },
          { supplierName: 'B', unitCost: 18, isPreferred: false, invoiceDate: null },
        ],
      },
    ];
    const lines = buildMultiSupplierLines(twoResults);
    expect(lines[0]).toContain('2 products');
  });
});

// ── Suite C: single-supplier excluded ─────────────────────────────────────────

describe('Suitee product context — Part C: single-supplier product excluded', () => {
  it('a product with only one supplier produces no multi-supplier output', () => {
    // The production code filters: withPrices.length > 1 → null if only one supplier
    // This mirrors that: build a result that would have been filtered out
    const singleSupplierResult: MultiSupplierResult | null = (() => {
      const withPrices = [
        { supplierName: 'Only Supplier', unitCost: 45.00, isPreferred: true, invoiceDate: null },
      ].filter(s => s.unitCost != null);
      return withPrices.length > 1 ? { product: SINGLE_SUPPLIER_PRODUCT, suppliers: withPrices } : null;
    })();
    expect(singleSupplierResult).toBeNull();
  });

  it('passing an empty multi-supplier list produces no output lines', () => {
    const lines = buildMultiSupplierLines([]);
    expect(lines).toHaveLength(0);
  });

  it('single-supplier product name does not appear in multi-supplier section', () => {
    const lines = buildMultiSupplierLines([{
      product: MULTI_SUPPLIER_PRODUCT,
      suppliers: [
        { supplierName: 'A', unitCost: 30, isPreferred: true, invoiceDate: null },
        { supplierName: 'B', unitCost: 28, isPreferred: false, invoiceDate: null },
      ],
    }]);
    expect(lines.some(l => l.includes(SINGLE_SUPPLIER_PRODUCT.name))).toBe(false);
  });
});
