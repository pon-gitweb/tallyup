import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { listBudgets, createBudget, computeBudgetProgress, isoToTs, tsToIso, Budget } from '../../services/budgets';
import { listSuppliers, Supplier } from '../../services/suppliers';

type Row = Budget & { progress?: { spent: number; remaining: number; pct: number } };

export default function BudgetsScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // new budget form
  const [amount, setAmount] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [startIso, setStartIso] = useState<string>(''); // YYYY-MM-DD
  const [endIso, setEndIso] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const supplierMap = useMemo(() => {
    const m = new Map<string, Supplier>();
    suppliers.forEach(s => m.set(s.id!, s));
    return m;
  }, [suppliers]);

  async function load() {
    if (!venueId) { setRows([]); setLoading(false); return; }
    try {
      setLoading(true);
      const [b, sups] = await Promise.all([listBudgets(venueId), listSuppliers(venueId)]);
      setSuppliers(sups);

      const withProg: Row[] = [];
      for (const budget of b) {
        try {
          const p = await computeBudgetProgress(venueId, budget);
          withProg.push({ ...budget, progress: { spent: p.spent, remaining: p.remaining, pct: p.pct } });
        } catch (e: any) {
          console.log('[Budgets] compute error', e?.message);
          withProg.push(budget);
        }
      }
      setRows(withProg);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  async function onCreate() {
    if (!venueId) return;
    const amt = Number(amount);
    if (!amt || !startIso || !endIso) {
      Alert.alert('Missing fields', 'Amount, start and end are required.');
      return;
    }
    try {
      await createBudget(venueId, {
        amount: amt,
        supplierId: supplierId || null,
        periodStart: isoToTs(startIso),
        periodEnd: isoToTs(endIso),
        notes: notes || null,
      });
      setAmount(''); setSupplierId(''); setStartIso(''); setEndIso(''); setNotes('');
      setIsCreating(false);
      await load();
    } catch (e: any) {
      Alert.alert('Create failed', e?.message || 'Unknown error');
    }
  }

  if (loading) {
    return (<View style={styles.center}><ActivityIndicator /><Text>Loading budgets…</Text></View>);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Budgets</Text>

      {/* create form toggle */}
      <TouchableOpacity style={styles.toggle} onPress={() => setIsCreating(v => !v)}>
        <Text style={styles.toggleText}>{isCreating ? 'Cancel' : 'New Budget'}</Text>
      </TouchableOpacity>

      {isCreating && (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={[styles.col, {flex:1}]}>
              <Text style={styles.label}>Amount</Text>
              <TextInput
                placeholder="e.g. 1200"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
                style={styles.input}
              />
            </View>
            <View style={[styles.col, {flex:1}]}>
              <Text style={styles.label}>Supplier (optional, id)</Text>
              <TextInput
                placeholder="supplier id (or leave blank)"
                value={supplierId}
                onChangeText={setSupplierId}
                style={styles.input}
              />
              <Text style={styles.hint}>Known: {suppliers.map(s => s.name).join(', ') || '—'}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.col, {flex:1}]}>
              <Text style={styles.label}>Start (YYYY-MM-DD)</Text>
              <TextInput placeholder="2025-09-01" value={startIso} onChangeText={setStartIso} style={styles.input} />
            </View>
            <View style={[styles.col, {flex:1}]}>
              <Text style={styles.label}>End (YYYY-MM-DD)</Text>
              <TextInput placeholder="2025-09-30" value={endIso} onChangeText={setEndIso} style={styles.input} />
            </View>
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput placeholder="Notes…" value={notes} onChangeText={setNotes} style={styles.input} />
          </View>

          <TouchableOpacity style={styles.primary} onPress={onCreate}>
            <Text style={styles.primaryText}>Create Budget</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id!}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item: b }) => {
          const name = b.supplierId ? (supplierMap.get(b.supplierId)?.name || b.supplierId) : 'All Suppliers';
          const start = tsToIso(b.periodStart);
          const end = tsToIso(b.periodEnd);
          const prog = b.progress;
          const pct = prog ? prog.pct : 0;
          return (
            <View style={styles.bcard}>
              <Text style={styles.btitle}>{name}</Text>
              <Text style={styles.sub}>{start} → {end}</Text>
              <View style={styles.barWrap}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.sub}>
                Spent {prog ? prog.spent.toFixed(2) : '—'} / {Number(b.amount || 0).toFixed(2)} ({pct}%)
              </Text>
              {b.notes ? <Text style={styles.notes}>{b.notes}</Text> : null}
            </View>
          );
        }}
        ListEmptyComponent={<Text>No budgets yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex:1, padding:16, gap:12 },
  center: { flex:1, alignItems:'center', justifyContent:'center', gap:8 },
  title: { fontSize:22, fontWeight:'800' },
  toggle: { alignSelf:'flex-start', backgroundColor:'#E5F0FF', paddingVertical:8, paddingHorizontal:12, borderRadius:10 },
  toggleText: { color:'#0A84FF', fontWeight:'800' },
  card: { backgroundColor:'#F2F2F7', padding:12, borderRadius:12, gap:10 },
  row: { flexDirection:'row', gap:10 },
  col: { gap:6 },
  label: { fontWeight:'700' },
  hint: { fontSize:12, opacity:0.7 },
  input: { borderWidth:1, borderColor:'#D0D3D7', borderRadius:10, paddingHorizontal:10, paddingVertical:8 },
  primary: { backgroundColor:'#0A84FF', paddingVertical:12, borderRadius:12, alignItems:'center' },
  primaryText: { color:'#fff', fontWeight:'800' },

  bcard: { backgroundColor:'#EFEFF4', padding:12, borderRadius:12, gap:6 },
  btitle: { fontWeight:'800' },
  sub: { opacity:0.8 },
  notes: { marginTop:4 },
  barWrap: { height:10, backgroundColor:'#E3E6EA', borderRadius:8, overflow:'hidden', marginTop:6 },
  barFill: { height:10, backgroundColor:'#0A84FF' },
});
