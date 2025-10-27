import variance from '../../src/services/reports/variance';

describe('computeVarianceFromData', () => {
  it('classifies shortages/excesses vs par and totals values', () => {
    const items = [
      { id: 'vodka', name: 'Vodka 1L', departmentId: 'bar', unitCost: 25, par: 10 },
      { id: 'gin', name: 'Gin 1L', departmentId: 'bar', unitCost: 30, par: 8 },
      { id: 'mint', name: 'Mint Bunch', departmentId: 'kitchen', unitCost: 2, par: 20 },
    ];
    const lastCounts = { vodka: 10, gin: 8, mint: 20 };
    const received = { vodka: 0, gin: 2, mint: 0 };
    const sold = { vodka: 3, gin: 1, mint: 10 };

    const r = variance.computeVarianceFromData({
      items, lastCountsByItemId: lastCounts, receivedByItemId: received, soldByItemId: sold, filterDepartmentId: 'bar',
    });

    expect(r.scope.venueId).toBe('unknown'); // patched by orchestrator; here it's pure compute
    expect(r.shortages.length + r.excesses.length).toBeGreaterThan(0);

    // Vodka: theo = 10 + 0 - 3 = 7; par 10 => deltaVsPar = -3 -> shortage, $=3*25=75
    const vodkaRow = [...r.shortages, ...r.excesses].find(x => x.itemId === 'vodka')!;
    expect(vodkaRow.theoreticalOnHand).toBe(7);
    expect(vodkaRow.deltaVsPar).toBe(-3);
    expect(vodkaRow.valueImpact).toBe(75);

    // Gin: theo = 8 + 2 - 1 = 9; par 8 => deltaVsPar = +1 -> excess, $=1*30=30
    const ginRow = [...r.shortages, ...r.excesses].find(x => x.itemId === 'gin')!;
    expect(ginRow.deltaVsPar).toBe(1);
    expect(ginRow.valueImpact).toBe(30);

    expect(r.totalShortageValue).toBe(75);
    expect(r.totalExcessValue).toBe(30);
  });
});
