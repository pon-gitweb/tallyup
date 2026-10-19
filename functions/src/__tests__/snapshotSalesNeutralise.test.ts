import {
  neutraliseItems,
  recomputeSummary,
  planNeutralise,
} from "../snapshotSalesNeutralise";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    productId: "prod-1",
    name: "Test Product",
    openingCount: 0,
    actualClosing: 0,
    receivedQty: 0,
    totalVarianceQty: 0,
    totalVarianceDollars: null,
    costPrice: null,
    soldQty: null,
    expectedClosing: 0,
    unexplainedVarianceQty: 0,
    unexplainedVarianceDollars: null,
    hasUnexplainedLoss: false,
    hasUnexplainedGain: false,
    likelyMissingInvoice: false,
    ...overrides,
  };
}

// ── neutraliseItems ───────────────────────────────────────────────────────────

describe("neutraliseItems — Andre Clouet example", () => {
  // opening 0, actualClosing 0, soldQty 875, cost 51
  // When soldQty=875 was added: expectedClosing = 0 + 0 − 875 = −875
  // After neutralise: soldQty null, expectedClosing = 0 + 0 = 0, unexplainedVarianceQty = 0
  const item = makeItem({
    openingCount: 0,
    actualClosing: 0,
    receivedQty: 0,
    soldQty: 875,
    costPrice: 51,
    expectedClosing: -875,
    unexplainedVarianceQty: 875,
    unexplainedVarianceDollars: 875 * 51,
    totalVarianceQty: 0,
  });

  it("sets soldQty to null", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].soldQty).toBeNull();
  });

  it("recomputes expectedClosing to opening + received (0)", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].expectedClosing).toBe(0);
  });

  it("recomputes unexplainedVarianceQty to 0", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].unexplainedVarianceQty).toBe(0);
  });

  it("recomputes unexplainedVarianceDollars to 0", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].unexplainedVarianceDollars).toBe(0);
  });

  it("changedCount is 1", () => {
    const { changedCount } = neutraliseItems([item]);
    expect(changedCount).toBe(1);
  });
});

describe("neutraliseItems — Tanqueray example", () => {
  // opening 3.2, actualClosing 1.9, soldQty 240 (units were wrong), cost 45.95
  // After: soldQty null, expectedClosing = 3.2 + 0 = 3.2, unexplainedVarianceQty = 1.9 − 3.2 = −1.3
  const item = makeItem({
    openingCount: 3.2,
    actualClosing: 1.9,
    receivedQty: 0,
    soldQty: 240,
    costPrice: 45.95,
    expectedClosing: 3.2 - 240,
    unexplainedVarianceQty: 1.9 - (3.2 - 240),
    totalVarianceQty: 1.9 - 3.2,
  });

  it("unexplainedVarianceQty is -1.3 after neutralise", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].unexplainedVarianceQty).toBeCloseTo(-1.3, 5);
  });

  it("hasUnexplainedLoss is true (< -2 threshold not met, so false)", () => {
    // −1.3 is not < −2
    const { items } = neutraliseItems([item]);
    expect(items[0].hasUnexplainedLoss).toBe(false);
  });
});

describe("neutraliseItems — openingCount null item", () => {
  const item = makeItem({
    openingCount: null,
    actualClosing: 2,
    soldQty: 5,
    totalVarianceQty: 3,
    totalVarianceDollars: 60,
    costPrice: 20,
    expectedClosing: -3,
    unexplainedVarianceQty: 5,
  });

  it("soldQty becomes null", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].soldQty).toBeNull();
  });

  it("uses totalVarianceQty for unexplainedVarianceQty when openingCount null", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].unexplainedVarianceQty).toBe(3);
    expect(items[0].unexplainedVarianceDollars).toBe(60);
  });
});

describe("neutraliseItems — costPrice null", () => {
  const item = makeItem({
    openingCount: 5,
    actualClosing: 3,
    receivedQty: 0,
    soldQty: 10,
    costPrice: null,
    expectedClosing: 5 - 10,
    unexplainedVarianceQty: 3 - (5 - 10),
    unexplainedVarianceDollars: null,
  });

  it("unexplainedVarianceDollars stays null when costPrice null", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0].unexplainedVarianceDollars).toBeNull();
  });
});

describe("neutraliseItems — displayCostPrice present", () => {
  const item = makeItem({
    openingCount: 6,
    actualClosing: 4,
    receivedQty: 0,
    soldQty: 8,
    costPrice: 10,
    displayCostPrice: 12,
    expectedClosing: 6 - 8,
    unexplainedVarianceQty: 4 - (6 - 8),
    unexplainedVarianceDollars: (4 - (6 - 8)) * 10,
    displayUnexplainedVarianceDollars: (4 - (6 - 8)) * 12,
  });

  it("displayUnexplainedVarianceDollars is recomputed after neutralise", () => {
    const { items } = neutraliseItems([item]);
    // After: expectedClosing = 6+0 = 6, unexplainedVarianceQty = 4−6 = −2
    expect(items[0].unexplainedVarianceQty).toBe(-2);
    expect(items[0].displayUnexplainedVarianceDollars).toBeCloseTo(-2 * 12, 5);
  });
});

describe("neutraliseItems — item with null soldQty is unchanged", () => {
  const item = makeItem({ soldQty: null });

  it("changedCount is 0", () => {
    const { changedCount } = neutraliseItems([item]);
    expect(changedCount).toBe(0);
  });

  it("item object is unchanged (same reference)", () => {
    const { items } = neutraliseItems([item]);
    expect(items[0]).toBe(item);
  });
});

