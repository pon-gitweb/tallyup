// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

type UsageData = {
  totalCalls: number;
  breakdown: Record<string, number>;
  resetAt: string;
  plan: string;
};

// Keep in sync with functions/src/services/aiMeter.ts PLAN_LIMITS
const PLAN_LIMITS: Record<string, Record<string, number>> = {
  beta: {
    total: 600, invoice_ocr: 300, product_photo: 75, shelf_scan: 15,
    stocktake_photo: 40, sales_report: 10, izzy: 150, suitee: 50,
    ai_insights: 12, suggest_orders: 20, variance_explain: 12,
  },
  core: {
    total: 500, invoice_ocr: 300, product_photo: 30, shelf_scan: 10,
    stocktake_photo: 20, sales_report: 5, izzy: 100, suitee: 30,
    ai_insights: 8, suggest_orders: 15, variance_explain: 8,
  },
  core_plus: {
    total: 800, invoice_ocr: 400, product_photo: 100, shelf_scan: 30,
    stocktake_photo: 60, sales_report: 15, izzy: 300, suitee: 100,
    ai_insights: 20, suggest_orders: 40, variance_explain: 20,
  },
};

const PLAN_LABELS: Record<string, string> = {
  beta: 'Beta (Pilot)',
  core: 'Core',
  core_plus: 'Core Plus',
};

const PHOTO_FEATURES = [
  { key: 'invoice_ocr', label: 'Invoice scanning' },
  { key: 'product_photo', label: 'Product photos' },
  { key: 'shelf_scan', label: 'Shelf scanning' },
  { key: 'stocktake_photo', label: 'Stocktake import' },
];
const ASSISTANT_FEATURES = [
  { key: 'izzy', label: 'Izzy questions' },
  { key: 'suitee', label: 'Suitee queries' },
  { key: 'ai_insights', label: 'AI Insights' },
  { key: 'suggest_orders', label: 'Order suggestions' },
  { key: 'variance_explain', label: 'Variance explanations' },
];

function barColour(pct: number): string {
  if (pct >= 100) return '#dc2626'; // red
  if (pct >= 90) return '#dc2626';
  if (pct >= 70) return '#d97706'; // amber
  return '#16a34a'; // green
}

function FeatureRow({
  label, used, limit, colours,
}: { label: string; used: number; limit: number; colours: any }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = used >= limit;
  const colour = barColour(pct);
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colours.text }}>{label}</Text>
          {atLimit && (
            <View style={{ backgroundColor: '#fee2e2', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#dc2626' }}>AT LIMIT</Text>
            </View>
          )}
        </View>
        <Text style={{ fontSize: 12, color: atLimit ? '#dc2626' : colours.textSecondary, fontWeight: atLimit ? '800' : '600' }}>
          {used}/{limit}
        </Text>
      </View>
      <View style={{ height: 8, backgroundColor: colours.border, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: 8, width: `${pct}%`, backgroundColor: colour, borderRadius: 4 }} />
      </View>
    </View>
  );
}

function AiUsageScreen() {
  const venueId = useVenueId();
  const colours = useColours();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const db = getFirestore();
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const snap = await getDoc(doc(db, 'venues', venueId, 'aiUsage', monthKey));
      setUsage(snap.exists()
        ? snap.data() as UsageData
        : { totalCalls: 0, breakdown: {}, resetAt: '', plan: 'beta' });
    } catch (e) {
      console.log('[AiUsage] load error', e);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const plan = usage?.plan || 'beta';
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.beta;
  const totalLimit = limits.total ?? 600;
  const totalUsed = usage?.totalCalls || 0;
  const breakdown = usage?.breakdown || {};
  const totalPct = totalLimit > 0 ? Math.min(100, Math.round((totalUsed / totalLimit) * 100)) : 0;

  const now = new Date();
  const resetAt = usage?.resetAt
    ? new Date(usage.resetAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });

  const monthLabel = now.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });

  const anyAtLimit = [...PHOTO_FEATURES, ...ASSISTANT_FEATURES].some(f => (breakdown[f.key] || 0) >= (limits[f.key] || 999));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colours.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 22, fontWeight: '900', color: colours.text, marginBottom: 2 }}>AI Usage</Text>
      <Text style={{ color: colours.textSecondary, fontSize: 14, marginBottom: 16 }}>
        {monthLabel} · Resets {resetAt}
      </Text>

      {loading ? (
        <ActivityIndicator color={colours.accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Plan + total */}
          <View style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colours.border, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontWeight: '800', fontSize: 15, color: colours.text }}>Plan: {PLAN_LABELS[plan] || plan}</Text>
              <Text style={{ fontSize: 13, color: colours.textSecondary }}>
                {totalUsed}/{totalLimit} total calls
              </Text>
            </View>
            <View style={{ height: 10, backgroundColor: colours.border, borderRadius: 5, overflow: 'hidden', marginBottom: 6 }}>
              <View style={{ height: 10, width: `${totalPct}%`, backgroundColor: barColour(totalPct), borderRadius: 5 }} />
            </View>
            <Text style={{ fontSize: 12, color: colours.textSecondary }}>{totalPct}% of monthly total used</Text>
          </View>

          {anyAtLimit && (
            <View style={{ backgroundColor: '#fef2f2', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#fecaca', marginBottom: 16 }}>
              <Text style={{ fontWeight: '800', color: '#dc2626', marginBottom: 4 }}>Some limits reached</Text>
              <Text style={{ color: '#dc2626', fontSize: 13 }}>
                Some features have reached their monthly limit. They reset automatically on {resetAt}.{'\n\n'}
                Contact office@hosti.co.nz if you need more.
              </Text>
              <TouchableOpacity onPress={() => Linking.openURL('mailto:office@hosti.co.nz')} style={{ marginTop: 8 }}>
                <Text style={{ color: '#1b4f72', fontWeight: '700', fontSize: 13 }}>Email us →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Photo features */}
          <View style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colours.border, marginBottom: 16 }}>
            <Text style={{ fontWeight: '800', color: colours.text, marginBottom: 14, fontSize: 14 }}>PHOTO FEATURES</Text>
            {PHOTO_FEATURES.map(f => (
              <FeatureRow
                key={f.key}
                label={f.label}
                used={breakdown[f.key] || 0}
                limit={limits[f.key] || 999}
                colours={colours}
              />
            ))}
          </View>

          {/* Assistant features */}
          <View style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colours.border, marginBottom: 16 }}>
            <Text style={{ fontWeight: '800', color: colours.text, marginBottom: 14, fontSize: 14 }}>ASSISTANT FEATURES</Text>
            {ASSISTANT_FEATURES.map(f => (
              <FeatureRow
                key={f.key}
                label={f.label}
                used={breakdown[f.key] || 0}
                limit={limits[f.key] || 999}
                colours={colours}
              />
            ))}
          </View>

          {plan === 'beta' && (
            <View style={{ backgroundColor: '#f0fdf4', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#bbf7d0', marginBottom: 16 }}>
              <Text style={{ fontWeight: '800', color: '#166534', marginBottom: 4 }}>Pilot access</Text>
              <Text style={{ color: '#166534', fontSize: 13 }}>
                You're on the beta pilot plan with generous limits. Usage is tracked to help us build fair pricing.
              </Text>
            </View>
          )}

          <TouchableOpacity onPress={load} style={{ alignItems: 'center', padding: 12 }}>
            <Text style={{ color: colours.textSecondary, fontSize: 13 }}>Refresh</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

export default withErrorBoundary(AiUsageScreen, 'AiUsage');
