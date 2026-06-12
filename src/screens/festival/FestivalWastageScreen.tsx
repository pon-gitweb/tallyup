// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  collection, doc, getDocs, writeBatch, increment, onSnapshot, serverTimestamp, query, where,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

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
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const W = makeStyles(c);

  const [products,       setProducts]       = useState<any[]>([]);
  const [selectedProd,   setSelectedProd]   = useState<any>(null);
  const [qty,            setQty]            = useState('');
  const [reason,         setReason]         = useState('breakage');
  const [note,           setNote]           = useState('');
  const [loading,        setLoading]        = useState(FESTIVAL_BETA);
  const [saving,         setSaving]         = useState(false);
  const [todayWastage,   setTodayWastage]   = useState<any[]>([]);

  // Load products for this bar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    getDocs(collection(db, 'venues', venueId, 'departments', barId, 'areas', 'back-of-house', 'items')).then(snap => {
      setProducts(snap.docs.map(d => {
        const data = d.data() as any;
        return { id: d.id, ...data, productName: data.name || d.id, currentStock: data.lastCount ?? 0 };
      }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [venueId, barId]);

  // Live listener for today's wastage for this bar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) return;
    const unsub = onSnapshot(
      query(collection(db, 'venues', venueId, 'wastage'), where('barId', '==', barId)),
      snap => {
        const today = new Date();
        const rows = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(w => {
            if (!w.createdAt?.toDate) return false;
            const d = w.createdAt.toDate();
            return d.getFullYear() === today.getFullYear()
              && d.getMonth() === today.getMonth()
              && d.getDate() === today.getDate();
          });
        setTodayWastage(rows);
      },
    );
    return () => unsub();
  }, [venueId, barId]);

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
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  async function saveWastage() {
    if (!selectedProd) { showInfo('Select a product.'); return; }
    const q = parseFloat(qty);
    if (!q || q <= 0) { showInfo('Enter a valid quantity.'); return; }
    if (!venueId) return;

    setSaving(true);
    try {
      const uid         = auth.currentUser?.uid ?? 'unknown';
      const displayName = auth.currentUser?.displayName ?? null;
      const wastageId   = `w_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const batch = writeBatch(db);

      // Decrement bar stock
      batch.update(
        doc(db, 'venues', venueId, 'departments', barId, 'areas', 'back-of-house', 'items', selectedProd.id),
        { lastCount: increment(-q), updatedAt: serverTimestamp() },
      );

      // Tracked wastage record
      batch.set(
        doc(db, 'venues', venueId, 'wastage', wastageId),
        {
          barId,
          barName:      barName || null,
          itemId:       selectedProd.id,
          productName:  selectedProd.productName || selectedProd.id,
          quantity:     q,
          reason,
          note:         note.trim() || null,
          wastedBy:     uid,
          wastedByName: displayName,
          createdAt:    serverTimestamp(),
        },
      );

      await batch.commit();

      // Optimistic local update so chip shows reduced stock without re-read
      setProducts(prev => prev.map(p =>
        p.id === selectedProd.id
          ? { ...p, currentStock: Math.max(0, (p.currentStock ?? 0) - q) }
          : p
      ));

      setSelectedProd(null);
      setQty('');
      setNote('');
      setReason('breakage');
      showSuccess('✓ Wastage recorded');
    } catch (e: any) {
      showError(e?.message || 'Could not record wastage.');
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
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
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
          placeholderTextColor={c.slateMid}
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
          placeholderTextColor={c.slateMid}
          style={[W.input, { minHeight: 64 }]}
          multiline
        />

        <TouchableOpacity
          style={[W.primaryBtn, saving && W.primaryBtnDisabled]}
          disabled={saving}
          onPress={saveWastage}
        >
          {saving
            ? <ActivityIndicator color={c.surface} size="small" />
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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: any) {
  return StyleSheet.create({
    comingSoon: { flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 36 },
    csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    csTitle:    { fontSize: 26, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 16 },
    csBody:     { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24, marginBottom: 12 },
    csContact:  { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center', lineHeight: 22 },

    scroll:      { padding: 16, paddingBottom: 40 },
    screenTitle: { fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 16 },
    label:       { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 12, marginBottom: 6 },

    chipRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.oat },
    chipOn:   { borderColor: c.deepBlue, backgroundColor: c.primaryLight },
    chipText: { fontSize: 13, color: c.text, fontWeight: '500' },
    chipTextOn: { color: c.deepBlue, fontWeight: '700' },

    input: {
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
      fontSize: 14, color: c.navy,
    },

    radioCard:    { borderWidth: 1.5, borderColor: c.border, borderRadius: 10, padding: 12, marginBottom: 6, backgroundColor: c.surface },
    radioCardOn:  { borderColor: c.deepBlue, backgroundColor: c.primaryLight },
    radioLabel:   { fontSize: 14, fontWeight: '600', color: c.text },
    radioLabelOn: { color: c.deepBlue },

    primaryBtn:         { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText:     { color: c.surface, fontWeight: '700', fontSize: 15 },

    todayCard:  { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginTop: 20, borderWidth: 1, borderColor: c.border },
    todayTitle: { fontSize: 13, fontWeight: '800', color: c.navy, marginBottom: 8 },
    todayRow:   { fontSize: 13, color: c.text, lineHeight: 20 },
  });
}
