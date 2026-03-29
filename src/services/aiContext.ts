// @ts-nocheck
/**
 * AI Learning Context Store
 *
 * Accumulates venue data over time into a single snapshot document that
 * Claude reads when making AI suggestions. The more data, the smarter
 * the suggestions.
 *
 * Written to after:
 *  - Every stocktake area completion
 *  - Every sales report upload
 *  - Every order submission
 *
 * Read by:
 *  - variance-explain endpoint
 *  - suggest-orders endpoint
 *  - budget suggestion engine
 */

import {
  collection, doc, getDoc, getDocs, orderBy,
  query, setDoc, serverTimestamp, where, limit,
} from 'firebase/firestore';
import { db } from './firebase';

export type VenueAIContext = {
  updatedAt: any;
  stockCycleCount: number;
  salesCycleCount: number;
  orderCycleCount: number;
  topVarianceItems: {
    productId: string;
    name: string;
    avgVariancePct: number;
    unit: string | null;
    trend: 'improving' | 'worsening' | 'stable';
    shortageCount: number;
    excessCount: number;
  }[];
  topSellingRecipes: {
    recipeId: string;
    name: string;
    totalSold: number;
    ingredients: string[];
  }[];
  supplierSpend: {
    supplierId: string;
    name: string;
    totalSpend: number;
    orderCount: number;
  }[];
  frequentShortages: {
    productId: string;
    name: string;
    frequency: number;
  }[];
  peakDays: string[];
  avgWeeklyRevenue: number | null;
  dataQuality: 'low' | 'medium' | 'high';
  notes: string[];
};

const CTX_PATH = (venueId: string) =>
  doc(db, 'venues', venueId, 'aiContext', 'snapshot');

/** Read the current AI context for a venue */
export async function getAIContext(venueId: string): Promise<VenueAIContext | null> {
  try {
    const snap = await getDoc(CTX_PATH(venueId));
    return snap.exists() ? (snap.data() as VenueAIContext) : null;
  } catch {
    return null;
  }
}

