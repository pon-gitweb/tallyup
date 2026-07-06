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
  confidenceRationale: string;   // "Based on X stocktakes — prior: 60% industry rate × evidence: strong signal"
  evidencePoints: string[];      // 2–4 bullet points explaining why we think this
  severity: 'high' | 'medium' | 'low' | 'positive';
  actionable: string;            // one sentence: what to do about it
  financialFrame: string | null; // "$X at risk" or "Est. $X recovered" or null
}

/**
 * Bayesian confidence estimator.
 * posterior = (prior × likelihoodRatio) / normaliser
 * Returned as 0–100.
 *
 * prior: industry base rate for this explanation (0–1)
 * likelihoodGivenHypothesis: probability of seeing this evidence IF the hypothesis is true (0–1)
 * likelihoodGivenAlternative: probability of seeing this evidence if something else is the cause (0–1)
 * evidenceStrength: 0–1 multiplier for how many data points support the conclusion
 *   (more stocktakes = stronger evidence = higher multiplier)
 */
function bayesianConfidence(
  prior: number,
  likelihoodGivenHypothesis: number,
  likelihoodGivenAlternative: number,
  evidenceStrength: number,
): number {
  const lrNumerator = prior * likelihoodGivenHypothesis;
  const lrDenominator = lrNumerator + (1 - prior) * likelihoodGivenAlternative;
  if (lrDenominator === 0) return Math.round(prior * 100);
  const posterior = lrNumerator / lrDenominator;
  // Blend posterior with evidence strength — more data = trust the posterior more
  // With very few stocktakes, regress toward 50% (maximum uncertainty)
  const blended = posterior * evidenceStrength + 0.5 * (1 - evidenceStrength);
  return Math.round(Math.min(95, Math.max(20, blended * 100)));
}

