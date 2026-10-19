/**
 * Pure functions to neutralise salesReport-derived soldQty that was incorrectly
 * summed into snapshot items by the mobile snapshotWriter (step A2).
 *
 * No Firebase imports — all Firestore I/O is in the caller (snapshotNeutraliseTrigger.ts).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NeutraliseResult {
  items: any[];
  changedCount: number;
}

export interface SummaryRecomputeResult {
  summary: Record<string, any>;
}

export interface PlanResult {
  abort?: string;
  noop?: true;
  docUpdate?: Record<string, any>;
  inlineItems?: any[];
  correctedChunks?: Array<{ id: string; index: number; items: any[] }>;
  correctedSummary?: Record<string, any>;
  correctedDataCompleteness?: Record<string, any>;
}

// ── Helper: recompute all fields derived from soldQty for a single item ───────
//
// Field derivation mirrors snapshotWriter.ts exactly:
//
// Post-enrichment block (snapshotWriter.ts:248–254):
//   expectedClosing = openingCount + (receivedQty || 0) - (soldQty ?? 0)
//   unexplainedVarianceQty = actualClosing - expectedClosing
//   unexplainedVarianceDollars = costPrice != null ? unexplainedVarianceQty * costPrice : null
//
// Pricing tier block (snapshotWriter.ts:268–283):
//   displayUnexplainedVarianceDollars = displayCostPrice != null
//     ? unexplainedVarianceQty * displayCostPrice : null
//
// Flags (snapshotWriter.ts:287–303):
//   likelyMissingInvoice = totalVarianceQty > 2 && receivedQty === 0 && openingCount != null
//   hasUnexplainedGain   = likelyMissingInvoice  (set in same block)
//   hasUnexplainedLoss   = unexplainedVarianceQty < -2 && openingCount != null

function recomputeItem(item: any): any {
  const out = { ...item, soldQty: null };

  if (out.openingCount != null) {
    // snapshotWriter.ts:250
    out.expectedClosing = out.openingCount + (out.receivedQty || 0);
    // snapshotWriter.ts:251
    out.unexplainedVarianceQty = out.actualClosing - out.expectedClosing;
    // snapshotWriter.ts:252–253
    out.unexplainedVarianceDollars = out.costPrice != null
      ? out.unexplainedVarianceQty * out.costPrice : null;
  } else {
    // openingCount null: revert to initialised defaults (snapshotWriter.ts:148–157)
    out.expectedClosing = null;
    // unexplainedVarianceQty = totalVarianceQty (snapshotWriter.ts:153)
    out.unexplainedVarianceQty = out.totalVarianceQty ?? 0;
    out.unexplainedVarianceDollars = out.totalVarianceDollars ?? null;
  }

  // Pricing tier block — displayUnexplainedVarianceDollars (snapshotWriter.ts:281–282)
  if ('displayCostPrice' in item) {
    out.displayUnexplainedVarianceDollars = out.displayCostPrice != null
      ? out.unexplainedVarianceQty * out.displayCostPrice : null;
  }

  // Flags (snapshotWriter.ts:287–303)
  const totalVarianceQty = out.totalVarianceQty ?? 0;
  const likelyMissingInvoice = (
    totalVarianceQty > 2 && (out.receivedQty ?? 0) === 0 && out.openingCount != null
  );
  out.likelyMissingInvoice = likelyMissingInvoice;
  out.hasUnexplainedGain = likelyMissingInvoice;
  out.hasUnexplainedLoss = out.unexplainedVarianceQty < -2 && out.openingCount != null;

  return out;
}

// ── a) neutraliseItems ────────────────────────────────────────────────────────

export function neutraliseItems(items: any[]): NeutraliseResult {
  let changedCount = 0;
  const result = items.map(item => {
    if (typeof item.soldQty !== 'number') return item;
    changedCount++;
    return recomputeItem(item);
  });
  return { items: result, changedCount };
}

// ── b) recomputeSummary ───────────────────────────────────────────────────────
//
// Recomputes the three unexplained fields exactly as snapshotWriter.ts:740–803.
// hasPrices rule: snapshotWriter.ts:740 — only non-null when any item has costPrice != null.
// display rule: snapshotWriter.ts:801 — only non-null when any item has displayCostPrice != null.

export function recomputeSummary(
  summary: Record<string, any>,
  items: any[],
): SummaryRecomputeResult {
  const hasPrices = items.some(si => si.costPrice != null);
  const hasDisplay = items.some(si => si.displayCostPrice != null);

  // snapshotWriter.ts:785
  const unexplainedVarianceQty = items.reduce(
    (s, si) => s + (si.unexplainedVarianceQty ?? 0), 0,
  );
  // snapshotWriter.ts:740–742
  const unexplainedVarianceDollars = hasPrices
    ? items.reduce((s, si) => s + (si.unexplainedVarianceDollars ?? 0), 0)
    : null;
  // snapshotWriter.ts:801–803
  const displayUnexplainedVarianceDollars = hasDisplay
    ? items.reduce((s, si) => s + (si.displayUnexplainedVarianceDollars ?? 0), 0)
    : null;

  return {
    summary: {
      ...summary,
      unexplainedVarianceQty,
      unexplainedVarianceDollars,
      displayUnexplainedVarianceDollars,
    },
  };
}

// ── c) neutraliseDataCompleteness ─────────────────────────────────────────────
//
// Reflects that sold data is gone: hasSales → false, tier recalculated.
// All other keys (hasBaseline, hasInvoices, hasPrices, etc.) are unchanged.
// snapshotWriter.ts:752-763: tier = hasSales ? 3 : hasInvoices ? 2 : 1

export function neutraliseDataCompleteness(
  dc: Record<string, any>,
): Record<string, any> {
  return {
    ...dc,
    hasSales: false,
    tier: dc.hasInvoices ? 2 : 1,
  };
}

// ── d) planNeutralise ─────────────────────────────────────────────────────────

export function planNeutralise(
  docData: Record<string, any>,
  chunkDocs: Array<{ id: string; index: number; items: any[] }>,
): PlanResult {
  const itemChunkCount: number = docData.itemChunkCount ?? 0;

  // Validate chunks when the doc declares them
  if (itemChunkCount > 0) {
    if (chunkDocs.length !== itemChunkCount) {
      return { abort: `itemChunkCount=${itemChunkCount} but received ${chunkDocs.length} chunk docs` };
    }
    // Check indices are contiguous 0..n-1
    const sorted = [...chunkDocs].sort((a, b) => a.index - b.index);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].index !== i) {
        return { abort: `chunk indices not contiguous 0..${itemChunkCount - 1}: found index ${sorted[i].index} at position ${i}` };
      }
    }
  }

  // Build the full item list
  const fullItems: any[] =
    itemChunkCount > 0
      ? chunkDocs
          .slice()
          .sort((a, b) => a.index - b.index)
          .flatMap(c => c.items)
      : (docData.items ?? []);

  // Check whether any item has a numeric soldQty
  const hasNumericSoldQty = fullItems.some(it => typeof it.soldQty === 'number');
  if (!hasNumericSoldQty) {
    return { noop: true };
  }

  // Correct all items
  const { items: correctedItems } = neutraliseItems(fullItems);

  // Inline items = first 200 (snapshotWriter.ts:813)
  const inlineItems = correctedItems.slice(0, 200);

  // Corrected chunks — same ids and indices as input
  const correctedChunks: Array<{ id: string; index: number; items: any[] }> = [];
  if (itemChunkCount > 0) {
    const sorted = [...chunkDocs].sort((a, b) => a.index - b.index);
    let offset = 0;
    for (const chunk of sorted) {
      const len = chunk.items.length;
      correctedChunks.push({
        id: chunk.id,
        index: chunk.index,
        items: correctedItems.slice(offset, offset + len),
      });
      offset += len;
    }
  }

  // Corrected summary
  const { summary: correctedSummary } = recomputeSummary(
    docData.summary ?? {},
    correctedItems,
  );

  // Corrected dataCompleteness (absent → stays absent)
  const correctedDataCompleteness = docData.dataCompleteness
    ? neutraliseDataCompleteness(docData.dataCompleteness)
    : undefined;

  // docUpdate: fields to merge into the snapshot doc
  const docUpdate: Record<string, any> = {
    summary: correctedSummary,
    items: inlineItems,
    // soldQtyNeutralisedAt set by caller with a server timestamp
  };
  if (correctedDataCompleteness !== undefined) {
    docUpdate.dataCompleteness = correctedDataCompleteness;
  }

  return {
    docUpdate,
    inlineItems,
    correctedChunks,
    correctedSummary,
    correctedDataCompleteness,
  };
}
