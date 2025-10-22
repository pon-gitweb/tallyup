// @ts-nocheck
import React from 'react';
import { TouchableOpacity, View, Text, ActivityIndicator } from 'react-native';
import { explainVariance } from '../../services/aiVariance';

type ExplainOut = {
  text?: string;
  confidence?: number; // 0..1
  par?: number | null;
  factors?: Array<{ key?: string; label?: string }>;
  cachedAt?: number | string | null; // optional from server
};

export default function VarianceExplainButton({ ctx }: { ctx: any }) {
  const [loading, setLoading] = React.useState(false);
  const [res, setRes] = React.useState<ExplainOut | null>(null);

  // very small heuristic when AI has nothing useful
  function fallbackHeuristic(input: any): ExplainOut {
    const par  = Number.isFinite(input?.parLevel) ? Number(input.parLevel) : null;
    const oh   = Number.isFinite(input?.onHand) ? Number(input.onHand) : 0;
    const prev = Number.isFinite(input?.lastCountQty) ? Number(input.lastCountQty) : 0;
    const mov  = Number.isFinite(input?.movement) ? Number(input.movement) : 0;
    const delta = Number.isFinite(input?.varianceQty) ? Number(input.varianceQty) : (oh - prev);

    let cause = 'counting issue'; let conf = 0.6;
    if (delta > 0) {
      cause = mov <= 0.1 ? 'overcount at last stock take' : 'slow movement / overcount';
    } else if (delta < 0) {
      cause = mov > 0 ? 'usage/sales not recorded timely' : 'missed delivery or undercount';
    } else if (par != null && oh < par) {
      cause = 'below PAR';
    }

    const bits = ['AI insight unavailable', `Likely ${cause}`];
    if (par != null) bits.push(`PAR ${par}`);
    return { text: bits.join(' · '), confidence: conf, par };
  }

  const onPress = React.useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const out = await explainVariance(ctx);
      const cleanText = (out?.text || '').trim();
      if (!cleanText || cleanText === '—') {
        setRes(fallbackHeuristic(ctx));
      } else {
        setRes(out as ExplainOut);
      }
    } catch {
      setRes(fallbackHeuristic(ctx));
    } finally {
      setLoading(false);
    }
  }, [loading, ctx]);

  if (res) {
    const t = (res.text || '—').trim();
    const confPct = typeof res.confidence === 'number' && res.confidence >= 0 && res.confidence <= 1
      ? ` (≈${Math.round(res.confidence * 100)}%${res.cachedAt ? ', cached' : ''})`
      : ' (confidence unknown)';
    const parStr = Number.isFinite(res.par) ? ` · PAR ${res.par}` : '';
    return (
      <View style={{ marginLeft: 8, maxWidth: 260 }}>
        <Text style={{ color: '#6B7280', fontSize: 12 }} numberOfLines={3}>
          {t}{confPct}{parStr}
        </Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      style={{ marginLeft: 8, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}
      accessibilityLabel="Explain this variance"
      testID="variance-explain-button"
    >
      {loading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 12, color: '#1F2937', marginLeft: 6 }}>Explaining…</Text>
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: '#1D4ED8', fontWeight: '800' }}>Explain</Text>
      )}
    </TouchableOpacity>
  );
}
