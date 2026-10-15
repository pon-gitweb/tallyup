// Tests for quantityConfidence propagation through buildProductMaps + resolveProduct.
//
// Covered scenarios (P3d-2 spec):
//   (a) physical_count  — no marker: row's quantityConfidence === 'physical_count'
//   (b) estimated_with_sales — marker: quantityConfidence !== 'physical_count'
//   (c) estimated_no_sales   — marker: quantityConfidence !== 'physical_count'
//   (d) field absent         — marker: quantityConfidence is undefined, !== 'physical_count'
//   (e) merged chain         — survivor's quantityConfidence wins over the defunct's;
//                              the chain-walk returns the survivor's full entry intact

import { buildProductMaps, resolveProduct, resolveProductChain, type ProdEntry } from '../resolveProduct';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal QuerySnapshot-like object usable by buildProductMaps. */
function makeSnap(docs: Array<{ id: string; data: Record<string, any> }>) {
  return {
    forEach: (fn: (d: any) => void) =>
      docs.forEach(d => fn({ id: d.id, data: () => d.data })),
  } as any;
}

function makeProduct(id: string, data: Record<string, any>) {
  return { id, data };
}

// ── (a/b/c/d): buildProductMaps correctly populates quantityConfidence ─────────

describe('buildProductMaps — quantityConfidence field', () => {
  it('(a) captures physical_count — row would show no marker', () => {
    const snap = makeSnap([
      makeProduct('prod-1', { name: 'Beer', category: 'Drinks', costPrice: 10, active: true, quantityConfidence: 'physical_count' }),
    ]);
    const { prodById } = buildProductMaps(snap);
    expect(prodById['prod-1'].quantityConfidence).toBe('physical_count');
    // Display rule: marker iff !== 'physical_count'
    expect(prodById['prod-1'].quantityConfidence !== 'physical_count').toBe(false);
  });

  it('(b) captures estimated_with_sales — row would show ~ marker', () => {
    const snap = makeSnap([
      makeProduct('prod-1', { name: 'Beer', category: 'Drinks', costPrice: 10, active: true, quantityConfidence: 'estimated_with_sales' }),
    ]);
    const { prodById } = buildProductMaps(snap);
    expect(prodById['prod-1'].quantityConfidence).toBe('estimated_with_sales');
    expect(prodById['prod-1'].quantityConfidence !== 'physical_count').toBe(true);
  });

  it('(c) captures estimated_no_sales — row would show ~ marker', () => {
    const snap = makeSnap([
      makeProduct('prod-1', { name: 'Beer', category: 'Drinks', costPrice: 10, active: true, quantityConfidence: 'estimated_no_sales' }),
    ]);
    const { prodById } = buildProductMaps(snap);
    expect(prodById['prod-1'].quantityConfidence).toBe('estimated_no_sales');
    expect(prodById['prod-1'].quantityConfidence !== 'physical_count').toBe(true);
  });

  it('(d) absent field → undefined — row would show ~ marker (no-information = estimated)', () => {
    const snap = makeSnap([
      makeProduct('prod-1', { name: 'Beer', category: 'Drinks', costPrice: 10, active: true /* no quantityConfidence */ }),
    ]);
    const { prodById } = buildProductMaps(snap);
    expect(prodById['prod-1'].quantityConfidence).toBeUndefined();
    // undefined !== 'physical_count' is true → marker shown
    expect(prodById['prod-1'].quantityConfidence !== 'physical_count').toBe(true);
  });

  it('also stores quantityConfidence in prodByName for name-key fallback lookups', () => {
    const snap = makeSnap([
      makeProduct('prod-1', { name: 'Wine', category: 'Drinks', costPrice: 15, active: true, quantityConfidence: 'estimated_with_sales' }),
    ]);
    const { prodByName } = buildProductMaps(snap);
    expect(prodByName['wine'].quantityConfidence).toBe('estimated_with_sales');
  });
});

// ── (e): merged chain — survivor's quantityConfidence wins ────────────────────

