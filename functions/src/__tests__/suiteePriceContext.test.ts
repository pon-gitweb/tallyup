/**
 * Tests for the Suitee price-context historical-backfill filter (Handoff C).
 *
 * The change in api.ts's /suitee route intercepts priceHistory entries with
 * isHistoricalBackfill === true before the 90-day filter, routing them to a
 * separate "HISTORICAL INVOICES RECENTLY PROCESSED" section instead of the
 * "PRICE CHANGES (last 90 days)" section.
 *
 * These tests mirror the exact in-route logic as pure TypeScript — no Firebase
 * or Express dependency needed.  Follows the same pattern as
 * FastReceivesReviewPanel.reviewedBadge.test.ts.
 */

// ── Types (mirroring the in-route data shapes) ────────────────────────────────

type PriceHistoryEntry = {
  isHistoricalBackfill?: boolean;
  date?: Date | null;           // toDate() result in production
  invoiceDate?: string | null;
  historicalScenario?: string | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  changePercent?: number | null;
  direction?: string | null;
  supplierName?: string | null;
};

// ── Helpers mirroring the in-route classification logic ───────────────────────

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Returns which bucket a priceHistory entry falls into:
 *   'historical_backfill' — has isHistoricalBackfill === true, routed to the
 *                           new HISTORICAL INVOICES section regardless of date.
 *   'recent_change'       — live change within the 90-day window.
 *   'outside_window'      — live change older than 90 days.
 */
function classifyEntry(
  entry: PriceHistoryEntry,
  now = new Date(),
): 'historical_backfill' | 'recent_change' | 'outside_window' {
  if (entry.isHistoricalBackfill === true) return 'historical_backfill';
  const ninetyDaysAgo = new Date(now.getTime() - NINETY_DAYS_MS);
  if (entry.date && entry.date >= ninetyDaysAgo) return 'recent_change';
  return 'outside_window';
}

