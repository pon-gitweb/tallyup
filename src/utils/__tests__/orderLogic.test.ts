import { abbr3, extractSupplierFromProductDoc, buildAllDraftPlan } from '../../utils/orderLogic';

describe('abbr3', () => {
  it('uses first 3 letters of name', () => {
    expect(abbr3('Bidfood')).toBe('BID');
  });
  it('falls back to id when name is short', () => {
    expect(abbr3('Bi', 'sup123')).toBe('SUP');
    expect(abbr3('', 'abcde')).toBe('ABC');
  });
  it('defaults to SUP when nothing provided', () => {
    // @ts-ignore
    expect(abbr3()).toBe('SUP');
  });
});

describe('extractSupplierFromProductDoc', () => {
  it('reads supplierId/supplierName direct', () => {
    const pd = { supplierId: 'S1', supplierName: 'FreshCo' };
    expect(extractSupplierFromProductDoc(pd)).toEqual({ supplierId: 'S1', supplierName: 'FreshCo' });
  });
  it('reads nested supplier {id,name}', () => {
    const pd = { supplier: { id: 'S2', name: 'Bidfood' } };
    expect(extractSupplierFromProductDoc(pd)).toEqual({ supplierId: 'S2', supplierName: 'Bidfood' });
  });
  it('reads vendorRef and vendor', () => {
    const pd = { vendorRef: { id: 'S3' }, vendor: { id: 'S3', name: 'Gilmours' } };
    expect(extractSupplierFromProductDoc(pd)).toEqual({ supplierId: 'S3', supplierName: 'Gilmours' });
  });
  it('returns empty when nothing matches', () => {
    expect(extractSupplierFromProductDoc({})).toEqual({ supplierId: null, supplierName: null });
    // @ts-ignore
    expect(extractSupplierFromProductDoc(null)).toEqual({});
  });
});

describe('buildAllDraftPlan', () => {
  const lines = (n: number) => Array.from({ length: n }).map((_, i) => ({ productId: 'p'+i, qty: 1 }));
  it('splits into willCreate and willMerge', () => {
    const per = new Map<string, any>([
      ['S1', { supplierName: 'Alpha', lines: lines(2) }],
      ['S2', { supplierName: 'Beta', lines: lines(3) }],
      ['S3', { supplierName: 'Charlie', lines: lines(0) }], // ignored (no orderables)
    ]);
    const existing = { S2: true } as Record<string, true>;
    const plan = buildAllDraftPlan(per, existing);
    expect(plan.willCreate).toEqual([{ supplierId: 'S1', supplierName: 'Alpha', count: 2 }]);
    expect(plan.willMerge).toEqual([{ supplierId: 'S2', supplierName: 'Beta', count: 3 }]);
  });

  it('sorts by supplierName for stability', () => {
    const per = new Map<string, any>([
      ['S2', { supplierName: 'Zebra', lines: lines(1) }],
      ['S1', { supplierName: 'Apple', lines: lines(1) }],
    ]);
    const existing = {} as Record<string, true>;
    const plan = buildAllDraftPlan(per, existing);
    expect(plan.willCreate.map(p => p.supplierName)).toEqual(['Apple', 'Zebra']);
  });
});
