// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDocs, setDoc, updateDoc, serverTimestamp, query, where, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_TYPES = [
  { id: 'morning',   label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening',   label: 'Evening' },
  { id: 'full_day',  label: 'Full day' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type CountRow = {
  productId: string;
  productName: string;
  openingCount: number;
  receivedQty: number;
  expectedCount: number;
  actualCount: number;
  velocity: number | null;
  unit: string;
};

type ReconcileRow = CountRow & { used: number; expectedUsed: number; variance: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function varianceLabel(variance: number, expectedUsed: number): { icon: string; color: string; text: string } {
  if (expectedUsed === 0) return { icon: '–', color: '#6b7280', text: 'No baseline' };
  const pct = Math.abs(variance / expectedUsed);
  if (pct <= 0.1) return { icon: '✓', color: '#16a34a', text: 'Within range' };
  if (variance > 0) return { icon: '⚠️', color: '#d97706', text: 'Higher than expected' };
  return { icon: '▼', color: '#6b7280', text: 'Lower than expected' };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalSessionCountScreen() {
  const nav    = useNavigation<any>();
  const route  = useRoute<any>();
  const { barId, barName } = route.params || {};
  const venueId = useVenueId();

  const [sessionType,  setSessionType]  = useState('afternoon');
  const [rows,         setRows]         = useState<CountRow[]>([]);
  const [loading,      setLoading]      = useState(FESTIVAL_BETA);
  const [saving,       setSaving]       = useState(false);
  const [reconcile,    setReconcile]    = useState<ReconcileRow[] | null>(null);

  // Load stock for this bar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    Promise.all([
      getDocs(collection(db, 'venues', venueId, 'bars', barId, 'stock')),
      getDocs(query(
        collection(db, 'venues', venueId, 'requests'),
        where('barId', '==', barId),
        where('status', '==', 'delivered'),
      )),
      getDocs(query(
        collection(db, 'venues', venueId, 'sessions'),
        where('barId', '==', barId),
        orderBy('completedAt', 'desc'),
        limit(1),
      )),
    ]).then(([stockSnap, reqSnap, sessSnap]) => {
      const lastSessionAt = sessSnap.docs[0]?.data()?.completedAt?.toDate?.() ?? new Date(0);
      const received: Record<string, number> = {};
      for (const r of reqSnap.docs) {
        const data = r.data() as any;
        const completedAt = data.completedAt?.toDate?.();
        if (!completedAt || completedAt <= lastSessionAt) continue;
        for (const p of (data.products || [])) {
          if (!p.productId) continue;
          received[p.productId] = (received[p.productId] || 0) + (p.quantity || 0);
        }
      }
      setRows(stockSnap.docs.map(d => {
        const data = d.data() as any;
        return {
          productId: d.id, productName: data.productName || d.id,
          openingCount: data.currentStock ?? 0,
          receivedQty: received[d.id] || 0,
          expectedCount: Math.max(0, (data.currentStock ?? 0) - (data.velocity ?? 0) * 4),
          actualCount: 0, velocity: data.velocity ?? null, unit: data.unit || 'units',
        };
      }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [venueId, barId]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={C.comingSoon}>
        <Text style={C.csEmoji}>🎪</Text>
        <Text style={C.csTitle}>Festival mode</Text>
        <Text style={C.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={C.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={C.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  function updateCount(productId: string, raw: string) {
    const val = parseFloat(raw);
    setRows(prev => prev.map(r =>
      r.productId === productId ? { ...r, actualCount: isNaN(val) ? 0 : val } : r
    ));
  }

  function adjustCount(productId: string, delta: number) {
    setRows(prev => prev.map(r =>
      r.productId === productId
        ? { ...r, actualCount: Math.max(0, +(r.actualCount + delta).toFixed(1)) }
        : r
    ));
  }

  async function submitCount() {
    if (!venueId || rows.length === 0) return;
    setSaving(true);
    try {
      const uid  = auth.currentUser?.uid ?? 'unknown';
      const name = auth.currentUser?.displayName ?? 'Unknown';
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const counts = rows.map(r => ({
        productId:     r.productId,
        productName:   r.productName,
        openingCount:  r.openingCount,
        receivedQty:   r.receivedQty,
        expectedCount: r.expectedCount,
        actualCount:   r.actualCount,
        variance:      r.actualCount - r.expectedCount,
      }));

      await setDoc(doc(db, 'venues', venueId, 'sessions', sessionId), {
        barId,
        barName: barName || '',
        sessionType,
        countedBy: uid,
        countedByName: name,
        counts,
        completedAt: serverTimestamp(),
      });

      // Update bar stock to reflect actual counts
      for (const r of rows) {
        try {
          await updateDoc(doc(db, 'venues', venueId, 'bars', barId, 'stock', r.productId), {
            currentStock: r.actualCount,
            lastCountAt:  serverTimestamp(),
            lastCountBy:  uid,
            updatedAt:    serverTimestamp(),
          });
        } catch (_) {}
      }

      // Build reconciliation
      const reconcileRows: ReconcileRow[] = rows.map(r => {
        const used         = r.openingCount + r.receivedQty - r.actualCount;
        const expectedUsed = r.openingCount + r.receivedQty - r.expectedCount;
        return { ...r, used: Math.max(0, used), expectedUsed: Math.max(0, expectedUsed), variance: used - expectedUsed };
      });
      setReconcile(reconcileRows);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save count. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Reconciliation screen ─────────────────────────────────────────────────
  if (reconcile) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView contentContainerStyle={C.scroll}>
          <Text style={C.screenTitle}>Session reconciliation</Text>
          <Text style={C.sub}>{barName} · {SESSION_TYPES.find(s => s.id === sessionType)?.label}</Text>

          {reconcile.map(r => {
            const vl = varianceLabel(r.variance, r.expectedUsed);
            return (
              <View key={r.productId} style={C.reconcileCard}>
                <View style={C.reconcileTop}>
                  <Text style={C.reconcileProduct}>{r.productName}</Text>
                  <Text style={[C.reconcileStatus, { color: vl.color }]}>{vl.icon} {vl.text}</Text>
                </View>
                <Text style={C.reconcileDetail}>
                  Opening {r.openingCount} + received {r.receivedQty} − counted {r.actualCount} = <Text style={{ fontWeight: '700' }}>used {r.used}</Text>
                </Text>
                {r.expectedUsed > 0 && (
                  <Text style={C.reconcileDetail}>
                    Expected usage: ~{r.expectedUsed.toFixed(0)}
                    {r.variance !== 0 && (
                      <Text style={{ color: vl.color }}>
                        {r.variance > 0 ? `  +${r.variance.toFixed(0)} over` : `  ${r.variance.toFixed(0)} under`}
                      </Text>
                    )}
                  </Text>
                )}
              </View>
            );
          })}

          <TouchableOpacity style={C.primaryBtn} onPress={() => nav.goBack()}>
            <Text style={C.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Count form ────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={C.scroll} keyboardShouldPersistTaps="handled">

        <Text style={C.screenTitle}>{barName} — Count</Text>

        {/* Session type */}
        <Text style={C.label}>Session</Text>
        <View style={C.chipRow}>
          {SESSION_TYPES.map(st => (
            <TouchableOpacity
              key={st.id}
              style={[C.chip, sessionType === st.id && C.chipOn]}
              onPress={() => setSessionType(st.id)}
            >
              <Text style={[C.chipText, sessionType === st.id && C.chipTextOn]}>{st.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Product rows */}
        {rows.length === 0 ? (
          <View style={C.emptyCard}>
            <Text style={C.emptyText}>No products assigned to this bar yet.</Text>
          </View>
        ) : (
          rows.map(row => (
            <View key={row.productId} style={C.rowCard}>
              <Text style={C.rowProduct}>{row.productName}</Text>
              <View style={C.rowMeta}>
                <Text style={C.rowMetaText}>Opening: {row.openingCount}</Text>
                <Text style={C.rowMetaText}>Received: {row.receivedQty}</Text>
                <Text style={C.rowMetaText}>Expected: ~{row.expectedCount.toFixed(0)}</Text>
              </View>
              <View style={C.stepper}>
                <TouchableOpacity style={C.stepBtn} onPress={() => adjustCount(row.productId, -0.5)}>
                  <Text style={C.stepBtnText}>−</Text>
                </TouchableOpacity>
                <TextInput
                  value={String(row.actualCount)}
                  onChangeText={v => updateCount(row.productId, v)}
                  keyboardType="decimal-pad"
                  style={C.countInput}
                  selectTextOnFocus
                />
                <TouchableOpacity style={C.stepBtn} onPress={() => adjustCount(row.productId, 0.5)}>
                  <Text style={C.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity
          style={[C.primaryBtn, (saving || rows.length === 0) && C.primaryBtnDisabled]}
          disabled={saving || rows.length === 0}
          onPress={submitCount}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={C.primaryBtnText}>Submit count</Text>}
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const C = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:       { padding: 16, paddingBottom: 40 },
  screenTitle:  { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub:          { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  label:        { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },

  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  chipOn:       { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  chipText:     { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextOn:   { color: '#1b4f72', fontWeight: '700' },

  rowCard:      { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  rowProduct:   { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 6 },
  rowMeta:      { flexDirection: 'row', gap: 12, marginBottom: 10 },
  rowMetaText:  { fontSize: 12, color: '#6b7280' },

  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepBtnText:  { fontSize: 20, fontWeight: '700', color: '#374151', lineHeight: 24 },
  countInput: {
    flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#0B132B',
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 10, paddingVertical: 8,
  },

  emptyCard:    { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText:    { fontSize: 15, color: '#6b7280', textAlign: 'center' },

  reconcileCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  reconcileTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  reconcileProduct: { fontSize: 15, fontWeight: '800', color: '#0B132B', flex: 1 },
  reconcileStatus:  { fontSize: 12, fontWeight: '700' },
  reconcileDetail:  { fontSize: 13, color: '#6b7280', lineHeight: 20 },

  primaryBtn:         { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
});
