/* @ts-nocheck */
import { chooseCheapest } from '../chooseCheapest';

describe('chooseCheapest', () => {
  it('returns null for empty or invalid input', () => {
    expect(chooseCheapest([])).toBeNull();
    expect(chooseCheapest([{ supplierId: 's1', price: NaN }])).toBeNull();
  });
  it('picks the lowest price', () => {
    const res = chooseCheapest([
      { supplierId: 's1', price: 12.5 },
      { supplierId: 's2', price: 10.0 },
      { supplierId: 's3', price: 11.0 },
    ]);
    expect(res?.supplierId).toBe('s2');
  });
  it('prefers contract when price ties', () => {
    const res = chooseCheapest([
      { supplierId: 's1', price: 10.0, isContract: false },
      { supplierId: 's2', price: 10.0, isContract: true },
    ]);
    expect(res?.supplierId).toBe('s2');
  });
});
