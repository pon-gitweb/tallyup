import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useLastCycleSummary } from '../../hooks/reports/useLastCycleSummary';
import { formatNZD } from '../../utils/currency';
import type { VarianceRow } from '../../lib/lastCycleMath';

type RouteParams = { venueId: string };

export default function LastCycleSummaryScreen() {
  const route = useRoute() as any;
  const venueId: string | undefined = (route?.params as RouteParams | undefined)?.venueId;

  const [query, setQuery] = useState('');
  const state = useLastCycleSummary(venueId, { topN: 20 });

  const filtered = useMemo<VarianceRow[]>(() => {
    if (state.status !== 'ready') return [];
    const q = query.trim().toLowerCase();
    const rows = state.summary.topVariances;
    if (!q) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(q));
  }, [state, query]);

  if (!venueId) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>No venue selected. Navigate here with a valid {"{ venueId }"}.</Text>
      </View>
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading last cycle…</Text>
      </View>
    );
  }

  if (state.status === 'empty') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Last Cycle Summary</Text>
        <Text style={styles.muted}>No completed cycle found.</Text>
        <Text style={styles.mutedSmall}>Complete a stock take to see summary here.</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Error loading summary</Text>
        <Text style={styles.mutedSmall}>{state.error}</Text>
      </View>
    );
  }

  const { summary, completedAt } = state;
  const dateStr = completedAt ? new Date(completedAt).toLocaleString() : 'Unknown time';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Last Cycle Summary</Text>
      <Text style={styles.muted}>Completed: {dateStr}</Text>

      <View style={styles.metricsRow}>
        <Metric label="Items Counted" value={String(summary.totalItemsCounted)} />
        <Metric label="Shortages (value)" value={formatNZD(summary.totalShortageValue)} />
      </View>
      <View style={styles.metricsRow}>
        <Metric label="Excess (value)" value={formatNZD(summary.totalExcessValue)} />
        <Metric label="Net Impact" value={formatNZD(summary.netValueImpact)} />
      </View>

      <TextInput
        placeholder="Search top variances…"
        value={query}
        onChangeText={setQuery}
        style={styles.search}
        autoCorrect={false}
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id || item.name}
        contentContainerStyle={filtered.length === 0 ? styles.centerEmpty : undefined}
        ListEmptyComponent={<Text style={styles.muted}>No matches.</Text>}
        renderItem={({ item }) => <VarianceRowView row={item} />}
      />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function VarianceRowView({ row }: { row: VarianceRow }) {
  const sign = row.diffUnits === 0 ? '' : row.diffUnits > 0 ? '+' : '';
  const diffText = `${sign}${row.diffUnits}`;
  const val = row.valueImpact;
  const valStr = (val >= 0 ? '+' : '−') + formatNZD(Math.abs(val));
  const valStyle = val >= 0 ? styles.excess : styles.shortage;

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{row.name}</Text>
        <Text style={styles.rowMeta}>Par: {row.par} • Count: {row.count} • Δ {diffText}</Text>
      </View>
      <Text style={[styles.rowValue, valStyle]}>{valStr}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  muted: { color: '#666' },
  mutedSmall: { color: '#888', fontSize: 12, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  centerEmpty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },

  metricsRow: { flexDirection: 'row', gap: 12 },
  metricCard: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: '#f4f4f5' },
  metricLabel: { color: '#555', marginBottom: 6 },
  metricValue: { fontSize: 18, fontWeight: '700' },

  search: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rowMain: { flexShrink: 1, paddingRight: 12 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowMeta: { color: '#666', marginTop: 2 },
  rowValue: { fontSize: 16, fontWeight: '700' },
  shortage: { color: '#b00020' },
  excess: { color: '#0b7a00' },
  error: { color: '#b00020', fontWeight: '600' },
});
