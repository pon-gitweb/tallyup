// @ts-nocheck
/**
 * AiUsageScreen — Settings → AI Usage
 * Shows per-venue AI call usage for the current month.
 * Prepares for future billing tier enforcement.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
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

const CALL_LABELS: Record<string, string> = {
  'variance-explain': 'Variance explanations',
  'suggest-orders': 'Order suggestions',
  'budget-suggest': 'Budget suggestions',
  'photo-count': 'Photo counts',
  'invoice-ocr': 'Invoice processing',
};

const PLAN_LIMITS: Record<string, number> = {
  beta: 999999,
  core: 200,
  core_plus: 999999,
};

const PLAN_LABELS: Record<string, string> = {
  beta: 'Beta — Unlimited',
  core: 'Core — 200/month',
  core_plus: 'Core Plus — Unlimited',
};

function AiUsageScreen() {
  const venueId = useVenueId();
  const themeColours = useColours();
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
      if (snap.exists()) {
        setUsage(snap.data() as UsageData);
      } else {
        setUsage({ totalCalls: 0, breakdown: {}, resetAt: '', plan: 'beta' });
      }
    } catch (e) {
      console.log('[AiUsage] load error', e);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const plan = usage?.plan || 'beta';
  const limit = PLAN_LIMITS[plan] ?? 999999;
  const used = usage?.totalCalls || 0;
  const remaining = Math.max(0, limit - used);
  const pct = limit === 999999 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const resetDate = usage?.resetAt ? new Date(usage.resetAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' }) : '1st of next month';

  const barColour = pct > 80 ? themeColours.error : pct > 60 ? themeColours.warning : themeColours.success;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: themeColours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      <View>
        <Text style={{ fontSize: 22, fontWeight: '900', color: themeColours.text }}>AI Usage</Text>
        <Text style={{ color: themeColours.textSecondary, marginTop: 4, fontSize: 14 }}>
          Your AI call usage for this month. Resets on {resetDate}.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={themeColours.accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Plan badge */}
          <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: themeColours.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontWeight: '900', color: themeColours.text, fontSize: 16 }}>This month</Text>
              <View style={{ backgroundColor: themeColours.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: themeColours.accent }}>{PLAN_LABELS[plan] || plan}</Text>
              </View>
            </View>

            {/* Usage numbers */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
              <View style={{ flex: 1, backgroundColor: themeColours.background, borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ fontSize: 36, fontWeight: '900', color: themeColours.text }}>{used}</Text>
                <Text style={{ color: themeColours.textSecondary, fontSize: 12, fontWeight: '700' }}>AI calls used</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: themeColours.background, borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ fontSize: 36, fontWeight: '900', color: limit === 999999 ? themeColours.success : barColour }}>
                  {limit === 999999 ? '∞' : remaining}
                </Text>
                <Text style={{ color: themeColours.textSecondary, fontSize: 12, fontWeight: '700' }}>remaining</Text>
              </View>
            </View>

            {/* Progress bar — only shown for limited plans */}
            {limit !== 999999 && (
              <View>
                <View style={{ height: 8, backgroundColor: themeColours.border, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                  <View style={{ height: 8, width: pct + '%', backgroundColor: barColour, borderRadius: 4 }} />
                </View>
                <Text style={{ color: themeColours.textSecondary, fontSize: 12 }}>{pct}% of {limit} monthly calls used</Text>
              </View>
            )}
          </View>

          {/* Breakdown */}
          {usage?.breakdown && Object.keys(usage.breakdown).length > 0 && (
            <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: themeColours.border }}>
              <Text style={{ fontWeight: '900', color: themeColours.text, marginBottom: 12 }}>Breakdown by feature</Text>
              {Object.entries(usage.breakdown).map(([key, count]) => (
                <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: themeColours.border }}>
                  <Text style={{ color: themeColours.text, fontWeight: '600' }}>{CALL_LABELS[key] || key}</Text>
                  <View style={{ backgroundColor: themeColours.primaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 }}>
                    <Text style={{ fontWeight: '800', color: themeColours.accent, fontSize: 13 }}>{count}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Beta notice */}
          {plan === 'beta' && (
            <View style={{ backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' }}>
              <Text style={{ fontWeight: '800', color: '#166534', marginBottom: 4 }}>Beta — full access</Text>
              <Text style={{ color: '#166534', fontSize: 13 }}>
                All AI features are unlimited during the pilot. Usage is tracked so we can right-size plans before launch. Your data helps us build fair pricing.
              </Text>
            </View>
          )}

          {/* Low remaining warning */}
          {plan !== 'beta' && plan !== 'core_plus' && pct >= 80 && (
            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FDE68A' }}>
              <Text style={{ fontWeight: '800', color: '#92400E', marginBottom: 4 }}>Running low</Text>
              <Text style={{ color: '#92400E', fontSize: 13 }}>
                You have {remaining} AI calls left this month. Upgrade to Core Plus for unlimited access.
              </Text>
            </View>
          )}

          <TouchableOpacity onPress={load} style={{ alignItems: 'center', padding: 12 }}>
            <Text style={{ color: themeColours.textSecondary, fontSize: 13 }}>Refresh usage data</Text>
          </TouchableOpacity>
        </>
      )}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(AiUsageScreen, 'AiUsage');
