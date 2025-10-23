// @ts-nocheck
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Summary = {
  withinBand?: boolean;
  bandPct?: number;
  message?: string;
};

export default function VarianceBand({ summary }: { summary: Summary|null }) {
  if (!summary) {
    return (
      <View style={[S.band, S.neutral]}>
        <Text style={S.bandText}>Calculating latest variance…</Text>
      </View>
    );
  }
  const pct = Number.isFinite(summary.bandPct) ? summary.bandPct : 1.5;
  const ok = !!summary.withinBand;

  return (
    <View style={[S.band, ok ? S.ok : S.warn]}>
      <Text style={S.bandText}>
        {summary.message || (ok ? 'Within tolerance' : 'Outside tolerance')}
        <Text style={S.dim}>  ·  tolerance ±{pct}%</Text>
      </Text>
    </View>
  );
}

const S = StyleSheet.create({
  band: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  ok: { backgroundColor: '#ecfdf5', borderWidth: 0.5, borderColor: '#a7f3d0' },
  warn: { backgroundColor: '#fef2f2', borderWidth: 0.5, borderColor: '#fecaca' },
  neutral: { backgroundColor: '#f3f4f6', borderWidth: 0.5, borderColor: '#e5e7eb' },
  bandText: { fontSize: 12, fontWeight: '800', color: '#111827' },
  dim: { color: '#6b7280', fontWeight: '700' },
});
