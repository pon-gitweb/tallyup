/* @ts-nocheck */
import * as linking from '../../orders/linking';
import * as sup from '../../orders/suppliers';
import { applyCatalogLinks } from '../../suppliers/catalogApply';

jest.mock('../../orders/linking', ()=>({
  ensureProduct: jest.fn(async ()=>undefined)
}));
jest.mock('../../orders/suppliers', ()=>({
  setSupplierOnProduct: jest.fn(async ()=>undefined)
}));

describe('applyCatalogLinks', () => {
  const venueId = 'v_test';
  beforeEach(()=>jest.clearAllMocks());

  it('skips rows with missing data', async () => {
    const res = await applyCatalogLinks({ venueId, rows: [
      { rowIndex: 0, supplierId: '', productId: 'p1' },
      { rowIndex: 1, supplierId: 's1', productId: '', productName: '' },
    ]});
    expect(res.results.map(r=>r.status)).toEqual(['skipped','skipped']);
  });

  it('ensures product and links supplier', async () => {
    const res = await applyCatalogLinks({ venueId, rows: [
      { rowIndex: 0, supplierId: 's1', productId: 'p1', productName: 'Cola', createIfMissing: true, supplierName: 'Allied' },
    ]});
    expect(linking.ensureProduct).toHaveBeenCalledWith(venueId, 'p1', 'Cola');
    expect(sup.setSupplierOnProduct).toHaveBeenCalledWith(venueId, 'p1', 's1', 'Allied');
    expect(res.results[0].status).toBe('ok');
  });

  it('creates a product id from name when missing', async () => {
    const res = await applyCatalogLinks({ venueId, rows: [
      { rowIndex: 0, supplierId: 's1', productName: 'Orange Juice 1L', supplierName: 'Hancocks', createIfMissing: true },
    ]});
    const ok = res.results[0];
    expect(ok.status).toBe('ok');
    // ensureProduct called with derived id
    expect(linking.ensureProduct).toHaveBeenCalled();
    expect(sup.setSupplierOnProduct).toHaveBeenCalled();
  });
});
