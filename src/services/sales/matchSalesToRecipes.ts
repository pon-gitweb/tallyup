// @ts-nocheck
/**
 * Recipe-aware sales matching and theoretical consumption engine.
 *
 * Step 1: Match sales lines to confirmed recipes by name (fuzzy)
 * Step 2: Multiply qtySold × consumptionPerServe per ingredient
 * Step 3: Write theoreticalConsumption to Firestore
 * Step 4: Write recipeSalesAttribution for reverse lookup in variance report
 *
 * Firestore writes:
 *   venues/{v}/theoreticalConsumption  (one doc, merged)
 *   venues/{v}/recipeSalesAttribution  (one doc per match)
 */

import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  addDoc,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

type SalesLine = {
  name: string;
  qtySold: number;
  sku?: string | null;
  barcode?: string | null;
  gross?: number | null;
};

type ConsumptionBucket = { ml?: number; g?: number; each?: number };

// Normalise a string for fuzzy matching
const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Score how well two names match (0 = no match, 1 = exact)
function matchScore(salesName: string, recipeName: string): number {
  const s = norm(salesName);
  const r = norm(recipeName);
  if (!s || !r) return 0;
  if (s === r) return 1;
  if (s.includes(r) || r.includes(s)) return 0.9;
  // word overlap score
  const sWords = new Set(s.split(' '));
  const rWords = r.split(' ');
  const overlap = rWords.filter(w => sWords.has(w)).length;
  return overlap > 0 ? (overlap / Math.max(sWords.size, rWords.length)) * 0.8 : 0;
}

const MATCH_THRESHOLD = 0.6; // minimum score to count as a match

export type RecipeMatchResult = {
  salesLine: SalesLine;
  recipeId: string;
  recipeName: string;
  score: number;
  qtySold: number;
  // productId → consumption in base units for qtySold serves
  consumptionByProduct: Record<string, ConsumptionBucket>;
};

export type TheoreticalConsumptionResult = {
  matched: RecipeMatchResult[];
  unmatched: SalesLine[];
  // productId → total theoretical consumption across all matched sales
  totalByProduct: Record<string, ConsumptionBucket>;
};

/**
 * Load all confirmed recipes for a venue and return them with their
 * consumptionPerServe maps already attached.
 */
async function loadConfirmedRecipes(venueId: string) {
  const snap = await getDocs(
    query(
      collection(db, 'venues', venueId, 'recipes'),
      where('status', '==', 'confirmed')
    )
  );
  const recipes: any[] = [];
  snap.forEach(d => recipes.push({ id: d.id, ...(d.data() as any) }));
  return recipes;
}

/**
 * Match a list of sales lines against confirmed recipes.
 * Returns full match results plus totals by product.
 */
export async function matchSalesToRecipes(
  venueId: string,
  lines: SalesLine[]
): Promise<TheoreticalConsumptionResult> {
  if (!venueId) throw new Error('venueId required');

  const recipes = await loadConfirmedRecipes(venueId);
  const matched: RecipeMatchResult[] = [];
  const unmatched: SalesLine[] = [];
  const totalByProduct: Record<string, ConsumptionBucket> = {};

  for (const line of lines) {
    if (!line.name || line.qtySold <= 0) {
      unmatched.push(line);
      continue;
    }

    // Find best matching recipe
    let bestScore = 0;
    let bestRecipe: any = null;

    for (const recipe of recipes) {
      const score = matchScore(line.name, recipe.name || '');
      if (score > bestScore) {
        bestScore = score;
        bestRecipe = recipe;
      }
    }

    if (!bestRecipe || bestScore < MATCH_THRESHOLD) {
      unmatched.push(line);
      continue;
    }

    // Use pre-computed consumptionPerServe if available, else fall back to items
    const consumptionPerServe: Record<string, ConsumptionBucket> =
      bestRecipe.consumptionPerServe || {};

    // Multiply by qtySold to get total consumption for this sales line
    const consumptionByProduct: Record<string, ConsumptionBucket> = {};
    for (const [productId, bucket] of Object.entries(consumptionPerServe)) {
      const b = bucket as ConsumptionBucket;
      const scaled: ConsumptionBucket = {};
      if (b.ml != null) scaled.ml = b.ml * line.qtySold;
      if (b.g != null) scaled.g = b.g * line.qtySold;
      if (b.each != null) scaled.each = b.each * line.qtySold;
      consumptionByProduct[productId] = scaled;

      // Accumulate into totals
      const total = totalByProduct[productId] || {};
      if (scaled.ml != null) total.ml = (total.ml ?? 0) + scaled.ml;
      if (scaled.g != null) total.g = (total.g ?? 0) + scaled.g;
      if (scaled.each != null) total.each = (total.each ?? 0) + scaled.each;
      totalByProduct[productId] = total;
    }

    matched.push({
      salesLine: line,
      recipeId: bestRecipe.id,
      recipeName: bestRecipe.name,
      score: bestScore,
      qtySold: line.qtySold,
      consumptionByProduct,
    });
  }

  return { matched, unmatched, totalByProduct };
}