describe('resolveProduct — quantityConfidence via merge-chain', () => {
  it("(e) returns the survivor's quantityConfidence, not the defunct's", () => {
    // Defunct product has estimated_with_sales; survivor has physical_count.
    // resolveProduct should walk to the survivor and return its entry.
    const snap = makeSnap([
      makeProduct('prod-defunct', {
        name: 'Old Beer', category: 'Drinks', active: false,
        mergedInto: 'prod-survivor',
        quantityConfidence: 'estimated_with_sales',
      }),
      makeProduct('prod-survivor', {
        name: 'Beer', category: 'Drinks', costPrice: 10, active: true,
        quantityConfidence: 'physical_count',
      }),
    ]);
    const { prodById } = buildProductMaps(snap);
    const result = resolveProduct('prod-defunct', prodById);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('prod-survivor');
    // Survivor's entry is returned intact — including its quantityConfidence.
    expect(result!.entry.quantityConfidence).toBe('physical_count');
    // Display rule: no marker because survivor confirmed by physical count.
    expect(result!.entry.quantityConfidence !== 'physical_count').toBe(false);
  });

  it("survivor with absent quantityConfidence → marker shown even when defunct had physical_count", () => {
    // Defunct was physical_count; survivor never had a cycle-reset yet (undefined).
    // We must use the survivor's data, not the defunct's — so the marker should show.
    const snap = makeSnap([
      makeProduct('prod-defunct', {
        name: 'Old Beer', category: 'Drinks', active: false,
        mergedInto: 'prod-survivor',
        quantityConfidence: 'physical_count',
      }),
      makeProduct('prod-survivor', {
        name: 'Beer', category: 'Drinks', costPrice: 10, active: true,
        // quantityConfidence intentionally absent
      }),
    ]);
    const { prodById } = buildProductMaps(snap);
    const result = resolveProduct('prod-defunct', prodById);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('prod-survivor');
    expect(result!.entry.quantityConfidence).toBeUndefined();
    // undefined !== 'physical_count' → marker shown.
    expect(result!.entry.quantityConfidence !== 'physical_count').toBe(true);
  });

  it('direct lookup of an active product returns its quantityConfidence unchanged', () => {
    const snap = makeSnap([
      makeProduct('prod-1', { name: 'Cider', category: 'Drinks', costPrice: 8, active: true, quantityConfidence: 'estimated_no_sales' }),
    ]);
    const { prodById } = buildProductMaps(snap);
    const result = resolveProduct('prod-1', prodById);

    expect(result).not.toBeNull();
    expect(result!.entry.quantityConfidence).toBe('estimated_no_sales');
  });
});

// ── resolveProductChain: survivor resolution ──────────────────────────────────

describe('resolveProductChain', () => {
  it('3-step chain A → B → C collapses to survivor C', () => {
    const prodById: Record<string, ProdEntry> = {
      'A': { name: 'a', category: 'x', mergedInto: 'B' },
      'B': { name: 'b', category: 'x', mergedInto: 'C' },
      'C': { name: 'c', category: 'x', mergedInto: null },
    };
    expect(resolveProductChain('A', prodById)).toBe('C');
    expect(resolveProductChain('B', prodById)).toBe('C');
    expect(resolveProductChain('C', prodById)).toBe('C');
  });

  it('single doc with no mergedInto returns itself', () => {
    const prodById: Record<string, ProdEntry> = {
      'X': { name: 'x', category: 'y', mergedInto: null },
    };
    expect(resolveProductChain('X', prodById)).toBe('X');
  });

  it('cycle detected: returns null', () => {
    const prodById: Record<string, ProdEntry> = {
      'A': { name: 'a', category: 'x', mergedInto: 'B' },
      'B': { name: 'b', category: 'x', mergedInto: 'A' },
    };
    expect(resolveProductChain('A', prodById)).toBeNull();
  });

  it('missing doc in chain: returns null', () => {
    const prodById: Record<string, ProdEntry> = {
      'A': { name: 'a', category: 'x', mergedInto: 'B' },
      // B is missing from prodById
    };
    expect(resolveProductChain('A', prodById)).toBeNull();
  });

  it('depth cap (11-hop chain beyond the 10-hop limit): returns null', () => {
    const prodById: Record<string, ProdEntry> = {};
    for (let i = 0; i < 11; i++) {
      prodById[`p${i}`] = { name: `p${i}`, category: 'x', mergedInto: i < 10 ? `p${i + 1}` : null };
    }
    // p0 → p1 → ... → p10 (no mergedInto), but that's 11 hops total including p10
    // Actually the chain is p0→p1→...→p10 = 10 hops, with p10 being the survivor.
    // Use 12 nodes to exceed the 10-hop cap:
    const prodById12: Record<string, ProdEntry> = {};
    for (let i = 0; i < 12; i++) {
      prodById12[`q${i}`] = { name: `q${i}`, category: 'x', mergedInto: i < 11 ? `q${i + 1}` : null };
    }
    // q0→q1→...→q11 = 11 hops; cap is 10 → returns null
    expect(resolveProductChain('q0', prodById12)).toBeNull();
  });

  it('inactive survivor (active: false, no mergedInto) is still returned', () => {
    // resolveProductChain follows chains to the doc with no mergedInto, regardless of active flag
    const prodById: Record<string, ProdEntry> = {
      'A': { name: 'a', category: 'x', active: true, mergedInto: 'B' },
      'B': { name: 'b', category: 'x', active: false, mergedInto: null }, // inactive but is the survivor
    };
    expect(resolveProductChain('A', prodById)).toBe('B');
  });
});
