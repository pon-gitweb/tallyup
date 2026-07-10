// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SmartLoader, LOADER_MESSAGES } from '../../components/SmartLoader';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours, useTheme } from '../../context/ThemeContext';
import { getHostiHealthStage, HostiHealthData } from '../../services/health/hostiHealth';

type KpiPreview = {
  label: string;
  lit: number;       // 0–5 dots filled
  status: string;
};

function dots(lit: number): string {
  const safe = Math.max(0, Math.min(5, lit));
  return '●'.repeat(safe) + '○'.repeat(5 - safe);
}

const KPI_META: Record<string, { label: string; calc: string; nullStatus: string }> = {
  stockAccuracy: {
    label: 'Stock Accuracy',
    calc: 'Based on the dollar variance between your expected and counted stock, compared to your total stock value. Lower variance means a higher score (capped at 95).',
    nullStatus: 'Not enough data',
  },
  labourEfficiency: {
    label: 'Labour Efficiency',
    calc: "Compares your active counting time this stocktake to your baseline in Settings → Stocktake staff hourly rate. Less time than baseline means a higher score.",
    nullStatus: 'Configure hourly rate',
  },
  inventoryHealth: {
    label: 'Inventory Health',
    calc: 'Based on Days of Cover — how many days your current operational stock would last at your current consumption rate. The healthy range for NZ hospitality is 7–14 days. Cellar and premium stock (identified automatically by cost and velocity patterns) is excluded from this calculation so it doesn\'t distort your working inventory picture.',
    nullStatus: 'Limited data',
  },
  orderingIntelligence: {
    label: 'Ordering Intel.',
    calc: 'Measures how often suggested orders are acted on, compared against what was actually suggested by velocity data.',
    nullStatus: 'Needs 3 stocktakes',
  },
  wasteControl: {
    label: 'Waste Control',
    calc: 'Not yet built — coming in a future update.',
    nullStatus: 'Coming soon',
  },
};

const KPI_ORDER = ['stockAccuracy', 'labourEfficiency', 'inventoryHealth', 'orderingIntelligence', 'wasteControl'];

/** One recommendation, derived from the lowest-scoring available KPI — or, when
 * Pareto data is available, naming the single biggest variance driver instead. */
function buildRecommendation(
  kpis: Record<string, number | null>,
  paretoItems?: Array<{ name: string; varianceDollars: number; areaName: string | null }>,
): string | null {
  // If we have Pareto data, lead with the specific product
  if (paretoItems?.length) {
    const top = paretoItems[0];
    const direction = top.varianceDollars < 0 ? 'short' : 'excess';
    const area = top.areaName ? ` in ${top.areaName}` : '';
    const dollars = Math.abs(top.varianceDollars).toFixed(0);
    return `${top.name}${area} shows the highest variance ($${dollars} ${direction}). Check counts and pour records for this product first.`;
  }

  const candidates: { score: number; message: string }[] = [];
  if (kpis.stockAccuracy != null) {
    candidates.push({ score: kpis.stockAccuracy, message: 'Your variance has increased this cycle — review your departments for discrepancies.' });
  }
  if (kpis.labourEfficiency != null) {
    candidates.push({ score: kpis.labourEfficiency, message: 'Your stocktake is taking longer than your baseline — check if all areas are being counted efficiently.' });
  }
  if (kpis.inventoryHealth != null) {
    candidates.push({ score: kpis.inventoryHealth, message: 'Your stock value changed significantly this month — review ordering patterns.' });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0].message;
}

