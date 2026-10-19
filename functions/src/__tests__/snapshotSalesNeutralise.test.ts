import {
  neutraliseItems,
  recomputeSummary,
  neutraliseDataCompleteness,
  planNeutralise,
} from "../snapshotSalesNeutralise";
import {
  neutraliseSnapshotTransaction,
  syncLatest,
} from "../snapshotNeutraliseTrigger";

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

  it("hasUnexplainedLoss is false (−1.3 does not cross −2 threshold)", () => {
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

// ── neutraliseDataCompleteness ────────────────────────────────────────────────

describe("neutraliseDataCompleteness", () => {
  const baseDC = {
    hasBaseline: true,
    hasInvoices: true,
    hasSales: true,
    hasRecipes: false,
    hasWastage: false,
    hasPrices: true,
    tier: 3,
    pricedItemPercent: 80,
    invoiceCoverage: 0,
    salesCoverage: 0,
  };

  it("tier 3 becomes 2 when hasInvoices is true", () => {
    const dc = neutraliseDataCompleteness(baseDC);
    expect(dc.tier).toBe(2);
    expect(dc.hasSales).toBe(false);
  });

  it("tier 3 becomes 1 when hasInvoices is false", () => {
    const dc = neutraliseDataCompleteness({ ...baseDC, hasInvoices: false });
    expect(dc.tier).toBe(1);
    expect(dc.hasSales).toBe(false);
  });

  it("other keys (hasBaseline, hasPrices, pricedItemPercent) are preserved", () => {
    const dc = neutraliseDataCompleteness(baseDC);
    expect(dc.hasBaseline).toBe(true);
    expect(dc.hasPrices).toBe(true);
    expect(dc.pricedItemPercent).toBe(80);
  });
});

// ── planNeutralise — dataCompleteness ─────────────────────────────────────────

describe("planNeutralise — dataCompleteness neutralised", () => {
  const item = makeItem({ soldQty: 10, openingCount: 5, actualClosing: 3, costPrice: null });
  const dc = { hasBaseline: true, hasInvoices: true, hasSales: true, hasPrices: false, tier: 3, pricedItemPercent: 0, invoiceCoverage: 0, salesCoverage: 0 };

  it("correctedDataCompleteness has hasSales:false and tier:2 (invoices present)", () => {
    const plan = planNeutralise({ items: [item], itemChunkCount: 0, dataCompleteness: dc, summary: {} }, []);
    expect(plan.noop).toBeUndefined();
    expect(plan.correctedDataCompleteness?.hasSales).toBe(false);
    expect(plan.correctedDataCompleteness?.tier).toBe(2);
  });

  it("docUpdate includes dataCompleteness", () => {
    const plan = planNeutralise({ items: [item], itemChunkCount: 0, dataCompleteness: dc, summary: {} }, []);
    expect(plan.docUpdate?.dataCompleteness).toBeDefined();
    expect(plan.docUpdate?.dataCompleteness?.tier).toBe(2);
  });

  it("tier becomes 1 when no invoices", () => {
    const noInvoiceDC = { ...dc, hasInvoices: false };
    const plan = planNeutralise({ items: [item], itemChunkCount: 0, dataCompleteness: noInvoiceDC, summary: {} }, []);
    expect(plan.correctedDataCompleteness?.tier).toBe(1);
  });

  it("absent dataCompleteness stays absent from docUpdate", () => {
    const plan = planNeutralise({ items: [item], itemChunkCount: 0, summary: {} }, []);
    expect(plan.docUpdate?.dataCompleteness).toBeUndefined();
    expect(plan.correctedDataCompleteness).toBeUndefined();
  });
});

describe("planNeutralise — findings and recommendations NOT in docUpdate", () => {
  const item = makeItem({ soldQty: 5, openingCount: 1, actualClosing: 8, costPrice: null, totalVarianceQty: 7 });

  it("docUpdate does not contain findings", () => {
    const plan = planNeutralise({ items: [item], itemChunkCount: 0, summary: {}, findings: { likelyMissingInvoices: [] } }, []);
    expect("findings" in (plan.docUpdate ?? {})).toBe(false);
  });

  it("docUpdate does not contain recommendations", () => {
    const plan = planNeutralise({ items: [item], itemChunkCount: 0, summary: {}, recommendations: [] }, []);
    expect("recommendations" in (plan.docUpdate ?? {})).toBe(false);
  });
});

// ── planNeutralise — idempotency: second run is noop ─────────────────────────

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

// ── syncLatest ────────────────────────────────────────────────────────────────

function makeFakeDb(
  docs: Record<string, any>,
  writes: Array<{ path: string; data: any; op: string }>,
) {
  function refFor(path: string) {
    const ref: any = {
      _path: path,
      collection: (seg: string) => refFor(`${path}/${seg}`),
      doc: (seg: string) => refFor(`${path}/${seg}`),
    };
    return ref;
  }

  const fakeDb: any = {
    collection: (seg: string) => ({
      doc: (id: string) => refFor(`${seg}/${id}`),
    }),
    runTransaction: async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        get: async (ref: any) => {
          const path = ref._path;
          const data = docs[path];
          return {
            exists: data !== undefined,
            id: path.split("/").pop(),
            data: () => (data ?? {}),
          };
        },
        update: (ref: any, data: any) => {
          writes.push({ path: ref._path, data, op: "update" });
        },
        set: (ref: any, data: any, opts?: any) => {
          writes.push({ path: ref._path, data, op: opts?.merge ? "set-merge" : "set" });
        },
      };
      await fn(tx);
    },
  };
  return fakeDb;
}

