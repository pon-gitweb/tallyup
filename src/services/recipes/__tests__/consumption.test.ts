import { computeConsumption } from '../../recipes/consumption';

describe('computeConsumption', () => {
  it('aggregates ml/g/each per product for single serve recipes', () => {
    const recipe = {
      status: 'confirmed',
      mode: 'single',
      items: [
        { productId: 'vodka', qty: 30, unit: 'ml' },
        { productId: 'lime',  qty: 20, unit: 'ml' },
        { productId: 'salt',  qty: 2,  unit: 'g'  },
        { productId: 'garnish', qty: 1, unit: 'each' },
      ],
    };
    const out = computeConsumption(recipe as any, 10);
    expect(out.vodka.ml).toBe(300);
    expect(out.lime.ml).toBe(200);
    expect(out.salt.g).toBe(20);
    expect(out.garnish.each).toBe(10);
  });

  it('divides batch qty by yield to compute per-serve', () => {
    const recipe = {
      status: 'confirmed',
      mode: 'batch',
      yield: 20, // 20 serves produced
      items: [
        { productId: 'mix', qty: 2000, unit: 'ml' }, // 2L per batch -> 100 ml per serve
      ],
    };
    const out = computeConsumption(recipe as any, 5); // 5 serves used
    expect(out.mix.ml).toBe(500);
  });

  it('ignores misc (no productId) and unknown units', () => {
    const recipe = {
      status: 'confirmed',
      mode: 'single',
      items: [
        { qty: 10, unit: 'ml' },           // no productId
        { productId: 'x', qty: 1, unit: 'unknown' },  // unknown unit
      ],
    };
    const out = computeConsumption(recipe as any, 3);
    expect(Object.keys(out).length).toBe(0);
  });
});
