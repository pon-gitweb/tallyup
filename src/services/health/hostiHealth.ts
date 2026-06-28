// @ts-nocheck
/**
 * Hosti Health — Phase 1.
 * Stage 1 (before the first stocktake): a data-completeness checklist, no score.
 * Stage 2 (after the first stocktake): an honest, wide estimated score range
 * while confidence builds. Real variance-driven scoring lands in Phase 2.
 */
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export interface HostiHealthStage1 {
  stage: 1;
  progress: {
    hasProducts: boolean;       // productCount > 0
    hasCostPrices: boolean;     // at least 50% of products have costPrice > 0
    hasSuppliers: boolean;      // supplierCount > 0
    hasHourlyRate: boolean;     // venueSettings.hourlyRate exists
    hasFirstStocktake: boolean; // totalStocktakesCompleted >= 1
  };
  completedSteps: number;       // 0–5
  totalSteps: number;           // always 5
}

export interface HostiHealthStage2 {
  stage: 2;
  scoreMin: number;             // estimated range low
  scoreMax: number;             // estimated range high
  confidence: 'Very Low' | 'Building' | 'Medium' | 'High';
  completedStocktakes: number;
  stockValue: number | null;
}

export type HostiHealthData = HostiHealthStage1 | HostiHealthStage2;

export async function getHostiHealthStage(
  venueId: string,
  totalStocktakesCompleted: number,
  productCount: number,
  supplierCount: number,
  stockValue: number | null,
): Promise<HostiHealthData> {
  // Stage 1: fewer than 1 completed stocktake
  if (totalStocktakesCompleted < 1) {
    let hasHourlyRate = false;
    try {
      const labourSnap = await getDoc(doc(db, 'venues', venueId, 'settings', 'labour'));
      hasHourlyRate = typeof labourSnap.data()?.hourlyRate === 'number';
    } catch {
      // Non-fatal — treat as not configured
    }

    let hasCostPrices = false;
    try {
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const total = productsSnap.size;
      if (total > 0) {
        let priced = 0;
        productsSnap.forEach(d => {
          const costPrice = (d.data() as any)?.costPrice;
          if (typeof costPrice === 'number' && costPrice > 0) priced++;
        });
        hasCostPrices = priced / total >= 0.5;
      }
    } catch {
      // Non-fatal — treat as incomplete
    }

    const progress = {
      hasProducts: productCount > 0,
      hasCostPrices,
      hasSuppliers: supplierCount > 0,
      hasHourlyRate,
      hasFirstStocktake: totalStocktakesCompleted >= 1,
    };
    const completedSteps = Object.values(progress).filter(Boolean).length;

    return {
      stage: 1,
      progress,
      completedSteps,
      totalSteps: 5,
    };
  }

  // Stage 2: 1 completed stocktake — honest wide range, narrows in Phase 2
  // once real variance data feeds into it. All venues start at 50–70.
  return {
    stage: 2,
    scoreMin: 50,
    scoreMax: 70,
    confidence: 'Building',
    completedStocktakes: totalStocktakesCompleted,
    stockValue,
  };
}
