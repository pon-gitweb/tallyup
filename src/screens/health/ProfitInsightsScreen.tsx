// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
    calc: 'Compares your total stock value month-over-month. Stable or slightly decreasing value scores highest; large swings up or down score lower.',
    nullStatus: 'Limited data',
  },
  orderingIntelligence: {
    label: 'Ordering Intel.',
    calc: 'Based on how often suggested orders are acted on. Each time you create a draft order from the Suggested Orders screen, it counts toward your acceptance rate. Higher acceptance means your ordering is data-driven rather than guesswork.',
    nullStatus: 'Needs 3 stocktakes',
  },
  wasteControl: {
    label: 'Waste Control',
    calc: 'Not yet built — coming in a future update.',
    nullStatus: 'Coming soon',
  },
};

const KPI_ORDER = ['stockAccuracy', 'labourEfficiency', 'inventoryHealth', 'orderingIntelligence', 'wasteControl'];

/** One recommendation, derived from the lowest-scoring available KPI. */
function buildRecommendation(kpis: Record<string, number | null>): string | null {
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
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const [health, setHealth] = useState<HostiHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthlyScores, setMonthlyScores] = useState<number[] | null>(null);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
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
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: c.navy, fontFamily: theme.fontTitleBold, marginBottom: 4 }}>
          Hosti Health
        </Text>

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color={c.deepBlue} />
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
                {health.score} / 100
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
              const recommendation = buildRecommendation(health.kpis);
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
                <View key={key} style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border }}>
                  <KpiCard c={c} theme={theme} kpiKey={key} score={(health.kpis as any)[key]} />
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

function KpiCard({
  c, theme, kpiKey, score,
}: {
  c: any; theme: any; kpiKey: string; score: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
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
      <Text style={{ fontSize: 11, color: c.deepBlue, marginTop: 4 }}>
        {expanded ? 'Hide calculation ▲' : 'How is this calculated? ▼'}
      </Text>
      {expanded && (
        <Text style={{ fontSize: 12, color: c.textSecondary, fontFamily: theme.fontBody, lineHeight: 17, marginTop: 6 }}>
          {meta.calc}
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
