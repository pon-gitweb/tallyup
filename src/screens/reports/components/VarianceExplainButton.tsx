// @ts-nocheck
import React from 'react';
import { Alert, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { explainVariance } from '../../../services/aiVariance';

type Props = {
  venueId: string | null | undefined;
  departmentId: string | null | undefined;
  row: any;
};

const pct = (v: any) => (typeof v === 'number' && isFinite(v) ? `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` : 'unknown');

export default function VarianceExplainButton({ venueId, departmentId, row }: Props) {
  const [busy, setBusy] = React.useState(false);

  const onPress = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const counted = typeof row?.onHand === 'number' ? row.onHand : 0;
      const expected = (typeof row?.onHand === 'number' && typeof row?.varianceQty === 'number') ? row.onHand - row.varianceQty : 0;

      const ai = await explainVariance({
        itemName: row?.name,
        varianceQty: row?.varianceQty ?? row?.variance ?? 0,
        varianceValue: row?.varianceValue ?? row?.value ?? null,
        par: row?.par,
        lastCountQty: counted,
        theoreticalOnHand: typeof row?.onHand === 'number' ? row.onHand : null,
        departmentId: row?.departmentId ?? departmentId ?? null,
        recentSoldQty: row?.recentSoldQty ?? undefined,
        recentReceivedQty: row?.recentReceivedQty ?? undefined,
        lastDeliveryAt: row?.lastDeliveryAt ?? undefined,
        context: {
          venueId: String(venueId || ''),
          areaId: null,
          productId: row?.productId || row?.id || String(row?.name || 'unknown'),
          expected,
          counted,
          unit: row?.unit ?? null,
          departmentId: row?.departmentId ?? departmentId ?? null,
          lastDeliveryAt: row?.lastDeliveryAt ?? null,
          recentSoldQty: row?.recentSoldQty ?? null,
          recentReceivedQty: row?.recentReceivedQty ?? null,
        },
      });

      const summary = (ai?.summary && String(ai.summary).trim()) || 'No specific insight.';
      const factors = Array.isArray(ai?.factors) ? ai.factors.filter(Boolean) : [];
      const missing = Array.isArray(ai?.missing) ? ai.missing.filter(Boolean) : [];

      const lines = [
        summary,
        '',
        factors.length ? 'Key factors:' : null,
        ...factors.map((f: string) => `- ${f}`),
        '',
        `Confidence: ${pct(ai?.confidence)}`,
        '',
        missing.length ? 'To improve results, add:' : null,
        ...missing.map((m: string) => `- ${m}`),
        !summary || summary === 'No specific insight.' ? '\n(Insufficient recent context — conservative explanation.)' : null,
      ].filter(Boolean);

      Alert.alert('AI Insight', lines.join('\n'));
    } catch (e: any) {
      Alert.alert('AI Insight', e?.message || 'Failed to get explanation.');
    } finally {
      setBusy(false);
    }
  }, [busy, venueId, departmentId, row]);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={{ marginLeft: 8, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}
      accessibilityLabel="Explain this variance"
    >
      {busy ? <ActivityIndicator /> : <Text style={{ color: '#1D4ED8', fontWeight: '800' }}>🤖 Explain</Text>}
    </TouchableOpacity>
  );
}
