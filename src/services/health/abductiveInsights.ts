// @ts-nocheck
/**
 * Abductive Reasoning — pure math pattern matching over already-computed
 * Hosti Health values. No Firestore reads here; the caller supplies inputs
 * that have already been calculated elsewhere in hostiHealth.ts.
 */
export interface AbductiveInsight {
  id: string;                    // unique, stable identifier for this pattern
  pattern: string;               // one sentence: what the data shows
  mostLikelyExplanation: string; // one sentence: what probably caused it
  alternativeExplanations: string[]; // 1–2 alternatives, honest about uncertainty
  confidence: number;            // 0–100, Bayesian-style
  confidenceLabel: 'High' | 'Medium' | 'Low';
  evidencePoints: string[];      // 2–4 bullet points explaining why we think this
  severity: 'high' | 'medium' | 'low' | 'positive';
  actionable: string;            // one sentence: what to do about it
  financialFrame: string | null; // "$X at risk" or "Est. $X recovered" or null
}

export interface AbductiveInputs {
  totalVarianceDollars: number | null;
  prevVarianceDollars: number | null;
  stockAccuracy: number | null;
  labourEfficiency: number | null;
  inventoryHealth: number | null;
  avgCycleDays: number;
  totalStocktakesCompleted: number;
  pricedItemFraction: number;
  paretoItems: Array<{
    name: string;
    areaName: string | null;
    categoryName: string | null;
    varianceDollars: number;
    varianceQty: number;
    contributionPct: number;
  }>;
  daysOfCover: number | null;
  operationalStockValue: number | null;
}

