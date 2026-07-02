// ─── Interfaces ───────────────────────────────────────────────────────────────

export type PredictionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type PredictionBasis = 'prior_year' | 'benchmark';

export interface PredictionResult {
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  predictedQty: number;    // safeOrderQty — the recommended order quantity
  bufferedQty: number;     // demand + buffer, before return allowance math
  unitCost: number | null;
  estimatedCost: number | null;
  confidence: PredictionConfidence;
  basis: PredictionBasis;
  notes: string[];
  minimumCommitment: number | null;
  // Return allowance fields
  returnAllowancePercent: number;
  maxReturnable: number;
  targetSellQty: number;
  safeOrderQty: number;
  // Obligation / rider / activation (set by screen post-processing)
  obligationAdjusted?: boolean;
  obligationMin?: number | null;
  riderQty?: number;
  activationQty?: number;
  totalQty?: number;
}

// ─── Category benchmarks (units per person per day) ──────────────────────────

const BENCHMARKS: Record<string, number> = {
  beer:    2.8,
  wine:    0.6,
  spirits: 0.4,
  rtd:     1.2,
  na:      0.8,
};

// Event type modifiers
const EVENT_MODIFIERS: Record<string, Record<string, number>> = {
  music_festival: { beer: 1.2, rtd: 1.1, wine: 0.9, spirits: 1.0, na: 1.0 },
  food_wine:      { beer: 0.9, wine: 1.3, spirits: 1.0, rtd: 0.9, na: 1.1 },
  sports:         { beer: 1.1, rtd: 1.2, wine: 0.7, spirits: 0.8, na: 1.0 },
  corporate:      { beer: 0.8, wine: 1.2, spirits: 1.1, rtd: 0.8, na: 1.2 },
  // Estimates pending real data — update after first year of tracking
  fringe_arts:    { beer: 0.8, wine: 1.1, spirits: 1.0, rtd: 0.7, na: 1.1 },
  community:      { beer: 0.7, wine: 0.8, spirits: 0.5, rtd: 0.8, na: 1.3 },
  markets:        { beer: 0.7, wine: 0.9, spirits: 0.5, rtd: 0.7, na: 1.4 },
  default:        { beer: 1.0, wine: 1.0, spirits: 1.0, rtd: 1.0, na: 1.0 },
};

// Price positioning modifiers
const PRICE_MODIFIERS: Record<string, number> = {
  budget:    1.15,
  mid:       1.0,
  mid_range: 1.0,
  premium:   0.85,
};

export function guessCategory(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('beer') || n.includes('lager') || n.includes('ale') || n.includes('ipa')) return 'beer';
  if (n.includes('wine') || n.includes('sauvignon') || n.includes('pinot') || n.includes('rosé') || n.includes('rose') || n.includes('champagne')) return 'wine';
  if (n.includes('spirit') || n.includes('whisky') || n.includes('whiskey') || n.includes('vodka') || n.includes('rum') || n.includes('gin')) return 'spirits';
  if (n.includes('rtd') || n.includes('seltzer') || n.includes('hard') || n.includes('ready')) return 'rtd';
  return 'na';
}

// ─── Main function ────────────────────────────────────────────────────────────

