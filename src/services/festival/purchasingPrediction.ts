// ─── Interfaces ───────────────────────────────────────────────────────────────

export type PredictionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type PredictionBasis = 'prior_year' | 'benchmark';

export interface PredictionResult {
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  predictedQty: number;
  bufferedQty: number;
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
  default:        { beer: 1.0, wine: 1.0, spirits: 1.0, rtd: 1.0, na: 1.0 },
};

// Price positioning modifiers
const PRICE_MODIFIERS: Record<string, number> = {
  budget:    1.15,
  mid:       1.0,
  mid_range: 1.0,
  premium:   0.85,
};

function guessCategory(name: string): string {
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
    pricePositioning?: 'budget' | 'mid' | 'premium';
  },
  products: {
    id: string;
    name: string;
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
): PredictionResult[] {
  const results: PredictionResult[] = [];

  const eventType = event.eventType ?? 'default';
  const modifiers = EVENT_MODIFIERS[eventType] ?? EVENT_MODIFIERS.default;
  const priceMultiplier = PRICE_MODIFIERS[event.pricePositioning ?? 'mid'];

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
      // Path B: category benchmark
      const category = guessCategory(product.name);
      const benchmarkPerPersonPerDay = BENCHMARKS[category] ?? BENCHMARKS.na;
      const categoryModifier = modifiers[category] ?? 1.0;

      predictedQty = Math.ceil(
        benchmarkPerPersonPerDay * categoryModifier * priceMultiplier * event.attendance * event.eventDays
      );
      basis = 'benchmark';
      confidence = 'LOW';

      notes.push(`Estimated from ${category} benchmark: ${benchmarkPerPersonPerDay} units/person/day × ${event.attendance.toLocaleString()} people × ${event.eventDays} day${event.eventDays !== 1 ? 's' : ''}.`);
      if (eventType !== 'default') {
        notes.push(`${eventType.replace('_', ' ')} event type modifier applied.`);
      }
      if (event.pricePositioning && event.pricePositioning !== 'mid') {
        notes.push(`${event.pricePositioning} pricing modifier applied.`);
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

    const estimatedCost = product.unitCost != null ? product.unitCost * finalQty : null;

    const allowance = product.returnAllowancePercent ?? 5;
    const maxReturnable = Math.floor(finalQty * allowance / 100);
    const targetSellQty = finalQty - maxReturnable;
    // safeOrderQty: the order size where selling to targetSellQty exactly uses up the buffer
    const safeOrderQty = allowance < 100
      ? Math.ceil((predictedQty * (1 + bufferPercent / 100)) / (1 - allowance / 100))
      : finalQty;

    if (allowance < 10) {
      notes.push(`Return allowance ${allowance}% — max ${maxReturnable} units returnable. Target sell-through: ${targetSellQty}.`);
    } else {
      notes.push(`Return allowance ${allowance}% — up to ${maxReturnable} units can be returned. Safe order qty: ${safeOrderQty}.`);
    }

    results.push({
      productId:             product.id,
      productName:           product.name,
      supplierId:            product.supplierId,
      supplierName:          product.supplierName,
      predictedQty:          finalQty,
      bufferedQty:           finalQty,
      unitCost:              product.unitCost ?? null,
      estimatedCost,
      confidence,
      basis,
      notes,
      minimumCommitment:     product.minimumCommitment ?? null,
      returnAllowancePercent: allowance,
      maxReturnable,
      targetSellQty,
      safeOrderQty,
    });
  }

  return results;
}
