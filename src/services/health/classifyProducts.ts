// @ts-nocheck
/**
 * Abductive cellar/premium stock classifier — infers whether a product is
 * cellar or premium stock from signals already in the data (cost, unit,
 * velocity), with no user input required. Used to exclude that stock from
 * the operational Days of Cover calculation in hostiHealth.ts, since cellar
 * stock turns over far slower and would otherwise distort the reading.
 */
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export interface ProductClassification {
  productId: string;
  name: string;
  classification: 'cellar' | 'premium' | 'standard';
  confidence: number; // 0–100
  signals: string[];  // human-readable explanation of what triggered classification
  costPrice: number | null;
  stockValue: number; // lastCount * costPrice
}

export async function classifyVenueProducts(
  venueId: string
): Promise<ProductClassification[]> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const products = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  if (!products.length) return [];

  // Compute category-level cost statistics for relative comparison
  const categoryGroups: Record<string, number[]> = {};
  products.forEach(p => {
    if (typeof p.costPrice === 'number' && p.costPrice > 0) {
      const cat = p.category || 'uncategorised';
      if (!categoryGroups[cat]) categoryGroups[cat] = [];
      categoryGroups[cat].push(p.costPrice);
    }
  });

  // Compute 90th percentile per category
  const categoryP90: Record<string, number> = {};
  Object.entries(categoryGroups).forEach(([cat, prices]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.9);
    categoryP90[cat] = sorted[idx] ?? sorted[sorted.length - 1];
  });

  return products.map(p => {
    const signals: string[] = [];
    let score = 0;

    const cat = p.category || 'uncategorised';
    const p90 = categoryP90[cat];

    // Signal 1 — Cost in top 10% of category (+40 points)
    if (typeof p.costPrice === 'number' && p90 != null && p.costPrice >= p90) {
      score += 40;
      signals.push(`Cost $${p.costPrice} is in top 10% for ${cat}`);
    }

    // Signal 2 — Unit is 'bottle' and not appearing in recipes (+25 points)
    // Note: recipe cross-reference would need a separate read — approximate by unit only for now
    if ((p.unit || '').toLowerCase() === 'bottle') {
      score += 15;
      signals.push('Sold by bottle');
    }

    // Signal 3 — Very low velocity: lastCount close to confirmedCount (+20 points)
    // Low velocity = less than 10% drawdown between cycles
    if (typeof p.lastCount === 'number' && typeof p.confirmedCount === 'number'
        && p.confirmedCount > 0) {
      const drawdown = (p.confirmedCount - p.lastCount) / p.confirmedCount;
      if (drawdown < 0.1) {
        score += 20;
        signals.push('Very low velocity — less than 10% drawdown between cycles');
      }
    }

    // Signal 4 — High absolute cost (over $80 regardless of category) (+15 points)
    if (typeof p.costPrice === 'number' && p.costPrice > 80) {
      score += 15;
      signals.push(`High absolute cost $${p.costPrice}`);
    }

    // Signal 5 — Whole number counts only (+5 points)
    if (typeof p.lastCount === 'number' && Number.isInteger(p.lastCount) && p.lastCount > 0) {
      score += 5;
      signals.push('Whole number count — typical of bottle-level tracking');
    }

    const classification: 'cellar' | 'premium' | 'standard' =
      score >= 70 ? 'cellar' :
      score >= 50 ? 'premium' :
      'standard';

    const stockValue = typeof p.lastCount === 'number' && typeof p.costPrice === 'number'
      ? p.lastCount * p.costPrice
      : 0;

    return {
      productId: p.id,
      name: p.name || '(Unnamed)',
      classification,
      confidence: Math.min(100, score),
      signals,
      costPrice: p.costPrice ?? null,
      stockValue,
    };
  });
}

export function separateStockLayers(classifications: ProductClassification[]) {
  const operational = classifications.filter(p => p.classification === 'standard');
  const premium = classifications.filter(p => p.classification === 'premium');
  const cellar = classifications.filter(p => p.classification === 'cellar');

  const operationalStockValue = operational.reduce((s, p) => s + p.stockValue, 0);
  const premiumStockValue = premium.reduce((s, p) => s + p.stockValue, 0);
  const cellarStockValue = cellar.reduce((s, p) => s + p.stockValue, 0);

  return {
    operational, premium, cellar,
    operationalStockValue,
    premiumStockValue,
    cellarStockValue,
    totalStockValue: operationalStockValue + premiumStockValue + cellarStockValue,
    cellarCount: cellar.length + premium.length,
  };
}
