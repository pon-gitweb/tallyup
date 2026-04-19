import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TextInput, TouchableOpacity, FlatList, Modal, ScrollView, Pressable } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { listBudgets, createBudget, computeBudgetProgress, isoToTs, tsToIso, Budget } from '../../services/budgets';
import { getAIContext } from '../../services/aiContext';
import { AI_BASE_URL } from '../../config/ai';
import { getAuth } from 'firebase/auth';
import { listSuppliers, Supplier } from '../../services/suppliers';
import { exportPdf } from '../../utils/exporters';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

type Row = Budget & { progress?: { spent: number; remaining: number; pct: number } };

export default function BudgetsScreen() {
  const venueId = useVenueId();
  const colours = useColours();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [aiNote, setAiNote] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);

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

  async function getAiSuggestions() {
    if (!venueId) return;
    try {
      setAiLoading(true); setShowSuggestions(true);
      const ctx = await getAIContext(venueId);
      const token = await getAuth().currentUser?.getIdToken();
      const resp = await fetch(AI_BASE_URL + '/api/budget-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ venueId, aiContext: ctx }),
      });
      const data = await resp.json();
      setAiSuggestions(data.suggestions || []);
      setAiNote(data.overallNote || null);
    } catch (e) { Alert.alert('AI Error', e && e.message ? e.message : 'Could not get suggestions'); }
    finally { setAiLoading(false); }
  }

  function acceptSuggestion(s) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    setAmount(String(s.suggestedAmount));
    setSupplierId(s.supplierId || '');
    setStartIso(y + '-' + m + '-01');
    setEndIso(y + '-' + m + '-' + String(lastDay).padStart(2, '0'));
    setNotes(s.reasoning || '');
    setShowSuggestions(false); setIsCreating(true);
  }

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

  const onExportPdf = async () => {
    if (!venueId) {
      Alert.alert('Not ready', 'Select a venue first.');
      return;
    }
    if (!rows.length) {
      Alert.alert('Nothing to export', 'No budgets defined yet.');
      return;
    }
    try {
      const venueName = await fetchVenueName(venueId);
      const html = buildBudgetsHtml(venueName, rows, supplierMap);
      const out = await exportPdf('Budgets', html);
      if (!out.ok) {
        Alert.alert(
          'PDF generated',
          'Sharing may be unavailable or failed on this device, but the PDF was written to storage if supported.',
        );
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not export budgets.');
    }
  };

  if (loading) {
    return (<View style={styles.center}><ActivityIndicator /><Text>Loading budgets…</Text></View>);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Budgets</Text>

      {/* create form toggle */}
      <TouchableOpacity style={styles.toggle} onPress={() => {
          if (!isCreating) {
            // Smart defaults: current month
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
            if (!startIso) setStartIso(y + '-' + m + '-01');
            if (!endIso) setEndIso(y + '-' + m + '-' + String(lastDay).padStart(2, '0'));
          }
          setIsCreating(v => !v);
        }}>
        <Text style={styles.toggleText}>{isCreating ? 'Cancel' : 'New Budget'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.toggle, { backgroundColor: '#F3E8FF', marginLeft: 8 }]} onPress={getAiSuggestions} disabled={aiLoading}>
        <Text style={[styles.toggleText, { color: '#7C3AED' }]}>{aiLoading ? 'Thinking...' : '✨ AI Suggest'}</Text>
      </TouchableOpacity>

      {showSuggestions && (
        <View style={{ backgroundColor: "#F5F3FF", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#DDD6FE", marginBottom: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={{ fontWeight: "900", fontSize: 16, color: "#5B21B6" }}>AI Budget Suggestions</Text>
            <TouchableOpacity onPress={() => setShowSuggestions(false)}>
              <Text style={{ color: "#7C3AED", fontWeight: "700" }}>Close</Text>
            </TouchableOpacity>
          </View>
          {aiNote ? <Text style={{ color: "#6B7280", marginBottom: 10, fontSize: 13 }}>{aiNote}</Text> : null}
          {aiLoading ? (
            <ActivityIndicator color="#7C3AED" />
          ) : aiSuggestions.length === 0 ? (
            <Text style={{ color: "#6B7280" }}>No suggestions yet. Complete more stocktakes and upload sales reports to improve AI suggestions.</Text>
          ) : aiSuggestions.map((s, i) => (
            <View key={i} style={{ backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#EDE9FE" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontWeight: "800", color: "#111", flex: 1 }}>{s.supplierName}</Text>
                <Text style={{ fontWeight: "900", fontSize: 18, color: "#5B21B6" }}>${"$"}{s.suggestedAmount}</Text>
              </View>
              <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 4 }}>{s.reasoning}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <Text style={{ fontSize: 11, color: "#9CA3AF" }}>Confidence: {Math.round((s.confidence || 0) * 100)}%</Text>
                <TouchableOpacity onPress={() => acceptSuggestion(s)}
                  style={{ backgroundColor: "#7C3AED", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Use this</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

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
              <Text style={styles.label}>Supplier (optional)</Text>
              <TouchableOpacity
                onPress={() => setSupplierPickerOpen(true)}
                style={[styles.input, { justifyContent: 'center' }]}
              >
                <Text style={{ color: supplierId ? '#111' : '#9CA3AF' }}>
                  {supplierId ? (supplierMap.get(supplierId)?.name || supplierId) : 'All suppliers'}
                </Text>
              </TouchableOpacity>
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
                <View style={[styles.barFill, { width: pct + '%', backgroundColor: pct >= 100 ? colours.error : pct >= 80 ? '#D97706' : colours.success }]} />
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

      {/* Supplier picker modal */}
      <Modal visible={supplierPickerOpen} transparent animationType="fade" onRequestClose={() => setSupplierPickerOpen(false)}>
        <Pressable style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', alignItems:'center' }} onPress={() => setSupplierPickerOpen(false)}>
          <Pressable style={{ backgroundColor:'#fff', borderRadius:16, padding:16, width:'85%', maxHeight:'70%' }}>
            <Text style={{ fontWeight:'900', fontSize:16, marginBottom:12 }}>Select Supplier</Text>
            <ScrollView>
              <TouchableOpacity
                onPress={() => { setSupplierId(''); setSupplierPickerOpen(false); }}
                style={{ padding:12, borderBottomWidth:1, borderColor:'#F3F4F6' }}
              >
                <Text style={{ fontWeight:'700', color: !supplierId ? '#0A84FF' : '#111' }}>All suppliers</Text>
                <Text style={{ color:'#6B7280', fontSize:12 }}>No supplier filter</Text>
              </TouchableOpacity>
              {suppliers.map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => { setSupplierId(s.id || ''); setSupplierPickerOpen(false); }}
                  style={{ padding:12, borderBottomWidth:1, borderColor:'#F3F4F6' }}
                >
                  <Text style={{ fontWeight:'700', color: supplierId === s.id ? '#0A84FF' : '#111' }}>{s.name}</Text>
                  {s.email ? <Text style={{ color:'#6B7280', fontSize:12 }}>{s.email}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {rows.length > 0 && (
        <TouchableOpacity style={styles.exportButton} onPress={onExportPdf}>
          <Text style={styles.exportButtonText}>Export Budgets (PDF)</Text>
        </TouchableOpacity>
      )}
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

  exportButton: { marginTop:12, backgroundColor:'#1D4ED8', paddingVertical:12, borderRadius:12, alignItems:'center' },
  exportButtonText: { color:'#fff', fontWeight:'800' },
});

async function fetchVenueName(venueId: string | null | undefined) {
  if (!venueId) return 'Venue';
  try {
    const snap = await getDoc(doc(db, 'venues', venueId));
    if (snap.exists()) {
      const d: any = snap.data() || {};
      return d.name || d.venueName || 'Venue';
    }
  } catch (e) {
    // best-effort only
  }
  return 'Venue';
}

function buildBudgetsHtml(venueName: string, rows: Row[], supplierMap: Map<string, Supplier>) {
  const bodyRows = rows && rows.length
    ? rows.map((b) => {
        const name = b.supplierId ? (supplierMap.get(b.supplierId)?.name || b.supplierId) : 'All Suppliers';
        const start = tsToIso(b.periodStart);
        const end = tsToIso(b.periodEnd);
        const spent = b.progress ? b.progress.spent : null;
        const amount = typeof b.amount === 'number' ? b.amount : null;
        const pct = b.progress ? b.progress.pct : 0;
        return `
          <tr>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(name)}</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(start)} → ${escapeHtml(end)}</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${spent == null ? '—' : '$' + Number(spent).toFixed(2)}</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${amount == null ? '—' : '$' + Number(amount).toFixed(2)}</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${pct.toFixed(0)}%</td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="5" style="padding:8px;text-align:center;color:#6B7280;">No budgets defined.</td></tr>';

  return `
    <html>
      <body style="font-family:-apple-system,Roboto,sans-serif;padding:16px;">
        <h2>${escapeHtml(venueName)} — Budgets</h2>
        <p style="color:#4B5563;margin:0 0 12px 0;">
          Supplier and venue-level spend limits with current utilisation.
        </p>

        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:13px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Supplier</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Period</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Spent</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Budget</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Used</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function escapeHtml(str: any) {
  const s = String(str ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
