// @ts-nocheck
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, FlatList } from 'react-native';
import { useLastCycleSummary } from '../../hooks/reports/useLastCycleSummary';
import { Timestamp } from 'firebase/firestore';

function fmt(ts: any) {
  try {
    if (ts && typeof ts?.toDate === 'function') return ts.toDate().toLocaleString();
    if (ts instanceof Date) return ts.toLocaleString();
  } catch {}
  return '—';
}

export default function LastCycleSummaryScreen() {
  const { loading, data, generateNow, refresh } = useLastCycleSummary();

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Last Cycle Summary</Text>

      <View style={styles.row}>
        <TouchableOpacity style={styles.primary} onPress={generateNow}>
          <Text style={styles.primaryText}>Generate / Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={refresh}>
          <Text style={styles.secondaryText}>Reload</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text>Loading…</Text>
        </View>
      ) : !data ? (
        <View style={[styles.card, styles.warn]}>
          <Text style={styles.warnText}>No snapshot yet. Tap “Generate / Refresh”.</Text>
        </View>
      ) : (
        <>
          <View style={styles.grid}>
            <View style={styles.card}>
              <Text style={styles.kpiLabel}>Generated</Text>
              <Text style={styles.kpiValue}>{fmt((data as any).generatedAt)}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.kpiLabel}>Departments</Text>
              <Text style={styles.kpiValue}>{data.departments}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.kpiLabel}>Areas</Text>
              <Text style={styles.kpiValue}>{data.areasCompleted}/{data.areasTotal}</Text>
              <Text style={styles.sub}>Completed / Total</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.kpiLabel}>In Progress</Text>
              <Text style={styles.kpiValue}>{data.areasInProgress}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.kpiLabel}>Items Counted</Text>
              <Text style={styles.kpiValue}>{data.itemsCounted}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.kpiLabel}>Shortages / Excess</Text>
              <Text style={styles.kpiValue}>{data.shortages} / {data.excesses}</Text>
            </View>
            <View style={styles.cardWide}>
              <Text style={styles.kpiLabel}>Value Impact (abs.)</Text>
              <Text style={styles.kpiValue}>${data.valueImpact?.toFixed(2)}</Text>
            </View>
          </View>

          <View style={[styles.card, { marginTop: 12 }]}>
            <Text style={styles.sectionTitle}>Top Variances</Text>
            <FlatList
              style={{ marginTop: 6 }}
              data={data.topVariances}
              keyExtractor={(r, i) => `${r.productId}-${i}`}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              renderItem={({ item }) => (
                <View style={styles.rowLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineName}>{item.name}</Text>
                    <Text style={styles.sub}>
                      variance {item.variance > 0 ? '+' : ''}{item.variance}
                      {item.unitCost != null ? ` · $${Number(item.unitCost).toFixed(2)}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.kpiValue, { fontSize: 16 }]}>
                    {item.valueImpact != null ? `$${Number(item.valueImpact).toFixed(2)}` : '—'}
                  </Text>
                </View>
              )}
              ListEmptyComponent={<Text>No variances calculated.</Text>}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },

  center: { paddingVertical: 40, alignItems: 'center', gap: 8 },

  row: { flexDirection: 'row', gap: 10 },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  primaryText: { color: '#fff', fontWeight: '800' },
  secondary: { backgroundColor: '#E5E7EB', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  secondaryText: { color: '#111827', fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, width: '48%', gap: 4 },
  cardWide: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, width: '100%', gap: 4 },

  kpiLabel: { fontSize: 12, opacity: 0.7 },
  kpiValue: { fontSize: 18, fontWeight: '900' },
  sub: { fontSize: 12, opacity: 0.7 },

  sectionTitle: { fontSize: 16, fontWeight: '800' },
  rowLine: { flexDirection: 'row', alignItems: 'center' },

  warn: { backgroundColor: '#FFF4E5', padding: 12, borderRadius: 12 },
  warnText: { color: '#8A5200' },

  lineName: { fontWeight: '700' },
});
