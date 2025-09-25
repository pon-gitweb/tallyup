import { pickTopVariances } from '../lib/lastCycleSelectors';

describe('pickTopVariances', () => {
  it('orders by valueImpact when present, else by |variance|', () => {
    const rows = [
      { name: 'A', variance: -2, valueImpact: 50 },
      { name: 'B', variance: -10 }, // higher |variance| but no valueImpact
      { name: 'C', variance: 1, valueImpact: 200 },
    ];
    const out = pickTopVariances(rows, 2);
    expect(out[0].name).toBe('C'); // 200 first
    expect(out[1].name).toBe('A'); // 50 next
  });
});
