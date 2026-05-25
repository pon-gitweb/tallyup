// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  collection, doc, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Constants ────────────────────────────────────────────────────────────────

const REASONS = [
  { id: 'breakage',          label: 'Breakage' },
  { id: 'spillage',          label: 'Spillage' },
  { id: 'tap_waste',         label: 'Tap waste' },
  { id: 'staff_allocation',  label: 'Staff allocation' },
  { id: 'artist_rider',      label: 'Artist / rider' },
  { id: 'other',             label: 'Other' },
];

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalWastageScreen() {
  const nav    = useNavigation<any>();
  const route  = useRoute<any>();
  const { barId, barName } = route.params || {};
  const venueId = useVenueId();

  const [products,       setProducts]       = useState<any[]>([]);
  const [selectedProd,   setSelectedProd]   = useState<any>(null);
  const [qty,            setQty]            = useState('');
  const [reason,         setReason]         = useState('breakage');
  const [note,           setNote]           = useState('');
  const [loading,        setLoading]        = useState(FESTIVAL_BETA);
  const [saving,         setSaving]         = useState(false);
  const [todayWastage,   setTodayWastage]   = useState<any[]>([]);
  const [toast,          setToast]          = useState<string | null>(null);
  const toastTimer = useRef<any>(null);

  // Load products for this bar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    getDocs(collection(db, 'venues', venueId, 'bars', barId, 'stock')).then(snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [venueId, barId]);

  // Live listener for today's wastage for this bar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) return;
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'sessions', 'wastage', barId),
      snap => {
        const today = new Date();
        const rows = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(w => {
            if (!w.recordedAt?.toDate) return false;
            const d = w.recordedAt.toDate();
            return d.getFullYear() === today.getFullYear()
              && d.getMonth() === today.getMonth()
              && d.getDate() === today.getDate();
          });
        setTodayWastage(rows);
      },
    );
    return () => unsub();
  }, [venueId, barId]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={W.comingSoon}>
        <Text style={W.csEmoji}>🎪</Text>
        <Text style={W.csTitle}>Festival mode</Text>
        <Text style={W.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={W.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={W.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  async function saveWastage() {
    if (!selectedProd) { Alert.alert('Required', 'Select a product.'); return; }
    const q = parseFloat(qty);
    if (!q || q <= 0) { Alert.alert('Required', 'Enter a valid quantity.'); return; }
    if (!venueId) return;

    setSaving(true);
    try {
      const uid  = auth.currentUser?.uid ?? 'unknown';
      const wastageId = `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // Write wastage record under sessions/wastage/{barId}/{wastageId}
      await setDoc(doc(db, 'venues', venueId, 'sessions', 'wastage', barId, wastageId), {
        barId,
        productId:   selectedProd.id,
        productName: selectedProd.productName || selectedProd.id,
        quantity:    q,
        reason,
        note: note.trim() || null,
        recordedBy:  uid,
        recordedAt:  serverTimestamp(),
      });

      // Decrement bar stock (best effort)
      try {
        const currentStock = selectedProd.currentStock ?? 0;
        await updateDoc(doc(db, 'venues', venueId, 'bars', barId, 'stock', selectedProd.id), {
          currentStock: Math.max(0, currentStock - q),
          updatedAt: serverTimestamp(),
        });
        // Update local products list for next save
        setProducts(prev => prev.map(p =>
          p.id === selectedProd.id
            ? { ...p, currentStock: Math.max(0, (p.currentStock ?? 0) - q) }
            : p
        ));
      } catch (_) {}

      setSelectedProd(null);
      setQty('');
      setNote('');
      setReason('breakage');
      showToast('✓ Wastage recorded');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not record wastage.');
    } finally {
      setSaving(false);
    }
  }

  // Group today's wastage by reason
  const wastageByReason: Record<string, { productName: string; qty: number }[]> = {};
  for (const w of todayWastage) {
    if (!wastageByReason[w.reason]) wastageByReason[w.reason] = [];
    wastageByReason[w.reason].push({ productName: w.productName, qty: w.quantity });
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={W.scroll} keyboardShouldPersistTaps="handled">

        <Text style={W.screenTitle}>{barName} — Wastage</Text>

        {/* Product selection */}
        <Text style={W.label}>Product</Text>
        <View style={W.chipRow}>
          {products.map(p => (
            <TouchableOpacity
              key={p.id}
              style={[W.chip, selectedProd?.id === p.id && W.chipOn]}
              onPress={() => setSelectedProd(selectedProd?.id === p.id ? null : p)}
            >
              <Text style={[W.chipText, selectedProd?.id === p.id && W.chipTextOn]}>
                {p.productName || p.id}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Quantity */}
        <Text style={W.label}>Quantity</Text>
        <TextInput
          value={qty}
          onChangeText={setQty}
          placeholder="e.g. 2"
          placeholderTextColor="#9ca3af"
          keyboardType="decimal-pad"
          style={W.input}
        />

        {/* Reason */}
        <Text style={W.label}>Reason</Text>
        {REASONS.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[W.radioCard, reason === r.id && W.radioCardOn]}
            onPress={() => setReason(r.id)}
          >
            <Text style={[W.radioLabel, reason === r.id && W.radioLabelOn]}>
              {reason === r.id ? '●' : '○'}  {r.label}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Note */}
        <Text style={W.label}>Note — optional</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Any additional details"
          placeholderTextColor="#9ca3af"
          style={[W.input, { minHeight: 64 }]}
          multiline
        />

        <TouchableOpacity
          style={[W.primaryBtn, saving && W.primaryBtnDisabled]}
          disabled={saving}
          onPress={saveWastage}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={W.primaryBtnText}>Record wastage</Text>}
        </TouchableOpacity>

        {/* Running today total */}
        {todayWastage.length > 0 && (
          <View style={W.todayCard}>
            <Text style={W.todayTitle}>
              {barName} — Wastage today: {todayWastage.length} item{todayWastage.length !== 1 ? 's' : ''}
            </Text>
            {Object.entries(wastageByReason).map(([r, items]) => {
              const reasonLabel = REASONS.find(x => x.id === r)?.label ?? r;
              return items.map((item, i) => (
                <Text key={`${r}_${i}`} style={W.todayRow}>
                  {reasonLabel}: {item.qty} × {item.productName}
                </Text>
              ));
            })}
          </View>
        )}

      </ScrollView>

      {/* Toast */}
      {toast ? (
        <View style={W.toast} pointerEvents="none">
          <Text style={W.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const W = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 16 },
  label:       { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 6 },

  chipRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  chipOn:   { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextOn: { color: '#1b4f72', fontWeight: '700' },

  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: '#0f172a',
  },

  radioCard:    { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 6, backgroundColor: '#fff' },
  radioCardOn:  { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  radioLabel:   { fontSize: 14, fontWeight: '600', color: '#374151' },
  radioLabelOn: { color: '#1b4f72' },

  primaryBtn:         { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },

  todayCard:  { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 20, borderWidth: 1, borderColor: '#e5e1d8' },
  todayTitle: { fontSize: 13, fontWeight: '800', color: '#0B132B', marginBottom: 8 },
  todayRow:   { fontSize: 13, color: '#374151', lineHeight: 20 },

  toast:     { position: 'absolute', bottom: 32, left: 24, right: 24, backgroundColor: 'rgba(27,79,114,0.95)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  toastText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
