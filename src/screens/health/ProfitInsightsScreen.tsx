// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
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

export default function ProfitInsightsScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const [health, setHealth] = useState<HostiHealthData | null>(null);
  const [loading, setLoading] = useState(true);

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
        ) : (
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
        )}

        {!loading && health && (
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
      </ScrollView>
    </View>
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
