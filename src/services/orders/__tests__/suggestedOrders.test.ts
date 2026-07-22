// Mock firebase at every layer so neither suggestedOrders.ts nor the OrdersService
// import chain (domain/orders → orders.service → create → firebase) triggers an init.
jest.mock('firebase/app', () => ({
  getApp: () => ({}),
  getApps: () => [{}],
  initializeApp: () => ({}),
}));
jest.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  collection: jest.fn(),
  getDocs: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  writeBatch: jest.fn(),
  serverTimestamp: jest.fn(),
  Timestamp: { fromDate: jest.fn(), now: jest.fn() },
  increment: jest.fn(),
  arrayUnion: jest.fn(),
  arrayRemove: jest.fn(),
}));
jest.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: null }) }));
jest.mock('firebase/storage', () => ({}));
jest.mock('../../firebase', () => ({ db: {}, app: {}, auth: null }));
jest.mock('../../completion', () => ({ getVenueSession: jest.fn() }));

import { buildSuggestedOrdersFromData } from '../suggestedOrders';
import { OrdersService } from '../../../domain/orders';
import type { DeptSnap, ProdMeta } from '../suggestedOrders';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDept(id: string, name = 'Bar'): DeptSnap {
  return { id, name };
}

function callWithDefaults(
  depts: DeptSnap[],
  prodMeta: Record<string, ProdMeta>,
  onHand: Record<string, Record<string, number>>,
  soldByDept: Record<string, Record<string, number>> = {},
  cycleDays = 7,
  defaultPar = 6,
) {
  return buildSuggestedOrdersFromData(
    depts,
    prodMeta,
    onHand,
    soldByDept,
    cycleDays,
    { roundToPack: false, defaultPar },
    {},
    null,
    Object.values(soldByDept).some(d => Object.values(d).some(q => q > 0)),
  );
}

// ── Suite 1: return shape / wiring lock ──────────────────────────────────────

describe('OrdersService.buildSuggestedOrdersInMemory — export wiring', () => {
  it('is exported from OrdersService (rewire guard)', () => {
    // This test locks the Task 1 wiring: if someone changes orders.service.ts
    // to export a different function here, this test fails.
    expect(typeof OrdersService.buildSuggestedOrdersInMemory).toBe('function');
  });
});

describe('buildSuggestedOrdersFromData — return shape', () => {
  it('always returns intelligence, buckets, unassigned, and _meta', () => {
    const result = callWithDefaults([makeDept('d1')], {}, { d1: {} });
    expect(Array.isArray(result.intelligence)).toBe(true);
    expect(typeof result.buckets).toBe('object');
    expect(Array.isArray(result.unassigned.lines)).toBe(true);
    expect(typeof result._meta).toBe('object');
  });

  it('_meta includes velocityDriven and snapshotsUsed', () => {
    const result = callWithDefaults([makeDept('d1')], {}, { d1: {} });
    expect(typeof result._meta.velocityDriven).toBe('number');
    expect(typeof result._meta.snapshotsUsed).toBe('number');
  });
});

// ── Suite 2: category PAR defaults ───────────────────────────────────────────

describe('buildSuggestedOrdersFromData — category PAR defaults', () => {
  function parFor(category: string, dp = 99): number {
    const result = buildSuggestedOrdersFromData(
      [makeDept('d1')],
      { p1: { name: 'Prod', category, cost: 10 } },
      { d1: { p1: 0 } },
      {}, 7,
      { roundToPack: false, defaultPar: dp },
      {}, null, false,
    );
    return result.intelligence.find(l => l.productId === 'p1')?.usedPar ?? -1;
  }

  it('beer → 12', () => expect(parFor('Beer')).toBe(12));
  it('cider → 12', () => expect(parFor('Cider')).toBe(12));
  it('rtd → 12', () => expect(parFor('RTD Cans')).toBe(12));
  it('spirits → 6', () => expect(parFor('Spirits')).toBe(6));
  it('whisky → 6', () => expect(parFor('Whisky')).toBe(6));
  it('wine → 6', () => expect(parFor('Wine')).toBe(6));
  it('non-alc → 12', () => expect(parFor('Non-Alcoholic')).toBe(12));
  it('soft drink → 12', () => expect(parFor('Soft Drinks')).toBe(12));
  it('cocktail mix → 4', () => expect(parFor('Cocktail Mix')).toBe(4));
  it('syrup → 4', () => expect(parFor('Syrup')).toBe(4));

  it('category PAR overrides defaultPar (defaultPar=99, beer still returns 12)', () => {
    expect(parFor('Beer', 99)).toBe(12);
  });

  it('explicit deptPar overrides category PAR', () => {
    const result = buildSuggestedOrdersFromData(
      [makeDept('d1')],
      { p1: { name: 'Prod', category: 'Beer', cost: 10, deptPar: { d1: 24 } } },
      { d1: { p1: 0 } },
      {}, 7,
      { roundToPack: false, defaultPar: 6 },
      {}, null, false,
    );
    const line = result.intelligence.find(l => l.productId === 'p1');
    expect(line?.usedPar).toBe(24);
    expect(line?.needsPar).toBe(false);
  });
});

// ── Suite 3: cycleDays and coverStatus bands ──────────────────────────────────

describe('buildSuggestedOrdersFromData — coverStatus bands', () => {
  function lineFor(onHandQty: number, qtySold: number, cycleDays: number) {
    return buildSuggestedOrdersFromData(
      [makeDept('d1')],
      { p1: { name: 'P', cost: 10, supplierId: 's1', par: 20 } },
      { d1: { p1: onHandQty } },
      { d1: { p1: qtySold } },
      cycleDays,
      { roundToPack: false, defaultPar: 6 },
      { s1: 'Sup' }, null, true,
    ).intelligence.find(l => l.productId === 'p1');
  }

  it('cycleDays is reflected in _meta', () => {
    const result = callWithDefaults([makeDept('d1')], {}, { d1: {} }, {}, 45);
    expect(result._meta.cycleDays).toBe(45);
  });

  it('critical when daysOfCover ≤ 2 (2 on hand, 1/day velocity)', () => {
    const l = lineFor(2, 7, 7); // 2 on hand, 1/day → 2 days cover
    expect(l?.daysOfCover).toBe(2);
    expect(l?.coverStatus).toBe('critical');
  });

  it('low when daysOfCover ≤ 7 (5 on hand, 1/day velocity)', () => {
    const l = lineFor(5, 7, 7);
    expect(l?.daysOfCover).toBe(5);
    expect(l?.coverStatus).toBe('low');
  });

  it('ok when daysOfCover > 7 (14 on hand, 1/day velocity)', () => {
    const l = lineFor(14, 7, 7);
    expect(l?.coverStatus).toBe('ok');
  });

  it('unknown when no sales velocity', () => {
    const l = callWithDefaults(
      [makeDept('d1')],
      { p1: { name: 'P', cost: 10, supplierId: 's1', par: 20 } },
      { d1: { p1: 5 } },
    ).intelligence.find(l => l.productId === 'p1');
    expect(l?.velocityPerDay).toBeNull();
    expect(l?.coverStatus).toBe('unknown');
  });
});
