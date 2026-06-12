// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItem = { productId: string; productName: string; quantity: number; unit: string };

const URGENCY_OPTIONS = [
  { id: 'asap',        label: '⚡ ASAP',           sub: 'Running low now' },
  { id: 'next-round',  label: '📦 Next round',     sub: '30–60 minutes' },
  { id: 'planning',    label: '📋 Planning ahead', sub: 'When convenient' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDot({ n, active, done, SS }: { n: number; active: boolean; done: boolean; SS: any }) {
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
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const SS = makeStyles(c);

  const [step,              setStep]              = useState(1);
  const [products,          setProducts]          = useState<any[]>([]);
  const [lines,             setLines]             = useState<LineItem[]>([]);
  const [urgency,           setUrgency]           = useState<string>('asap');
  const [note,              setNote]              = useState('');
  const [saving,            setSaving]            = useState(false);
  const [sent,              setSent]              = useState(false);
  const [loading,           setLoading]           = useState(FESTIVAL_BETA);
  const [sourceLocationId,  setSourceLocationId]  = useState<string | null>(null);
  const [sourceLocationName,setSourceLocationName]= useState<string>('Central Store');
  const [excessSuggestion,  setExcessSuggestion]  = useState<{barId:string;barName:string;excessQty:number;hoursRemaining:number;productId:string}|null>(null);

  // Load products from all areas under this bar's department
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    (async () => {
      try {
        const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', barId, 'areas'));
        const allItems = [];
        for (const area of areasSnap.docs) {
          const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', barId, 'areas', area.id, 'items'));
          allItems.push(...itemsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        }
        setProducts(allItems);
      } catch (_) {}
      setLoading(false);
    })();
  }, [venueId, barId]);

  // Load HQ areas to determine default source location for this bar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) return;
    (async () => {
      try {
        const hqAreasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', 'hq', 'areas'));
        // Prefer the area whose servingBarIds includes this bar
        const servingArea = hqAreasSnap.docs.find(a =>
          (a.data().servingBarIds || []).includes(barId)
        ) || hqAreasSnap.docs[0];
        if (servingArea) {
          setSourceLocationId(servingArea.id);
          setSourceLocationName(servingArea.data().name || 'Central Store');
        }
      } catch (_) {}
    })();
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
        <ActivityIndicator color={c.deepBlue} size="large" />
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

  async function doSendRequest() {
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
        sourceLocationId: sourceLocationId || null,
        sourceLocationName: sourceLocationName || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showSuccess('✓ Request sent');
      setSent(true);
    } catch (e: any) {
      showError(e?.message || 'Could not send request. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function sendRequest() {
    confirm({
      title: 'Send top-up request?',
      message: 'The ops team will be notified to fulfil this request.',
      confirmLabel: 'Send request',
      onConfirm: doSendRequest,
    });
  }

  // ── Step indicator ────────────────────────────────────────────────────────
  const stepBar = (
    <View style={SS.stepBar}>
      {[1, 2, 3].map(n => (
        <React.Fragment key={n}>
          <StepDot n={n} active={step === n} done={step > n} SS={SS} />
          {n < 3 && <View style={[SS.stepLine, step > n && SS.stepLineDone]} />}
        </React.Fragment>
      ))}
    </View>
  );

  // ── STEP 1: What do you need? ─────────────────────────────────────────────
  if (step === 1) return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
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
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
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
          placeholderTextColor={c.slateMid}
          style={[SS.input, { minHeight: 72 }]}
          multiline
        />

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <TouchableOpacity style={SS.secondaryBtn} onPress={() => setStep(1)}>
            <Text style={SS.secondaryBtnText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[SS.primaryBtn, { flex: 1 }]} onPress={() => {
            setStep(3);
            // Check if any other bar has excess of the requested products
            if (!venueId || !barId || lines.length === 0) return;
            const firstLine = lines[0];
            if (!firstLine?.productId) return;
            (async () => {
              try {
                const barSnap = await getDocs(query(collection(db, 'venues', venueId, 'departments'), where('isFestivalBar', '==', true)));
                for (const barDoc of barSnap.docs) {
                  if (barDoc.id === barId) continue;
                  const itemRef = doc(db, 'venues', venueId, 'departments', barDoc.id, 'areas', 'back-of-house', 'items', firstLine.productId);
                  const itemSnap = await getDoc(itemRef);
                  if (!itemSnap.exists()) continue;
                  const item = itemSnap.data() as any;
                  const stock = item.lastCount || 0;
                  const velocity = item.velocity || 0;
                  if (velocity <= 0 || stock <= 0) continue;
                  const hoursRemaining = stock / velocity;
                  if (hoursRemaining > 4) {
                    const safeToGive = Math.max(0, Math.floor(stock - velocity * 3));
                    if (safeToGive > 0) {
                      setExcessSuggestion({
                        barId: barDoc.id,
                        barName: barDoc.data().name || barDoc.id,
                        excessQty: safeToGive,
                        hoursRemaining,
                        productId: firstLine.productId,
                      });
                      return;
                    }
                  }
                }
              } catch (_) {}
            })();
          }}>
            <Text style={SS.primaryBtnText}>Next →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  // ── STEP 3: Confirm ───────────────────────────────────────────────────────
  const urgencyLabel = URGENCY_OPTIONS.find(o => o.id === urgency)?.label ?? urgency;
  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
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

        {/* Excess bar suggestion — pure velocity math */}
        {excessSuggestion && (
          <View style={{ backgroundColor: c.primaryLight, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1.5, borderColor: c.deepBlue }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: c.deepBlue, marginBottom: 4 }}>
              💡 {excessSuggestion.barName} has excess ({excessSuggestion.hoursRemaining.toFixed(1)}hrs supply)
            </Text>
            <Text style={{ fontSize: 13, color: c.text, marginBottom: 10 }}>
              Consider a bar transfer first — saves a trip to {sourceLocationName}.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 10, alignItems: 'center' }}
                onPress={() => setExcessSuggestion(null)}
              >
                <Text style={{ color: c.deepBlue, fontWeight: '700', fontSize: 13 }}>Request from HQ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 10, alignItems: 'center' }}
                onPress={() => nav.navigate('FestivalTransfer', { fromBarId: excessSuggestion.barId, fromBarName: excessSuggestion.barName })}
              >
                <Text style={{ color: c.surface, fontWeight: '700', fontSize: 13 }}>Transfer from {excessSuggestion.barName}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
              ? <ActivityIndicator color={c.surface} size="small" />
              : <Text style={SS.primaryBtnText}>Send request</Text>}
          </TouchableOpacity>
        </View>
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

    scroll: { padding: 16, paddingBottom: 40 },

    stepBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    dot:          { width: 28, height: 28, borderRadius: 14, backgroundColor: c.border, alignItems: 'center', justifyContent: 'center' },
    dotActive:    { backgroundColor: c.deepBlue },
    dotDone:      { backgroundColor: c.success },
    dotText:      { fontSize: 12, fontWeight: '800', color: c.surface },
    stepLine:     { flex: 1, height: 2, backgroundColor: c.border, maxWidth: 48 },
    stepLineDone: { backgroundColor: c.success },

    stepTitle:  { fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 4 },
    stepSub:    { fontSize: 14, color: c.slateMid, marginBottom: 16 },
    label:      { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 12, marginBottom: 6 },
    helper:     { fontSize: 12, color: c.slateMid, marginBottom: 6, lineHeight: 17 },
    input: {
      backgroundColor: c.oat, borderWidth: 1, borderColor: c.border,
      borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 14, color: c.navy,
    },

    chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.oat },
    chipOn:      { borderColor: c.deepBlue, backgroundColor: c.primaryLight },
    chipText:    { fontSize: 13, color: c.text, fontWeight: '500' },
    chipTextOn:  { color: c.deepBlue, fontWeight: '700' },

    lineRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: c.border },
    lineName:    { flex: 1, fontSize: 14, fontWeight: '600', color: c.navy },
    stepper:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepperBtn:  { width: 32, height: 32, borderRadius: 16, backgroundColor: c.border, alignItems: 'center', justifyContent: 'center' },
    stepperBtnText: { fontSize: 18, fontWeight: '700', color: c.text, lineHeight: 22 },
    stepperVal:  { fontSize: 14, fontWeight: '700', color: c.navy, minWidth: 64, textAlign: 'center' },

    radioCard:    { borderWidth: 1.5, borderColor: c.border, borderRadius: 12, padding: 14, marginBottom: 8, backgroundColor: c.surface },
    radioCardOn:  { borderColor: c.deepBlue, backgroundColor: c.primaryLight },
    radioLabel:   { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 2 },
    radioLabelOn: { color: c.deepBlue },
    radioSub:     { fontSize: 12, color: c.slateMid },

    summaryCard: { backgroundColor: c.surface, borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: c.border, gap: 6 },
    summaryRow:  { fontSize: 14, color: c.text, lineHeight: 20 },
    summaryKey:  { fontWeight: '700', color: c.navy },

    primaryBtn:         { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText:     { color: c.surface, fontWeight: '700', fontSize: 15 },
    secondaryBtn:       { borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', marginTop: 8 },
    secondaryBtnText:   { color: c.deepBlue, fontWeight: '700', fontSize: 15 },
  });
}
