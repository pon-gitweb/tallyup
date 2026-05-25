// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItem = { productId: string; productName: string; quantity: number; unit: string };

const URGENCY_OPTIONS = [
  { id: 'asap',        label: '⚡ ASAP',           sub: 'Running low now' },
  { id: 'next-round',  label: '📦 Next round',     sub: '30–60 minutes' },
  { id: 'planning',    label: '📋 Planning ahead', sub: 'When convenient' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <View style={[SS.dot, done && SS.dotDone, active && SS.dotActive]}>
      <Text style={SS.dotText}>{done ? '✓' : n}</Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalTopUpRequestScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const { barId, barName } = route.params || {};
  const venueId = useVenueId();

  const [step,     setStep]     = useState(1);
  const [products, setProducts] = useState<any[]>([]);
  const [lines,    setLines]    = useState<LineItem[]>([]);
  const [urgency,  setUrgency]  = useState<string>('asap');
  const [note,     setNote]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [sent,     setSent]     = useState(false);
  const [loading,  setLoading]  = useState(FESTIVAL_BETA);

  // Load products for this bar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    getDocs(collection(db, 'venues', venueId, 'bars', barId, 'stock')).then(snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [venueId, barId]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={SS.comingSoon}>
        <Text style={SS.csEmoji}>🎪</Text>
        <Text style={SS.csTitle}>Festival mode</Text>
        <Text style={SS.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={SS.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={SS.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  // ── Sent confirmation ─────────────────────────────────────────────────────
  if (sent) {
    return (
      <View style={SS.comingSoon}>
        <Text style={{ fontSize: 52, marginBottom: 16 }}>✅</Text>
        <Text style={SS.csTitle}>Request sent</Text>
        <Text style={SS.csBody}>Ops team has been notified.</Text>
        <TouchableOpacity style={SS.primaryBtn} onPress={() => nav.goBack()}>
          <Text style={SS.primaryBtnText}>Back to bar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function addLine(product: any) {
    if (lines.find(l => l.productId === product.id)) return;
    setLines(prev => [...prev, {
      productId: product.id,
      productName: product.productName || product.name || product.id,
      quantity: 1,
      unit: product.unit || 'case',
    }]);
  }

  function removeLine(productId: string) {
    setLines(prev => prev.filter(l => l.productId !== productId));
  }

  function adjustQty(productId: string, delta: number) {
    setLines(prev => prev.map(l => l.productId === productId
      ? { ...l, quantity: Math.max(1, l.quantity + delta) }
      : l));
  }

  async function sendRequest() {
    if (!venueId || lines.length === 0) return;
    setSaving(true);
    try {
      const uid = auth.currentUser?.uid ?? 'unknown';
      const displayName = auth.currentUser?.displayName ?? 'Unknown';
      const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await setDoc(doc(db, 'venues', venueId, 'requests', reqId), {
        barId,
        barName: barName || '',
        requestedBy: uid,
        requestedByName: displayName,
        products: lines,
        urgency,
        note: note.trim() || null,
        status: 'pending',
        sourceLocationId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSent(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not send request. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Step indicator ────────────────────────────────────────────────────────
  const stepBar = (
    <View style={SS.stepBar}>
      {[1, 2, 3].map(n => (
        <React.Fragment key={n}>
          <StepDot n={n} active={step === n} done={step > n} />
          {n < 3 && <View style={[SS.stepLine, step > n && SS.stepLineDone]} />}
        </React.Fragment>
      ))}
    </View>
  );

  // ── STEP 1: What do you need? ─────────────────────────────────────────────
  if (step === 1) return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={SS.scroll} keyboardShouldPersistTaps="handled">
        {stepBar}
        <Text style={SS.stepTitle}>What do you need?</Text>
        <Text style={SS.stepSub}>{barName}</Text>

        {/* Product picker */}
        <Text style={SS.label}>Select products</Text>
        <View style={SS.chipRow}>
          {products.map(p => {
            const isAdded = lines.some(l => l.productId === p.id);
            return (
              <TouchableOpacity
                key={p.id}
                style={[SS.chip, isAdded && SS.chipOn]}
                onPress={() => isAdded ? removeLine(p.id) : addLine(p)}
              >
                <Text style={[SS.chipText, isAdded && SS.chipTextOn]}>
                  {p.productName || p.name || p.id}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Quantity steppers */}
        {lines.length > 0 && (
          <>
            <Text style={[SS.label, { marginTop: 16 }]}>Quantities</Text>
            {lines.map(line => (
              <View key={line.productId} style={SS.lineRow}>
                <Text style={SS.lineName} numberOfLines={1}>{line.productName}</Text>
                <View style={SS.stepper}>
                  <TouchableOpacity style={SS.stepperBtn} onPress={() => adjustQty(line.productId, -1)}>
                    <Text style={SS.stepperBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={SS.stepperVal}>{line.quantity} {line.unit}</Text>
                  <TouchableOpacity style={SS.stepperBtn} onPress={() => adjustQty(line.productId, 1)}>
                    <Text style={SS.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        <TouchableOpacity
          style={[SS.primaryBtn, lines.length === 0 && SS.primaryBtnDisabled]}
          disabled={lines.length === 0}
          onPress={() => setStep(2)}
        >
          <Text style={SS.primaryBtnText}>Next →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  // ── STEP 2: Urgency ───────────────────────────────────────────────────────
  if (step === 2) return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={SS.scroll} keyboardShouldPersistTaps="handled">
        {stepBar}
        <Text style={SS.stepTitle}>How urgent?</Text>

        {URGENCY_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.id}
            style={[SS.radioCard, urgency === opt.id && SS.radioCardOn]}
            onPress={() => setUrgency(opt.id)}
          >
            <Text style={[SS.radioLabel, urgency === opt.id && SS.radioLabelOn]}>
              {urgency === opt.id ? '●' : '○'}  {opt.label}
            </Text>
            <Text style={SS.radioSub}>{opt.sub}</Text>
          </TouchableOpacity>
        ))}

        <Text style={SS.label}>Note — optional</Text>
        <Text style={SS.helper}>e.g. Tap line playing up, send cans instead</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note for the ops team"
          placeholderTextColor="#9ca3af"
          style={[SS.input, { minHeight: 72 }]}
          multiline
        />

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <TouchableOpacity style={SS.secondaryBtn} onPress={() => setStep(1)}>
            <Text style={SS.secondaryBtnText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[SS.primaryBtn, { flex: 1 }]} onPress={() => setStep(3)}>
            <Text style={SS.primaryBtnText}>Next →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  // ── STEP 3: Confirm ───────────────────────────────────────────────────────
  const urgencyLabel = URGENCY_OPTIONS.find(o => o.id === urgency)?.label ?? urgency;
  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={SS.scroll}>
        {stepBar}
        <Text style={SS.stepTitle}>Confirm request</Text>

        <View style={SS.summaryCard}>
          <Text style={SS.summaryRow}><Text style={SS.summaryKey}>Bar:  </Text>{barName}</Text>
          <Text style={SS.summaryRow}><Text style={SS.summaryKey}>Urgency:  </Text>{urgencyLabel}</Text>
          {lines.map(l => (
            <Text key={l.productId} style={SS.summaryRow}>
              <Text style={SS.summaryKey}>{l.productName}:  </Text>{l.quantity} {l.unit}
            </Text>
          ))}
          {!!note && (
            <Text style={SS.summaryRow}><Text style={SS.summaryKey}>Note:  </Text>{note}</Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={SS.secondaryBtn} onPress={() => setStep(2)}>
            <Text style={SS.secondaryBtnText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[SS.primaryBtn, { flex: 1 }, saving && SS.primaryBtnDisabled]}
            disabled={saving}
            onPress={sendRequest}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={SS.primaryBtnText}>Send request</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const SS = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll: { padding: 16, paddingBottom: 40 },

  stepBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  dot:          { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  dotActive:    { backgroundColor: '#1b4f72' },
  dotDone:      { backgroundColor: '#16a34a' },
  dotText:      { fontSize: 12, fontWeight: '800', color: '#fff' },
  stepLine:     { flex: 1, height: 2, backgroundColor: '#e5e7eb', maxWidth: 48 },
  stepLineDone: { backgroundColor: '#16a34a' },

  stepTitle:  { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  stepSub:    { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  label:      { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 6 },
  helper:     { fontSize: 12, color: '#9ca3af', marginBottom: 6, lineHeight: 17 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0f172a',
  },

  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  chipOn:      { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  chipText:    { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextOn:  { color: '#1b4f72', fontWeight: '700' },

  lineRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  lineName:    { flex: 1, fontSize: 14, fontWeight: '600', color: '#0B132B' },
  stepper:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn:  { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 18, fontWeight: '700', color: '#374151', lineHeight: 22 },
  stepperVal:  { fontSize: 14, fontWeight: '700', color: '#0B132B', minWidth: 64, textAlign: 'center' },

  radioCard:    { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 8, backgroundColor: '#fff' },
  radioCardOn:  { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  radioLabel:   { fontSize: 15, fontWeight: '700', color: '#374151', marginBottom: 2 },
  radioLabelOn: { color: '#1b4f72' },
  radioSub:     { fontSize: 12, color: '#9ca3af' },

  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#e5e1d8', gap: 6 },
  summaryRow:  { fontSize: 14, color: '#374151', lineHeight: 20 },
  summaryKey:  { fontWeight: '700', color: '#0B132B' },

  primaryBtn:         { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn:       { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', marginTop: 8 },
  secondaryBtnText:   { color: '#1b4f72', fontWeight: '700', fontSize: 15 },
});
