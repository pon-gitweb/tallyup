// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  collection, getDocs, doc, setDoc, onSnapshot, serverTimestamp, query, where,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type BarEntry = { barId: string; barName: string };
type CountRow = { productId: string; productName: string; unit: string; finalCount: number };

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalEndOfEventCountScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);

  const [bars,        setBars]        = useState<BarEntry[]>([]);
  const [barCounts,   setBarCounts]   = useState<Record<string, any>>({});
  const [loading,     setLoading]     = useState(FESTIVAL_BETA);
  const [selectedBar, setSelectedBar] = useState<BarEntry | null>(null);
  const [stockRows,   setStockRows]   = useState<CountRow[]>([]);
  const [loadingStock,setLoadingStock]= useState(false);
  const [saving,      setSaving]      = useState(false);

  // Load bars
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    getDocs(query(
      collection(db, 'venues', venueId, 'departments'),
      where('isFestivalBar', '==', true),
    )).then(snap => {
      setBars(snap.docs.map(d => ({ barId: d.id, barName: (d.data() as any).name || d.id })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [venueId]);

  // Live barCounts listener
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'returns', 'eventClose', 'barCounts'),
      snap => {
        const map: Record<string, any> = {};
        snap.docs.forEach(d => { map[d.id] = d.data(); });
        setBarCounts(map);
      },
    );
    return () => unsub();
  }, [venueId]);

  // Load stock when bar selected
  useEffect(() => {
    if (!selectedBar || !venueId) return;
    setLoadingStock(true);
    getDocs(collection(db, 'venues', venueId, 'departments', selectedBar.barId, 'areas', 'back-of-house', 'items')).then(snap => {
      setStockRows(snap.docs.map(d => {
        const data = d.data() as any;
        return {
          productId:   d.id,
          productName: data.name || data.productName || d.id,
          unit:        data.unit || 'units',
          finalCount:  0,
        };
      }));
      setLoadingStock(false);
    }).catch(() => setLoadingStock(false));
  }, [selectedBar, venueId]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>Coming soon — we'll let you know when it's live.</Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) return <View style={S.center}><ActivityIndicator color={c.deepBlue} size="large" /></View>;

  // ── Per-bar count form ────────────────────────────────────────────────────
  if (selectedBar) {
    if (loadingStock) return <View style={S.center}><ActivityIndicator color={c.deepBlue} size="large" /></View>;

    function updateCount(productId: string, raw: string) {
      const val = parseFloat(raw);
      setStockRows(prev => prev.map(r =>
        r.productId === productId ? { ...r, finalCount: isNaN(val) ? 0 : val } : r
      ));
    }

    function adjustCount(productId: string, delta: number) {
      setStockRows(prev => prev.map(r =>
        r.productId === productId
          ? { ...r, finalCount: Math.max(0, +(r.finalCount + delta).toFixed(1)) }
          : r
      ));
    }

    async function doSubmitBarCount() {
      if (!venueId || saving) return;
      setSaving(true);
      try {
        const name = auth.currentUser?.displayName ?? 'Unknown';
        await setDoc(doc(db, 'venues', venueId, 'returns', 'eventClose', 'barCounts', selectedBar!.barId), {
          barId:         selectedBar!.barId,
          barName:       selectedBar!.barName,
          countedBy:     uid ?? 'unknown',
          countedByName: name,
          counts:        stockRows.map(r => ({
            productId:   r.productId,
            productName: r.productName,
            finalCount:  r.finalCount,
            unit:        r.unit,
          })),
          completedAt: serverTimestamp(),
        });
        showSuccess('✓ Final count saved');
        setSelectedBar(null);
      } catch (e: any) {
        showError(e?.message || 'Could not save count.');
      } finally {
        setSaving(false);
      }
    }

    function submitBarCount() {
      confirm({
        title: 'Save final count?',
        message: `This records the end-of-event stock count for ${selectedBar!.barName}.`,
        confirmLabel: 'Save count',
        onConfirm: doSubmitBarCount,
      });
    }

    return (
      <View style={{ flex: 1, backgroundColor: c.oat }}>
        {modal}
        <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">
          <Text style={S.screenTitle}>{selectedBar.barName}</Text>
          <Text style={S.sub}>Final count — end of event</Text>

          {stockRows.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No products assigned to this bar.</Text>
              <TouchableOpacity style={S.secondaryBtn} onPress={() => setSelectedBar(null)}>
                <Text style={S.secondaryBtnText}>← Back to bar list</Text>
              </TouchableOpacity>
            </View>
          ) : (
            stockRows.map(row => (
              <View key={row.productId} style={S.rowCard}>
                <Text style={S.rowProduct}>{row.productName}</Text>
                <View style={S.stepper}>
                  <TouchableOpacity style={S.stepBtn} onPress={() => adjustCount(row.productId, -1)}>
                    <Text style={S.stepBtnText}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={String(row.finalCount)}
                    onChangeText={v => updateCount(row.productId, v)}
                    keyboardType="decimal-pad"
                    style={S.countInput}
                    selectTextOnFocus
                  />
                  <TouchableOpacity style={S.stepBtn} onPress={() => adjustCount(row.productId, 1)}>
                    <Text style={S.stepBtnText}>+</Text>
                  </TouchableOpacity>
                  <Text style={S.unitLabel}>{row.unit}</Text>
                </View>
              </View>
            ))
          )}

          {stockRows.length > 0 && (
            <TouchableOpacity
              style={[S.primaryBtn, saving && S.btnDisabled]}
              disabled={saving}
              onPress={submitBarCount}
            >
              {saving
                ? <ActivityIndicator color={c.surface} size="small" />
                : <Text style={S.primaryBtnText}>Save final count</Text>}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[S.secondaryBtn, { marginTop: 10 }]}
            onPress={() => setSelectedBar(null)}
          >
            <Text style={S.secondaryBtnText}>← Back to bar list</Text>
          </TouchableOpacity>

        </ScrollView>
      </View>
    );
  }

  // ── Bar list view ──────────────────────────────────────────────────────────
  const allCounted = bars.length > 0 && bars.every(b => !!barCounts[b.barId]);

  function formatTime(ts: any): string {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.screenTitle}>End of event count</Text>
        <Text style={S.sub}>Count all bars before proceeding to reconciliation.</Text>

        {bars.length === 0 ? (
          <View style={S.emptyCard}>
            <Text style={S.emptyText}>No bars configured. Set up bars in Event Setup.</Text>
          </View>
        ) : (
          bars.map(bar => {
            const counted = barCounts[bar.barId];
            return (
              <View key={bar.barId} style={S.barCard}>
                <View style={S.barRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.barName}>{bar.barName}</Text>
                    {counted
                      ? <Text style={S.countedAt}>✓ Counted {formatTime(counted.completedAt)} by {counted.countedByName}</Text>
                      : <Text style={S.notCounted}>⏳ Not yet counted</Text>}
                  </View>
                  {!counted && (
                    <TouchableOpacity
                      style={S.countNowBtn}
                      onPress={() => setSelectedBar(bar)}
                    >
                      <Text style={S.countNowBtnText}>Count now →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}

        {allCounted && (
          <TouchableOpacity
            style={[S.primaryBtn, { marginTop: 24 }]}
            onPress={() => nav.navigate('FestivalReturns')}
          >
            <Text style={S.primaryBtnText}>Proceed to returns →</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[S.secondaryBtn, { marginTop: 12 }]}
          onPress={() => nav.navigate('FestivalReconciliation')}
        >
          <Text style={S.secondaryBtnText}>Skip to reconciliation</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: any) {
  return StyleSheet.create({
    center:     { flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 36 },
    csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    csTitle:    { fontSize: 26, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 16 },
    csBody:     { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24 },
    csContact:  { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center' },

    scroll:     { padding: 16, paddingBottom: 40 },
    screenTitle:{ fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 4 },
    sub:        { fontSize: 14, color: c.slateMid, marginBottom: 20 },

    barCard:    { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    barRow:     { flexDirection: 'row', alignItems: 'center' },
    barName:    { fontSize: 15, fontWeight: '700', color: c.navy, marginBottom: 3 },
    countedAt:  { fontSize: 12, color: c.success, fontWeight: '600' },
    notCounted: { fontSize: 12, color: c.slateMid },
    countNowBtn:{ backgroundColor: c.deepBlue, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    countNowBtnText:{ color: c.surface, fontWeight: '700', fontSize: 13 },

    rowCard:    { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    rowProduct: { fontSize: 15, fontWeight: '700', color: c.navy, marginBottom: 10 },
    stepper:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: c.border, alignItems: 'center', justifyContent: 'center' },
    stepBtnText:{ fontSize: 20, fontWeight: '700', color: c.text, lineHeight: 24 },
    countInput: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '800', color: c.navy, backgroundColor: c.oat, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingVertical: 8 },
    unitLabel:  { fontSize: 13, color: c.slateMid, width: 40 },

    emptyCard:  { backgroundColor: c.surface, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    emptyText:  { fontSize: 14, color: c.slateMid, textAlign: 'center', marginBottom: 12 },

    primaryBtn:     { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
    primaryBtnText: { color: c.surface, fontWeight: '700', fontSize: 15 },
    secondaryBtn:   { borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
    secondaryBtnText:{ color: c.deepBlue, fontWeight: '700', fontSize: 14 },
    btnDisabled:    { opacity: 0.5 },
  });
}
