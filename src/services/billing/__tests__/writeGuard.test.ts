import { evaluateWriteGuard, WriteGuardInput, WriteAction } from '../writeGuard';

const ALL_ACTIONS: WriteAction[] = [
  'START_COUNT',
  'PRODUCT_WRITE',
  'STRUCTURE_WRITE',
  'INVOICE_POST',
  'ORDER_WRITE',
  'RESET_STOCKTAKE',
];

/** Fully blocked state — every field set to trigger a block. */
const BLOCKED: Omit<WriteGuardInput, 'action'> = {
  enforce: true,
  ready: true,
  accessMode: 'readOnly',
  venueType: 'venue',
  areaStarted: false,
  cycleActive: false,
};

// ── Master-switch: enforce=false ──────────────────────────────────────────────

describe('enforce=false — master switch off', () => {
  test.each(ALL_ACTIONS)('allows %s', (action) => {
    const r = evaluateWriteGuard({ ...BLOCKED, enforce: false, action });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('ok');
  });
});

// ── Loading guard: ready=false ────────────────────────────────────────────────

describe('ready=false — loading state', () => {
  test.each(ALL_ACTIONS)('allows %s', (action) => {
    const r = evaluateWriteGuard({ ...BLOCKED, ready: false, action });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('ok');
  });
});

// ── Full access: accessMode=full ──────────────────────────────────────────────

describe('accessMode=full — full subscriber / trial active', () => {
  test.each(ALL_ACTIONS)('allows %s', (action) => {
    const r = evaluateWriteGuard({ ...BLOCKED, accessMode: 'full', action });
    expect(r.allowed).toBe(true);
  });
});

// ── Festival venues ───────────────────────────────────────────────────────────

describe('venueType=festival — always full access', () => {
  test.each(ALL_ACTIONS)('allows %s', (action) => {
    const r = evaluateWriteGuard({ ...BLOCKED, venueType: 'festival', action });
    expect(r.allowed).toBe(true);
  });
});

// ── venueType=null (loading) ──────────────────────────────────────────────────

describe('venueType=null — ready=false so never blocked', () => {
  test.each(ALL_ACTIONS)('allows %s', (action) => {
    // ready=false because resolveEntitlements returns ready=false when venueType=null
    const r = evaluateWriteGuard({ ...BLOCKED, venueType: null, ready: false, action });
    expect(r.allowed).toBe(true);
  });
});

// ── Blocked actions in readOnly mode ─────────────────────────────────────────

describe('readOnly mode — blocked actions', () => {
  const BLOCKED_ACTIONS: WriteAction[] = [
    'PRODUCT_WRITE',
    'STRUCTURE_WRITE',
    'INVOICE_POST',
    'ORDER_WRITE',
    'RESET_STOCKTAKE',
  ];

  test.each(BLOCKED_ACTIONS)('blocks %s', (action) => {
    const r = evaluateWriteGuard({ ...BLOCKED, action });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('read_only');
  });
});

// ── START_COUNT — area/cycle logic ────────────────────────────────────────────

