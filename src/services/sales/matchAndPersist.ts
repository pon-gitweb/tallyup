import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, addDoc, serverTimestamp, Timestamp
} from 'firebase/firestore';
import type { NormalizedSalesReport } from './types';
import { tokenizeForMatching, overlapCoefficient, isReliableMatch } from '../nameMatching';

/** Accumulator for all lines in a single report that matched the same recipe. */
type RecipeMatchAgg = {
  recipeId:    string;
  recipeName:  string;
  lines:        { name: string; qtySold: number; gross: number | null; matchScore: number }[];
  qtySoldTotal: number;
  grossAccum:   number;
  hasNullGross: boolean;
};

/**
 * Match sales lines against products, then (for lines that don't match any
 * product) fuzzy-match against recipes using the same
 * tokenizeForMatching/overlapCoefficient/isReliableMatch logic already used
 * throughout the codebase. Lines that match neither fall through to
 * salesReportUnknowns, exactly as before.
 *
 * Firestore writes:
 *   venues/{v}/salesReportMatches       — product-match summary (unchanged shape)
 *   venues/{v}/salesReportRecipeMatches — one doc per (report × recipe) pair;
 *                                         queryable by recipeId and by period
 *   venues/{v}/salesReportUnknowns      — one doc per truly unmatched line
 *
 * Shape of salesReportRecipeMatches docs:
 *   reportId, recipeId, recipeName,
 *   matchedLines: [{name, qtySold, gross, matchScore}],
 *   qtySoldTotal, grossTotal,
 *   periodStart: Timestamp|null, periodEnd: Timestamp|null,
 *   createdAt: serverTimestamp()
 *
 * The overlappingCycles / allocationMethod / status fields live on the parent
 * salesReport doc (pointed to by reportId) — tagOverlappingCycles writes those
 * after this function runs, so they cannot be denormalized here. Consumers that
 * need cycle data join through reportId.
 */
