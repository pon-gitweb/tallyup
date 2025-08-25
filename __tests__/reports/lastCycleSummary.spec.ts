import { computeLastCycleSummary } from '../../src/lib/lastCycleMath';

describe('computeLastCycleSummary', () => {
  it('aggregates shortages, excess, and net value correctly', () => {
    const items = [
      { id: 'a', name: 'Vodka 1L', par: 10, count: 7, costPrice: 5 },   // -15
      { id: 'b', name: 'Lime', par: 4, count: 6, costPrice: 2 },         // +4
      { id: 'c', name: 'Tonic', par: 12, count: 12, costPrice: 1.5 },    //  0
    ];

    const s = computeLastCycleSummary(items, 10);
    expect(s.totalItemsCounted).toBe(3);
    expect(s.totalShortageValue).toBe(15);
    expect(s.totalExcessValue).toBe(4);
    expect(s.netValueImpact).toBe(-11);
    expect(s.topVariances[0].name).toBe('Vodka 1L');
    expect(s.topVariances[1].name).toBe('Lime');
  });
});
