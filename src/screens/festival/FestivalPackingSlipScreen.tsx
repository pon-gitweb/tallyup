// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Sharing from 'expo-sharing';
import { collection, getDocs, doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { generatePackingSlipPDF } from '../../services/festival/packingSlip';
import { reconcileChepPallets } from '../../services/festival/chepReconciliation';

// ─── Types ────────────────────────────────────────────────────────────────────

type PalletProduct = {
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  casesCount: number;
  condition: string;
};

type Pallet = { products: PalletProduct[]; uri: string | null };

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalPackingSlipScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;
  const { supplierName } = route.params || {};

  const [event,       setEvent]       = useState<any>(null);
  const [products,    setProducts]    = useState<PalletProduct[]>([]);
  const [pallets,     setPallets]     = useState<Pallet[]>([]);
  const [loading,     setLoading]     = useState(FESTIVAL_BETA);
  const [generating,  setGenerating]  = useState(false);
  // CHEP tracking
  const [chepReceived,   setChepReceived]   = useState('');
  const [chepReturning,  setChepReturning]  = useState('');

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), async snap => {
      const ev = snap.exists() ? snap.data() : null;
      setEvent(ev);
      await loadSupplierProducts();
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [venueId, supplierName]);

  async function loadSupplierProducts() {
    if (!venueId || !supplierName) return;
    try {
      const barCountsSnap = await getDocs(
        collection(db, 'venues', venueId, 'returns', 'eventClose', 'barCounts')
      );
      const totalRemaining: Record<string, { productName: string; count: number; unit: string }> = {};
      for (const bc of barCountsSnap.docs) {
        for (const c of ((bc.data() as any).counts || [])) {
          if (!totalRemaining[c.productId]) {
            totalRemaining[c.productId] = { productName: c.productName, count: 0, unit: c.unit || 'units' };
          }
          totalRemaining[c.productId].count += c.finalCount || 0;
        }
      }

      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const productMap: Record<string, any> = {};
      productsSnap.docs.forEach(d => { productMap[d.id] = d.data(); });

      const supplierProducts: PalletProduct[] = [];
      for (const [productId, rem] of Object.entries(totalRemaining)) {
        if (rem.count <= 0) continue;
        const prod = productMap[productId];
        const sn = prod?.supplierName || prod?.primarySupplierName || 'Other / Unknown';
        if (sn !== supplierName) continue;
        supplierProducts.push({
          productId,
          productName: rem.productName,
          quantity: rem.count,
          unit: rem.unit,
          casesCount: Math.ceil(rem.count / (prod?.casesPerUnit || 12)),
          condition: 'Sealed',
        });
      }

      setProducts(supplierProducts);
      // Default: all products on one pallet
      setPallets([{ products: supplierProducts, uri: null }]);
    } catch (e: any) {
      console.log('[PackingSlip] load error', e?.message);
    }
  }

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

  if (loading) return <View style={S.center}><ActivityIndicator color="#1b4f72" size="large" /></View>;

  const supplierCode = (supplierName || 'SUP').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
  const eventCode    = (event?.eventName || 'EVT').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
  const today        = new Date().toLocaleDateString('en-NZ');

  const chepRec = chepReceived && chepReturning
    ? reconcileChepPallets(
        supplierName,
        supplierName,
        parseInt(chepReceived, 10) || 0,
        parseInt(chepReturning, 10) || 0,
        parseInt(chepReturning, 10) || 0,
        0,
      )
    : null;

  async function generatePallet(palletIdx: number) {
    if (generating) return;
    setGenerating(true);
    try {
      const pallet = pallets[palletIdx];
      const slipNumber = `${eventCode}-${supplierCode}-001-P${palletIdx + 1}`;
      const uri = await generatePackingSlipPDF({
        slipNumber,
        eventName:    event?.eventName || 'Festival',
        supplierName: supplierName || '',
        palletNumber: palletIdx + 1,
        totalPallets: pallets.length,
        date:         today,
        products:     pallet.products,
        festivalContact: {
          name:  event?.contactName  || 'Festival Admin',
          phone: event?.contactPhone || '',
        },
        chepPallets:        chepReceived ? parseInt(chepReceived, 10) : null,
        driverSignatureLine: true,
        notes:               null,
      });

      setPallets(prev => prev.map((p, i) => i === palletIdx ? { ...p, uri } : p));

      if (chepRec) {
        await setDoc(
          doc(db, 'venues', venueId, 'returns', `chep_${supplierCode.toLowerCase()}`),
          {
            ...chepRec,
            updatedAt:   serverTimestamp(),
            resolvedAt:  null,
            resolution:  null,
          },
          { merge: true },
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not generate PDF.');
    } finally {
      setGenerating(false);
    }
  }

  async function sharePallet(uri: string) {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) { Alert.alert('Sharing not available'); return; }
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share packing slip' });
  }

  async function generateAll() {
    if (generating) return;
    for (let i = 0; i < pallets.length; i++) {
      await generatePallet(i);
    }
  }

  function addPallet() {
    setPallets(prev => [...prev, { products: [], uri: null }]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.screenTitle}>{supplierName || 'Packing Slips'}</Text>
        <Text style={S.sub}>{pallets.length} pallet{pallets.length !== 1 ? 's' : ''} · {products.length} product{products.length !== 1 ? 's' : ''}</Text>

        {/* Pallets */}
        {pallets.map((pallet, i) => (
          <View key={i} style={S.palletCard}>
            <Text style={S.palletTitle}>Pallet {i + 1}</Text>
            {pallet.products.length === 0 ? (
              <Text style={S.emptyText}>No products assigned to this pallet.</Text>
            ) : (
              pallet.products.map(p => (
                <Text key={p.productId} style={S.palletProduct}>
                  {p.productName} × {p.quantity} {p.unit} ({p.casesCount} cases)
                </Text>
              ))
            )}
            <View style={S.palletBtnRow}>
              <TouchableOpacity
                style={[S.generateBtn, generating && S.btnDisabled]}
                disabled={generating}
                onPress={() => generatePallet(i)}
              >
                {generating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={S.generateBtnText}>Generate PDF</Text>}
              </TouchableOpacity>
              {pallet.uri && (
                <>
                  <TouchableOpacity style={S.shareBtn} onPress={() => sharePallet(pallet.uri!)}>
                    <Text style={S.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            {pallet.uri && <Text style={S.generatedNote}>✓ PDF ready</Text>}
          </View>
        ))}

        <TouchableOpacity style={S.addPalletBtn} onPress={addPallet}>
          <Text style={S.addPalletBtnText}>+ Add pallet</Text>
        </TouchableOpacity>

        {/* CHEP reconciliation */}
        <Text style={S.sectionHeading}>CHEP PALLETS</Text>
        <View style={S.chepCard}>
          <View style={S.chepRow}>
            <Text style={S.chepLabel}>Received from supplier</Text>
            <TextInput
              value={chepReceived}
              onChangeText={setChepReceived}
              keyboardType="number-pad"
              style={S.chepInput}
              placeholder="0"
              placeholderTextColor="#9ca3af"
            />
          </View>
          <View style={S.chepRow}>
            <Text style={S.chepLabel}>Returning</Text>
            <TextInput
              value={chepReturning}
              onChangeText={setChepReturning}
              keyboardType="number-pad"
              style={S.chepInput}
              placeholder="0"
              placeholderTextColor="#9ca3af"
            />
          </View>
          {chepRec && (
            <View style={[S.chepStatus, chepRec.status !== 'balanced' && S.chepStatusWarning]}>
              <Text style={[S.chepStatusText, chepRec.status !== 'balanced' && S.chepStatusTextWarning]}>
                {chepRec.status === 'balanced'
                  ? '✓ All pallets accounted for'
                  : `⚠️ ${chepRec.missing} pallet${chepRec.missing !== 1 ? 's' : ''} missing — check all bar locations before driver arrives`}
              </Text>
            </View>
          )}
        </View>

        {/* Print all */}
        <TouchableOpacity
          style={[S.primaryBtn, generating && S.btnDisabled]}
          disabled={generating}
          onPress={generateAll}
        >
          {generating
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={S.primaryBtnText}>📄 Generate all packing slips</Text>}
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  center:     { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 22, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 12 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  scroll:         { padding: 16, paddingBottom: 40 },
  screenTitle:    { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub:            { fontSize: 14, color: '#6b7280', marginBottom: 20 },
  sectionHeading: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginTop: 24, marginBottom: 10 },

  palletCard:     { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e5e1d8' },
  palletTitle:    { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 8 },
  palletProduct:  { fontSize: 13, color: '#374151', marginBottom: 3 },
  emptyText:      { fontSize: 13, color: '#9ca3af', fontStyle: 'italic', marginBottom: 8 },
  palletBtnRow:   { flexDirection: 'row', gap: 8, marginTop: 12 },
  generateBtn:    { flex: 1, backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  generateBtnText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
  shareBtn:       { backgroundColor: '#f3f4f6', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  shareBtnText:   { color: '#374151', fontWeight: '700', fontSize: 13 },
  generatedNote:  { fontSize: 12, color: '#16a34a', fontWeight: '700', marginTop: 6 },

  addPalletBtn:    { borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 8, borderStyle: 'dashed' },
  addPalletBtnText:{ color: '#6b7280', fontSize: 13, fontWeight: '600' },

  chepCard:    { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 12 },
  chepRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  chepLabel:   { flex: 1, fontSize: 14, color: '#374151', fontWeight: '600' },
  chepInput:   { width: 72, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#0B132B', backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 8 },
  chepStatus:        { backgroundColor: '#dcfce7', borderRadius: 8, padding: 10, marginTop: 4 },
  chepStatusWarning: { backgroundColor: '#fef9c3' },
  chepStatusText:        { fontSize: 13, fontWeight: '700', color: '#16a34a' },
  chepStatusTextWarning: { color: '#92400e' },

  primaryBtn:     { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled:    { opacity: 0.5 },
});
