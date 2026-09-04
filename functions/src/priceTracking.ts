import * as admin from "firebase-admin";
import { classifyLine, summarizeExcludedLines, ExcludedLineSummary } from './classifyLine';
import { tokenizeForMatching, overlapCoefficient, isReliableMatch } from "./nameMatching";

export interface InvoiceLine {
  name: string;
  qty: number;
  unitPrice?: number;
  caseSize?: number | null;
}

export interface PriceTrackingOptions {
  venueId: string;
  lines: InvoiceLine[];
  supplierId?: string;
  supplierName?: string;
  invoiceId?: string;
  invoiceDocId?: string;
}

export interface HistoricalPriceTrackingOptions extends PriceTrackingOptions {
  /** The invoice's actual date string (YYYY-MM-DD or ISO). Stamped on every
   *  invoiceHistory entry and included in the priceChangeFlags conflict record. */
  invoiceDate?: string | null;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function namesMatch(a: string, b: string): { isMatch: boolean; score: number } {
  const ta = tokenizeForMatching(a);
  const tb = tokenizeForMatching(b);
  const score = overlapCoefficient(a, b);
  return { isMatch: isReliableMatch(ta, tb, score), score };
}

/** Returns the correct caseSize/unitCost/caseCost fields for a product or supplier-link
 * document update. perUnitPrice is already per-unit â the OCR extraction prompt divides
 * the case total by caseSize before returning unitPrice, so no further division is needed.
 * caseCost is the actual case total (perUnitPrice Ã cs).
 * Returns {} when cs is null/falsy.
 */
function computeCaseSizeFields(
  perUnitPrice: number | null,
  cs: number | null,
): Record<string, number | null> {
  if (!cs) return {};
  return {
    caseSize: cs,
    unitCost: perUnitPrice,
    caseCost: perUnitPrice != null ? perUnitPrice * cs : null,
  };
}

// ---------------------------------------------------------------------------
// Propose / commit split â replaces trackPriceChanges once callers are migrated
// ---------------------------------------------------------------------------

/**
 * Shape-builder for per-supplier `invoiceHistory` subcollection entries.
 * `lineTotal` is computed internally (unitCost Ã qty, rounded to 2 dp).
 * Optional fields (oldPrice, changePercent, direction, note) are omitted from
 * the output when not supplied rather than written as `undefined`.
 */
function buildInvoiceHistoryEntry(opts: {
  invoiceId: string;
  productId: string;
  productName: string;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: number;
  qty: number;
  caseSize: number | null;
  type: 'priceChange' | 'firstTime' | 'samePriceTouch' | 'nearDuplicate' | 'newProduct' | 'supplierLink';
  wasPreferredSupplier: boolean | null;
  oldPrice?: number | null;
  changePercent?: number | null;
  direction?: 'increase' | 'decrease' | 'initial';
  note?: string;
}): Record<string, unknown> {
  const lineTotal = Math.round(opts.unitCost * opts.qty * 100) / 100;
  const entry: Record<string, unknown> = {
    date: admin.firestore.FieldValue.serverTimestamp(),
    invoiceId: opts.invoiceId,
    productId: opts.productId,
    productName: opts.productName,
    supplierId: opts.supplierId,
    supplierName: opts.supplierName,
    unitCost: opts.unitCost,
    qty: opts.qty,
    caseSize: opts.caseSize,
    lineTotal,
    type: opts.type,
    wasPreferredSupplier: opts.wasPreferredSupplier,
  };
  if (opts.oldPrice !== undefined) entry.oldPrice = opts.oldPrice;
  if (opts.changePercent !== undefined) entry.changePercent = opts.changePercent;
  if (opts.direction !== undefined) entry.direction = opts.direction;
  if (opts.note !== undefined) entry.note = opts.note;
  return entry;
}

/**
 * Computes a new periodic weighted-average cost from the product's current
 * quantity basis + price and a new purchase. See
 * price-provenance-supplier-history-scope.md Â§8/Â§8a â this is the corrected
 * model: a genuine new price from ANY supplier must move the canonical cost,
 * blended by how much of each cost is actually on hand, not gated by whether
 * the supplier is the preferred one.
 *
 * When priorQty is 0 (nothing on hand, or a product/legacy-basis with no
 * prior recompute at all), this correctly collapses to the trivial
 * first-ever-price case: the new price becomes the cost outright, with no
 * special-casing needed.
 */
function computeWeightedAverageCost(
  priorQty: number,
  priorPrice: number | null,
  newQty: number,
  newPrice: number,
): { blendedPrice: number; newQuantityBasis: number } {
  // If there's no known prior price, there's no valid prior cost basis to
  // blend against â treat the prior quantity as 0 too, rather than silently
  // assuming unpriced stock cost $0 (which would wrongly drag the blended
  // average toward zero instead of correctly collapsing to just newPrice).
  const hasValidPriorPrice = typeof priorPrice === "number" && priorPrice > 0;
  const safePriorQty = hasValidPriorPrice ? Math.max(0, priorQty || 0) : 0;
  const safePriorPrice = hasValidPriorPrice ? (priorPrice as number) : 0;
  const safeNewQty = Math.max(0, newQty || 0);
  const totalQty = safePriorQty + safeNewQty;
  if (totalQty <= 0) {
    return { blendedPrice: newPrice, newQuantityBasis: safeNewQty };
  }
  const blendedPrice = (safePriorQty * safePriorPrice + safeNewQty * newPrice) / totalQty;
  return {
    blendedPrice: Math.round(blendedPrice * 10000) / 10000,
    newQuantityBasis: totalQty,
  };
}

/**
 * Checks whether any pre-fetched salesReports document's period overlaps the
 * window [since, now]. Reuses the exact overlap-check pattern
 * snapshotWriter.ts already established for cycle-scoped sales enrichment
 * (see Â§8a) â investigated directly rather than assumed, since salesReports
 * already stores each report's own period independent of any stocktake
 * cycle, so the same logic answers this new question for free.
 * Venue-level: confirms SOME report covers the window, not specific to one
 * product â a report covering the period but not mentioning a given
 * product's line is treated as confirming zero sold for it, consistent with
 * how snapshotWriter.ts's own sales matching already works (no line = not sold).
 */
function hasSalesDataForWindow(
  salesReportsData: Array<{ report?: { period?: { start?: string; end?: string } } }>,
  since: Date,
): boolean {
  const sinceIso = since.toISOString().slice(0, 10);
  const nowIso = new Date().toISOString().slice(0, 10);
  for (const doc of salesReportsData) {
    const report = doc.report;
    if (!report) continue;
    const periodStart = report.period?.start ?? null;
    const periodEnd = report.period?.end ?? null;
    // A report with NEITHER bound at all carries no real date information â
    // skip it rather than treat missing data as "covers everything," which
    // would wrongly mark unrelated windows as having real sales data. One
    // malformed report here could otherwise falsely tag every product's
    // recompute across the whole venue as estimated_with_sales â a bigger
    // blast radius than the same ambiguity in snapshotWriter.ts's original
    // per-cycle version, worth hardening rather than copying forward as-is.
    if (periodStart == null && periodEnd == null) continue;
    const overlapStart = !periodEnd || periodEnd >= sinceIso;
    const overlapEnd = !periodStart || periodStart <= nowIso;
    if (overlapStart && overlapEnd) return true;
  }
  return false;
}

/**
 * Orchestrates a single product's weighted-average recompute. All I/O
 * (product read, sales report fetch) happens in the CALLER and is passed in
 * already-fetched â never an extra read inside here â since multiple
 * proposals processed in one commitInvoiceChanges/proposeInvoiceChanges call
 * would otherwise redundantly re-fetch the same salesReports collection once
 * per proposal instead of once per call. See Â§8a for the full design.
 */
function recomputeWeightedAverageCost(
  productData: any,
  salesReportsData: Array<{ report?: { period?: { start?: string; end?: string } } }>,
  newQty: number,
  newPrice: number,
): {
  costPrice: number;
  costPriceQuantityBasis: number;
  quantityConfidence: "estimated_with_sales" | "estimated_no_sales";
} {
  const priorQty = typeof productData?.costPriceQuantityBasis === "number"
    ? productData.costPriceQuantityBasis : 0;
  const priorPrice = typeof productData?.costPrice === "number" ? productData.costPrice : null;
  const priorBasisAt: FirebaseFirestore.Timestamp | null = productData?.costPriceBasisAt ?? null;

  const { blendedPrice, newQuantityBasis } = computeWeightedAverageCost(priorQty, priorPrice, newQty, newPrice);

  // No prior basis at all (legacy product predating this feature, or genuinely
  // first-ever price) â nothing to check sales against, since there's no
  // window that could have decayed. Conservative default, not physical_count
  // â that tier is reserved specifically for the cycle-reset trigger (Â§8a,
  // Phase P3b), not for an ad-hoc invoice-driven recompute like this one.
  const quantityConfidence = priorBasisAt && hasSalesDataForWindow(salesReportsData, priorBasisAt.toDate())
    ? "estimated_with_sales"
    : "estimated_no_sales";

  return { costPrice: blendedPrice, costPriceQuantityBasis: newQuantityBasis, quantityConfidence };
}

export type ProposedAction =
  | {
      id: string;
      type: "priceChange";
      productId: string;
      productName: string;
      lineName: string;
      oldPrice: number;
      newPrice: number;
      changePercent: number;
      direction: "increase" | "decrease";
      qty: number;
      caseSize: number | null;
      sellPrice?: number | null;  // product's current sell price — used to compute impactOnGP
      possibleCaseMismatch?: boolean;
      caseMismatchGuess?: number | null;
      correctedUnitPrice?: number | null;
      correctedChangePercent?: number | null;
      useCorrectedPrice?: boolean;
      reasoning?: {
        isolatedVsTrend: "isolated" | "trending";
        similarChangesOnInvoice: number;
        supplierMismatch: boolean;
        preferredSupplierName: string | null;
        matchConfidence: "high" | "moderate";
        matchScore: number;
      };
    }
  | {
      id: string;
      type: "nearDuplicateMatch";
      candidateProductId: string;
      candidateProductName: string;
      lineName: string;
      existingPrice: number | null;
      newPrice: number;
      qty: number;
      caseSize: number | null;
      sellPrice?: number | null;  // product's current sell price — used to compute impactOnGP
    }
  | {
      id: string;
      type: "newProduct";
      lineName: string;
      unitPrice: number | null;
      qty: number;
      caseSize: number | null;
      supplierId: string | null;
      supplierName: string | null;
    }
  | {
      id: string;
      type: "supplierLink";
      productId: string;
      productName: string;
      supplierId: string;
      supplierName: string | null;
      unitCost: number;
      caseSize: number | null;
      wouldBecomePreferred: boolean;
      qty: number;
      preferredSupplierName?: string | null;
      preferredUnitCost?: number | null;
      costDeltaPerUnit?: number | null;
    };

async function applyAreaItemLinking(
  db: FirebaseFirestore.Firestore,
  venueId: string,
  productMap: Record<string, string>,
  logPrefix: string,
): Promise<number> {
  if (Object.keys(productMap).length === 0) return 0;
  try {
    const depsSnap = await db.collection(`venues/${venueId}/departments`).get();
    const itemBatch = db.batch();
    let itemOps = 0;

    for (const dep of depsSnap.docs) {
      const areasSnap = await db
        .collection(`venues/${venueId}/departments/${dep.id}/areas`)
        .get();
      for (const area of areasSnap.docs) {
        const itemsSnap = await db
          .collection(`venues/${venueId}/departments/${dep.id}/areas/${area.id}/items`)
          .get();
        for (const itemDoc of itemsSnap.docs) {
          if (itemOps >= 400) break;
          const item = itemDoc.data() as any;
          const itemName = (item.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

          for (const [lineName, resolvedProductId] of Object.entries(productMap)) {
            const normLine = lineName.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (
              itemName && normLine &&
              (itemName === normLine || itemName.includes(normLine) || normLine.includes(itemName))
            ) {
              const prodSnap = await db.doc(`venues/${venueId}/products/${resolvedProductId}`).get();
              const resolvedCostPrice = (prodSnap.data() as any)?.costPrice ?? null;

              const updates: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
              if (!item.productId && resolvedProductId) {
                updates.productId = resolvedProductId;
              }
              if (resolvedCostPrice && !item.costPrice) {
                updates.costPrice = resolvedCostPrice;
                updates.costPriceSource = "invoice";
                updates.costPriceUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
              }
              if (Object.keys(updates).length > 1) {
                itemBatch.update(itemDoc.ref, updates);
                itemOps++;
              }
              break;
            }
          }
        }
      }
    }

    if (itemOps > 0) {
      await itemBatch.commit();
      console.log(`[${logPrefix}] linked ${itemOps} area item(s) to venue products`);
    }
    return itemOps;
  } catch (e: any) {
    console.log(`[${logPrefix}] area item linking failed (non-fatal):`, e?.message);
    return 0;
  }
}

export async function proposeInvoiceChanges(opts: PriceTrackingOptions): Promise<{
  autoApplied: { linked: number };
  proposals: ProposedAction[];
  autoProductMap: Record<string, string>;
  excludedLines: ExcludedLineSummary[];
}> {
  const {
    venueId,
    lines,
    supplierId = "",
    supplierName = "",
    invoiceId = `inv_${Date.now()}`,
  } = opts;
  const cleanSupplierId = supplierId && supplierId.trim() ? supplierId.trim() : null;
  const cleanSupplierName = supplierName && supplierName.trim() ? supplierName.trim() : null;
  const db = admin.firestore();

  // Classify all input lines first â non-product lines (freight, deposits, etc.)
  // are excluded from matching/proposal logic and surfaced in excludedLines instead
  const productLines: InvoiceLine[] = [];
  const nonProductLines: InvoiceLine[] = [];
  for (const l of lines) {
    if (classifyLine(l) === 'product') productLines.push(l);
    else nonProductLines.push(l);
  }

  const priced = productLines.filter(l =>
    typeof l.unitPrice === "number" &&
    (l.unitPrice as number) > 0 &&
    (l.unitPrice as number) < 10000
  );
  if (!priced.length) return {
    autoApplied: { linked: 0 },
    proposals: [],
    autoProductMap: {},
    excludedLines: summarizeExcludedLines(nonProductLines),
  };

  const productsSnap = await db.collection(`venues/${venueId}/products`).limit(500).get();
  const products = productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  // Fetched once for the whole call â see recomputeWeightedAverageCost's own
  // comment on why this must not be re-fetched per line/proposal.
  let salesReportsData: Array<{ report?: { period?: { start?: string; end?: string } } }> = [];
  try {
    const salesReportsSnap = await db.collection(`venues/${venueId}/salesReports`).get();
    salesReportsData = salesReportsSnap.docs.map(d => d.data() as any);
  } catch (e: any) {
    console.warn("[proposeInvoiceChanges] salesReports fetch failed (safe degrade to estimated_no_sales):", e?.message);
  }

  const batch = db.batch();
  let ops = 0;
  const proposals: ProposedAction[] = [];
  // Confident namesMatch lines â fed to area-item linking even when price write waits
  const autoProductMap: Record<string, string> = {};
  // Per-line price-change records â used for the trend signal in Phase 3 reasoning
  const invoiceLineData: Array<{
    direction: "increase" | "decrease";
    changePercent: number;
    proposalId: string;
    matchScore: number;
    supplierMismatch: boolean;
    primarySupplierId: string | null;
  }> = [];

  for (const line of priced) {
    if (ops >= 400) break;
    const unitPrice = line.unitPrice as number;
    let lineMatchScore = 0;
    const matched = products.find(p => {
      const r = namesMatch(p.name || "", line.name);
      if (r.isMatch) { lineMatchScore = r.score; return true; }
      return false;
    });

    const cs = typeof line.caseSize === "number" && line.caseSize > 0 ? line.caseSize : null;
    const caseSizeFields = computeCaseSizeFields(unitPrice, cs);

    if (matched) {
      // Trusted product ID â queue for area-item linking regardless of price outcome
      autoProductMap[line.name] = matched.id;
      const existing: number | null = (typeof matched.costPrice === "number" && matched.costPrice > 0) ? matched.costPrice : null;
      const productRef = db.doc(`venues/${venueId}/products/${matched.id}`);

      if (existing != null) {
        const pctDiff = Math.abs((unitPrice - existing) / existing);
        if (pctDiff > 0.01) {
          // Price change â waits for user confirmation
          const changePercent = Math.round(((unitPrice - existing) / existing) * 10000) / 100;
          // Case-mismatch detection â only fires for suspiciously large changes (>50%)
          let caseMismatchFields: {
            possibleCaseMismatch?: boolean;
            caseMismatchGuess?: number | null;
            correctedUnitPrice?: number | null;
            correctedChangePercent?: number | null;
          } = {};
          if (pctDiff > 0.5) {
            const knownCaseSize =
              typeof matched.caseSize === "number" && matched.caseSize > 0
                ? matched.caseSize as number
                : null;
            const candidates = knownCaseSize != null ? [knownCaseSize] : [6, 12, 24];
            const ratio = unitPrice / existing;
            let matchedCandidate: number | null = null;
            for (const candidate of candidates) {
              if (Math.abs(ratio - candidate) / candidate <= 0.15) {
                matchedCandidate = candidate;
                break;
              }
            }
            if (matchedCandidate != null) {
              const correctedUnitPrice = unitPrice / matchedCandidate;
              const correctedChangePercent =
                Math.round(((correctedUnitPrice - existing) / existing) * 10000) / 100;
              caseMismatchFields = {
                possibleCaseMismatch: true,
                caseMismatchGuess: matchedCandidate,
                correctedUnitPrice,
                correctedChangePercent,
              };
            }
          }
          const priceChangeId = `${invoiceId}:priceChange:${matched.id}`;
          const direction: "increase" | "decrease" = unitPrice > existing ? "increase" : "decrease";
          const supplierMismatch =
            typeof matched.primarySupplierId === "string" &&
            matched.primarySupplierId.length > 0 &&
            cleanSupplierId !== null &&
            matched.primarySupplierId !== cleanSupplierId;
          invoiceLineData.push({
            direction,
            changePercent,
            proposalId: priceChangeId,
            matchScore: lineMatchScore,
            supplierMismatch,
            primarySupplierId: typeof matched.primarySupplierId === "string" ? matched.primarySupplierId : null,
          });
          proposals.push({
            id: priceChangeId,
            type: "priceChange",
            productId: matched.id,
            productName: matched.name || line.name,
            lineName: line.name,
            oldPrice: existing,
            newPrice: unitPrice,
            changePercent,
            direction,
            qty: line.qty,
            caseSize: cs,
            sellPrice: typeof matched.sellPrice === "number" ? matched.sellPrice : null,
            ...caseMismatchFields,
          });
        } else {
          // Same price â automatic touch (no meaningful price change), but the
          // quantity basis still needs to grow: new stock arrived even though
          // the price didn't move, and the next genuinely different price
          // must weight against the correct, current on-hand quantity, not a
          // stale one. See Â§8a â this is the corrected weighted-average model.
          const wac = recomputeWeightedAverageCost(matched, salesReportsData, line.qty, unitPrice);
          batch.update(productRef, {
            costPrice: wac.costPrice,
            costPriceQuantityBasis: wac.costPriceQuantityBasis,
            costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
            quantityConfidence: wac.quantityConfidence,
            lastInvoicePrice: unitPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
          // Site 1: per-supplier invoiceHistory â record every invoice appearance
          if (cleanSupplierId) {
            const suppRef = productRef.collection("suppliers").doc(cleanSupplierId);
            const invHistRef = suppRef.collection("invoiceHistory").doc();
            batch.set(invHistRef, buildInvoiceHistoryEntry({
              invoiceId,
              productId: matched.id,
              productName: matched.name || line.name,
              supplierId: cleanSupplierId,
              supplierName: cleanSupplierName,
              unitCost: unitPrice,
              qty: line.qty,
              caseSize: cs,
              type: "samePriceTouch",
              wasPreferredSupplier: typeof matched.primarySupplierId === "string"
                && matched.primarySupplierId.length > 0
                && matched.primarySupplierId === cleanSupplierId,
              oldPrice: existing,
              changePercent: 0,
            }));
            ops++;
          }
        }
      } else {
        // First-time price set â automatic. Trivial case of the weighted-average
        // formula (priorQty=0 collapses to newPrice outright), but this still
        // needs to ESTABLISH costPriceQuantityBasis/costPriceBasisAt so the
        // NEXT invoice for this product has a real basis to chain from,
        // rather than being treated as first-time again. See Â§8a.
        const wac = recomputeWeightedAverageCost(matched, salesReportsData, line.qty, unitPrice);
        const initHistRef = productRef.collection("priceHistory").doc();
        batch.set(initHistRef, {
          date: admin.firestore.FieldValue.serverTimestamp(),
          oldPrice: null,
          newPrice: unitPrice,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          invoiceId,
          changePercent: null,
          direction: "initial",
          source: "invoice",
          note: "Initial price set from invoice",
        });
        batch.update(productRef, {
          costPrice: wac.costPrice,
          costPriceQuantityBasis: wac.costPriceQuantityBasis,
          costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
          quantityConfidence: wac.quantityConfidence,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: "invoice",
          lastInvoicePrice: unitPrice,
          lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...caseSizeFields,
        });
        ops += 2;
        // Site 2: per-supplier invoiceHistory for first-time automatic price set
        if (cleanSupplierId) {
          const suppRef = productRef.collection("suppliers").doc(cleanSupplierId);
          const invHistRef = suppRef.collection("invoiceHistory").doc();
          batch.set(invHistRef, buildInvoiceHistoryEntry({
            invoiceId,
            productId: matched.id,
            productName: matched.name || line.name,
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            unitCost: unitPrice,
            qty: line.qty,
            caseSize: cs,
            type: "firstTime",
            wasPreferredSupplier: typeof matched.primarySupplierId === "string"
              && matched.primarySupplierId.length > 0
              && matched.primarySupplierId === cleanSupplierId,
            oldPrice: null,
            changePercent: null,
            direction: "initial",
            note: "Initial price set from invoice",
          }));
          ops++;
        }
      }
    } else {
      const normLine = normalizeName(line.name);
      const nearDuplicate = products.find(p => {
        const np = normalizeName(p.name || "");
        if (!np || !normLine) return false;
        const exactMatch = np === normLine;
        const tokensA = tokenizeForMatching(p.name || "");
        const tokensB = tokenizeForMatching(line.name);
        const [smaller, larger] = tokensA.size <= tokensB.size
          ? [tokensA, tokensB]
          : [tokensB, tokensA];
        const subMatch = smaller.size > 0 && [...smaller].every(t => larger.has(t));
        return exactMatch || subMatch;
      });

      if (nearDuplicate) {
        // Near-duplicate â match AND price wait together (wrong match = wrong product ID)
        const existing: number | null =
          typeof nearDuplicate.costPrice === "number" ? nearDuplicate.costPrice : null;
        proposals.push({
          id: `${invoiceId}:nearDuplicateMatch:${normalizeName(line.name)}`,
          type: "nearDuplicateMatch",
          candidateProductId: nearDuplicate.id,
          candidateProductName: nearDuplicate.name || "",
          lineName: line.name,
          existingPrice: existing,
          newPrice: unitPrice,
          qty: line.qty,
          caseSize: cs,
          sellPrice: typeof nearDuplicate.sellPrice === "number" ? nearDuplicate.sellPrice : null,
        });
      } else {
        // Genuinely new product â waits for user confirmation
        proposals.push({
          id: `${invoiceId}:newProduct:${normalizeName(line.name)}`,
          type: "newProduct",
          lineName: line.name,
          unitPrice,
          qty: line.qty,
          caseSize: cs,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
        });
      }
    }
  }

  // Commit auto-applied writes (same-price touches + first-time prices)
  if (ops > 0) {
    await batch.commit();
    console.log("[proposeInvoiceChanges] auto-committed", { venueId, ops, invoiceId });
  }

  // Area-item linking for all confident namesMatch lines â runs immediately
  const linked = await applyAreaItemLinking(db, venueId, autoProductMap, "proposeInvoiceChanges");

  // Supplier links: existing links auto-update; new links become proposals
  if (cleanSupplierId) {
    for (const line of priced) {
      const unitPrice = line.unitPrice as number;
      const matched = products.find(p => namesMatch(p.name || "", line.name).isMatch);
      if (!matched) continue;
      const cs = typeof line.caseSize === "number" && line.caseSize > 0 ? line.caseSize : null;
      const unitCost = unitPrice; // already per-unit â OCR prompt normalises before returning
      const supplierRef = db.doc(
        `venues/${venueId}/products/${matched.id}/suppliers/${cleanSupplierId}`
      );
      try {
        const snap = await supplierRef.get();
        if (!snap.exists) {
          let preferredSupplierName: string | null = null;
          let preferredUnitCost: number | null = null;
          let costDeltaPerUnit: number | null = null;
          const prefId = matched.primarySupplierId || null;
          if (prefId && prefId !== cleanSupplierId) {
            try {
              const prefSnap = await db.doc(
                `venues/${venueId}/products/${matched.id}/suppliers/${prefId}`
              ).get();
              if (prefSnap.exists) {
                const prefData = prefSnap.data() as any;
                preferredSupplierName = prefData.supplierName || null;
                if (prefData.unitCost != null) {
                  preferredUnitCost = prefData.unitCost;
                  costDeltaPerUnit = unitCost - preferredUnitCost;
                }
              }
            } catch (e: any) {
              console.log("[proposeInvoiceChanges] preferred cost lookup failed (non-fatal)", matched.id, e?.message);
            }
          }
          proposals.push({
            id: `${invoiceId}:supplierLink:${matched.id}:${cleanSupplierId}`,
            type: "supplierLink",
            productId: matched.id,
            productName: matched.name || line.name,
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            unitCost,
            caseSize: cs,
            qty: line.qty,
            wouldBecomePreferred: !(matched.primarySupplierId || matched.supplierId),
            preferredSupplierName,
            preferredUnitCost,
            costDeltaPerUnit,
          });
        } else {
          await supplierRef.update({
            unitCost,
            caseSize: cs,
            lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInvoicePrice: unitPrice,
          });
        }
      } catch (e: any) {
        console.log("[proposeInvoiceChanges] supplier link error", matched.id, e?.message);
      }
    }
  }

  // Phase 3: attach reasoning to priceChange proposals crossing the 25% effective threshold
  const lineDataByProposalId = new Map(invoiceLineData.map(d => [d.proposalId, d]));
  const proposalsWithReasoning: ProposedAction[] = await Promise.all(proposals.map(async p => {
    if (p.type !== "priceChange") return p;
    const effectivePercent =
      p.possibleCaseMismatch && typeof p.correctedChangePercent === "number"
        ? p.correctedChangePercent
        : p.changePercent;
    if (Math.abs(effectivePercent) <= 25) return p;
    const lineData = lineDataByProposalId.get(p.id);
    if (!lineData) return p;
    const otherChanges = invoiceLineData.filter(d => d.proposalId !== p.id);
    const sameDirectionMeaningful = otherChanges.filter(
      d => d.direction === p.direction && Math.abs(d.changePercent) >= 5
    );
    const count = sameDirectionMeaningful.length;
    const totalOtherMeaningful = otherChanges.filter(d => Math.abs(d.changePercent) >= 5).length;
    const isolatedVsTrend: "isolated" | "trending" =
      count >= 2 || (totalOtherMeaningful > 0 && count / totalOtherMeaningful >= 0.3)
        ? "trending"
        : "isolated";
    const matchConfidence: "high" | "moderate" = lineData.matchScore >= 0.95 ? "high" : "moderate";
    // Lookup preferred supplier name â only when a mismatch is confirmed and we have an ID to query
    let preferredSupplierName: string | null = null;
    if (lineData.supplierMismatch && lineData.primarySupplierId) {
      try {
        const prefSnap = await db.doc(
          `venues/${venueId}/products/${p.productId}/suppliers/${lineData.primarySupplierId}`
        ).get();
        if (prefSnap.exists) {
          preferredSupplierName = (prefSnap.data() as any)?.supplierName || null;
        }
      } catch (e: any) {
        console.log("[proposeInvoiceChanges] preferred supplier name lookup failed (non-fatal)", p.productId, e?.message);
      }
    }
    return {
      ...p,
      reasoning: {
        isolatedVsTrend,
        similarChangesOnInvoice: count,
        supplierMismatch: lineData.supplierMismatch,
        preferredSupplierName,
        matchConfidence,
        matchScore: lineData.matchScore,
      },
    };
  }));
  return { autoApplied: { linked }, proposals: proposalsWithReasoning, autoProductMap, excludedLines: summarizeExcludedLines(nonProductLines) };
}

// ---------------------------------------------------------------------------
// Historical invoice processing — three-way per-line branch
// ---------------------------------------------------------------------------

/**
 * Handles price tracking for invoices older than 3 months (historical / old / very_old).
 * Called instead of proposeInvoiceChanges when ageCategory is historical — fresh
 * invoices (current / late) continue to use proposeInvoiceChanges unchanged.
 *
 * Per priced line, exactly one of three cases applies:
 *   Case 1 — Matched product, costPrice already set (any source):
 *             Write invoiceHistory only (tagged isHistoricalBackfill / price_protected).
 *             Never touch costPrice. Also write a priceChangeFlags conflict entry when
 *             the prices actually differ (> 1%), so managers can review the discrepancy.
 *   Case 2 — Matched product, no costPrice set:
 *             Set price using the normal weighted-average mechanism, tagged
 *             costPriceSource:'historical-invoice'. Write invoiceHistory
 *             (price_set_first_time). Never write priceChangeFlags.
 *   Case 3 — No matching product:
 *             Create the product using the same schema as commitInvoiceChanges's
 *             newProduct handler, tagged costPriceSource:'historical-invoice' and
 *             historicalScenario:'product_created'. Never write priceChangeFlags.
 */
export async function processHistoricalInvoiceLines(opts: HistoricalPriceTrackingOptions): Promise<{
  autoApplied: { linked: number };
  proposals: ProposedAction[];
  autoProductMap: Record<string, string>;
  excludedLines: ExcludedLineSummary[];
}> {
  const {
    venueId,
    lines,
    supplierId = '',
    supplierName = '',
    invoiceId = `inv_${Date.now()}`,
    invoiceDocId,
    invoiceDate = null,
  } = opts;
  const cleanSupplierId = supplierId && supplierId.trim() ? supplierId.trim() : null;
  const cleanSupplierName = supplierName && supplierName.trim() ? supplierName.trim() : null;
  const db = admin.firestore();

  // Classify lines — non-product lines (freight, deposits, etc.) excluded
  const productLines: InvoiceLine[] = [];
  const nonProductLines: InvoiceLine[] = [];
  for (const l of lines) {
    if (classifyLine(l) === 'product') productLines.push(l);
    else nonProductLines.push(l);
  }

  const priced = productLines.filter(l =>
    typeof l.unitPrice === 'number' &&
    (l.unitPrice as number) > 0 &&
    (l.unitPrice as number) < 10000
  );
  if (!priced.length) {
    return { autoApplied: { linked: 0 }, proposals: [], autoProductMap: {}, excludedLines: summarizeExcludedLines(nonProductLines) };
  }

  const productsSnap = await db.collection(`venues/${venueId}/products`).limit(500).get();
  const products = productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  // salesReports fetched once for WAC blending in Case 2
  let salesReportsData: Array<{ report?: { period?: { start?: string; end?: string } } }> = [];
  try {
    const salesReportsSnap = await db.collection(`venues/${venueId}/salesReports`).get();
    salesReportsData = salesReportsSnap.docs.map(d => d.data() as any);
  } catch (e: any) {
    console.warn('[processHistoricalInvoiceLines] salesReports fetch failed (safe degrade):', e?.message);
  }

  // Venue country for GST on newly created products (Case 3)
  let venueCountry = 'NZ';
  try {
    const venueSnap = await db.collection('venues').doc(venueId).get();
    venueCountry = (venueSnap.data()?.country as string) || 'NZ';
  } catch {}

  const batch = db.batch();
  let ops = 0;
  const autoProductMap: Record<string, string> = {};

  for (const line of priced) {
    if (ops >= 400) break;
    const unitPrice = line.unitPrice as number;
    const cs = typeof line.caseSize === 'number' && line.caseSize > 0 ? line.caseSize : null;

    // Confident name-match — same threshold as proposeInvoiceChanges
    const matched = products.find(p => namesMatch(p.name || '', line.name).isMatch);

    if (matched) {
      autoProductMap[line.name] = matched.id;
      const existingPrice: number | null =
        typeof matched.costPrice === 'number' && matched.costPrice > 0 ? matched.costPrice : null;
      const productRef = db.doc(`venues/${venueId}/products/${matched.id}`);
      const wasPreferred =
        typeof matched.primarySupplierId === 'string' &&
        matched.primarySupplierId.length > 0 &&
        matched.primarySupplierId === cleanSupplierId;

      if (existingPrice !== null) {
        // ── Case 1: matched product with existing costPrice — protect it ─────────
        // costPrice is intentionally never written in this branch.

        // Always write an invoiceHistory entry so the price is historically logged
        if (cleanSupplierId) {
          const changePercent = Math.round(((unitPrice - existingPrice) / existingPrice) * 10000) / 100;
          const direction: 'increase' | 'decrease' = unitPrice > existingPrice ? 'increase' : 'decrease';
          const suppRef = productRef.collection('suppliers').doc(cleanSupplierId);
          const invHistRef = suppRef.collection('invoiceHistory').doc();
          batch.set(invHistRef, {
            ...buildInvoiceHistoryEntry({
              invoiceId,
              productId: matched.id,
              productName: matched.name || line.name,
              supplierId: cleanSupplierId,
              supplierName: cleanSupplierName,
              unitCost: unitPrice,
              qty: line.qty,
              caseSize: cs,
              type: 'priceChange',
              wasPreferredSupplier: wasPreferred,
              oldPrice: existingPrice,
              changePercent,
              direction,
              note: 'Historical invoice — costPrice protected, not applied',
            }),
            isHistoricalBackfill: true,
            invoiceDate: invoiceDate ?? null,
            historicalScenario: 'price_protected',
          });
          ops++;
        }

        // priceChangeFlags conflict entry — only when prices actually differ (> 1%),
        // so the review screen isn't flooded with no-op historical same-price records.
        const pctDiff = Math.abs((unitPrice - existingPrice) / existingPrice);
        if (pctDiff > 0.01) {
          const changePercent = Math.round(((unitPrice - existingPrice) / existingPrice) * 10000) / 100;
          const flagRef = db.collection(`venues/${venueId}/priceChangeFlags`).doc();
          batch.set(flagRef, {
            // Core schema identical to flagPriceChangeToManager — reuses existing review screen
            productId: matched.id,
            productName: matched.name || line.name,
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            invoiceId,
            invoiceDocId: invoiceDocId ?? null,
            // oldPrice = current protected price; newPrice = what the historical invoice shows
            oldPrice: existingPrice,
            newPrice: unitPrice,
            changePercent,
            direction: unitPrice > existingPrice ? 'increase' : 'decrease',
            // Historical-specific context fields
            currentPriceSetAt: matched.costPriceUpdatedAt ?? null,
            currentPriceSource: matched.costPriceSource ?? null,
            proposedHistoricalInvoiceDate: invoiceDate ?? null,
            qty: line.qty,
            caseSize: cs,
            flagReason: 'historical_invoice_conflict',
            flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
            acknowledgedBy: null,
            acknowledgedAt: null,
            impactOnGP: null,
            note: null,
          });
          ops++;
        }

      } else {
        // ── Case 2: matched product, no costPrice set — set price normally ───────
        // Same WAC mechanism as fresh invoice first-time price, tagged 'historical-invoice'.
        // Never writes priceChangeFlags.

        const wac = recomputeWeightedAverageCost(matched, salesReportsData, line.qty, unitPrice);
        const caseSizeFields = computeCaseSizeFields(unitPrice, cs);

        // priceHistory entry with historical source tag
        const initHistRef = productRef.collection('priceHistory').doc();
        batch.set(initHistRef, {
          date: admin.firestore.FieldValue.serverTimestamp(),
          oldPrice: null,
          newPrice: unitPrice,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          invoiceId,
          changePercent: null,
          direction: 'initial',
          source: 'historical-invoice',
          note: 'Initial price set from historical invoice',
          isHistoricalBackfill: true,
          invoiceDate: invoiceDate ?? null,
        });

        // Product update — costPriceSource tagged 'historical-invoice', not 'invoice'
        batch.update(productRef, {
          costPrice: wac.costPrice,
          costPriceQuantityBasis: wac.costPriceQuantityBasis,
          costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
          quantityConfidence: wac.quantityConfidence,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: 'historical-invoice',
          lastInvoicePrice: unitPrice,
          lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...caseSizeFields,
        });
        ops += 2;

        // invoiceHistory with historical tags
        if (cleanSupplierId) {
          const suppRef = productRef.collection('suppliers').doc(cleanSupplierId);
          const invHistRef = suppRef.collection('invoiceHistory').doc();
          batch.set(invHistRef, {
            ...buildInvoiceHistoryEntry({
              invoiceId,
              productId: matched.id,
              productName: matched.name || line.name,
              supplierId: cleanSupplierId,
              supplierName: cleanSupplierName,
              unitCost: unitPrice,
              qty: line.qty,
              caseSize: cs,
              type: 'firstTime',
              wasPreferredSupplier: wasPreferred,
              oldPrice: null,
              changePercent: null,
              direction: 'initial',
              note: 'Initial price set from historical invoice',
            }),
            isHistoricalBackfill: true,
            invoiceDate: invoiceDate ?? null,
            historicalScenario: 'price_set_first_time',
          });
          ops++;
        }
      }

    } else {
      // ── Case 3: no matching product — create it with historical tags ──────────
      // Uses the same product doc schema as commitInvoiceChanges's newProduct handler.
      // Never writes priceChangeFlags.

      const caseSizeFields = computeCaseSizeFields(unitPrice, cs);
      const newRef = db.collection(`venues/${venueId}/products`).doc();

      batch.set(newRef, {
        name: line.name.trim(),
        costPrice: unitPrice,
        costPriceQuantityBasis: line.qty,
        costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
        quantityConfidence: 'estimated_no_sales',
        costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        costPriceSource: 'historical-invoice',
        lastInvoicePrice: unitPrice,
        lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
        supplierId: cleanSupplierId,
        supplierName: cleanSupplierName,
        ...(cleanSupplierId
          ? { primarySupplierId: cleanSupplierId, primarySupplierName: cleanSupplierName }
          : {}),
        inductionSource: 'invoice-price-tracking',
        inductionStatus: 'pending',
        priceChanged: false,
        gstPercent: venueCountry === 'AU' ? 10 : 15,
        ...caseSizeFields,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      ops++;

      // Supplier subdoc — same shape as commitInvoiceChanges newProduct handler
      if (cleanSupplierId) {
        const newSubRef = db.doc(`venues/${venueId}/products/${newRef.id}/suppliers/${cleanSupplierId}`);
        batch.set(newSubRef, {
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          unitCost: unitPrice,
          caseSize: cs,
          caseCost: cs != null ? unitPrice * cs : null,
          isPreferred: true,
          relationship: 'preferred',
          agreedPrice: unitPrice,
          agreedPriceSource: 'historical-invoice',
          lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
          lastInvoicePrice: unitPrice,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
          addedBy: 'invoice-import',
        });
        ops++;
      }

      // priceHistory entry with historical source tag
      const newHistRef = newRef.collection('priceHistory').doc();
      batch.set(newHistRef, {
        date: admin.firestore.FieldValue.serverTimestamp(),
        oldPrice: null,
        newPrice: unitPrice,
        supplierId: cleanSupplierId,
        supplierName: cleanSupplierName,
        invoiceId,
        changePercent: null,
        direction: 'initial',
        source: 'historical-invoice',
        note: 'Initial price set — new product from historical invoice',
        isHistoricalBackfill: true,
        invoiceDate: invoiceDate ?? null,
      });
      ops++;

      // invoiceHistory with historical tags
      if (cleanSupplierId) {
        const suppRef = newRef.collection('suppliers').doc(cleanSupplierId);
        const invHistRef = suppRef.collection('invoiceHistory').doc();
        batch.set(invHistRef, {
          ...buildInvoiceHistoryEntry({
            invoiceId,
            productId: newRef.id,
            productName: line.name.trim(),
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            unitCost: unitPrice,
            qty: line.qty,
            caseSize: cs,
            type: 'newProduct',
            wasPreferredSupplier: true, // always preferred — it becomes the first/only supplier
            oldPrice: null,
            changePercent: null,
            direction: 'initial',
            note: 'New product from historical invoice',
          }),
          isHistoricalBackfill: true,
          invoiceDate: invoiceDate ?? null,
          historicalScenario: 'product_created',
        });
        ops++;
      }

      autoProductMap[line.name] = newRef.id;
      console.log(`[processHistoricalInvoiceLines] new product created: "${line.name}"`);
    }
  }

  if (ops > 0) {
    await batch.commit();
    console.log('[processHistoricalInvoiceLines] committed', { venueId, ops, invoiceId });
  }

  const linked = await applyAreaItemLinking(db, venueId, autoProductMap, 'processHistoricalInvoiceLines');

  return {
    autoApplied: { linked },
    proposals: [],  // Historical processing is auto-applied — no proposals queued for review
    autoProductMap,
    excludedLines: summarizeExcludedLines(nonProductLines),
  };
}

export async function commitInvoiceChanges(
  venueId: string,
  accepted: ProposedAction[],
  context: { supplierId?: string; supplierName?: string; invoiceId?: string },
): Promise<{ changed: number; created: number; productMap: Record<string, string> }> {
  const db = admin.firestore();
  const cleanSupplierId = context.supplierId?.trim() || null;
  const cleanSupplierName = context.supplierName?.trim() || null;
  const invoiceId = context.invoiceId || `inv_${Date.now()}`;

  const batch = db.batch();
  let ops = 0;
  let changed = 0;
  let created = 0;
  // lineName â productId for lines that get a real product ID for the first time here
  const newlyResolvedMap: Record<string, string> = {};

  // Read venue country once â only when new products will be created, to set gstPercent correctly.
  // AU â 10%, everything else (NZ and any future country) â 15%.
  const hasNewProducts = accepted.some(p => p.type === 'newProduct');
  let venueCountry = 'NZ';
  if (hasNewProducts) {
    const venueSnap = await db.collection('venues').doc(venueId).get();
    venueCountry = (venueSnap.data()?.country as string) || 'NZ';
  }

  // Fetched once for the whole call â see recomputeWeightedAverageCost's own
  // comment on why this must not be re-fetched per proposal.
  let salesReportsData: Array<{ report?: { period?: { start?: string; end?: string } } }> = [];
  try {
    const salesReportsSnap = await db.collection(`venues/${venueId}/salesReports`).get();
    salesReportsData = salesReportsSnap.docs.map(d => d.data() as any);
  } catch (e: any) {
    console.warn("[commitInvoiceChanges] salesReports fetch failed (safe degrade to estimated_no_sales):", e?.message);
  }

  for (const proposal of accepted) {
    if (ops >= 400) break;

    if (proposal.type === "priceChange") {
      const productRef = db.doc(`venues/${venueId}/products/${proposal.productId}`);
      const cs = proposal.caseSize;
      // When the user confirmed a case-size correction, use the corrected unit price
      // in place of newPrice for all stored values; otherwise behaviour is unchanged.
      const effectivePrice =
        proposal.useCorrectedPrice && typeof proposal.correctedUnitPrice === "number"
          ? proposal.correctedUnitPrice
          : proposal.newPrice;
      const effectiveChangePercent =
        proposal.useCorrectedPrice && typeof proposal.correctedChangePercent === "number"
          ? proposal.correctedChangePercent
          : proposal.changePercent;
      const caseSizeFields = computeCaseSizeFields(effectivePrice, cs);

      // Fresh read required here (unlike sites 1/2, which reuse `matched` for
      // free): the proposal may have been generated minutes or days before
      // being accepted, and the basis could have shifted via another invoice
      // committed in between. Using a stale propose-time snapshot would blend
      // against the wrong prior quantity â a real correctness risk now that
      // this feeds the canonical cost, not just an annotation. See Â§8a.
      const freshProductSnap = await productRef.get();
      const freshProductData = freshProductSnap.data() as any;
      const wac = recomputeWeightedAverageCost(freshProductData, salesReportsData, proposal.qty, effectivePrice);

      const histRef = productRef.collection("priceHistory").doc();
      batch.set(histRef, {
        date: admin.firestore.FieldValue.serverTimestamp(),
        oldPrice: proposal.oldPrice,
        newPrice: wac.costPrice,
        supplierId: cleanSupplierId,
        supplierName: cleanSupplierName,
        invoiceId,
        changePercent: effectiveChangePercent,
        direction: proposal.direction,
        source: "invoice",
      });
      batch.update(productRef, {
        costPrice: wac.costPrice,
        costPriceQuantityBasis: wac.costPriceQuantityBasis,
        costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
        quantityConfidence: wac.quantityConfidence,
        costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        costPriceSource: "invoice",
        lastInvoicePrice: effectivePrice,
        lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
        priceChanged: true,
        lastPriceChangeAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...caseSizeFields,
      });
      ops += 2;
      changed++;
      // Site 3: per-supplier invoiceHistory for confirmed price change. Records
      // the RAW invoice-observed price (effectivePrice), not the blended
      // costPrice â priceHistory is the blended "official cost" trail;
      // invoiceHistory is the raw per-invoice observation trail. See Â§2/Â§8a.
      // wasPreferredSupplier: supplierMismatch=true means the invoice supplier is NOT the preferred
      // one; if no reasoning was attached (below 25% threshold), assume it IS preferred.
      if (cleanSupplierId) {
        const suppRef = productRef.collection("suppliers").doc(cleanSupplierId);
        const invHistRef = suppRef.collection("invoiceHistory").doc();
        batch.set(invHistRef, buildInvoiceHistoryEntry({
          invoiceId,
          productId: proposal.productId,
          productName: proposal.productName,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          unitCost: effectivePrice,
          qty: proposal.qty,
          caseSize: cs,
          type: "priceChange",
          wasPreferredSupplier: !(proposal.reasoning?.supplierMismatch ?? false),
          oldPrice: proposal.oldPrice,
          changePercent: effectiveChangePercent,
          direction: proposal.direction,
        }));
        ops++;
      }
      // Area-item linking for this product already ran in proposeInvoiceChanges

    } else if (proposal.type === "nearDuplicateMatch") {
      const productRef = db.doc(`venues/${venueId}/products/${proposal.candidateProductId}`);
      const cs = proposal.caseSize;
      const caseSizeFields = computeCaseSizeFields(proposal.newPrice, cs);

      // Fresh read shared by all three sub-cases below â none of them read the
      // product before this (unlike sites 1/2's free `matched`), and this is
      // now a functional requirement for the weighted-average blend, not just
      // an annotation. One read here rather than three. See Â§8a.
      const freshProductSnap4 = await productRef.get();
      const freshProductData4 = freshProductSnap4.data() as any;
      const wac4 = recomputeWeightedAverageCost(freshProductData4, salesReportsData, proposal.qty, proposal.newPrice);

      if (proposal.existingPrice != null) {
        const pctDiff = Math.abs(
          (proposal.newPrice - proposal.existingPrice) / proposal.existingPrice
        );
        if (pctDiff > 0.01) {
          // Price change on confirmed near-duplicate â tag source + write priceHistory
          const changePercent = Math.round(
            ((proposal.newPrice - proposal.existingPrice) / proposal.existingPrice) * 10000
          ) / 100;
          const nearDupHistRef = productRef.collection("priceHistory").doc();
          batch.set(nearDupHistRef, {
            date: admin.firestore.FieldValue.serverTimestamp(),
            oldPrice: proposal.existingPrice,
            newPrice: wac4.costPrice,
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            invoiceId,
            changePercent,
            direction: proposal.newPrice > proposal.existingPrice ? "increase" : "decrease",
            source: "invoice",
            note: "Near-duplicate match confirmed",
          });
          batch.update(productRef, {
            costPrice: wac4.costPrice,
            costPriceQuantityBasis: wac4.costPriceQuantityBasis,
            costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
            quantityConfidence: wac4.quantityConfidence,
            costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            costPriceSource: "invoice",
            lastInvoicePrice: proposal.newPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops += 2;
          changed++;
        } else {
          // Same price â quantity basis still needs to grow even though the
          // price itself doesn't move. See site 1's identical reasoning.
          batch.update(productRef, {
            costPrice: wac4.costPrice,
            costPriceQuantityBasis: wac4.costPriceQuantityBasis,
            costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
            quantityConfidence: wac4.quantityConfidence,
            costPriceSource: "invoice",
            lastInvoicePrice: proposal.newPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
        }
      } else {
        // First-time price set on confirmed near-duplicate â tag source + write priceHistory.
        // Trivial case of the engine (freshProductData4 has no prior price/basis).
        const nearDupHistRef = productRef.collection("priceHistory").doc();
        batch.set(nearDupHistRef, {
          date: admin.firestore.FieldValue.serverTimestamp(),
          oldPrice: null,
          newPrice: wac4.costPrice,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          invoiceId,
          changePercent: null,
          direction: "initial",
          source: "invoice",
          note: "Initial price set from near-duplicate match",
        });
        batch.update(productRef, {
          costPrice: wac4.costPrice,
          costPriceQuantityBasis: wac4.costPriceQuantityBasis,
          costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
          quantityConfidence: wac4.quantityConfidence,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: "invoice",
          lastInvoicePrice: proposal.newPrice,
          lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...caseSizeFields,
        });
        ops += 2;
      }
      // Site 4: per-supplier invoiceHistory â ONE call covering all three sub-cases above.
      // Re-derives direction and changePercent from the proposal so no per-branch duplication.
      if (cleanSupplierId) {
        const existingP = proposal.existingPrice;
        const pctD = existingP != null
          ? Math.abs((proposal.newPrice - existingP) / existingP)
          : null;
        const changePercent =
          existingP != null
            ? Math.round(((proposal.newPrice - existingP) / existingP) * 10000) / 100
            : null;
        // same-price sub-case omits direction; first-time is 'initial'; price-change is increase/decrease
        const direction: 'increase' | 'decrease' | 'initial' | undefined =
          existingP == null
            ? 'initial'
            : pctD != null && pctD <= 0.01
            ? undefined
            : proposal.newPrice > existingP
            ? 'increase'
            : 'decrease';
        const suppRef = productRef.collection("suppliers").doc(cleanSupplierId);
        const invHistRef = suppRef.collection("invoiceHistory").doc();
        batch.set(invHistRef, buildInvoiceHistoryEntry({
          invoiceId,
          productId: proposal.candidateProductId,
          productName: proposal.candidateProductName,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          unitCost: proposal.newPrice,
          qty: proposal.qty,
          caseSize: proposal.caseSize,
          type: "nearDuplicate",
          // wasPreferredSupplier is genuinely unknown here without an extra product read;
          // null signals "not determined" rather than a wrong false.
          wasPreferredSupplier: null,
          oldPrice: existingP ?? null,
          changePercent,
          direction,
          note: "Near-duplicate match confirmed",
        }));
        ops++;
      }
      // Now has a real product ID â queue for area-item linking
      newlyResolvedMap[proposal.lineName] = proposal.candidateProductId;

    } else if (proposal.type === "newProduct") {
      const newRef = db.collection(`venues/${venueId}/products`).doc();
      const cs = proposal.caseSize;
      const caseSizeFields = computeCaseSizeFields(proposal.unitPrice ?? null, cs);
      batch.set(newRef, {
        name: proposal.lineName,
        costPrice: proposal.unitPrice,
        // Brand new product â priorQty is unambiguously 0, nothing to read.
        // Establishes the basis for the NEXT invoice's recompute to chain
        // from. Not physical_count: that tier is reserved for the
        // cycle-reset trigger (Â§8a, Phase P3b), not an ad-hoc induction.
        costPriceQuantityBasis: proposal.qty,
        costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
        quantityConfidence: "estimated_no_sales",
        costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        costPriceSource: "invoice",
        lastInvoicePrice: proposal.unitPrice,
        lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
        supplierId: cleanSupplierId,
        supplierName: cleanSupplierName,
        ...(cleanSupplierId
          ? { primarySupplierId: cleanSupplierId, primarySupplierName: cleanSupplierName }
          : {}),
        inductionSource: "invoice-price-tracking",
        inductionStatus: "pending",
        priceChanged: false,
        gstPercent: venueCountry === 'AU' ? 10 : 15,
        ...caseSizeFields,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (cleanSupplierId) {
        const newSubRef = db.doc(
          `venues/${venueId}/products/${newRef.id}/suppliers/${cleanSupplierId}`
        );
        const unitCost = proposal.unitPrice ?? null;
        const caseCost = cs != null && proposal.unitPrice != null ? proposal.unitPrice * cs : null;
        batch.set(newSubRef, {
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          unitCost,
          caseSize: cs,
          caseCost,
          isPreferred: true,
          relationship: "preferred",
          agreedPrice: proposal.unitPrice,
          agreedPriceSource: "invoice",
          lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
          lastInvoicePrice: proposal.unitPrice,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
          addedBy: "invoice-import",
        });
        ops++;
      }
      // priceHistory entry for the initial price â costPriceSource already set on the product doc above
      if (proposal.unitPrice != null) {
        const newHistRef = newRef.collection("priceHistory").doc();
        batch.set(newHistRef, {
          date: admin.firestore.FieldValue.serverTimestamp(),
          oldPrice: null,
          newPrice: proposal.unitPrice,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          invoiceId,
          changePercent: null,
          direction: "initial",
          source: "invoice",
          note: "Initial price set â new product from invoice",
        });
        ops++;
      }
      // Site 5: per-supplier invoiceHistory for new product induction.
      // wasPreferredSupplier: true because cleanSupplierId is set as primarySupplierId above.
      if (cleanSupplierId && proposal.unitPrice != null) {
        const suppRef = newRef.collection("suppliers").doc(cleanSupplierId);
        const invHistRef = suppRef.collection("invoiceHistory").doc();
        batch.set(invHistRef, buildInvoiceHistoryEntry({
          invoiceId,
          productId: newRef.id,
          productName: proposal.lineName,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          unitCost: proposal.unitPrice,
          qty: proposal.qty,
          caseSize: cs,
          type: "newProduct",
          wasPreferredSupplier: true,
          oldPrice: null,
          changePercent: null,
          direction: "initial",
          note: "Initial price set â new product from invoice",
        }));
        ops++;
      }
      ops++;
      created++;
      newlyResolvedMap[proposal.lineName] = newRef.id;
      console.log(`[commitInvoiceChanges] new product queued: "${proposal.lineName}"`);
    }
    // supplierLink proposals handled after the batch (need per-doc reads)
  }

  if (ops > 0) {
    await batch.commit();
    console.log("[commitInvoiceChanges] committed", { venueId, ops, changed, created, invoiceId });
  }

  // Area-item linking for lines that got a real product ID for the first time
  await applyAreaItemLinking(db, venueId, newlyResolvedMap, "commitInvoiceChanges");

  // Supplier link proposals â individual reads, outside batch
  const supplierLinkProposals = accepted.filter(
    (p): p is ProposedAction & { type: "supplierLink" } => p.type === "supplierLink"
  );
  for (const proposal of supplierLinkProposals) {
    const supplierRef = db.doc(
      `venues/${venueId}/products/${proposal.productId}/suppliers/${proposal.supplierId}`
    );
    try {
      const snap = await supplierRef.get();
      const invoicePrice = proposal.caseSize
        ? proposal.unitCost * proposal.caseSize
        : proposal.unitCost;

      // wasPreferredSupplierForLink: set inside each branch; used by the invoiceHistory write below.
      // (The legacy-same-supplier continue path writes its own entry with wasPreferredSupplier:true.)
      let wasPreferredSupplierForLink = false;

      if (!snap.exists) {
        // Fresh product read (state may have changed since propose)
        const productSnap = await db
          .doc(`venues/${venueId}/products/${proposal.productId}`)
          .get();
        const productData = productSnap.data() as any;
        const legacySupplierId: string | null = productData?.supplierId || null;
        const hasPrimarySet = !!(productData?.primarySupplierId);
        const hasPreferred = !!(productData?.primarySupplierId || productData?.supplierId);
        // supplier becomes preferred only if no preferred link existed before this invoice
        wasPreferredSupplierForLink = !hasPreferred;

        // Backfill legacy-only products into the new model before processing the new link
        if (!hasPrimarySet && legacySupplierId) {
          const legacySubRef = db.doc(
            `venues/${venueId}/products/${proposal.productId}/suppliers/${legacySupplierId}`
          );
          const legacySubSnap = await legacySubRef.get();
          if (!legacySubSnap.exists) {
            await legacySubRef.set({
              supplierId: legacySupplierId,
              supplierName: productData.supplierName || '',
              unitCost: productData.costPrice ?? null,
              caseSize: productData.caseSize ?? null,
              caseCost: null,
              isPreferred: true,
              relationship: 'preferred',
              lastInvoicePrice: productData.lastInvoicePrice ?? null,
              addedAt: admin.firestore.FieldValue.serverTimestamp(),
              addedBy: 'migration',
            });
          }
          await db.doc(`venues/${venueId}/products/${proposal.productId}`).update({
            primarySupplierId: legacySupplierId,
            primarySupplierName: productData.supplierName || '',
            supplierCount: 1,
          });
          // Invoice supplier is the same as the just-backfilled legacy supplier â
          // update its invoice data and skip the set below to avoid overwriting preferredâalternative
          if (legacySupplierId === proposal.supplierId) {
            await supplierRef.update({
              unitCost: proposal.unitCost,
              caseSize: proposal.caseSize,
              lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
              lastInvoicePrice: invoicePrice,
            });
            // Â§8's corrected model: a genuine purchase from ANY supplier must
            // move the canonical cost, blended by quantity â supplierLink
            // previously never touched product.costPrice at all. productData
            // is already loaded above, no new read needed.
            const wac6a = recomputeWeightedAverageCost(productData, salesReportsData, proposal.qty, proposal.unitCost);
            await db.doc(`venues/${venueId}/products/${proposal.productId}`).update({
              costPrice: wac6a.costPrice,
              costPriceQuantityBasis: wac6a.costPriceQuantityBasis,
              costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
              quantityConfidence: wac6a.quantityConfidence,
              costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              costPriceSource: "invoice",
            });
            // Site 6a: invoiceHistory for legacy-same-supplier path.
            // wasPreferredSupplier: true â this IS the legacy preferred supplier being updated.
            await supplierRef.collection("invoiceHistory").doc().set(buildInvoiceHistoryEntry({
              invoiceId,
              productId: proposal.productId,
              productName: proposal.productName,
              supplierId: proposal.supplierId,
              supplierName: proposal.supplierName,
              unitCost: proposal.unitCost,
              qty: proposal.qty,
              caseSize: proposal.caseSize,
              type: "supplierLink",
              wasPreferredSupplier: true,
            }));
            continue;
          }
        }

        await supplierRef.set({
          supplierId: proposal.supplierId,
          supplierName: proposal.supplierName,
          unitCost: proposal.unitCost,
          caseSize: proposal.caseSize,
          caseCost: proposal.caseSize ? invoicePrice : null,
          isPreferred: !hasPreferred,
          relationship: "alternative",
          agreedPrice: proposal.unitCost,
          agreedPriceSetAt: admin.firestore.FieldValue.serverTimestamp(),
          agreedPriceSource: "invoice",
          lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
          lastInvoicePrice: invoicePrice,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
          addedBy: "invoice-import",
        });
        // Â§8's corrected model: a genuine purchase from an alternative supplier
        // still moves the canonical blended cost. productData already loaded
        // above (same read used for the legacy-backfill check), no new read.
        // primarySupplierId is folded into this same update (spread below) â
        // same document, no batch in this section, so merging avoids a
        // separate round-trip.
        const wac6b = recomputeWeightedAverageCost(productData, salesReportsData, proposal.qty, proposal.unitCost);
        await db.doc(`venues/${venueId}/products/${proposal.productId}`).update({
          costPrice: wac6b.costPrice,
          costPriceQuantityBasis: wac6b.costPriceQuantityBasis,
          costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
          quantityConfidence: wac6b.quantityConfidence,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: "invoice",
          ...(!hasPreferred
            ? { primarySupplierId: proposal.supplierId, primarySupplierName: proposal.supplierName }
            : {}),
        });
      } else {
        // Existing link â record whether it was already the preferred supplier
        wasPreferredSupplierForLink = (snap.data() as any)?.isPreferred === true;
        await supplierRef.update({
          unitCost: proposal.unitCost,
          caseSize: proposal.caseSize,
          lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
          lastInvoicePrice: invoicePrice,
        });
        // Â§8's corrected model: this is the one sub-case with no existing
        // product-level read at all (snap above is the SUPPLIER subdoc, not
        // the product) â a genuinely new read, unlike 6a/6b which reuse
        // productData already loaded elsewhere in this function.
        const productSnap7 = await db.doc(`venues/${venueId}/products/${proposal.productId}`).get();
        const productData7 = productSnap7.data() as any;
        const wac7 = recomputeWeightedAverageCost(productData7, salesReportsData, proposal.qty, proposal.unitCost);
        await db.doc(`venues/${venueId}/products/${proposal.productId}`).update({
          costPrice: wac7.costPrice,
          costPriceQuantityBasis: wac7.costPriceQuantityBasis,
          costPriceBasisAt: admin.firestore.FieldValue.serverTimestamp(),
          quantityConfidence: wac7.quantityConfidence,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: "invoice",
        });
      }
      // Sites 6b & 7: per-supplier invoiceHistory â one entry covering both the new-link
      // and existing-link paths (legacy-same-supplier continue path is handled at site 6a above)
      await supplierRef.collection("invoiceHistory").doc().set(buildInvoiceHistoryEntry({
        invoiceId,
        productId: proposal.productId,
        productName: proposal.productName,
        supplierId: proposal.supplierId,
        supplierName: proposal.supplierName,
        unitCost: proposal.unitCost,
        qty: proposal.qty,
        caseSize: proposal.caseSize,
        type: "supplierLink",
        wasPreferredSupplier: wasPreferredSupplierForLink,
      }));
    } catch (e: any) {
      console.log("[commitInvoiceChanges] supplier link error", proposal.productId, e?.message);
    }
  }

  return { changed, created, productMap: newlyResolvedMap };
}
