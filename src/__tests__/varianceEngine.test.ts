import { computeUnified } from '../services/reports/varianceEngine';

test('computeUnified basic math', () => {
  const counts = [
    { sku:'GIN-1L', name:'Gin 1L', onHand:8, expected:10, unitCost:32.5 },
    { sku:'TON-200', name:'Tonic 200', onHand:40, expected:30, unitCost:1.3 },
  ];
  const sales = [
    { sku:'GIN-1L', qty:3 },
    { sku:'TON-200', qty:5 },
  ];
  const invoices = [
    { sku:'GIN-1L', qty:1 },
    { sku:'TON-200', qty:20 },
  ];
  const res = computeUnified(counts as any, sales as any, invoices as any, {});

  // variance = onHand - expected
  const gin = res.rows.find(r => r.sku === 'GIN-1L')!;
  const ton = res.rows.find(r => r.sku === 'TON-200')!;
  expect(gin.variance).toBe(8 - 10);        // -2
  expect(ton.variance).toBe(40 - 30);       // +10

  // shrinkage = (expected - sales + invoices) - onHand
  expect(gin.shrinkage).toBe((10 - 3 + 1) - 8);   // 0 -> no shrink
  expect(ton.shrinkage).toBe((30 - 5 + 20) - 40); // +5 -> no loss

  // totals
  expect(res.totals.shortageValue).toBeCloseTo(Math.abs(-2 * 32.5)); // 65
  expect(res.totals.excessValue).toBeCloseTo(10 * 1.3);              // 13
  expect(res.totals.shrinkageUnits).toBeCloseTo(0);
  expect(res.totals.shrinkageValue).toBeCloseTo(0);
});