function evidenceStrengthFromCycles(totalStocktakesCompleted: number): number {
  // 1 cycle → 0.3 (very uncertain)
  // 2 cycles → 0.5
  // 3 cycles → 0.65
  // 4 cycles → 0.75
  // 6+ cycles → 0.9
  if (totalStocktakesCompleted <= 1) return 0.3;
  if (totalStocktakesCompleted === 2) return 0.5;
  if (totalStocktakesCompleted === 3) return 0.65;
  if (totalStocktakesCompleted === 4) return 0.75;
  if (totalStocktakesCompleted === 5) return 0.82;
  return 0.9; // 6+ cycles
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

      // Prior: ~60% of concentrated variance cases in hospitality = overpouring
      // Likelihood given overpouring: high contribution pct is very consistent with systematic overpouring
      // Likelihood given other cause: concentrated variance also happens with counting errors (~30%)
      const evidenceStr = evidenceStrengthFromCycles(totalStocktakesCompleted);
      const concentrationStrength = top.contributionPct / 100; // 52% concentration → 0.52
      const conf = bayesianConfidence(0.60, concentrationStrength, 0.30, evidenceStr);
      const confLabel: 'High' | 'Medium' | 'Low' = conf >= 70 ? 'High' : conf >= 50 ? 'Medium' : 'Low';
      const rationale = `Based on ${totalStocktakesCompleted} stocktake${totalStocktakesCompleted !== 1 ? 's' : ''} — industry prior 60% for overpouring, evidence strength ${Math.round(evidenceStr * 100)}%`;

      insights.push({
        id: 'concentrated-variance',
        pattern: `${top.name} accounts for ${top.contributionPct}% of all variance this cycle.`,
        mostLikelyExplanation: isShortage
          ? `Systematic overpouring, wastage, or unrecorded removal of ${top.name}.`
          : `Possible miscounting or unrecorded delivery received for ${top.name}.`,
        alternativeExplanations: isShortage
          ? ['Counting error on this product', 'Theft — especially if pattern repeats across cycles']
          : ['Count entered twice', 'Delivery received but not linked to an invoice'],
        confidence: conf,
        confidenceLabel: confLabel,
        confidenceRationale: rationale,
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
      // Prior: ~50% of variance improvements are genuine (vs random fluctuation)
      // Likelihood given genuine improvement: large % drop is consistent
      // Likelihood given random: 30% — random fluctuation can produce 20%+ swings
      const evidenceStr = evidenceStrengthFromCycles(totalStocktakesCompleted);
      const improvementSignal = Math.min(1, improvementPct / 60); // cap at 60% improvement
      const conf = bayesianConfidence(0.50, improvementSignal, 0.30, evidenceStr);
      const confLabel: 'High' | 'Medium' | 'Low' = conf >= 70 ? 'High' : conf >= 50 ? 'Medium' : 'Low';
      const rationale = `Based on ${totalStocktakesCompleted} stocktake${totalStocktakesCompleted !== 1 ? 's' : ''} — need 3+ cycles to confirm genuine improvement`;

      insights.push({
        id: 'improving-variance',
        pattern: `Variance dropped ${Math.round(improvementPct)}% compared to last cycle.`,
        mostLikelyExplanation: 'Counting discipline has improved, or a previous problem has been identified and corrected.',
        alternativeExplanations: ['Normal fluctuation — confirm trend over 3+ cycles before drawing conclusions'],
        confidence: conf,
        confidenceLabel: confLabel,
        confidenceRationale: rationale,
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
      // Prior: ~55% of variance increases have an identifiable cause (vs random)
      // Likelihood given real cause: large absolute deterioration is a strong signal
      // Likelihood given random: 25% — deterioration is less likely to be random than improvement
      const evidenceStr = evidenceStrengthFromCycles(totalStocktakesCompleted);
      const deteriorationSignal = Math.min(1, deteriorationPct / 60);
      const conf = bayesianConfidence(0.55, deteriorationSignal, 0.25, evidenceStr);
      const confLabel: 'High' | 'Medium' | 'Low' = conf >= 70 ? 'High' : conf >= 50 ? 'Medium' : 'Low';
      const rationale = `Based on ${totalStocktakesCompleted} stocktake${totalStocktakesCompleted !== 1 ? 's' : ''} — more cycles needed to confirm whether this is a trend or a one-off`;

      insights.push({
        id: 'worsening-variance',
        pattern: `Variance increased ${Math.round(deteriorationPct)}% compared to last cycle.`,
        mostLikelyExplanation: 'Something changed between your last and current stocktake — new staff, menu change, or supplier issue.',
        alternativeExplanations: [
          'Counting error this cycle',
          'Seasonal or event-driven increase in a specific category',
        ],
        confidence: conf,
        confidenceLabel: confLabel,
        confidenceRationale: rationale,
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

    // Prior: ~65% of high days-of-cover = genuine over-ordering (vs coincidental timing)
    // Likelihood given over-ordering: very high days of cover is strongly consistent
    // Likelihood given coincidence (delivery just before count): 40%
    const evidenceStr = evidenceStrengthFromCycles(totalStocktakesCompleted);
    const overStockSignal = Math.min(1, (daysOfCover - 14) / 20); // 14 = threshold, 34 = max signal
    const conf = bayesianConfidence(0.65, overStockSignal, 0.40, evidenceStr);
    const confLabel: 'High' | 'Medium' | 'Low' = conf >= 70 ? 'High' : conf >= 50 ? 'Medium' : 'Low';
    const rationale = `Based on ${totalStocktakesCompleted} stocktake${totalStocktakesCompleted !== 1 ? 's' : ''} — ${daysOfCover} days cover vs 7–14 day healthy range`;

    insights.push({
      id: 'overstocked',
      pattern: `You're holding ${daysOfCover} days of operational stock — above the healthy 7–14 day range.`,
      mostLikelyExplanation: 'Ordering quantities are outpacing current sales velocity.',
      alternativeExplanations: [
        'Recent delivery arrived just before counting',
        'Deliberate pre-event stock build-up',
      ],
      confidence: conf,
      confidenceLabel: confLabel,
      confidenceRationale: rationale,
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
    // Prior: ~70% of low days-of-cover = genuine ordering lag (vs delivery timing)
    // Likelihood given ordering lag: low days of cover is strongly consistent
    // Likelihood given coincidence: 35%
    const evidenceStr = evidenceStrengthFromCycles(totalStocktakesCompleted);
    const leanSignal = Math.min(1, (7 - daysOfCover) / 5); // 7 = threshold, 2 = max signal
    const conf = bayesianConfidence(0.70, leanSignal, 0.35, evidenceStr);
    const confLabel: 'High' | 'Medium' | 'Low' = conf >= 70 ? 'High' : conf >= 50 ? 'Medium' : 'Low';
    const rationale = `Based on ${totalStocktakesCompleted} stocktake${totalStocktakesCompleted !== 1 ? 's' : ''} — only ${daysOfCover} days cover remaining`;

    insights.push({
      id: 'lean-stock',
      pattern: `You're holding only ${daysOfCover} days of operational stock — below the safe minimum of 7 days.`,
      mostLikelyExplanation: 'Orders are not keeping pace with consumption, or a delivery is overdue.',
      alternativeExplanations: [
        'Unusually high sales since last delivery',
        'Stocktake done just before a regular delivery',
      ],
      confidence: conf,
      confidenceLabel: confLabel,
      confidenceRationale: rationale,
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