export function generatePurchasingPrediction(
  event: {
    attendance: number;
    eventDays: number;
    eventType?: string;
    pricePositioning?: 'budget' | 'mid' | 'mid_range' | 'premium' | 'mixed';
  },
  products: {
    id: string;
    name: string;
    category?: string;
    supplierId: string;
    supplierName: string;
    unitCost?: number;
    minimumCommitment?: number;
    returnAllowancePercent?: number;
  }[],
  priorYearData: {
    productId: string;
    lastYearSales: number;
    lastYearAttendance: number;
  }[] = [],
  bufferPercent: number = 15,
  priorYearActuals?: { actualsPerProduct: Record<string, { name: string; consumed: number; unit: string | null }> } | null,
  growthRate?: number,
): PredictionResult[] {
  const results: PredictionResult[] = [];

  const eventType = event.eventType ?? 'default';
  const modifiers = EVENT_MODIFIERS[eventType] ?? EVENT_MODIFIERS.default;
  const priceMultiplier = PRICE_MODIFIERS[event.pricePositioning ?? 'mid'] ?? 1.0;

  // ── Market share pre-computation ─────────────────────────────────────────
  // Group products that will use benchmark path (no prior-year data) by category.
  // Each product gets an equal share of its category's total volume.
  const benchmarkIdsByCategory: Record<string, string[]> = {};
  for (const product of products) {
    const priorYear = priorYearData.find(p => p.productId === product.id);
    if (!priorYear || priorYear.lastYearAttendance <= 0 || priorYear.lastYearSales <= 0) {
      const cat = product.category || guessCategory(product.name) || 'na';
      if (!benchmarkIdsByCategory[cat]) benchmarkIdsByCategory[cat] = [];
      benchmarkIdsByCategory[cat].push(product.id);
    }
  }

  // Pre-compute total category volume once per category (not per product)
  const categoryTotals: Record<string, number> = {};
  for (const cat of Object.keys(benchmarkIdsByCategory)) {
    const benchmarkPerPersonPerDay = BENCHMARKS[cat] ?? BENCHMARKS.na;
    const categoryModifier = modifiers[cat] ?? 1.0;
    categoryTotals[cat] = Math.round(
      benchmarkPerPersonPerDay * categoryModifier * priceMultiplier * event.attendance * event.eventDays
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  for (const product of products) {
    const notes: string[] = [];
    let predictedQty: number;
    let confidence: PredictionConfidence;
    let basis: PredictionBasis;

    const priorYear = priorYearData.find(p => p.productId === product.id);

    if (priorYear && priorYear.lastYearAttendance > 0 && priorYear.lastYearSales > 0) {
      // Path A: prior year data
      const attendanceRatio = event.attendance / priorYear.lastYearAttendance;
      predictedQty = Math.ceil(priorYear.lastYearSales * attendanceRatio);
      basis = 'prior_year';

      const attendanceChange = Math.abs(attendanceRatio - 1);
      confidence = attendanceChange <= 0.1 ? 'HIGH' : attendanceChange <= 0.3 ? 'MEDIUM' : 'LOW';

      notes.push(`Based on last year's ${priorYear.lastYearSales} units at ${priorYear.lastYearAttendance.toLocaleString()} attendance.`);
      if (attendanceRatio !== 1) {
        notes.push(`Attendance ${attendanceRatio > 1 ? `up ${Math.round((attendanceRatio - 1) * 100)}%` : `down ${Math.round((1 - attendanceRatio) * 100)}%`} from last year.`);
      }
    } else {
      // Path B: category benchmark with market share division
      const cat = product.category || guessCategory(product.name) || 'na';
      const catProductCount = benchmarkIdsByCategory[cat]?.length || 1;
      const marketShare = 1 / catProductCount;
      const catTotal = categoryTotals[cat] ?? 0;

      predictedQty = Math.max(1, Math.round(catTotal * marketShare));
      basis = 'benchmark';
      confidence = 'LOW';

      notes.push(`Category total: ${catTotal} units (${BENCHMARKS[cat] ?? BENCHMARKS.na} units/person/day × ${event.attendance.toLocaleString()} people × ${event.eventDays} day${event.eventDays !== 1 ? 's' : ''}).`);
      notes.push(`Market share: ${Math.round(marketShare * 100)}% of ${cat} category (${catProductCount} product${catProductCount !== 1 ? 's' : ''} — equal split).`);
      if (eventType !== 'default') {
        notes.push(`${eventType.replace(/_/g, ' ')} event type modifier applied.`);
      }
      if (event.pricePositioning && event.pricePositioning !== 'mid' && event.pricePositioning !== 'mid_range') {
        notes.push(`${event.pricePositioning} pricing modifier applied.`);
      }
    }

    // Override with prior year actuals when available
    if (priorYearActuals?.actualsPerProduct) {
      const prior = priorYearActuals.actualsPerProduct[product.id];
      if (prior && prior.consumed > 0) {
        const baseQty = Math.ceil(prior.consumed * (1 + (growthRate ?? 0)));
        predictedQty = baseQty;
        notes.push(
          `Based on ${prior.consumed} units consumed at prior event` +
          (growthRate ? ` × ${growthRate >= 0 ? '+' : ''}${(growthRate * 100).toFixed(0)}% growth` : '')
        );
        confidence = 'HIGH';
        basis = 'prior_year';
      }
    }

    // Apply buffer
    const bufferedQty = Math.ceil(predictedQty * (1 + bufferPercent / 100));

    // Sponsor/minimum commitment check
    let finalQty = bufferedQty;
    if (product.minimumCommitment && bufferedQty < product.minimumCommitment) {
      finalQty = product.minimumCommitment;
      notes.push(`⚠️ Quantity raised to meet supplier minimum commitment of ${product.minimumCommitment}.`);
    }

    const allowance = product.returnAllowancePercent ?? 5;
    // safeOrderQty: order this many so that even returning allowance% leaves demand covered
    // Math: need = safeOrderQty × (1 - allowance/100)  →  safeOrderQty = finalQty / (1 - allowance/100)
    const safeOrderQty = allowance < 100
      ? Math.ceil(finalQty / (1 - allowance / 100))
      : finalQty;
    const maxReturnable = Math.floor(safeOrderQty * allowance / 100);
    const targetSellQty = safeOrderQty - maxReturnable;
    const estimatedCost = product.unitCost != null ? product.unitCost * safeOrderQty : null;

    if (allowance > 0) {
      notes.push(`Return allowance ${allowance}% — order ${safeOrderQty}, target sell ${targetSellQty}, return up to ${maxReturnable}.`);
    }

    results.push({
      productId:              product.id,
      productName:            product.name,
      supplierId:             product.supplierId,
      supplierName:           product.supplierName,
      predictedQty:           safeOrderQty,   // recommended order quantity (return-allowance-aware)
      bufferedQty:            bufferedQty,     // demand + buffer before return allowance
      unitCost:               product.unitCost ?? null,
      estimatedCost,
      confidence,
      basis,
      notes,
      minimumCommitment:      product.minimumCommitment ?? null,
      returnAllowancePercent: allowance,
      maxReturnable,
      targetSellQty,
      safeOrderQty,
    });
  }

  return results;
}

export async function fetchPriorYearActuals(
  venueId: string,
  eventName: string
): Promise<{
  actualsPerProduct: Record<string, { name: string; consumed: number; unit: string | null }>;
  priorAttendance: number | null;
  priorEventDays: number | null;
  eventId: string;
  closedAt: any;
} | null> {
  try {
    const { getDocs, collection } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    const historySnap = await getDocs(
      collection(db, 'venues', venueId, 'eventHistory')
    );
    const matches = historySnap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(e => e.status === 'closed' && e.actualsPerProduct &&
        (e.eventName || '').toLowerCase().trim() === (eventName || '').toLowerCase().trim())
      .sort((a, b) => (b.closedAt?.toMillis?.() ?? 0) - (a.closedAt?.toMillis?.() ?? 0));
    if (!matches.length) return null;
    const prior = matches[0];
    return {
      actualsPerProduct: prior.actualsPerProduct,
      priorAttendance: prior.dailyAttendance ?? null,
      priorEventDays: prior.eventDays ?? null,
      eventId: prior.id,
      closedAt: prior.closedAt,
    };
  } catch {
    return null;
  }
}
