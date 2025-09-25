import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { computeVarianceSnapshot, VarianceRow } from '../../services/reports/variance';

export default function VarianceSnapshotScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [rowsShort, setRowsShort] = useState<VarianceRow[]>([]);
  const [rowsExcess, setRowsExcess] = useState<VarianceRow[]>([]);
  const [shortageValue, setShortageValue] = useState(0);
  const [excessValue, setExcessValue] = useState(0);
  const [q, setQ] = useState('');

  async function load() {
    if (!venueId) { setLoading(false); return; }
    try {
      setLoading(true);
      const res = await computeVarianceSnapshot(venueId);
      setRowsShort(res.shortages);
      setRowsExcess(res.excess);
      setShortageValue(res.totals.shortageValue);
      setExcessValue(res.totals.excessValue);
    } catch (e: any) {
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  const filteredShort = useMemo(() => {
    if (!q) return rowsShort;
    const qq = q.toLowerCase();
    return rowsShort.filter(r => r.name.toLowerCase().includes(qq) || (r.sku || '').toLowerCase().includes(qq));
  }, [q, rowsShort]);

  const filteredExcess = useMemo(() => {
    if (!q) return rowsExcess;
    const qq = q.toLowerCase();
    return rowsExcess.filter(r => r.name.toLowerCase().includes(qq) || (r.sku || '').toLowerCase().includes(qq));
  }, [q, rowsExcess]);

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Calculating variance…</Text></View>);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Variance Snapshot</Text>
      <Text style={styles.sub}>Compares current on‑hand (from last counts) against par level.</Text>

      <TextInput
        placeholder="Search by name or SKU"
        value={q}
        onChangeText={setQ}
        style={styles.input}
        autoCapitalize="none"
      />

      <View style={styles.totals}>
        <View style={styles.pill}>
          <Text style={styles.pillLabel}>Shortage value</Text>
          <Text style={[styles.pillValue, { color: '#FF3B30' }]}>{shortageValue.toFixed(2)}</Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillLabel}>Excess value</Text>
          <Text style={[styles.pillValue, { color: '#34C759' }]}>{excessValue.toFixed(2)}</Text>
        </View>
      </View>

      <Section title="Top Shortages (value impact)">
        <FlatList
          data={filteredShort}
          keyExtractor={(r) => r.productId}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => <Row r={item} color="#FF3B30" />}
          ListEmptyComponent={<Text style={{ opacity: 0.7 }}>No shortages.</Text>}
        />
      </Section>

      <Section title="Top Excess (value impact)">
        <FlatList
          data={filteredExcess}
          keyExtractor={(r) => r.productId}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => <Row r={item} color="#34C759" />}
          ListEmptyComponent={<Text style={{ opacity: 0.7 }}>No excess.</Text>}
        />
      </Section>
    </View>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ r, color }: { r: VarianceRow; color: string }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{r.name}</Text>
        <Text style={styles.sub}>{r.sku || '—'} · Unit: {r.unit || '—'}</Text>
      </View>
      <View style={styles.cell}>
        <Text style={styles.cellLabel}>Par</Text>
        <Text style={styles.cellVal}>{r.par}</Text>
      </View>
      <View style={styles.cell}>
        <Text style={styles.cellLabel}>On‑hand</Text>
        <Text style={styles.cellVal}>{r.onHand}</Text>
      </View>
      <View style={styles.cell}>
        <Text style={styles.cellLabel}>Variance</Text>
        <Text style={[styles.cellVal, { color }]}>{r.variance}</Text>
      </View>
      <View style={[styles.cell, { width: 90 }]}>
        <Text style={styles.cellLabel}>Value</Text>
        <Text style={styles.cellVal}>{r.unitCost != null ? (r.valueImpact).toFixed(2) : '—'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { opacity: 0.7, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  totals: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  pill: { flex: 1, backgroundColor: '#F2F2F7', padding: 10, borderRadius: 12 },
  pillLabel: { fontWeight: '700', opacity: 0.8 },
  pillValue: { fontWeight: '900', fontSize: 16 },
  sectionTitle: { fontWeight: '800', marginBottom: 6, marginTop: 4 },
  card: { backgroundColor: '#EFEFF4', padding: 8, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'white', padding: 10, borderRadius: 10 },
  name: { fontWeight: '700' },
  cell: { alignItems: 'flex-end', minWidth: 70 },
  cellLabel: { opacity: 0.5, fontSize: 12 },
  cellVal: { fontWeight: '800' },
});