export default function ProfitInsightsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const scrollToKpi = route.params?.scrollToKpi as string | undefined;
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const scrollRef = useRef<any>(null);
  const kpiRefs = useRef<Record<string, number>>({});
  const [health, setHealth] = useState<HostiHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthlyScores, setMonthlyScores] = useState<number[] | null>(null);
  const [expandedKpi, setExpandedKpi] = useState<string | null>(null);
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    if (!venueId) {
      // Stay in loading state if venueId is briefly null — VenueProvider will
      // update the context when it resolves, triggering a re-run of this effect.
      return; // keep loading=true, don't setLoading(false)
    }
    let alive = true;
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        const venueData = venueSnap.exists() ? (venueSnap.data() as any) : {};
        const totalStocktakesCompleted = venueData?.totalStocktakesCompleted || 0;

        const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
        const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
        let supplierCount = 0;
        suppliersSnap.forEach(d => { if (!(d.data() as any)?.isHoldingSupplier) supplierCount++; });

        let stockValue: number | null = null;
        try {
          const latestSnap = await getDoc(doc(db, 'venues', venueId, 'latestSnapshot', 'current'));
          if (latestSnap.exists()) {
            const depts = (latestSnap.data() as any)?.departments ?? [];
            stockValue = depts.reduce((sum: number, d: any) => sum + (d?.summary?.totalStockValue ?? 0), 0);
          }
        } catch {}

        const data = await getHostiHealthStage(
          venueId, totalStocktakesCompleted, productsSnap.size, supplierCount, stockValue,
        );
        if (alive) setHealth(data);

        // Historical trend text (Stage 3 only) — last 3 monthly snapshots, oldest first.
        if (data.stage === 3) {
          try {
            const recentSnaps = await getDocs(query(
              collection(db, 'venues', venueId, 'profitRecoverySnapshots'),
              orderBy('calculatedAt', 'desc'),
              limit(3),
            ));
            const scores = recentSnaps.docs
              .map(d => (d.data() as any)?.score)
              .filter((s: any) => typeof s === 'number')
              .reverse();
            if (alive) setMonthlyScores(scores);
          } catch {
            if (alive) setMonthlyScores(null);
          }
        }
      } catch {
        // Non-fatal — screen shows nothing extra if this fails
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [venueId]);

  useEffect(() => {
    if (!health || health.stage !== 3 || !health.score) return;
    scoreAnim.setValue(0);
    const listener = scoreAnim.addListener(({ value }) => setDisplayScore(Math.round(value)));
    Animated.timing(scoreAnim, { toValue: health.score, duration: 800, useNativeDriver: false }).start();
    return () => scoreAnim.removeListener(listener);
  }, [health?.score]);

  useEffect(() => {
    if (!scrollToKpi) return;
    const timer = setTimeout(() => {
      const y = kpiRefs.current[scrollToKpi];
      if (y != null && scrollRef.current) {
        scrollRef.current.scrollTo({ y: y - 16, animated: true });
      }
      setExpandedKpi(scrollToKpi);
    }, 400);
    return () => clearTimeout(timer);
  }, [scrollToKpi]);

  const kpis: KpiPreview[] = health?.stage === 2
    ? [
        { label: 'Stock Accuracy', lit: 2, status: 'Available' },
        { label: 'Labour Efficiency', lit: 0, status: 'Configure hourly rate' },
        { label: 'Inventory Health', lit: 1, status: 'Limited data' },
        { label: 'Ordering Intel.', lit: 0, status: 'Needs 2 stocktakes' },
        { label: 'Waste Control', lit: 0, status: 'Coming soon' },
      ]
    : [
        { label: 'Stock Accuracy', lit: 0, status: 'Needs first stocktake' },
        { label: 'Labour Efficiency', lit: 0, status: 'Configure hourly rate' },
        { label: 'Inventory Health', lit: 0, status: 'Needs first stocktake' },
        { label: 'Ordering Intel.', lit: 0, status: 'Needs 2 stocktakes' },
        { label: 'Waste Control', lit: 0, status: 'Coming soon' },
      ];

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: c.navy, fontFamily: theme.fontTitleBold, marginBottom: 4 }}>
          Hosti Health
        </Text>

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <SmartLoader messages={LOADER_MESSAGES.hostiHealth} size="large" />
          </View>
        ) : !health ? (
          <Text style={{ color: c.textSecondary, fontFamily: theme.fontBody, marginTop: 8 }}>
            Select a venue to see your Hosti Health.
          </Text>
        ) : health.stage === 1 ? (
          <>
            <Text style={{ fontSize: 15, color: c.textSecondary, fontFamily: theme.fontBody, marginBottom: 16 }}>
              Building your baseline.
            </Text>

            {/* Progress steps */}
            <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 16 }}>
              <ProgressStep
                c={c} theme={theme}
                done={health.progress.hasProducts}
                label="Products set up"
                fixLabel="tap to fix"
                onPress={!health.progress.hasProducts ? () => nav.navigate('Products') : undefined}
              />
              <ProgressStep
                c={c} theme={theme}
                done={health.progress.hasSuppliers}
                label="Suppliers set up"
                fixLabel="tap to fix"
                onPress={!health.progress.hasSuppliers ? () => nav.navigate('Suppliers') : undefined}
              />
              <ProgressStep
                c={c} theme={theme}
                done={health.progress.hasCostPrices}
                label="Cost prices added"
                fixLabel="tap to fix"
                onPress={!health.progress.hasCostPrices ? () => nav.navigate('Products') : undefined}
              />
              <ProgressStep
                c={c} theme={theme}
                done={health.progress.hasHourlyRate}
                label="Hourly wage configured"
                fixLabel="tap to fix"
                onPress={!health.progress.hasHourlyRate ? () => nav.navigate('Settings') : undefined}
              />
              <ProgressStep
                c={c} theme={theme}
                done={health.progress.hasFirstStocktake}
                label="First stocktake completed"
                fixLabel="tap to start"
                onPress={!health.progress.hasFirstStocktake ? () => nav.navigate('DepartmentSelection') : undefined}
                last
              />
            </View>

            <Text style={{ fontSize: 13, color: c.textSecondary, fontFamily: theme.fontBody, textAlign: 'center', lineHeight: 19, marginBottom: 20 }}>
              Your Hosti Health score will be available{'\n'}once your baseline is established.
            </Text>
          </>
        ) : health.stage === 2 ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <Text style={{ fontSize: 32, fontWeight: '800', color: c.navy, fontFamily: theme.fontTitleBold }}>
                {health.scoreMin} – {health.scoreMax}
              </Text>
              <Text style={{ fontSize: 14, color: c.amber, fontWeight: '700' }}>· Building confidence</Text>
            </View>
            <Text style={{ fontSize: 13, color: c.textSecondary, fontFamily: theme.fontBody, lineHeight: 19, marginBottom: 20 }}>
              We have your first stocktake.{'\n'}Complete a second to unlock your confirmed score.
            </Text>
          </>
        ) : (
          <>
            {/* Stage 3 — real score */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 32, fontWeight: '800', color: c.navy, fontFamily: theme.fontTitleBold }}>
                {displayScore} / 100
              </Text>
              <Text style={{ fontSize: 16, color: c.deepBlue, fontWeight: '700' }}>· {health.label}</Text>
            </View>
            <Text style={{ fontSize: 13, color: c.textSecondary, fontFamily: theme.fontBody, marginBottom: 6 }}>
              {health.trend != null && health.trendDirection
                ? `${health.trendDirection === 'up' ? '↑' : health.trendDirection === 'down' ? '↓' : '→'} ${health.trend > 0 ? '+' : ''}${health.trend} this month  ·  Confidence: ${health.confidence}`
                : `Confidence: ${health.confidence}`}
            </Text>
            <Text style={{ fontSize: 12, color: c.textSecondary, fontFamily: theme.fontBody, marginBottom: 6 }}>
              {health.score >= 90 ? "Top-performing NZ venues score 90+. You're in excellent company." :
                health.score >= 75 ? `Strong performance. Top NZ venues score 90+ — ${90 - health.score} points to go.` :
                health.score >= 60 ? "Developing. NZ venue average sits around 65–75. You're on track." :
                health.score >= 40 ? 'Room to improve. Most NZ venues score 65–75 with consistent stocktaking.' :
                'Early stage. Complete more stocktakes to build your score.'}
            </Text>
            {health.estimatedImpact != null && health.estimatedImpact > 0 && (
              <Text style={{ fontSize: 14, fontWeight: '700', color: c.success, marginBottom: 16 }}>
                Est. ${health.estimatedImpact.toFixed(0)} recovered this cycle
              </Text>
            )}

            {/* Top recommendation — derived from the lowest-scoring available KPI */}
            {(() => {
              const recommendation = buildRecommendation(health.kpis, health.paretoItems);
              return recommendation ? (
                <View style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.amber, marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, color: c.navy, fontFamily: theme.fontBody, lineHeight: 18 }}>
                    💡 {recommendation}
                  </Text>
                </View>
              ) : null;
            })()}
          </>
        )}

        {/* Stock Predictions — more urgent and actionable than pattern insights, shown first */}
        {!loading && health && health.stage === 3 && health.predictions && health.predictions.stockoutPredictions.length > 0 && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: c.navy, fontWeight: '700', fontSize: 15, fontFamily: theme.fontTitleBold, marginBottom: 4 }}>
              Stock Predictions
            </Text>
            {health.predictions.criticalCount > 0 && (
              <Text style={{ color: c.error, fontWeight: '600', fontSize: 13, marginBottom: 8 }}>
                {health.predictions.criticalCount} product{health.predictions.criticalCount !== 1 ? 's' : ''} at critical risk of running out
              </Text>
            )}
            {health.predictions.stockoutPredictions.slice(0, 3).map((p, i) => {
              const urgencyColour = p.urgency === 'critical' ? c.error : p.urgency === 'warning' ? c.amber : c.textSecondary;
              const rowBg = p.urgency === 'critical' ? `${c.error}14` : p.urgency === 'warning' ? `${c.amber}14` : c.surface;
              const dateLabel = new Date(p.stockoutDate + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
              return (
                <View
                  key={p.productId}
                  style={{
                    flexDirection: 'row', backgroundColor: rowBg, borderWidth: 1, borderColor: c.border,
                    borderRadius: 10, padding: 12, marginTop: i > 0 ? 8 : 0,
                  }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: urgencyColour, marginTop: 4, marginRight: 10 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.navy, fontWeight: '600', fontSize: 14, fontFamily: theme.fontBodySemiBold }}>
                      {p.name}{p.areaName ? ` · ${p.areaName}` : ''}
                    </Text>
                    <Text style={{ color: urgencyColour, fontSize: 13, fontFamily: theme.fontBody, marginTop: 2 }}>
                      Runs out in {p.daysUntilStockout} day{p.daysUntilStockout !== 1 ? 's' : ''} · {dateLabel}
                    </Text>
                    <Text style={{ color: c.textSecondary, fontSize: 12, fontFamily: theme.fontBody, marginTop: 2 }}>
                      Current: {p.currentStock} units · {p.velocityPerDay}/day
                    </Text>
                    {p.daysUntilBelowPAR != null && p.daysUntilBelowPAR < p.daysUntilStockout && (
                      <Text style={{ color: c.amber, fontSize: 11, fontFamily: theme.fontBody, marginTop: 2 }}>
                        Drops below PAR in {p.daysUntilBelowPAR} day{p.daysUntilBelowPAR !== 1 ? 's' : ''}
                      </Text>
                    )}
                    <Text style={{ color: c.textSecondary, fontSize: 10, fontStyle: 'italic', fontFamily: theme.fontBody, marginTop: 2 }}>
                      {p.confidenceLabel} confidence
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Insights — abductive, pattern-based, max 2 shown (highest severity/confidence first) */}
        {!loading && health && health.stage === 3 && health.abductiveInsights.length > 0 && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: c.navy, fontWeight: '700', fontSize: 15, fontFamily: theme.fontTitleBold, marginBottom: 8 }}>
              Insights
            </Text>
            {health.abductiveInsights.slice(0, 2).map(insight => (
              <InsightCard key={insight.id} c={c} theme={theme} insight={insight} />
            ))}
          </View>
        )}

        {/* Focus List — top 3 variance drivers. No variance = good news, stays hidden. */}
        {!loading && health && health.stage === 3 && health.paretoItems.length > 0 && health.paretoTotalVariance > 0 && (
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: c.navy, fontWeight: '700', fontSize: 15, fontFamily: theme.fontTitleBold, marginBottom: 4 }}>
              Focus List
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 12, fontFamily: theme.fontBody, marginBottom: 12 }}>
              These {health.paretoItems.length} item{health.paretoItems.length === 1 ? '' : 's'} account for {health.paretoCoverageByTop3}% of your total variance this cycle.
            </Text>
            {health.paretoItems.map((item, i) => {
              const isShortage = item.varianceDollars < 0;
              return (
                <View key={`${item.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                  <Text style={{ color: c.amber, fontWeight: '700', fontSize: 13, width: 20 }}>{i + 1}.</Text>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: c.navy, fontSize: 14, fontFamily: theme.fontBody }}>{item.name}</Text>
                    {item.areaName && (
                      <Text style={{ color: c.slateMid, fontSize: 12, fontFamily: theme.fontBody }}>{item.areaName}</Text>
                    )}
                  </View>
                  <Text style={{ color: isShortage ? c.error : c.success, fontWeight: '700', fontSize: 13, marginRight: 8 }}>
                    {isShortage ? '−' : '+'}${Math.abs(item.varianceDollars).toFixed(0)}
                  </Text>
                  <Text style={{ color: c.slateMid, fontSize: 11, width: 32, textAlign: 'right' }}>
                    {item.contributionPct}%
                  </Text>
                </View>
              );
            })}
            <Text style={{ color: c.textSecondary, fontSize: 12, fontStyle: 'italic', fontFamily: theme.fontBody, marginTop: 10 }}>
              Fix these first. Everything else is secondary.
            </Text>
          </View>
        )}

        {/* Stage 1/2 — static KPI previews (no real scores yet) */}
        {!loading && health && health.stage !== 3 && (
          <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border }}>
            {kpis.map((kpi, i) => (
              <View
                key={kpi.label}
                style={{
                  flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                  borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border,
                }}
              >
                <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: c.navy, fontFamily: theme.fontBodySemiBold }}>
                  {kpi.label}
                </Text>
                <Text style={{ fontSize: 14, color: kpi.lit > 0 ? c.deepBlue : c.border, letterSpacing: 2, marginRight: 10 }}>
                  {dots(kpi.lit)}
                </Text>
                <Text style={{ fontSize: 11, color: c.textSecondary, fontFamily: theme.fontBody, width: 110, textAlign: 'right' }}>
                  {kpi.status}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Stage 3 — real KPI cards, each independently expandable */}
        {!loading && health && health.stage === 3 && (
          <>
            <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 16 }}>
              {KPI_ORDER.map((key, i) => (
                <View
                  key={key}
                  style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border }}
                  onLayout={(e) => { kpiRefs.current[key] = e.nativeEvent.layout.y; }}
                >
                  <KpiCard
                    c={c} theme={theme} kpiKey={key} score={(health.kpis as any)[key]}
                    daysOfCover={key === 'inventoryHealth' ? health.daysOfCover : undefined}
                    usedInvoiceData={key === 'inventoryHealth' ? health.inventoryHealthUsedInvoiceData : undefined}
                    targetDaysOfCover={key === 'inventoryHealth' ? health.targetDaysOfCover : undefined}
                    orderingWeight={key === 'orderingIntelligence' ? health.orderingIntelligenceWeight : undefined}
                    externalExpanded={expandedKpi === key}
                  />
                </View>
              ))}
            </View>

            {/* Historical trend */}
            <Text style={{ fontSize: 13, color: c.textSecondary, fontFamily: theme.fontBody, textAlign: 'center', lineHeight: 19 }}>
              {!monthlyScores || monthlyScores.length < 2
                ? 'Complete another stocktake next month to see your trend.'
                : `Last ${monthlyScores.length} months: ${monthlyScores.join(' → ')} ${
                    monthlyScores[monthlyScores.length - 1] >= monthlyScores[0] ? '↑' : '↓'
                  }`}
            </Text>

            {/* Primary Constraint — only when a bottleneck has been identified */}
            {health.constraint !== null && (
              <View style={{
                backgroundColor: c.surface,
                borderWidth: 1,
                borderColor: health.constraint.impact === 'high' ? `${c.amber}4D` : c.border,
                borderRadius: 12,
                padding: 16,
                marginTop: 16,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ color: c.navy, fontWeight: '700', fontSize: 15, fontFamily: theme.fontTitleBold }}>
                    Primary Constraint
                  </Text>
                  <View style={{
                    backgroundColor: `${
                      health.constraint.impact === 'high' ? c.error : health.constraint.impact === 'medium' ? c.amber : c.textSecondary
                    }22`,
                    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
                  }}>
                    <Text style={{
                      fontSize: 11, fontWeight: '700', textTransform: 'capitalize',
                      color: health.constraint.impact === 'high' ? c.error : health.constraint.impact === 'medium' ? c.amber : c.textSecondary,
                    }}>
                      {health.constraint.impact}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: c.navy, fontSize: 13, fontFamily: theme.fontBody, lineHeight: 19, marginBottom: 10 }}>
                  {health.constraint.description}
                </Text>
                <Text style={{ color: c.deepBlue, fontSize: 13, fontFamily: theme.fontBody, lineHeight: 19, fontWeight: '600' }}>
                  → {health.constraint.fixAction}
                </Text>
              </View>
            )}

            {/* Counterfactual — what earlier counting would likely have recovered */}
            {health.counterfactual !== null && (
              <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 16, marginTop: 16 }}>
                <Text style={{ color: c.navy, fontWeight: '700', fontSize: 15, fontFamily: theme.fontTitleBold, marginBottom: 10 }}>
                  What if?
                </Text>
                <Text style={{ color: c.navy, fontSize: 13, fontFamily: theme.fontBody, lineHeight: 19, marginBottom: 10 }}>
                  {health.counterfactual.estimatedAdditionalRecovery != null
                    ? `${health.counterfactual.scenario}, you could have caught an estimated $${Math.round(health.counterfactual.estimatedAdditionalRecovery).toLocaleString()} more in variance earlier this cycle.`
                    : "If you'd counted more frequently, variance would have been detected earlier — but we need cost prices to estimate the financial impact."}
                </Text>
                <Text style={{ color: c.textSecondary, fontSize: 12, fontFamily: theme.fontBody, marginBottom: 4 }}>
                  {health.counterfactual.confidenceLabel}.
                </Text>
                <Text style={{ color: c.textSecondary, fontSize: 11, fontFamily: theme.fontBody }}>
                  ⓘ This is a conservative estimate.
                </Text>
              </View>
            )}

            {/* ROI framing — only when stock value is known */}
            {health.stockValue != null && health.stockValue > 0 && (() => {
              const roiMin = Math.round(health.stockValue * 12 * 0.015); // 1.5% of annual stock turnover
              const roiMax = Math.round(health.stockValue * 12 * 0.025); // 2.5%
              const recoveryMin = Math.round(roiMin * 0.10); // conservative 10% recovery
              const recoveryMax = Math.round(roiMax * 0.30); // optimistic 30% recovery
              return (
                <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, marginTop: 16 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: c.navy, fontFamily: theme.fontTitleBold, marginBottom: 8 }}>
                    What this means for your venue
                  </Text>
                  <Text style={{ fontSize: 13, color: c.navy, fontFamily: theme.fontBody, lineHeight: 19, marginBottom: 10 }}>
                    Based on your current stock value, venues like yours typically carry ${roiMin.toLocaleString()}–${roiMax.toLocaleString()} in annual inventory-related leakage. Hosti typically helps recover 10–30% of that through better controls.
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: c.success, marginBottom: 10 }}>
                    Est. annual recovery opportunity: ${recoveryMin.toLocaleString()} – ${recoveryMax.toLocaleString()}
                  </Text>
                  <Text style={{ fontSize: 11, color: c.textSecondary, fontFamily: theme.fontBody, lineHeight: 15 }}>
                    ⓘ This is an estimate based on NZ hospitality industry benchmarks. Actual recovery depends on how consistently stocktakes are completed and how suggestions are acted on.
                  </Text>
                </View>
              );
            })()}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function InsightCard({
  c, theme, insight,
}: {
  c: any; theme: any; insight: import('../../services/health/abductiveInsights').AbductiveInsight;
}) {
  const [expanded, setExpanded] = useState(false);
  const severityColour = insight.severity === 'high' ? c.error
    : insight.severity === 'medium' ? c.amber
    : insight.severity === 'positive' ? c.success
    : c.border; // low
  const severityLabel = insight.severity.charAt(0).toUpperCase() + insight.severity.slice(1);
  const financialColour = insight.severity === 'positive' ? c.success : c.error;

  return (
    <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <View style={{ backgroundColor: `${severityColour}22`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: severityColour }}>{severityLabel}</Text>
        </View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary }}>{insight.confidence}%</Text>
      </View>

      {insight.confidenceRationale ? (
        <Text style={{ fontSize: 11, color: c.textSecondary, fontStyle: 'italic', fontFamily: theme.fontBody, marginBottom: 8 }}>
          {insight.confidenceRationale}
        </Text>
      ) : null}

      <Text style={{ color: c.navy, fontWeight: '600', fontSize: 14, fontFamily: theme.fontBodySemiBold, marginBottom: 8 }}>
        {insight.pattern}
      </Text>

      <Text style={{ fontSize: 13, fontFamily: theme.fontBody, lineHeight: 18, marginBottom: 8 }}>
        <Text style={{ color: c.textSecondary }}>Most likely: </Text>
        <Text style={{ color: c.navy }}>{insight.mostLikelyExplanation}</Text>
      </Text>

      <Text style={{ color: c.deepBlue, fontSize: 13, fontFamily: theme.fontBody, lineHeight: 18, marginBottom: 8 }}>
        → {insight.actionable}
      </Text>

      {insight.financialFrame && (
        <Text style={{ color: financialColour, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>
          {insight.financialFrame}
        </Text>
      )}

      <TouchableOpacity onPress={() => setExpanded(prev => !prev)}>
        <Text style={{ fontSize: 11, color: c.deepBlue }}>
          {expanded ? 'Hide reasoning ▴' : 'Show reasoning ▾'}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 8 }}>
          {insight.confidenceRationale ? (
            <Text style={{ fontSize: 13, color: c.textSecondary, fontFamily: theme.fontBody, lineHeight: 18, marginBottom: 6 }}>
              {insight.confidenceRationale}
            </Text>
          ) : null}
          {insight.evidencePoints.map((point, i) => (
            <Text key={i} style={{ fontSize: 12, color: c.textSecondary, fontFamily: theme.fontBody, lineHeight: 17, marginBottom: 4 }}>
              • {point}
            </Text>
          ))}
          {insight.alternativeExplanations.length > 0 && (
            <Text style={{ fontSize: 12, color: c.textSecondary, fontFamily: theme.fontBody, lineHeight: 17, marginTop: 4 }}>
              Other possibilities: {insight.alternativeExplanations.join('; ')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function KpiCard({
  c, theme, kpiKey, score, daysOfCover, usedInvoiceData, targetDaysOfCover, orderingWeight, externalExpanded,
}: {
  c: any; theme: any; kpiKey: string; score: number | null; daysOfCover?: number | null; usedInvoiceData?: boolean;
  targetDaysOfCover?: number; orderingWeight?: number; externalExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (externalExpanded) setExpanded(true); }, [externalExpanded]);
  const meta = KPI_META[kpiKey];
  const lit = score != null ? Math.round(score / 20) : 0;

  return (
    <TouchableOpacity
      onPress={() => setExpanded(prev => !prev)}
      activeOpacity={0.8}
      style={{ paddingVertical: 10 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: c.navy, fontFamily: theme.fontBodySemiBold }}>
          {meta.label}
        </Text>
        <Text style={{ fontSize: 14, color: score != null ? c.deepBlue : c.border, letterSpacing: 2, marginRight: 10 }}>
          {dots(lit)}
        </Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.navy, width: 90, textAlign: 'right' }}>
          {score != null ? `${Math.round(score)} / 100` : meta.nullStatus}
        </Text>
      </View>
      {kpiKey === 'inventoryHealth' && daysOfCover != null && (
        <Text style={{ fontSize: 11, color: c.textSecondary, marginTop: 3 }}>
          {daysOfCover} days of cover · your target: {targetDaysOfCover ?? 10} days
        </Text>
      )}
      <Text style={{ fontSize: 11, color: c.deepBlue, marginTop: 4 }}>
        {expanded ? 'Hide calculation ▲' : 'How is this calculated? ▼'}
      </Text>
      {expanded && (
        <Text style={{ fontSize: 12, color: c.textSecondary, fontFamily: theme.fontBody, lineHeight: 17, marginTop: 6 }}>
          {meta.calc}
          {kpiKey === 'inventoryHealth' && usedInvoiceData != null
            ? usedInvoiceData
              ? ' Calculated using your actual invoice data for this cycle.'
              : ' Estimated — scan your invoices to improve this calculation.'
            : ''}
          {kpiKey === 'orderingIntelligence' && orderingWeight != null
            ? ` Weight increases as suggestion confidence improves — currently weighted at ${Math.round(orderingWeight * 100)}% (increases to 15% at 6+ stocktakes as velocity data becomes reliable).`
            : ''}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function ProgressStep({
  c, theme, done, label, fixLabel, onPress, last,
}: {
  c: any; theme: any; done: boolean; label: string; fixLabel: string; onPress?: () => void; last?: boolean;
}) {
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: c.border,
      }}
    >
      <Text style={{ fontSize: 16, color: done ? c.success : c.textSecondary, marginRight: 10, width: 18 }}>
        {done ? '✓' : '—'}
      </Text>
      <Text style={{ flex: 1, fontSize: 14, color: c.navy, fontFamily: theme.fontBody, fontWeight: done ? '600' : '500' }}>
        {label}
      </Text>
      {!done && onPress && (
        <Text style={{ fontSize: 12, color: c.deepBlue, fontWeight: '700' }}>{fixLabel} →</Text>
      )}
    </TouchableOpacity>
  );
}