/**
 * Run match and persist results to Firestore.
 *
 * Writes:
 *   venues/{v}/reports/theoreticalConsumption  — totals by product
 *   venues/{v}/recipeSalesAttribution (collection) — one doc per match
 */
export async function matchAndPersist(
  venueId: string,
  lines: SalesLine[],
  reportId: string
): Promise<TheoreticalConsumptionResult> {
  const result = await matchSalesToRecipes(venueId, lines);

  // Write theoretical consumption totals
  const consRef = doc(db, 'venues', venueId, 'reports', 'theoreticalConsumption');
  await setDoc(
    consRef,
    {
      reportId,
      generatedAt: serverTimestamp(),
      byProduct: result.totalByProduct,
      matchedLines: result.matched.length,
      unmatchedLines: result.unmatched.length,
    },
    { merge: true }
  );

  // Write one attribution doc per matched line
  const attrCol = collection(db, 'venues', venueId, 'recipeSalesAttribution');
  for (const m of result.matched) {
    await addDoc(attrCol, {
      reportId,
      recipeId: m.recipeId,
      recipeName: m.recipeName,
      matchScore: m.score,
      salesLineName: m.salesLine.name,
      qtySold: m.qtySold,
      consumptionByProduct: m.consumptionByProduct,
      createdAt: serverTimestamp(),
    });
  }

  if (__DEV__) {
    console.log(
      '[matchSalesToRecipes] matched:', result.matched.length,
      'unmatched:', result.unmatched.length,
      'products tracked:', Object.keys(result.totalByProduct).length
    );
  }

  return result;
}

/**
 * Reverse attribution: given a productId and its variance (onHand - expected),
 * find which recipes from recent sales explain the variance.
 *
 * Returns attributions sorted by how much of the variance they explain.
 */
export async function attributeVarianceToRecipes(
  venueId: string,
  productId: string,
  varianceMl: number,
  varianceG: number,
  varianceEach: number
): Promise<{
  recipeId: string;
  recipeName: string;
  qtySold: number;
  consumedMl: number;
  consumedG: number;
  consumedEach: number;
  attributedPct: number; // 0-100, how much of the variance this recipe explains
}[]> {
  // Load recent attribution docs for this product
  const snap = await getDocs(
    collection(db, 'venues', venueId, 'recipeSalesAttribution')
  );

  const byRecipe: Record<string, {
    recipeId: string;
    recipeName: string;
    qtySold: number;
    ml: number;
    g: number;
    each: number;
  }> = {};

  snap.forEach(d => {
    const data: any = d.data() || {};
    const consumption = data.consumptionByProduct?.[productId];
    if (!consumption) return;

    const key = data.recipeId;
    if (!byRecipe[key]) {
      byRecipe[key] = {
        recipeId: data.recipeId,
        recipeName: data.recipeName,
        qtySold: 0,
        ml: 0,
        g: 0,
        each: 0,
      };
    }
    byRecipe[key].qtySold += Number(data.qtySold || 0);
    byRecipe[key].ml += Number(consumption.ml || 0);
    byRecipe[key].g += Number(consumption.g || 0);
    byRecipe[key].each += Number(consumption.each || 0);
  });

  // Calculate what % of the variance each recipe explains
  const absVar = Math.abs(varianceMl) + Math.abs(varianceG) + Math.abs(varianceEach);

  return Object.values(byRecipe)
    .map(r => {
      const consumed = r.ml + r.g + r.each;
      const attributedPct =
        absVar > 0 ? Math.min(100, (consumed / absVar) * 100) : 0;
      return {
        recipeId: r.recipeId,
        recipeName: r.recipeName,
        qtySold: r.qtySold,
        consumedMl: r.ml,
        consumedG: r.g,
        consumedEach: r.each,
        attributedPct: Math.round(attributedPct * 10) / 10,
      };
    })
    .filter(r => r.attributedPct > 0)
    .sort((a, b) => b.attributedPct - a.attributedPct);
}