/** Mirrors the in-route loop that builds the two output arrays. */
function partitionEntries(
  entries: PriceHistoryEntry[],
  productName: string,
  now = new Date(),
): {
  recentChanges: Array<{ productName: string; entry: PriceHistoryEntry }>;
  historicalBackfills: Array<{ productName: string; entry: PriceHistoryEntry }>;
} {
  const recentChanges: Array<{ productName: string; entry: PriceHistoryEntry }> = [];
  const historicalBackfills: Array<{ productName: string; entry: PriceHistoryEntry }> = [];

  for (const entry of entries) {
    const bucket = classifyEntry(entry, now);
    if (bucket === 'historical_backfill') {
      historicalBackfills.push({ productName, entry });
    } else if (bucket === 'recent_change') {
      recentChanges.push({ productName, entry });
    }
    // outside_window entries are silently discarded, same as before
  }

  return { recentChanges, historicalBackfills };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-02T12:00:00Z');

/** A live price-change entry written 10 days ago — inside the 90-day window. */
function liveTenDaysAgo(): PriceHistoryEntry {
  return {
    date: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
    oldPrice: 25.00,
    newPrice: 27.50,
    changePercent: 10,
    direction: 'increase',
    supplierName: 'Fresh Wines Co.',
    // isHistoricalBackfill intentionally absent — fresh invoice
  };
}

/** A historical-backfill entry where date is "now" (serverTimestamp) but the
 *  invoice itself is months old. */
function historicalBackfillEntry(): PriceHistoryEntry {
  return {
    isHistoricalBackfill: true,
    date: NOW,   // serverTimestamp = time of processing, not invoice date
    invoiceDate: '2024-01-15',
    historicalScenario: 'price_set_first_time',
    oldPrice: null,
    newPrice: 22.00,
    changePercent: null,
    direction: 'initial',
    supplierName: 'Old Supplier Ltd.',
  };
}

// ── Suite 1: historical backfill never enters the 90-day section ──────────────

describe('Suitee price-context — historical backfill excluded from recent changes', () => {
  it('entry with isHistoricalBackfill:true classifies as historical_backfill', () => {
    expect(classifyEntry(historicalBackfillEntry(), NOW)).toBe('historical_backfill');
  });

  it('historical_backfill entry never reaches recentChanges, regardless of its date', () => {
    // The `date` field is serverTimestamp() — i.e. RIGHT NOW — which would otherwise
    // always pass the 90-day filter.
    const { recentChanges, historicalBackfills } = partitionEntries(
      [historicalBackfillEntry()],
      'Pinot Noir 750ml',
      NOW,
    );
    expect(recentChanges).toHaveLength(0);
    expect(historicalBackfills).toHaveLength(1);
  });

  it('historical_backfill entry lands in historicalBackfills with the correct product name', () => {
    const { historicalBackfills } = partitionEntries(
      [historicalBackfillEntry()],
      'Pinot Noir 750ml',
      NOW,
    );
    expect(historicalBackfills[0].productName).toBe('Pinot Noir 750ml');
    expect(historicalBackfills[0].entry.invoiceDate).toBe('2024-01-15');
    expect(historicalBackfills[0].entry.historicalScenario).toBe('price_set_first_time');
  });

  it('isHistoricalBackfill:false is treated as a live change, not a backfill', () => {
    const entry: PriceHistoryEntry = {
      ...liveTenDaysAgo(),
      isHistoricalBackfill: false,  // explicitly false
    };
    expect(classifyEntry(entry, NOW)).toBe('recent_change');
  });

  it('entry with no isHistoricalBackfill field is treated as a live change', () => {
    // The legacy path — fresh invoices never set this field
    const entry = liveTenDaysAgo();
    expect('isHistoricalBackfill' in entry).toBe(false);
    expect(classifyEntry(entry, NOW)).toBe('recent_change');
  });
});

// ── Suite 2: live changes completely unaffected (regression) ─────────────────

describe('Suitee price-context — live changes unaffected', () => {
  it('live change within 90 days classifies as recent_change', () => {
    expect(classifyEntry(liveTenDaysAgo(), NOW)).toBe('recent_change');
  });

  it('live change lands in recentChanges, not historicalBackfills', () => {
    const { recentChanges, historicalBackfills } = partitionEntries(
      [liveTenDaysAgo()],
      'Sauvignon Blanc',
      NOW,
    );
    expect(recentChanges).toHaveLength(1);
    expect(historicalBackfills).toHaveLength(0);
  });

  it('live change older than 90 days classifies as outside_window', () => {
    const old: PriceHistoryEntry = {
      date: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      oldPrice: 20,
      newPrice: 22,
      changePercent: 10,
      direction: 'increase',
    };
    expect(classifyEntry(old, NOW)).toBe('outside_window');
  });

  it('mixed list — live and historical entries partition correctly', () => {
    const { recentChanges, historicalBackfills } = partitionEntries(
      [liveTenDaysAgo(), historicalBackfillEntry(), liveTenDaysAgo()],
      'Chardonnay',
      NOW,
    );
    expect(recentChanges).toHaveLength(2);
    expect(historicalBackfills).toHaveLength(1);
  });
});

// ── Suite 3: historical section only appears when there is content ─────────────

describe('Suitee price-context — historical section only when non-empty', () => {
  it('no backfill entries → historicalBackfills is empty', () => {
    const { historicalBackfills } = partitionEntries(
      [liveTenDaysAgo()],
      'Product A',
      NOW,
    );
    expect(historicalBackfills).toHaveLength(0);
  });

  it('no live entries → recentChanges is empty', () => {
    const { recentChanges } = partitionEntries(
      [historicalBackfillEntry()],
      'Product B',
      NOW,
    );
    expect(recentChanges).toHaveLength(0);
  });

  it('completely empty entry list → both arrays empty', () => {
    const { recentChanges, historicalBackfills } = partitionEntries([], 'Product C', NOW);
    expect(recentChanges).toHaveLength(0);
    expect(historicalBackfills).toHaveLength(0);
  });

  it('multiple historical scenarios all classified as historical_backfill', () => {
    const price_protected: PriceHistoryEntry = {
      isHistoricalBackfill: true,
      date: NOW,
      historicalScenario: 'price_protected',
      invoiceDate: '2023-06-01',
    };
    const product_created: PriceHistoryEntry = {
      isHistoricalBackfill: true,
      date: NOW,
      historicalScenario: 'product_created',
      invoiceDate: '2023-07-15',
    };
    const { historicalBackfills } = partitionEntries(
      [price_protected, product_created],
      'Rum 700ml',
      NOW,
    );
    expect(historicalBackfills).toHaveLength(2);
  });
});

// ── B2 helpers mirroring the api.ts context-string building logic ─────────────────

/** Mirrors the summary line construction added for B2 truncation disclosure. */
function buildSummaryLine(recentChangesLength: number): string {
  const shownCount = Math.min(recentChangesLength, 8);
  const truncNote = recentChangesLength > 8 ? `, showing most recent ${shownCount}` : '';
  return `PRICE CHANGES (last 90 days): ${recentChangesLength} detected${truncNote}`;
}

type EntryLineArgs = {
  productName: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  supplierName: string;
  date: Date | null;
  historyFetchLimited: boolean;
};

/** Mirrors the per-entry line construction added for B2 per-product truncation note. */
function buildEntryLine(c: EntryLineArgs): string {
  const sign = c.changePercent >= 0 ? '+' : '';
  const dateStr = c.date ? c.date.toISOString().slice(0, 10) : '–';
  const histLimitNote = c.historyFetchLimited
    ? ' [history fetch limited to 3 entries; earlier changes may exist]'
    : '';
  return `  - ${c.productName}: $${c.oldPrice.toFixed(2)} → $${c.newPrice.toFixed(2)} (${sign}${c.changePercent.toFixed(1)}%) from ${c.supplierName} on ${dateStr}${histLimitNote}`;
}

// ── B2: summary line truncation disclosure ───────────────────────────────────────────

describe('B2: price-changes summary line truncation disclosure', () => {
  it('no "showing" note when all changes fit within the 8-entry limit', () => {
    const line = buildSummaryLine(3);
    expect(line).toBe('PRICE CHANGES (last 90 days): 3 detected');
    expect(line).not.toContain('showing');
  });

  it('no "showing" note at exactly 8 changes', () => {
    const line = buildSummaryLine(8);
    expect(line).toBe('PRICE CHANGES (last 90 days): 8 detected');
    expect(line).not.toContain('showing');
  });

  it('adds "showing most recent 8" note when detected > 8', () => {
    const line = buildSummaryLine(12);
    expect(line).toBe('PRICE CHANGES (last 90 days): 12 detected, showing most recent 8');
  });

  it('total count is the full detected count, not the shown count', () => {
    const line = buildSummaryLine(15);
    expect(line).toContain('15 detected');
    expect(line).toContain('showing most recent 8');
  });
});

// ── B2: per-entry history-fetch truncation disclosure ────────────────────────

describe('B2: per-entry history-fetch truncation note', () => {
  const entry: EntryLineArgs = {
    productName: 'Sauvignon Blanc 750ml',
    oldPrice: 25.00,
    newPrice: 27.50,
    changePercent: 10,
    supplierName: 'Fresh Wines Co.',
    date: NOW,
    historyFetchLimited: false,
  };

  it('no truncation note when historyFetchLimited is false', () => {
    const line = buildEntryLine({ ...entry, historyFetchLimited: false });
    expect(line).not.toContain('limited');
    expect(line).not.toContain('earlier changes');
  });

  it('appends truncation note when historyFetchLimited is true', () => {
    const line = buildEntryLine({ ...entry, historyFetchLimited: true });
    expect(line).toContain('[history fetch limited to 3 entries; earlier changes may exist]');
  });

  it('entry line format is unchanged when not truncated', () => {
    const line = buildEntryLine({ ...entry, historyFetchLimited: false });
    const dateStr = NOW.toISOString().slice(0, 10);
    expect(line).toBe(`  - Sauvignon Blanc 750ml: $25.00 → $27.50 (+10.0%) from Fresh Wines Co. on ${dateStr}`);
  });

  it('entry line with truncation note has correct format', () => {
    const line = buildEntryLine({ ...entry, historyFetchLimited: true });
    const dateStr = NOW.toISOString().slice(0, 10);
    expect(line).toBe(`  - Sauvignon Blanc 750ml: $25.00 → $27.50 (+10.0%) from Fresh Wines Co. on ${dateStr} [history fetch limited to 3 entries; earlier changes may exist]`);
  });
});
