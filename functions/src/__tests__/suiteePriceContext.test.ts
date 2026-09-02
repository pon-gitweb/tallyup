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