/** Build and persist updated AI context from live Firestore data */
export async function refreshAIContext(venueId: string): Promise<void> {
  if (!venueId) return;

  const notes: string[] = [];
  let stockCycleCount = 0;
  let salesCycleCount = 0;
  let orderCycleCount = 0;

  // ── Count stocktake cycles ─────────────────────────────────────────────────
  try {
    const sessSnap = await getDocs(
      query(collection(db, 'venues', venueId, 'sessions'),
        where('type', '==', 'area-completed'))
    );
    stockCycleCount = sessSnap.size;
  } catch { notes.push('Could not read stocktake cycles'); }

  // ── Count sales uploads ────────────────────────────────────────────────────
  try {
    const salesSnap = await getDocs(
      collection(db, 'venues', venueId, 'salesReports')
    );
    salesCycleCount = salesSnap.size;
  } catch { notes.push('Could not read sales cycles'); }

  // ── Count orders ───────────────────────────────────────────────────────────
  try {
    const ordersSnap = await getDocs(
      query(collection(db, 'venues', venueId, 'orders'),
        where('status', 'in', ['submitted', 'received']))
    );
    orderCycleCount = ordersSnap.size;
  } catch { notes.push('Could not read order cycles'); }

  // ── Top variance items from latestCounts ──────────────────────────────────
  const topVarianceItems: VenueAIContext['topVarianceItems'] = [];
  try {
    const countsSnap = await getDoc(
      doc(db, 'venues', venueId, 'reports', 'latestCounts')
    );
    if (countsSnap.exists()) {
      const rows = (countsSnap.data()?.rows || []) as any[];
      const withVariance = rows
        .filter(r => typeof r.onHand === 'number' && typeof r.expected === 'number' && r.expected > 0)
        .map(r => ({
          productId: String(r.sku || ''),
          name: String(r.name || r.sku || ''),
          unit: r.unit || null,
          variance: r.onHand - r.expected,
          variancePct: Math.abs((r.onHand - r.expected) / r.expected) * 100,
        }))
        .filter(r => r.variancePct > 5)
        .sort((a, b) => b.variancePct - a.variancePct)
        .slice(0, 10);

      for (const r of withVariance) {
        topVarianceItems.push({
          productId: r.productId,
          name: r.name,
          avgVariancePct: Math.round(r.variancePct * 10) / 10,
          unit: r.unit,
          trend: 'stable',
          shortageCount: r.variance < 0 ? 1 : 0,
          excessCount: r.variance > 0 ? 1 : 0,
        });
      }
    }
  } catch { notes.push('Could not read variance data'); }

  // ── Top selling recipes from attribution ──────────────────────────────────
  const topSellingRecipes: VenueAIContext['topSellingRecipes'] = [];
  try {
    const attrSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'recipeSalesAttribution'),
        orderBy('qtySold', 'desc'),
        limit(20)
      )
    );
    const recipeMap: Record<string, { name: string; total: number; ingredients: Set<string> }> = {};
    attrSnap.forEach(d => {
      const data = d.data() as any;
      const id = data.recipeId;
      if (!id) return;
      if (!recipeMap[id]) recipeMap[id] = { name: data.recipeName || id, total: 0, ingredients: new Set() };
      recipeMap[id].total += Number(data.qtySold || 0);
      const consumption = data.consumptionByProduct || {};
      Object.keys(consumption).forEach(pid => recipeMap[id].ingredients.add(pid));
    });
    Object.entries(recipeMap)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 5)
      .forEach(([id, r]) => {
        topSellingRecipes.push({
          recipeId: id,
          name: r.name,
          totalSold: r.total,
          ingredients: Array.from(r.ingredients).slice(0, 6),
        });
      });
  } catch { notes.push('Could not read recipe attribution'); }

  // ── Supplier spend from orders ─────────────────────────────────────────────
  const supplierSpend: VenueAIContext['supplierSpend'] = [];
  try {
    const ordersSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'orders'),
        where('status', 'in', ['submitted', 'received']),
        limit(50)
      )
    );
    const spendMap: Record<string, { name: string; total: number; count: number }> = {};
    ordersSnap.forEach(d => {
      const data = d.data() as any;
      const sid = data.supplierId || 'unknown';
      const sname = data.supplierName || sid;
      const total = Number(data.totalCost || data.estimatedCost || 0);
      if (!spendMap[sid]) spendMap[sid] = { name: sname, total: 0, count: 0 };
      spendMap[sid].total += total;
      spendMap[sid].count += 1;
    });
    Object.entries(spendMap)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 8)
      .forEach(([id, s]) => {
        supplierSpend.push({
          supplierId: id,
          name: s.name,
          totalSpend: Math.round(s.total * 100) / 100,
          orderCount: s.count,
        });
      });
  } catch { notes.push('Could not read supplier spend'); }

  // ── Frequent shortages ─────────────────────────────────────────────────────
  const frequentShortages = topVarianceItems
    .filter(r => r.shortageCount > 0)
    .map(r => ({ productId: r.productId, name: r.name, frequency: r.shortageCount }));

  // ── Data quality score ─────────────────────────────────────────────────────
  const dataPoints = stockCycleCount + salesCycleCount + orderCycleCount;
  const dataQuality: VenueAIContext['dataQuality'] =
    dataPoints >= 20 ? 'high' : dataPoints >= 5 ? 'medium' : 'low';

  if (dataQuality === 'low') {
    notes.push('Complete more stocktakes and upload sales reports to improve AI suggestions.');
  }

  const context: VenueAIContext = {
    updatedAt: serverTimestamp(),
    stockCycleCount,
    salesCycleCount,
    orderCycleCount,
    topVarianceItems,
    topSellingRecipes,
    supplierSpend,
    frequentShortages,
    peakDays: [],
    avgWeeklyRevenue: null,
    dataQuality,
    notes,
  };

  await setDoc(CTX_PATH(venueId), context, { merge: true });

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[aiContext] refreshed', {
      venueId, dataQuality, stockCycles: stockCycleCount,
      varItems: topVarianceItems.length, recipes: topSellingRecipes.length,
    });
  }
}