export function generateAbductiveInsights(inputs: AbductiveInputs): AbductiveInsight[] {
  const insights: AbductiveInsight[] = [];
  const {
    totalVarianceDollars, prevVarianceDollars, stockAccuracy,
    labourEfficiency, avgCycleDays, totalStocktakesCompleted,
    pricedItemFraction, paretoItems, daysOfCover, operationalStockValue,
    inventoryHealth,
  } = inputs;

  // ── Pattern 1: Concentrated variance (80/20) ────────────────────────────────
  // Signal: top 1 item accounts for >40% of total variance
  // Most likely: that specific product has a systematic issue
  if (paretoItems.length > 0 && totalVarianceDollars != null
      && Math.abs(totalVarianceDollars) > 50) {
    const top = paretoItems[0];
    if (top.contributionPct >= 40) {
      const isShortage = top.varianceDollars < 0;
      const dollars = Math.abs(top.varianceDollars).toFixed(0);
      insights.push({
        id: 'concentrated-variance',
        pattern: `${top.name} accounts for ${top.contributionPct}% of all variance this cycle.`,
        mostLikelyExplanation: isShortage
          ? `Systematic overpouring, wastage, or unrecorded removal of ${top.name}.`
          : `Possible miscounting or unrecorded delivery received for ${top.name}.`,
        alternativeExplanations: isShortage
          ? ['Counting error on this product', 'Theft — especially if pattern repeats across cycles']
          : ['Count entered twice', 'Delivery received but not linked to an invoice'],
        confidence: top.contributionPct >= 60 ? 75 : 60,
        confidenceLabel: top.contributionPct >= 60 ? 'High' : 'Medium',
        evidencePoints: [
          `${top.name} contributed $${dollars} of variance`,
          `This is ${top.contributionPct}% of your total variance`,
          top.areaName ? `Located in ${top.areaName}` : 'Check which area this product is counted in',
          'Concentrated variance in one product suggests a systematic cause, not random error',
        ],
        severity: isShortage ? 'high' : 'medium',
        actionable: `Count ${top.name} manually at close of trade for the next 3 days and compare with your POS.`,
        financialFrame: `$${dollars} variance on this product alone`,
      });
    }
  }

  // ── Pattern 2: Improving variance trend ─────────────────────────────────────
  // Signal: this cycle's variance is lower than last cycle by >20%
  // Most likely: controls are working, counting is getting more accurate
  if (totalVarianceDollars != null && prevVarianceDollars != null
      && Math.abs(prevVarianceDollars) > 20) {
    const improvement = Math.abs(prevVarianceDollars) - Math.abs(totalVarianceDollars);
    const improvementPct = improvement / Math.abs(prevVarianceDollars) * 100;
    if (improvementPct > 20) {
      insights.push({
        id: 'improving-variance',
        pattern: `Variance dropped ${Math.round(improvementPct)}% compared to last cycle.`,
        mostLikelyExplanation: 'Counting discipline has improved, or a previous problem has been identified and corrected.',
        alternativeExplanations: ['Normal fluctuation — confirm trend over 3+ cycles before drawing conclusions'],
        confidence: improvementPct > 40 ? 70 : 55,
        confidenceLabel: improvementPct > 40 ? 'High' : 'Medium',
        evidencePoints: [
          `Previous variance: $${Math.abs(prevVarianceDollars).toFixed(0)}`,
          `This cycle: $${Math.abs(totalVarianceDollars ?? 0).toFixed(0)}`,
          `Improvement: $${improvement.toFixed(0)} (${Math.round(improvementPct)}%)`,
        ],
        severity: 'positive',
        actionable: 'Keep doing what you\'re doing. Note what changed so you can repeat it.',
        financialFrame: `Est. $${improvement.toFixed(0)} recovered vs last cycle`,
      });
    }
  }

  // ── Pattern 3: Worsening variance trend ─────────────────────────────────────
  // Signal: this cycle's variance is higher than last cycle by >20%
  // Most likely: something changed — new staff, menu change, supplier issue
  if (totalVarianceDollars != null && prevVarianceDollars != null
      && Math.abs(prevVarianceDollars) > 20) {
    const deterioration = Math.abs(totalVarianceDollars) - Math.abs(prevVarianceDollars);
    const deteriorationPct = deterioration / Math.abs(prevVarianceDollars) * 100;
    if (deteriorationPct > 20 && deterioration > 30) {
      insights.push({
        id: 'worsening-variance',
        pattern: `Variance increased ${Math.round(deteriorationPct)}% compared to last cycle.`,
        mostLikelyExplanation: 'Something changed between your last and current stocktake — new staff, menu change, or supplier issue.',
        alternativeExplanations: [
          'Counting error this cycle',
          'Seasonal or event-driven increase in a specific category',
        ],
        confidence: deteriorationPct > 40 ? 65 : 50,
        confidenceLabel: deteriorationPct > 40 ? 'Medium' : 'Low',
        evidencePoints: [
          `Previous variance: $${Math.abs(prevVarianceDollars).toFixed(0)}`,
          `This cycle: $${Math.abs(totalVarianceDollars ?? 0).toFixed(0)}`,
          `Increase: $${deterioration.toFixed(0)} (${Math.round(deteriorationPct)}%)`,
          'Check if anything changed since your last stocktake — roster, menu, supplier',
        ],
        severity: deteriorationPct > 40 ? 'high' : 'medium',
        actionable: 'Review what changed since your last stocktake. Check the Focus List for which products drove the increase.',
        financialFrame: `$${deterioration.toFixed(0)} more variance than last cycle`,
      });
    }
  }

  // ── Pattern 4: Over-stocked relative to velocity ─────────────────────────────
  // Signal: days of cover > 21
  // Most likely: over-ordering, slow sales, or a menu item removed
  if (daysOfCover != null && daysOfCover > 21 && operationalStockValue != null) {
    const excessDays = daysOfCover - 14;
    const dailyValue = operationalStockValue / daysOfCover;
    const tiedUpCapital = Math.round(dailyValue * excessDays);
    insights.push({
      id: 'overstocked',
      pattern: `You're holding ${daysOfCover} days of operational stock — above the healthy 7–14 day range.`,
      mostLikelyExplanation: 'Ordering quantities are outpacing current sales velocity.',
      alternativeExplanations: [
        'Recent delivery arrived just before counting',
        'Deliberate pre-event stock build-up',
      ],
      confidence: daysOfCover > 30 ? 70 : 55,
      confidenceLabel: daysOfCover > 30 ? 'High' : 'Medium',
      evidencePoints: [
        `Current days of cover: ${daysOfCover} days`,
        `Healthy range: 7–14 days`,
        `Excess: ${excessDays} days above optimal`,
        `Est. capital tied up in excess stock: $${tiedUpCapital}`,
      ],
      severity: daysOfCover > 30 ? 'medium' : 'low',
      actionable: 'Reduce your next order quantities. Use Suggested Orders to guide how much to cut.',
      financialFrame: `Est. $${tiedUpCapital} in capital tied up above healthy stock level`,
    });
  }

  // ── Pattern 5: Lean stock — stockout risk ────────────────────────────────────
  // Signal: days of cover < 5
  if (daysOfCover != null && daysOfCover < 5 && daysOfCover > 0) {
    insights.push({
      id: 'lean-stock',
      pattern: `You're holding only ${daysOfCover} days of operational stock — below the safe minimum of 7 days.`,
      mostLikelyExplanation: 'Orders are not keeping pace with consumption, or a delivery is overdue.',
      alternativeExplanations: [
        'Unusually high sales since last delivery',
        'Stocktake done just before a regular delivery',
      ],
      confidence: 65,
      confidenceLabel: 'Medium',
      evidencePoints: [
        `Current days of cover: ${daysOfCover} days`,
        `Risk of stockout within ${daysOfCover} days at current consumption rate`,
        'Stockouts cause lost sales and customer dissatisfaction',
      ],
      severity: 'high',
      actionable: 'Review your pending orders. Place an urgent order for any products below PAR.',
      financialFrame: null,
    });
  }

  // Sort by severity then confidence
  const severityOrder = { high: 0, medium: 1, low: 2, positive: 3 };
  insights.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity] ||
    b.confidence - a.confidence
  );

  return insights;
}
