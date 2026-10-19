import { classifySalesLines, buildProductIndex } from '../classifySalesLines';
import { MappingDoc } from '../mappingConversion';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PRODUCTS = [
  { id: 'p-auto',  name: 'Auto Beer',    size: '330ml' },
  { id: 'p-ratio', name: 'Ratio Spirit', size: '700ml' },
  { id: 'p-gin',   name: 'House Gin',    size: '700ml' },
];

const PRODUCT_BY_ID: Record<string, any> = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
const PRODUCT_INDEX = buildProductIndex(PRODUCTS);

// confirmedMappings only for the explicitly mapped product
const CONFIRMED_MAPPINGS: Record<string, string> = {
  'ratio spirit': 'p-ratio',
};

const FULL_MAPPINGS: Record<string, MappingDoc> = {
  'ratio spirit':  { posItemName: 'Ratio Spirit', productId: 'p-ratio', mappingType: 'direct_product', conversionRatio: 0.04 },
  'dirty martini': { posItemName: 'Dirty Martini', recipeId: 'recipe-1', mappingType: 'recipe' },
  'staff meal':    { posItemName: 'Staff Meal', mappingType: 'skipped' },
};

const RECIPES_BY_ID: Record<string, any | null> = {
  'recipe-1': {
    name: 'Dirty Martini',
    yield: 1,
    items: [{ productId: 'p-gin', productName: 'House Gin', qty: 60, unit: 'ml' }],
  },
};

const LINES = [
  { name: 'Auto Beer',     qtySold: 10, gross: 50 },  // auto-matched (exact name)
  { name: 'Ratio Spirit',  qtySold: 5,  gross: 40 },  // mapped, conversionRatio
  { name: 'Dirty Martini', qtySold: 3,  gross: 25 },  // recipe
  { name: 'Staff Meal',    qtySold: 2,  gross: 0 },   // skipped
  { name: 'Unknown Item',  qtySold: 1,  gross: 5 },   // unknown
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('classifySalesLines — outcome units sum to total', () => {
  let result: ReturnType<typeof classifySalesLines>;

  beforeAll(() => {
    result = classifySalesLines(
      LINES, PRODUCT_INDEX, CONFIRMED_MAPPINGS, FULL_MAPPINGS, RECIPES_BY_ID, PRODUCT_BY_ID,
    );
  });

  it('counts.totalQtySold equals sum of all line qtySold', () => {
    const expected = LINES.reduce((s, l) => s + l.qtySold, 0);  // 10+5+3+2+1 = 21
    expect(result.counts.totalQtySold).toBe(expected);
  });

  it('outcome qtySold values sum to totalQtySold', () => {
    const matchedQtySold = result.matches.reduce((s: number, m: any) => s + (m.qtySold ?? 0), 0);
    // Unique POS lines that were recipe-expanded
    const recipePosQty = new Map<string, number>();
    for (const rd of result.recipeDeductions) {
      recipePosQty.set(rd.posName, rd.qtySold);
    }
    const recipeQtySold = [...recipePosQty.values()].reduce((s, q) => s + q, 0);
    const ignoredQtySold = result.ignored.reduce((s: number, i: any) => s + (i.qtySold ?? 0), 0);
    const unknownQtySold = result.unknowns.reduce((s: number, u: any) => s + (u.line?.qtySold ?? 0), 0);

    expect(matchedQtySold + recipeQtySold + ignoredQtySold + unknownQtySold)
      .toBe(result.counts.totalQtySold);
  });

  it('counts: matched=2, recipeMatched=1, ignored=1, unknowns=1', () => {
    expect(result.counts.matched).toBe(2);
    expect(result.counts.recipeMatched).toBe(1);
    expect(result.counts.ignored).toBe(1);
    expect(result.counts.unknowns).toBe(1);
  });
});

describe('classifySalesLines — auto-matched line', () => {
  it('auto-matched product (no fullMappings entry) has conversionSource default', () => {
    const result = classifySalesLines(
      LINES, PRODUCT_INDEX, CONFIRMED_MAPPINGS, FULL_MAPPINGS, RECIPES_BY_ID, PRODUCT_BY_ID,
    );
    const autoBeer = result.matches.find((m: any) => m.name === 'Auto Beer');
    expect(autoBeer).toBeDefined();
    expect(autoBeer.conversionSource).toBe('default');
    expect(autoBeer.via).toBe('exact');
    expect(autoBeer.mappingType).toBeNull();  // no fullMappings entry
  });

  it('mapped product with conversionRatio has conversionSource conversionRatio', () => {
    const result = classifySalesLines(
      LINES, PRODUCT_INDEX, CONFIRMED_MAPPINGS, FULL_MAPPINGS, RECIPES_BY_ID, PRODUCT_BY_ID,
    );
    const ratioSpirit = result.matches.find((m: any) => m.name === 'Ratio Spirit');
    expect(ratioSpirit).toBeDefined();
    expect(ratioSpirit.conversionSource).toBe('conversionRatio');
    expect(ratioSpirit.stockQty).toBeCloseTo(5 * 0.04);
  });
});

describe('classifySalesLines — recipe, skipped, unknown', () => {
  let result: ReturnType<typeof classifySalesLines>;
  beforeAll(() => {
    result = classifySalesLines(
      LINES, PRODUCT_INDEX, CONFIRMED_MAPPINGS, FULL_MAPPINGS, RECIPES_BY_ID, PRODUCT_BY_ID,
    );
  });

  it('recipe line: expanded into recipeDeductions, not in matches', () => {
    expect(result.matches.find((m: any) => m.name === 'Dirty Martini')).toBeUndefined();
    const rds = result.recipeDeductions.filter((r: any) => r.posName === 'Dirty Martini');
    expect(rds).toHaveLength(1);
    expect(rds[0].productId).toBe('p-gin');
    expect(rds[0].stockQty).toBeCloseTo(3 * 60 / 700);
  });

  it('skipped line: in ignored[], not in matches or unknowns', () => {
    const ig = result.ignored.find((i: any) => i.name === 'Staff Meal');
    expect(ig).toBeDefined();
    expect(ig.qtySold).toBe(2);
    expect(result.matches.find((m: any) => m.name === 'Staff Meal')).toBeUndefined();
  });

  it('unknown line: in unknowns', () => {
    const u = result.unknowns.find((u: any) => u.line?.name === 'Unknown Item');
    expect(u).toBeDefined();
    expect(result.counts.unknowns).toBe(1);
  });
});

describe('classifySalesLines — missing recipe treated as unknown', () => {
  it('missing recipe → unknown with reason recipe_missing, counts.recipeMissing incremented', () => {
    const result = classifySalesLines(
      LINES, PRODUCT_INDEX, CONFIRMED_MAPPINGS, FULL_MAPPINGS,
      { 'recipe-1': null },  // recipe explicitly missing
      PRODUCT_BY_ID,
    );
    const u = result.unknowns.find((u: any) => u.line?.name === 'Dirty Martini');
    expect(u).toBeDefined();
    expect(u.reason).toBe('recipe_missing');
    expect(result.counts.recipeMissing).toBe(1);
    expect(result.recipeDeductions.filter((r: any) => r.posName === 'Dirty Martini')).toHaveLength(0);
  });
});
