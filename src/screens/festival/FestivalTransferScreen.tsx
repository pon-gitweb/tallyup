// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert, Modal,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDocs, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Types ────────────────────────────────────────────────────────────────────

type VelocityResult = 'safe' | 'caution' | 'risk';

type CheckResult = {
  level: VelocityResult;
  hoursAfter: number;
  currentStock: number;
  remainingAfter: number;
};

// ─── Velocity check (pure math) ──────────────────────────────────────────────

function velocityCheck(currentStock: number, velocity: number | null, qty: number): CheckResult {
  const remaining = currentStock - qty;
  if (!velocity || velocity <= 0) {
    return { level: 'safe', hoursAfter: 999, currentStock, remainingAfter: remaining };
  }
  const hoursAfter = remaining / velocity;
  let level: VelocityResult = 'safe';
  if (hoursAfter < 2)      level = 'risk';
  else if (hoursAfter < 4) level = 'caution';
  return { level, hoursAfter, currentStock, remainingAfter: remaining };
}

// ─── Picker modal ─────────────────────────────────────────────────────────────

function PickerModal({ visible, title, items, onSelect, onClose }: any) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableOpacity style={PM.overlay} activeOpacity={1} onPress={onClose} />
      <View style={PM.sheet}>
        <Text style={PM.title}>{title}</Text>
        <ScrollView>
          {items.map((item: any) => (
            <TouchableOpacity key={item.id} style={PM.row} onPress={() => onSelect(item)}>
              <Text style={PM.rowText}>{item.label}</Text>
              {item.sub ? <Text style={PM.rowSub}>{item.sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const PM = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet:   { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '60%' },
  title:   { fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 12 },
  row:     { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  rowText: { fontSize: 15, fontWeight: '600', color: '#0B132B' },
  rowSub:  { fontSize: 12, color: '#9ca3af', marginTop: 2 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalTransferScreen() {
  const nav    = useNavigation<any>();
  const route  = useRoute<any>();
  const { fromBarId: initFromId, fromBarName: initFromName } = route.params || {};
  const venueId = useVenueId();

  const [bars,        setBars]        = useState<any[]>([]);
  const [fromBar,     setFromBar]     = useState<any>(initFromId ? { id: initFromId, label: initFromName || '' } : null);
  const [toBar,       setToBar]       = useState<any>(null);
  const [fromStock,   setFromStock]   = useState<any[]>([]);
  const [product,     setProduct]     = useState<any>(null);
  const [qty,         setQty]         = useState('');
  const [loading,     setLoading]     = useState(FESTIVAL_BETA);
  const [saving,      setSaving]      = useState(false);
  const [check,       setCheck]       = useState<CheckResult | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker,   setShowToPicker]   = useState(false);
  const [showProdPicker, setShowProdPicker] = useState(false);

  // Load bars
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    getDocs(collection(db, 'venues', venueId, 'bars')).then(snap => {
      setBars(snap.docs.map(d => {
        const data = d.data() as any;
        return { id: d.id, label: data.name || d.id, sub: data.location || '' };
      }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [venueId]);

  // Load from-bar stock when fromBar changes
  useEffect(() => {
    if (!venueId || !fromBar) { setFromStock([]); return; }
    getDocs(collection(db, 'venues', venueId, 'bars', fromBar.id, 'stock')).then(snap => {
      setFromStock(snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          label: data.productName || d.id,
          sub: `${data.currentStock ?? 0} units · ${data.velocity ? `${data.velocity.toFixed(1)}/hr` : 'no velocity'}`,
          currentStock: data.currentStock ?? 0,
          velocity: data.velocity ?? null,
        };
      }));
    }).catch(() => {});
  }, [venueId, fromBar?.id]);

  // Recompute velocity check when qty or product changes
  useEffect(() => {
    const q = parseFloat(qty);
    if (!product || !q || q <= 0) { setCheck(null); return; }
    setCheck(velocityCheck(product.currentStock, product.velocity, q));
  }, [qty, product]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={T.comingSoon}>
        <Text style={T.csEmoji}>🎪</Text>
        <Text style={T.csTitle}>Festival mode</Text>
        <Text style={T.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={T.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={T.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  // ── Transfer logic ────────────────────────────────────────────────────────
  async function doTransfer(overrideReason: string | null = null) {
    if (!venueId || !fromBar || !toBar || !product) return;
    const q = parseFloat(qty);
    if (!q || q <= 0) return;
    setSaving(true);
    try {
      const uid  = auth.currentUser?.uid ?? 'unknown';
      const name = auth.currentUser?.displayName ?? 'Unknown';
      const transferId = `xfr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const result = check ?? velocityCheck(product.currentStock, product.velocity, q);

      await setDoc(doc(db, 'venues', venueId, 'transfers', transferId), {
        fromBarId:   fromBar.id,
        fromBarName: fromBar.label,
        toBarId:     toBar.id,
        toBarName:   toBar.label,
        productId:   product.id,
        productName: product.label,
        quantity:    q,
        velocityCheckResult: result.level,
        hoursRemainingAfter: result.hoursAfter,
        overrideReason,
        approvedBy:   uid,
        approvedByName: name,
        status: 'completed',
        createdAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      });

      // Decrement from-bar stock (best effort)
      try {
        await updateDoc(doc(db, 'venues', venueId, 'bars', fromBar.id, 'stock', product.id), {
          currentStock: Math.max(0, product.currentStock - q),
          updatedAt: serverTimestamp(),
        });
      } catch (_) {}

      Alert.alert('Transfer complete', `${q} × ${product.label} moved from ${fromBar.label} to ${toBar.label}.`, [
        { text: 'Done', onPress: () => nav.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Transfer failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleTransfer() {
    const q = parseFloat(qty);
    if (!fromBar) { Alert.alert('Required', 'Select a from bar.'); return; }
    if (!toBar)   { Alert.alert('Required', 'Select a to bar.'); return; }
    if (fromBar.id === toBar.id) { Alert.alert('Invalid', 'From and to bars must be different.'); return; }
    if (!product) { Alert.alert('Required', 'Select a product.'); return; }
    if (!q || q <= 0) { Alert.alert('Required', 'Enter a valid quantity.'); return; }
    if (!check || check.level === 'safe') {
      doTransfer(null);
      return;
    }

    const fromName = fromBar.label;
    const hrs = check.hoursAfter.toFixed(1);
    const remaining = check.remainingAfter;

    if (check.level === 'caution') {
      const safeQty = product.velocity ? Math.floor((product.currentStock - product.velocity * 4)) : null;
      Alert.alert(
        '⚠️ Caution',
        `${fromName} will have approximately ${hrs} hours of ${product.label} remaining after this transfer.`,
        [
          { text: 'Cancel', style: 'cancel' },
          ...(safeQty != null && safeQty > 0 ? [{
            text: `Transfer ${safeQty} instead`,
            onPress: () => { setQty(String(safeQty)); doTransfer('caution_reduced'); },
          }] : []),
          { text: `Transfer ${q} anyway`, onPress: () => doTransfer('caution_override') },
        ],
      );
      return;
    }

    // risk
    const velocity = product.velocity ?? 1;
    const hoursNeeded = velocity > 0 ? (product.currentStock / velocity).toFixed(1) : '?';
    const safeQty = product.velocity ? Math.max(0, Math.floor(product.currentStock - product.velocity * 2)) : null;
    Alert.alert(
      '🚫 High Risk',
      `Transferring ${q} may leave ${fromName} short before close.\n\nAt current pace ${fromName} needs approximately ${hoursNeeded} units for the remaining time.\n\nGiving away ${q} leaves only ${remaining} units — about ${hrs} hours supply.`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(safeQty != null && safeQty > 0 ? [{
          text: `Transfer ${safeQty} (safer)`,
          onPress: () => { setQty(String(safeQty)); doTransfer('risk_reduced'); },
        }] : []),
        { text: `Transfer ${q} anyway — I'll manage it`, style: 'destructive', onPress: () => doTransfer('risk_override') },
      ],
    );
  }

  const q = parseFloat(qty);
  const checkColor = !check ? '#16a34a' : check.level === 'safe' ? '#16a34a' : check.level === 'caution' ? '#d97706' : '#dc2626';

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={T.scroll} keyboardShouldPersistTaps="handled">

        <Text style={T.screenTitle}>Transfer stock</Text>

        {/* From bar */}
        <Text style={T.label}>From bar</Text>
        <TouchableOpacity style={T.picker} onPress={() => setShowFromPicker(true)}>
          <Text style={fromBar ? T.pickerVal : T.pickerPlaceholder}>
            {fromBar ? fromBar.label : 'Select bar…'}
          </Text>
          <Text style={T.pickerArrow}>▾</Text>
        </TouchableOpacity>

        {/* To bar */}
        <Text style={T.label}>To bar</Text>
        <TouchableOpacity style={T.picker} onPress={() => setShowToPicker(true)}>
          <Text style={toBar ? T.pickerVal : T.pickerPlaceholder}>
            {toBar ? toBar.label : 'Select bar…'}
          </Text>
          <Text style={T.pickerArrow}>▾</Text>
        </TouchableOpacity>

        {/* Product */}
        <Text style={T.label}>Product</Text>
        <TouchableOpacity
          style={[T.picker, !fromBar && T.pickerDisabled]}
          onPress={() => fromBar && setShowProdPicker(true)}
          disabled={!fromBar}
        >
          <Text style={product ? T.pickerVal : T.pickerPlaceholder}>
            {product ? product.label : fromBar ? 'Select product…' : 'Select from bar first'}
          </Text>
          <Text style={T.pickerArrow}>▾</Text>
        </TouchableOpacity>
        {product && (
          <Text style={T.stockHint}>
            Current stock: {product.currentStock} units
            {product.velocity ? `  ·  ${product.velocity.toFixed(1)}/hr` : ''}
          </Text>
        )}

        {/* Quantity */}
        <Text style={T.label}>Quantity</Text>
        <TextInput
          value={qty}
          onChangeText={setQty}
          placeholder="e.g. 12"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          style={T.input}
        />

        {/* Velocity check result */}
        {check && q > 0 && (
          <View style={[T.checkCard, { borderColor: checkColor, backgroundColor: checkColor + '12' }]}>
            <Text style={[T.checkIcon]}>
              {check.level === 'safe' ? '✅' : check.level === 'caution' ? '⚠️' : '🚫'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[T.checkHeading, { color: checkColor }]}>
                {check.level === 'safe' ? 'Safe transfer' : check.level === 'caution' ? 'Caution' : 'High risk'}
              </Text>
              <Text style={T.checkBody}>
                {fromBar?.label} will have ~{check.hoursAfter < 999 ? `${check.hoursAfter.toFixed(1)}h` : 'plenty'} remaining after transfer.
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[T.primaryBtn, saving && T.primaryBtnDisabled]}
          disabled={saving}
          onPress={handleTransfer}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={T.primaryBtnText}>Transfer stock</Text>}
        </TouchableOpacity>

      </ScrollView>

      {/* Pickers */}
      <PickerModal
        visible={showFromPicker}
        title="From bar"
        items={bars}
        onSelect={(b: any) => { setFromBar(b); setProduct(null); setShowFromPicker(false); }}
        onClose={() => setShowFromPicker(false)}
      />
      <PickerModal
        visible={showToPicker}
        title="To bar"
        items={bars}
        onSelect={(b: any) => { setToBar(b); setShowToPicker(false); }}
        onClose={() => setShowToPicker(false)}
      />
      <PickerModal
        visible={showProdPicker}
        title="Product"
        items={fromStock}
        onSelect={(p: any) => { setProduct(p); setShowProdPicker(false); }}
        onClose={() => setShowProdPicker(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const T = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 20 },
  label:       { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 6 },
  stockHint:   { fontSize: 12, color: '#9ca3af', marginTop: 4, marginBottom: 2 },

  picker: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 13,
  },
  pickerDisabled:     { opacity: 0.5 },
  pickerVal:          { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '600' },
  pickerPlaceholder:  { flex: 1, fontSize: 14, color: '#9ca3af' },
  pickerArrow:        { fontSize: 14, color: '#6b7280' },

  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: '#0f172a',
  },

  checkCard:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 10, padding: 12, marginTop: 14, borderWidth: 1.5 },
  checkIcon:    { fontSize: 20 },
  checkHeading: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  checkBody:    { fontSize: 13, color: '#374151', lineHeight: 18 },

  primaryBtn:         { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
});