// ── recomputeSummary ──────────────────────────────────────────────────────────

describe("recomputeSummary", () => {
  it("sums unexplainedVarianceQty across items", () => {
    const items = [
      makeItem({ unexplainedVarianceQty: 2, costPrice: 10, unexplainedVarianceDollars: 20 }),
      makeItem({ unexplainedVarianceQty: -3, costPrice: 10, unexplainedVarianceDollars: -30 }),
    ];
    const { summary } = recomputeSummary({ totalVarianceDollars: 999 }, items);
    expect(summary.unexplainedVarianceQty).toBe(-1);
    expect(summary.unexplainedVarianceDollars).toBeCloseTo(-10, 5);
  });

  it("unexplainedVarianceDollars is null when no item has costPrice", () => {
    const items = [makeItem({ unexplainedVarianceQty: 2, costPrice: null, unexplainedVarianceDollars: null })];
    const { summary } = recomputeSummary({}, items);
    expect(summary.unexplainedVarianceDollars).toBeNull();
  });

  it("displayUnexplainedVarianceDollars is null when no item has displayCostPrice", () => {
    const items = [makeItem({ unexplainedVarianceQty: 2 })];
    const { summary } = recomputeSummary({}, items);
    expect(summary.displayUnexplainedVarianceDollars).toBeNull();
  });

  it("preserves other summary fields", () => {
    const items = [makeItem({ unexplainedVarianceQty: 1, costPrice: null })];
    const { summary } = recomputeSummary({ totalVarianceDollars: 42, someOtherField: true }, items);
    expect(summary.totalVarianceDollars).toBe(42);
    expect(summary.someOtherField).toBe(true);
  });
});

// ── planNeutralise ────────────────────────────────────────────────────────────

describe("planNeutralise — idempotency: second run is noop", () => {
  const item = makeItem({ soldQty: null });
  const docData = { items: [item], itemChunkCount: 0 };

  it("returns noop when no item has numeric soldQty", () => {
    const plan = planNeutralise(docData, []);
    expect(plan.noop).toBe(true);
  });
});

describe("planNeutralise — chunk count mismatch aborts", () => {
  const docData = { itemChunkCount: 3, items: [], summary: {} };
  const chunks = [
    { id: "000", index: 0, items: [makeItem({ soldQty: 5 })] },
    { id: "001", index: 1, items: [] },
    // only 2 provided, but itemChunkCount=3
  ];

  it("aborts with descriptive message", () => {
    const plan = planNeutralise(docData, chunks as any);
    expect(plan.abort).toContain("itemChunkCount=3");
    expect(plan.abort).toContain("received 2");
  });
});

describe("planNeutralise — non-contiguous chunk indices abort", () => {
  const docData = { itemChunkCount: 2, items: [], summary: {} };
  const chunks = [
    { id: "000", index: 0, items: [makeItem({ soldQty: 5 })] },
    { id: "001", index: 2, items: [] }, // index 2 instead of 1
  ];

  it("aborts", () => {
    const plan = planNeutralise(docData, chunks as any);
    expect(plan.abort).toBeTruthy();
  });
});

describe("planNeutralise — inline items (no chunks)", () => {
  const items = Array.from({ length: 5 }, (_, i) =>
    makeItem({ productId: `p${i}`, soldQty: i > 0 ? i * 10 : null }),
  );
  const docData = { items, itemChunkCount: 0, summary: { unexplainedVarianceQty: 999 } };

  it("corrects items and returns correctedSummary", () => {
    const plan = planNeutralise(docData, []);
    expect(plan.noop).toBeUndefined();
    expect(plan.correctedSummary).toBeDefined();
    expect(plan.inlineItems).toHaveLength(5);
    plan.inlineItems!.forEach(it => {
      expect(it.soldQty).toBeNull();
    });
  });
});

describe("planNeutralise — inline equals first 200 when 364 items", () => {
  const items = Array.from({ length: 364 }, (_, i) =>
    makeItem({ productId: `p${i}`, soldQty: 1 }),
  );
  // Build 2 chunks of 200 and 164
  const chunks = [
    { id: "000", index: 0, items: items.slice(0, 200) },
    { id: "001", index: 1, items: items.slice(200) },
  ];
  const docData = { itemChunkCount: 2, items: items.slice(0, 200), summary: {} };

  it("inlineItems has exactly 200 items", () => {
    const plan = planNeutralise(docData, chunks);
    expect(plan.inlineItems).toHaveLength(200);
  });

  it("correctedChunks has 2 entries covering all 364", () => {
    const plan = planNeutralise(docData, chunks);
    expect(plan.correctedChunks).toHaveLength(2);
    const totalItems = plan.correctedChunks!.reduce((s, c) => s + c.items.length, 0);
    expect(totalItems).toBe(364);
  });
});

describe("planNeutralise — legacy no-chunk doc (< 200 items inline)", () => {
  const items = Array.from({ length: 50 }, (_, i) =>
    makeItem({ productId: `p${i}`, soldQty: i % 5 === 0 ? 3 : null }),
  );
  const docData = { itemChunkCount: 0, items, summary: { unexplainedVarianceDollars: 500 } };

  it("corrects items and correctedChunks is empty", () => {
    const plan = planNeutralise(docData, []);
    expect(plan.correctedChunks).toHaveLength(0);
    expect(plan.inlineItems).toHaveLength(50);
    plan.inlineItems!.forEach(it => expect(it.soldQty).toBeNull());
  });
});
