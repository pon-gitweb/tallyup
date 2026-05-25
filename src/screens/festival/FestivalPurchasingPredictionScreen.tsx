// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { generatePurchasingPrediction, type PredictionResult } from '../../services/festival/purchasingPrediction';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confidenceColor(c: string) {
  if (c === 'HIGH')   return '#16a34a';
  if (c === 'MEDIUM') return '#d97706';
  return '#dc2626';
}

function formatCurrency(v: number | null): string {
  if (v == null) return '—';
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
}

// ─── Per-product row ──────────────────────────────────────────────────────────

function ProductRow({
  result,
  onQtyChange,
}: {
  result: PredictionResult;
  onQtyChange: (id: string, qty: number) => void;
}) {
  const [qtyText, setQtyText] = useState(String(result.bufferedQty));
  const [notesOpen, setNotesOpen] = useState(false);

  function commit() {
    const val = parseInt(qtyText, 10);
    if (!isNaN(val) && val > 0) onQtyChange(result.productId, val);
    else setQtyText(String(result.bufferedQty));
  }

  return (
    <View style={R.prodRow}>
      <View style={R.prodTop}>
        <Text style={R.prodName} numberOfLines={1}>{result.productName}</Text>
        <View style={[R.confBadge, { borderColor: confidenceColor(result.confidence) }]}>
          <Text style={[R.confText, { color: confidenceColor(result.confidence) }]}>
            {result.confidence}
          </Text>
        </View>
      </View>
      <Text style={R.basisText}>{result.basis === 'prior_year' ? 'Prior year data' : 'Category benchmark'}</Text>
      <View style={R.prodBottom}>
        <View style={R.qtyRow}>
          <TextInput
            value={qtyText}
            onChangeText={setQtyText}
            onBlur={commit}
            keyboardType="number-pad"
            style={R.qtyInput}
            selectTextOnFocus
          />
          <Text style={R.qtyUnit}>{' '}units</Text>
        </View>
        {result.estimatedCost != null && (
          <Text style={R.costText}>{formatCurrency(result.estimatedCost)}</Text>
        )}
      </View>
      {result.minimumCommitment != null && result.bufferedQty < result.minimumCommitment + 1 && (
        <Text style={R.commitText}>Min commitment: {result.minimumCommitment}</Text>
      )}
      <TouchableOpacity onPress={() => setNotesOpen(v => !v)} style={R.notesToggle}>
        <Text style={R.notesToggleText}>{notesOpen ? '▲ Hide notes' : '▼ How we calculated this'}</Text>
      </TouchableOpacity>
      {notesOpen && result.notes.map((n, i) => (
        <Text key={i} style={R.noteText}>• {n}</Text>
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalPurchasingPredictionScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const venueId = useVenueId();

  const [results,      setResults]      = useState<PredictionResult[]>([]);
  const [edited,       setEdited]       = useState<Record<string, number>>({});
  const [loading,      setLoading]      = useState(FESTIVAL_BETA);
  const [generating,   setGenerating]   = useState(false);
  const [eventData,    setEventData]    = useState<any>(null);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    loadAndPredict();
  }, [venueId]);

  async function loadAndPredict() {
    try {
      const venueSnap = await getDoc(doc(db, 'venues', venueId));
      const event = venueSnap.exists() ? (venueSnap.data() as any) : {};
      setEventData(event);

      // Load products from planned sources (all bars' stock)
      const barsSnap = await getDocs(collection(db, 'venues', venueId, 'bars'));
      const productMap: Record<string, any> = {};

      await Promise.all(barsSnap.docs.map(async barDoc => {
        const stockSnap = await getDocs(collection(db, 'venues', venueId, 'bars', barDoc.id, 'stock'));
        for (const s of stockSnap.docs) {
          const data = s.data() as any;
          if (!productMap[s.id]) {
            productMap[s.id] = {
              id:           s.id,
              name:         data.productName || s.id,
              supplierId:   data.supplierId   || 'unknown',
              supplierName: data.supplierName || 'Unknown Supplier',
              unitCost:     data.unitCost     ?? null,
              minimumCommitment: data.minimumCommitment ?? null,
            };
          }
        }
      }));

      const products = Object.values(productMap);

      // Parse attendance and event days
      const attendance = parseInt(event.dailyAttendance ?? event.attendance ?? '500', 10) || 500;
      const eventDays  = calculateEventDays(event.startDate, event.endDate);

      const predictions = generatePurchasingPrediction(
        { attendance, eventDays, eventType: event.eventType, pricePositioning: event.pricePositioning },
        products,
      );
      setResults(predictions);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function calculateEventDays(startStr?: string, endStr?: string): number {
    if (!startStr || !endStr) return 1;
    const parseDMY = (s: string) => {
      const [d, m, y] = s.split('/').map(Number);
      return new Date(y, m - 1, d);
    };
    const diff = parseDMY(endStr).getTime() - parseDMY(startStr).getTime();
    return Math.max(1, Math.round(diff / 86400000) + 1);
  }

  function handleQtyChange(productId: string, qty: number) {
    setEdited(prev => ({ ...prev, [productId]: qty }));
    setResults(prev => prev.map(r =>
      r.productId === productId ? { ...r, bufferedQty: qty, estimatedCost: r.unitCost != null ? r.unitCost * qty : null } : r
    ));
  }

  async function generateOrders() {
    if (!venueId || results.length === 0) return;
    setGenerating(true);
    try {
      // Group by supplier
      const bySupplier: Record<string, PredictionResult[]> = {};
      for (const r of results) {
        if (!bySupplier[r.supplierId]) bySupplier[r.supplierId] = [];
        bySupplier[r.supplierId].push(r);
      }

      const uid  = auth.currentUser?.uid ?? 'unknown';
      const name = auth.currentUser?.displayName ?? 'Unknown';

      for (const [supplierId, items] of Object.entries(bySupplier)) {
        const orderId = `pred_${supplierId}_${Date.now()}`;
        await setDoc(doc(db, 'venues', venueId, 'orders', orderId), {
          supplierId,
          supplierName: items[0]?.supplierName ?? supplierId,
          status:       'draft',
          source:       'festival_prediction',
          createdBy:    uid,
          createdByName: name,
          createdAt:    serverTimestamp(),
          products:     items.map(i => ({
            productId:   i.productId,
            productName: i.productName,
            quantity:    i.bufferedQty,
            unitCost:    i.unitCost,
          })),
        });
      }

      Alert.alert('Orders created', `${Object.keys(bySupplier).length} draft order${Object.keys(bySupplier).length !== 1 ? 's' : ''} created. Review them in Orders before sending.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not generate orders.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={R.comingSoon}>
        <Text style={R.csEmoji}>🎪</Text>
        <Text style={R.csTitle}>Festival mode</Text>
        <Text style={R.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={R.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={R.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  // Summary stats
  const totalCost = results.reduce((s, r) => s + (r.estimatedCost ?? 0), 0);
  const supplierCount = new Set(results.map(r => r.supplierId)).size;
  const highConf = results.filter(r => r.confidence === 'HIGH').length;
  const confBasis = highConf > results.length / 2 ? 'Mostly prior year data' : 'Mostly benchmarks';

  // Group by supplier
  const bySupplier: Record<string, PredictionResult[]> = {};
  for (const r of results) {
    if (!bySupplier[r.supplierName]) bySupplier[r.supplierName] = [];
    bySupplier[r.supplierName].push(r);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={R.scroll} keyboardShouldPersistTaps="handled">

        <Text style={R.screenTitle}>Purchasing Prediction</Text>

        {/* Summary card */}
        <View style={R.summaryCard}>
          <View style={R.summaryRow}>
            <View style={R.summaryItem}>
              <Text style={R.summaryValue}>{results.length}</Text>
              <Text style={R.summaryLabel}>Products</Text>
            </View>
            <View style={R.summaryItem}>
              <Text style={R.summaryValue}>{supplierCount}</Text>
              <Text style={R.summaryLabel}>Suppliers</Text>
            </View>
            <View style={R.summaryItem}>
              <Text style={R.summaryValue}>{formatCurrency(totalCost)}</Text>
              <Text style={R.summaryLabel}>Est. cost</Text>
            </View>
          </View>
          <Text style={R.confBasis}>{confBasis} · 15% buffer included</Text>
        </View>

        {/* By supplier */}
        {Object.entries(bySupplier).map(([supplierName, items]) => {
          const supplierTotal = items.reduce((s, r) => s + (r.estimatedCost ?? 0), 0);
          return (
            <View key={supplierName}>
              <View style={R.supplierHeader}>
                <Text style={R.supplierName}>{supplierName}</Text>
                {supplierTotal > 0 && (
                  <Text style={R.supplierTotal}>{formatCurrency(supplierTotal)}</Text>
                )}
              </View>
              {items.map(r => (
                <ProductRow key={r.productId} result={r} onQtyChange={handleQtyChange} />
              ))}
            </View>
          );
        })}

        {results.length === 0 && (
          <View style={R.emptyCard}>
            <Text style={R.emptyText}>No products found. Add products to your bars first.</Text>
          </View>
        )}

        {results.length > 0 && (
          <TouchableOpacity
            style={[R.generateBtn, generating && R.generateBtnDisabled]}
            disabled={generating}
            onPress={generateOrders}
          >
            {generating
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={R.generateBtnText}>Generate draft orders</Text>}
          </TouchableOpacity>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const R = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 16 },

  summaryCard: { backgroundColor: '#1b4f72', borderRadius: 14, padding: 16, marginBottom: 20 },
  summaryRow:  { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  summaryItem: { alignItems: 'center' },
  summaryValue:{ fontSize: 22, fontWeight: '800', color: '#fff' },
  summaryLabel:{ fontSize: 11, color: '#93c5fd', marginTop: 2 },
  confBasis:   { fontSize: 12, color: '#93c5fd', textAlign: 'center' },

  supplierHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, marginTop: 8 },
  supplierName:   { fontSize: 13, fontWeight: '800', color: '#374151' },
  supplierTotal:  { fontSize: 13, fontWeight: '700', color: '#1b4f72' },

  prodRow:   { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e5e1d8' },
  prodTop:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  prodName:  { fontSize: 14, fontWeight: '700', color: '#0B132B', flex: 1, marginRight: 8 },
  confBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  confText:  { fontSize: 10, fontWeight: '800' },
  basisText: { fontSize: 11, color: '#9ca3af', marginBottom: 8 },

  prodBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qtyRow:    { flexDirection: 'row', alignItems: 'center' },
  qtyInput:  { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 16, fontWeight: '700', color: '#0B132B', width: 80, textAlign: 'center', backgroundColor: '#f9fafb' },
  qtyUnit:   { fontSize: 13, color: '#6b7280' },
  costText:  { fontSize: 15, fontWeight: '700', color: '#1b4f72' },
  commitText:{ fontSize: 11, color: '#d97706', marginTop: 4 },

  notesToggle:    { marginTop: 8 },
  notesToggleText:{ fontSize: 11, color: '#1b4f72', fontWeight: '600' },
  noteText:       { fontSize: 12, color: '#6b7280', lineHeight: 18, marginTop: 3 },

  generateBtn:         { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText:     { color: '#fff', fontWeight: '700', fontSize: 16 },

  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText: { fontSize: 15, color: '#9ca3af', textAlign: 'center' },
});