export async function matchAndPersistSalesReport(args: {
  venueId:  string;
  reportId: string;
  report:   NormalizedSalesReport;
}) {
  const { venueId, reportId, report } = args;
  const db = getFirestore(getApp());

  // ── Convert period strings → Timestamps for recipe match docs ──────────────
  // report.period.{start,end} are YYYY-MM-DD strings from the normalized report.
  const rawStart = report?.period?.start ?? null;
  const rawEnd   = report?.period?.end   ?? null;
  const toTs = (s: string | null, suffix: string): Timestamp | null => {
    if (!s) return null;
    const d = new Date(s + suffix);
    return isFinite(d.getTime()) ? Timestamp.fromDate(d) : null;
  };
  const periodStartTs = toTs(rawStart, 'T00:00:00');
  const periodEndTs   = toTs(rawEnd,   'T23:59:59');

  // ── Load products ─────────────────────────────────────────────────────────
  const prodSnap  = await getDocs(collection(db, 'venues', venueId, 'products'));
  const byBarcode = new Map<string, any>();
  const bySku     = new Map<string, any>();
  const prodList:  any[] = [];

  prodSnap.forEach(d => {
    const p: any = { id: d.id, ...d.data() };
    const bc  = (p.barcode || p.barCode || p.bar_code || '').toString().trim();
    const sku = (p.sku     || p.code                 || '').toString().trim();
    if (bc)  byBarcode.set(bc,  p);
    if (sku) bySku.set(sku,     p);
    prodList.push(p);
  });

  // ── Load recipes ──────────────────────────────────────────────────────────
  const recipeSnap = await getDocs(collection(db, 'venues', venueId, 'recipes'));
  const recipeList: { id: string; name: string }[] = [];
  recipeSnap.forEach(d => {
    const data: any = d.data();
    if (typeof data.name === 'string' && data.name.trim()) {
      recipeList.push({ id: d.id, name: data.name.trim() });
    }
  });

  // ── Pass 1: product matching ───────────────────────────────────────────────
  const productMatches:   any[]              = [];
  const productUnmatched: { line: any }[]    = [];

  for (const ln of report?.lines || []) {
    const b = (ln.barcode || '').toString().trim();
    const s = (ln.sku    || '').toString().trim();
    const n = (ln.name   || '').toString().trim().toLowerCase();

    let hit: any = null;
    if (!hit && b && byBarcode.has(b)) hit = byBarcode.get(b);
    if (!hit && s && bySku.has(s))     hit = bySku.get(s);
    if (!hit && n) hit = prodList.find(p => (p.name || '').toString().toLowerCase().includes(n));

    if (hit) {
      productMatches.push({
        productId:   hit.id,
        productName: hit.name || null,
        sku:         s || null,
        barcode:     b || null,
        name:        ln.name || null,
        qtySold:     Number(ln.qtySold || 0),
        gross:       ln.gross ?? null,
        net:         ln.net   ?? null,
        tax:         ln.tax   ?? null,
      });
    } else {
      productUnmatched.push({ line: ln });
    }
  }

  // ── Pass 2: recipe matching for product-unmatched lines ───────────────────
  // Uses tokenizeForMatching + overlapCoefficient + isReliableMatch (score ≥ 0.85
  // with token-size guard) — the same matcher already used throughout the codebase.
  // Grouped by recipeId: one doc per (report × recipe) pair written to Firestore.
  const recipeAggMap = new Map<string, RecipeMatchAgg>();
  const trueUnknowns: { line: any }[] = [];

  for (const { line: ln } of productUnmatched) {
    const lineName = (ln.name || '').toString().trim();
    if (!lineName) { trueUnknowns.push({ line: ln }); continue; }

    const lnTokens  = tokenizeForMatching(lineName);
    let bestScore   = 0;
    let bestRecipe: { id: string; name: string } | null = null;

    for (const recipe of recipeList) {
      const score    = overlapCoefficient(lineName, recipe.name);
      const rTokens  = tokenizeForMatching(recipe.name);
      if (isReliableMatch(lnTokens, rTokens, score) && score > bestScore) {
        bestScore  = score;
        bestRecipe = recipe;
      }
    }

    if (bestRecipe) {
      let agg = recipeAggMap.get(bestRecipe.id);
      if (!agg) {
        agg = {
          recipeId:    bestRecipe.id,
          recipeName:  bestRecipe.name,
          lines:        [],
          qtySoldTotal: 0,
          grossAccum:   0,
          hasNullGross: false,
        };
        recipeAggMap.set(bestRecipe.id, agg);
      }
      const qty   = Number(ln.qtySold || 0);
      const gross = ln.gross ?? null;
      agg.lines.push({ name: lineName, qtySold: qty, gross, matchScore: bestScore });
      agg.qtySoldTotal += qty;
      if (gross === null) agg.hasNullGross = true;
      else                agg.grossAccum  += gross;
    } else {
      trueUnknowns.push({ line: ln });
    }
  }

  // ── Persist: product match summary ────────────────────────────────────────
  await addDoc(collection(db, 'venues', venueId, 'salesReportMatches'), {
    reportId,
    counts: {
      total:         report?.lines?.length || 0,
      matched:       productMatches.length,
      recipeMatched: recipeAggMap.size,
      unknowns:      trueUnknowns.length,
    },
    matches:  productMatches,
    period:   report?.period || {},
    createdAt: serverTimestamp(),
  });

  // ── Persist: recipe match docs — one per (report × recipe) pair ───────────
  for (const agg of recipeAggMap.values()) {
    // grossTotal: sum of non-null gross values.
    // null only when every line had null gross (no revenue data available at all).
    const grossTotal: number | null =
      agg.hasNullGross && agg.grossAccum === 0 ? null : agg.grossAccum;

    await addDoc(collection(db, 'venues', venueId, 'salesReportRecipeMatches'), {
      reportId,
      recipeId:     agg.recipeId,
      recipeName:   agg.recipeName,
      matchedLines:  agg.lines,
      qtySoldTotal:  agg.qtySoldTotal,
      grossTotal,
      // Period as Timestamps — allows date-range queries without joining to salesReport.
      // overlappingCycles / status are NOT denormalized here: they live on the parent
      // salesReport doc (written later by tagOverlappingCycles). Join via reportId.
      periodStart:  periodStartTs,
      periodEnd:    periodEndTs,
      createdAt:    serverTimestamp(),
    });
  }

  // ── Persist: true unknowns (matched neither product nor recipe) ───────────
  for (const u of trueUnknowns) {
    await addDoc(collection(db, 'venues', venueId, 'salesReportUnknowns'), {
      reportId,
      line:      u.line,
      status:    'unmapped',
      createdAt: serverTimestamp(),
    });
  }

  return {
    ok:            true,
    matched:       productMatches.length,
    recipeMatched: recipeAggMap.size,
    unknowns:      trueUnknowns.length,
  };
}