describe('START_COUNT area/cycle logic', () => {
  it('blocks when area not started and no cycle active (defaults)', () => {
    const r = evaluateWriteGuard({ ...BLOCKED, action: 'START_COUNT' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('read_only');
  });

  it('blocks explicitly when areaStarted=false, cycleActive=false', () => {
    const r = evaluateWriteGuard({
      ...BLOCKED, action: 'START_COUNT', areaStarted: false, cycleActive: false,
    });
    expect(r.allowed).toBe(false);
  });

  it('allows when area already started (resuming an area)', () => {
    const r = evaluateWriteGuard({
      ...BLOCKED, action: 'START_COUNT', areaStarted: true, cycleActive: false,
    });
    expect(r.allowed).toBe(true);
  });

  it('allows when a cycle is already active (stocktakeActive=true)', () => {
    const r = evaluateWriteGuard({
      ...BLOCKED, action: 'START_COUNT', areaStarted: false, cycleActive: true,
    });
    expect(r.allowed).toBe(true);
  });

  it('allows when both area started and cycle active', () => {
    const r = evaluateWriteGuard({
      ...BLOCKED, action: 'START_COUNT', areaStarted: true, cycleActive: true,
    });
    expect(r.allowed).toBe(true);
  });
});

// ── Privileged patterns — no entitlement type ever blocked ───────────────────

describe('privileged access patterns — never blocked', () => {
  // Each privileged entitlement produces accessMode='full' (or festival venueType).
  // The guard only sees accessMode, so any test of accessMode='full' covers all.
  const privileged: Array<[string, Partial<WriteGuardInput>]> = [
    ['founder (accessMode=full)',          { accessMode: 'full' }],
    ['legacy free access (accessMode=full)',{ accessMode: 'full' }],
    ['subscriptionOverride (accessMode=full)', { accessMode: 'full' }],
    ['Matchbox venue (accessMode=full)',   { accessMode: 'full' }],
    ['pilot in-year (accessMode=full)',    { accessMode: 'full' }],
    ['active Stripe subscriber (accessMode=full)', { accessMode: 'full' }],
    ['festival venue (venueType=festival)',{ venueType: 'festival' }],
  ];

  test.each(privileged)('%s is never blocked (all actions)', (_, overrides) => {
    for (const action of ALL_ACTIONS) {
      const r = evaluateWriteGuard({ ...BLOCKED, ...overrides, action });
      expect(r.allowed).toBe(true);
    }
  });
});

// ── Combined table: blocked state variations ──────────────────────────────────

describe('exhaustive blocked-state table', () => {
  // [label, input, expectedAllowed]
  const rows: [string, WriteGuardInput, boolean][] = [
    ['enforce=false, readOnly, PRODUCT_WRITE',
      { ...BLOCKED, enforce: false, action: 'PRODUCT_WRITE' }, true],
    ['ready=false, readOnly, INVOICE_POST',
      { ...BLOCKED, ready: false, action: 'INVOICE_POST' }, true],
    ['full, readOnly-like, ORDER_WRITE',
      { ...BLOCKED, accessMode: 'full', action: 'ORDER_WRITE' }, true],
    ['festival, readOnly, RESET_STOCKTAKE',
      { ...BLOCKED, venueType: 'festival', action: 'RESET_STOCKTAKE' }, true],
    ['all blocked, PRODUCT_WRITE',
      { ...BLOCKED, action: 'PRODUCT_WRITE' }, false],
    ['all blocked, STRUCTURE_WRITE',
      { ...BLOCKED, action: 'STRUCTURE_WRITE' }, false],
    ['all blocked, INVOICE_POST',
      { ...BLOCKED, action: 'INVOICE_POST' }, false],
    ['all blocked, ORDER_WRITE',
      { ...BLOCKED, action: 'ORDER_WRITE' }, false],
    ['all blocked, RESET_STOCKTAKE',
      { ...BLOCKED, action: 'RESET_STOCKTAKE' }, false],
    ['all blocked, START_COUNT, no cycle',
      { ...BLOCKED, action: 'START_COUNT', areaStarted: false, cycleActive: false }, false],
    ['all blocked, START_COUNT, area started',
      { ...BLOCKED, action: 'START_COUNT', areaStarted: true, cycleActive: false }, true],
    ['all blocked, START_COUNT, cycle active',
      { ...BLOCKED, action: 'START_COUNT', areaStarted: false, cycleActive: true }, true],
    ['enforce=false + ready=false, RESET_STOCKTAKE',
      { ...BLOCKED, enforce: false, ready: false, action: 'RESET_STOCKTAKE' }, true],
    ['enforce=true, ready=false, festival, START_COUNT',
      { ...BLOCKED, ready: false, venueType: 'festival', action: 'START_COUNT' }, true],
  ];

  test.each(rows)('%s → allowed=%s', (_, input, expectedAllowed) => {
    const r = evaluateWriteGuard(input);
    expect(r.allowed).toBe(expectedAllowed);
  });
});
