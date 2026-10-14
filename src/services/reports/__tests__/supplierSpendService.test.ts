import { loadSupplierSpendRows } from '../supplierSpendService';

// ── Mock Firestore ────────────────────────────────────────────────────────────

const mockGetDocs = jest.fn();
const mockQuery = jest.fn((...args: any[]) => args);
const mockCollection = jest.fn((...args: any[]) => args.join('/'));
const mockWhere = jest.fn((...args: any[]) => args);

jest.mock('firebase/firestore', () => ({
  collection: (...args: any[]) => mockCollection(...args),
  getDocs: (...args: any[]) => mockGetDocs(...args),
  query: (...args: any[]) => mockQuery(...args),
  where: (...args: any[]) => mockWhere(...args),
  Timestamp: {
    fromDate: (d: Date) => ({ toDate: () => d, seconds: Math.floor(d.getTime() / 1000) }),
  },
}));

jest.mock('../../firebase', () => ({ db: {} }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnap(docs: object[]) {
  return { docs: docs.map((data: any, i) => ({ id: `inv${i}`, data: () => data })) };
}

const periodStart = new Date('2024-01-01');
const periodEnd = new Date('2024-01-31');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadSupplierSpendRows', () => {
  beforeEach(() => jest.clearAllMocks());

  it('groups invoices by supplierId when present', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierId: 'sup1', supplierName: 'Acme', totalAmount: 100, pricesExGST: false },
      { supplierId: 'sup1', supplierName: 'Acme', totalAmount: 50, pricesExGST: false },
      { supplierId: 'sup2', supplierName: 'Beta', totalAmount: 200, pricesExGST: false },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);

    expect(rows).toHaveLength(2);
    const acme = rows.find(r => r.supplierId === 'sup1')!;
    expect(acme.totalSpend).toBe(150);
    expect(acme.invoiceCount).toBe(2);
    const beta = rows.find(r => r.supplierId === 'sup2')!;
    expect(beta.totalSpend).toBe(200);
    expect(beta.invoiceCount).toBe(1);
  });

  it('groups by normalized supplierName when supplierId is missing', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierName: 'Fresh Foods', totalAmount: 80, pricesExGST: false },
      { supplierName: '  fresh foods  ', totalAmount: 60, pricesExGST: false },
      { supplierName: 'Other Co', totalAmount: 40, pricesExGST: false },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);

    expect(rows).toHaveLength(2);
    const fresh = rows.find(r => r.supplierName === 'Fresh Foods')!;
    expect(fresh.totalSpend).toBe(140);
    expect(fresh.invoiceCount).toBe(2);
    expect(fresh.supplierId).toBeNull();
  });

  it('prefers supplierId over supplierName for grouping key', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierId: 'sid1', supplierName: 'Name A', totalAmount: 100, pricesExGST: false },
      { supplierId: 'sid1', supplierName: 'Name B', totalAmount: 50, pricesExGST: false },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalSpend).toBe(150);
  });

  it('labels gstNote as "excl GST" when all invoices for supplier have pricesExGST=true', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierId: 'sup1', supplierName: 'ExGST Co', totalAmount: 100, pricesExGST: true },
      { supplierId: 'sup1', supplierName: 'ExGST Co', totalAmount: 50, pricesExGST: true },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);
    expect(rows[0].gstNote).toBe('excl GST');
  });

  it('labels gstNote as "incl GST" when any invoice has pricesExGST=false', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierId: 'sup1', supplierName: 'Mixed Co', totalAmount: 100, pricesExGST: true },
      { supplierId: 'sup1', supplierName: 'Mixed Co', totalAmount: 50, pricesExGST: false },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);
    expect(rows[0].gstNote).toBe('incl GST');
  });

  it('sorts rows by totalSpend descending', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierId: 'sup1', supplierName: 'Small', totalAmount: 10, pricesExGST: false },
      { supplierId: 'sup2', supplierName: 'Large', totalAmount: 500, pricesExGST: false },
      { supplierId: 'sup3', supplierName: 'Mid', totalAmount: 100, pricesExGST: false },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);
    expect(rows.map(r => r.supplierId)).toEqual(['sup2', 'sup3', 'sup1']);
  });

  it('applies budget when supplierId matches', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierId: 'sup1', supplierName: 'Acme', totalAmount: 300, pricesExGST: false },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd, [
      { supplierId: 'sup1', amount: 200 },
    ]);

    expect(rows[0].budgetAmount).toBe(200);
    expect(rows[0].budgetVariance).toBe(100);
    expect(rows[0].budgetVariancePercent).toBe(50);
    expect(rows[0].overBudget).toBe(true);
  });

  it('returns empty array on Firestore error', async () => {
    mockGetDocs.mockRejectedValue(new Error('permission denied'));
    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);
    expect(rows).toEqual([]);
  });

  it('falls back to totalAmount=0 for invoice with no amount fields', async () => {
    mockGetDocs.mockResolvedValue(makeSnap([
      { supplierId: 'sup1', supplierName: 'Bare', pricesExGST: false },
    ]));

    const rows = await loadSupplierSpendRows('venue1', periodStart, periodEnd);
    expect(rows[0].totalSpend).toBe(0);
  });
});