describe("syncLatest — array shape, two departments", () => {
  const neutralisedSnap = {
    soldQtyNeutralisedAt: { toMillis: () => 1 },
    summary: { unexplainedVarianceQty: 0, unexplainedVarianceDollars: 0, displayUnexplainedVarianceDollars: null },
    dataCompleteness: { hasSales: false, tier: 2, hasInvoices: true },
  };
  const untouchedSnap = {
    // no soldQtyNeutralisedAt
    summary: { unexplainedVarianceQty: -50, unexplainedVarianceDollars: -500 },
    dataCompleteness: { hasSales: true, tier: 3 },
  };
  const latestDoc = {
    departments: [
      { departmentId: "dept-a", departmentName: "Bar",    cycleNumber: 2,
        summary: { unexplainedVarianceQty: 900, unexplainedVarianceDollars: 9000 },
        dataCompleteness: { hasSales: true, tier: 3 } },
      { departmentId: "dept-b", departmentName: "Cellar", cycleNumber: 1,
        summary: { unexplainedVarianceQty: -50, unexplainedVarianceDollars: -500 },
        dataCompleteness: { hasSales: true, tier: 3 } },
    ],
    totalDepts: 2,
    deptsWithData: 2,
  };

  const docs: Record<string, any> = {
    "venues/v1/latestSnapshot/current": latestDoc,
    "venues/v1/departments/dept-a/snapshots/cycle-2": neutralisedSnap,
    "venues/v1/departments/dept-b/snapshots/cycle-1": untouchedSnap,
  };

  it("only the neutralised entry changes, result is still an array in original order", async () => {
    const writes: any[] = [];
    const db = makeFakeDb(docs, writes);
    await syncLatest(db, "v1");

    expect(writes).toHaveLength(1);
    const update = writes[0];
    expect(update.op).toBe("update");
    // departments is still an array
    expect(Array.isArray(update.data.departments)).toBe(true);
    expect(update.data.departments).toHaveLength(2);
    // order preserved: dept-a first
    expect(update.data.departments[0].departmentId).toBe("dept-a");
    expect(update.data.departments[1].departmentId).toBe("dept-b");
    // dept-a updated
    expect(update.data.departments[0].summary.unexplainedVarianceQty).toBe(0);
    // dept-b unchanged
    expect(update.data.departments[1].summary.unexplainedVarianceQty).toBe(-50);
  });

  it("no write when already in sync", async () => {
    const inSyncLatest = {
      departments: [
        { departmentId: "dept-a", departmentName: "Bar", cycleNumber: 2,
          summary: { unexplainedVarianceQty: 0, unexplainedVarianceDollars: 0, displayUnexplainedVarianceDollars: null },
          dataCompleteness: { hasSales: false, tier: 2, hasInvoices: true } },
      ],
    };
    const inSyncDocs: Record<string, any> = {
      "venues/v1/latestSnapshot/current": inSyncLatest,
      "venues/v1/departments/dept-a/snapshots/cycle-2": neutralisedSnap,
    };
    const writes: any[] = [];
    const db = makeFakeDb(inSyncDocs, writes);
    await syncLatest(db, "v1");
    expect(writes).toHaveLength(0);
  });
});

// ── neutraliseSnapshotTransaction — fake transaction ─────────────────────────

describe("neutraliseSnapshotTransaction — fake transaction", () => {
  const snapshotPath = "venues/v1/departments/d1/snapshots/cycle-3";

  function makeSnapDoc(items: any[], itemChunkCount = 0, soldQtyNeutralisedAt: any = null) {
    return { items, itemChunkCount, summary: {}, soldQtyNeutralisedAt };
  }

  it("second run after neutralising does not write (noop)", async () => {
    // Items with null soldQty (already neutralised)
    const docData = makeSnapDoc([makeItem({ soldQty: null })], 0, null);
    const writes: any[] = [];
    const db = makeFakeDb({ [snapshotPath]: docData }, writes);
    const outcome = await neutraliseSnapshotTransaction(db, "v1", "d1", "cycle-3");
    expect(outcome).toBe("noop");
    expect(writes).toHaveLength(0);
  });

  it("doc rewritten with soldQty after neutralising is neutralised again", async () => {
    // Simulates a client re-writing soldQty after a neutralise
    const docData = makeSnapDoc([makeItem({ soldQty: 50, openingCount: 0, actualClosing: 0, costPrice: null })], 0, null);
    const writes: any[] = [];
    const db = makeFakeDb({ [snapshotPath]: docData }, writes);
    const outcome = await neutraliseSnapshotTransaction(db, "v1", "d1", "cycle-3");
    expect(outcome).toBe("written");
    expect(writes).toHaveLength(1);
    expect(writes[0].data.soldQtyNeutralisedAt).toBeDefined();
  });

  it("chunk-count mismatch aborts and writes nothing", async () => {
    // itemChunkCount says 2 but chunk docs aren't all present
    const docData = makeSnapDoc([], 2, null);
    // Only chunk 000 exists
    const docs: Record<string, any> = {
      [snapshotPath]: docData,
      [`${snapshotPath}/itemChunks/000`]: { index: 0, items: [makeItem({ soldQty: 5 })] },
      // 001 missing
    };
    const writes: any[] = [];
    const db = makeFakeDb(docs, writes);
    const outcome = await neutraliseSnapshotTransaction(db, "v1", "d1", "cycle-3");
    expect(outcome).toBe("abort");
    expect(writes).toHaveLength(0);
  });
});
