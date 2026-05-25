// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert, Modal, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, onSnapshot, setDoc, updateDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusConfig(s: string): { icon: string; label: string; color: string } {
  if (s === 'active')    return { icon: '🔴', label: 'Live now',       color: '#dc2626' };
  if (s === 'ready')     return { icon: '✓',  label: 'Ready',         color: '#16a34a' };
  if (s === 'completed') return { icon: '✓',  label: 'Completed',     color: '#9ca3af' };
  return                        { icon: '⏳', label: 'Prep required', color: '#d97706' };
}

function isActivationNow(activation: any): boolean {
  if (!activation.startTime || !activation.endTime) return false;
  const now = Date.now();
  const start = activation.startTime?.toDate?.()?.getTime() ?? 0;
  const end   = activation.endTime?.toDate?.()?.getTime() ?? 0;
  return now >= start && now <= end;
}

function formatTs(ts: any): string {
  if (!ts?.toDate) return '';
  return ts.toDate().toLocaleString('en-NZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── Product row helper ───────────────────────────────────────────────────────

type ProductRow = { productId: string; productName: string; quantity: string };

// ─── Add Activation Modal ─────────────────────────────────────────────────────

function AddActivationModal({ visible, onClose, venueId }: any) {
  const uid = auth.currentUser?.uid;
  const [brandName,    setBrandName]    = useState('');
  const [barId,        setBarId]        = useState('');
  const [barName,      setBarName]      = useState('');
  const [startDate,    setStartDate]    = useState('');
  const [startTime,    setStartTime]    = useState('');
  const [endTime,      setEndTime]      = useState('');
  const [attendance,   setAttendance]   = useState('');
  const [description,  setDescription]  = useState('');
  const [products,     setProducts]     = useState<ProductRow[]>([{ productId: '', productName: '', quantity: '' }]);
  const [displayReq,   setDisplayReq]   = useState(false);
  const [displayNote,  setDisplayNote]  = useState('');
  const [saving,       setSaving]       = useState(false);
  const [bars,         setBars]         = useState<any[]>([]);

  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'bars')).then(snap => {
      setBars(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }).catch(() => {});
  }, [venueId]);

  function parseDatetime(dateStr: string, timeStr: string): Date | null {
    if (!dateStr || !timeStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const [hours, mins] = timeStr.split(':').map(Number);
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), hours || 0, mins || 0);
    return isNaN(d.getTime()) ? null : d;
  }

  async function save() {
    if (!brandName.trim()) { Alert.alert('Required', 'Brand name is required.'); return; }
    if (!barId) { Alert.alert('Required', 'Select a bar.'); return; }
    if (!venueId) return;

    setSaving(true);
    try {
      const activationId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const startDt = parseDatetime(startDate, startTime);
      const endDt   = parseDatetime(startDate, endTime);

      const prods = products.filter(p => p.productName.trim()).map(p => ({
        productId:   p.productId || `act_${p.productName.toLowerCase().replace(/\s+/g, '_')}`,
        productName: p.productName.trim(),
        quantity:    parseFloat(p.quantity) || 1,
      }));

      await setDoc(doc(db, 'venues', venueId, 'activations', activationId), {
        brandName:           brandName.trim(),
        barId,
        barName,
        startTime:           startDt ? serverTimestamp() : null,  // placeholder — real TS set below
        endTime:             endDt   ? serverTimestamp() : null,
        expectedAttendance:  parseInt(attendance) || null,
        description:         description.trim() || null,
        productsRequired:    prods,
        displayRequirements: displayReq ? (displayNote.trim() || 'Yes') : null,
        status:              'planned',
        prepTaskId:          null,
        createdAt:           serverTimestamp(),
      });

      // Now update with actual timestamps (serverTimestamp() inside setDoc can't be used in arrays)
      if (startDt) {
        const { Timestamp } = require('firebase/firestore');
        await updateDoc(doc(db, 'venues', venueId, 'activations', activationId), {
          startTime: Timestamp.fromDate(startDt),
          endTime:   endDt ? Timestamp.fromDate(endDt) : null,
        });
      }

      onClose();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save activation.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={A.headerRow}>
            <Text style={A.modalTitle}>Add activation</Text>
            <TouchableOpacity onPress={onClose}><Text style={A.closeBtn}>✕</Text></TouchableOpacity>
          </View>

          <Text style={A.label}>Brand / sponsor name *</Text>
          <TextInput value={brandName} onChangeText={setBrandName} placeholder="e.g. Hendricks Gin" placeholderTextColor="#9ca3af" style={A.input} />

          <Text style={A.label}>Bar location *</Text>
          {bars.length === 0 ? (
            <Text style={A.helper}>No bars set up yet.</Text>
          ) : (
            bars.map(bar => (
              <TouchableOpacity
                key={bar.id}
                style={[A.radioCard, barId === bar.id && A.radioCardOn]}
                onPress={() => { setBarId(bar.id); setBarName(bar.name || bar.id); }}
              >
                <Text style={[A.radioLabel, barId === bar.id && A.radioLabelOn]}>
                  {barId === bar.id ? '●' : '○'}  {bar.name || bar.id}
                </Text>
              </TouchableOpacity>
            ))
          )}

          <Text style={A.label}>Date (DD/MM/YYYY)</Text>
          <TextInput value={startDate} onChangeText={setStartDate} placeholder="e.g. 14/06/2025" placeholderTextColor="#9ca3af" style={A.input} keyboardType="numbers-and-punctuation" />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={A.label}>Start time</Text>
              <TextInput value={startTime} onChangeText={setStartTime} placeholder="18:00" placeholderTextColor="#9ca3af" style={A.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={A.label}>End time</Text>
              <TextInput value={endTime} onChangeText={setEndTime} placeholder="19:00" placeholderTextColor="#9ca3af" style={A.input} />
            </View>
          </View>

          <Text style={A.label}>Expected attendance</Text>
          <TextInput value={attendance} onChangeText={setAttendance} placeholder="e.g. 80" placeholderTextColor="#9ca3af" style={A.input} keyboardType="numeric" />

          <Text style={A.label}>Description</Text>
          <TextInput value={description} onChangeText={setDescription} placeholder="e.g. Hendricks masterclass with garnish bar" placeholderTextColor="#9ca3af" style={[A.input, { minHeight: 56 }]} multiline />

          <Text style={[A.label, { marginTop: 14 }]}>Products required (extra stock for activation)</Text>
          {products.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
              <TextInput
                value={row.productName}
                onChangeText={v => setProducts(prev => prev.map((r, j) => j === i ? { ...r, productName: v } : r))}
                placeholder="Product" placeholderTextColor="#9ca3af" style={[A.input, { flex: 2 }]}
              />
              <TextInput
                value={row.quantity}
                onChangeText={v => setProducts(prev => prev.map((r, j) => j === i ? { ...r, quantity: v } : r))}
                placeholder="Qty" placeholderTextColor="#9ca3af" style={[A.input, { width: 60 }]}
                keyboardType="numeric"
              />
            </View>
          ))}
          <TouchableOpacity onPress={() => setProducts(p => [...p, { productId: '', productName: '', quantity: '' }])}>
            <Text style={A.addRowText}>+ Add product</Text>
          </TouchableOpacity>

          <View style={A.toggleRow}>
            <Text style={A.label}>Display requirements?</Text>
            <Switch value={displayReq} onValueChange={setDisplayReq} trackColor={{ true: '#1b4f72', false: '#d1d5db' }} />
          </View>
          {displayReq && (
            <TextInput value={displayNote} onChangeText={setDisplayNote} placeholder="e.g. Branded display at front of bar" placeholderTextColor="#9ca3af" style={A.input} />
          )}

          <TouchableOpacity style={[A.saveBtn, saving && A.btnDisabled]} disabled={saving} onPress={save}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={A.saveBtnText}>Add activation</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Prep task detail ─────────────────────────────────────────────────────────

function PrepTaskCard({ activation, onMarkReady, marking }: any) {
  return (
    <View style={A.prepCard}>
      <Text style={A.prepTitle}>ACTIVATION PREP TASK</Text>
      <Text style={A.prepSubtitle}>{activation.brandName} — {activation.barName} {activation.startTime ? formatTs(activation.startTime) : ''}</Text>
      <View style={A.prepDivider} />
      <Text style={A.prepNote}>Ensure before {activation.startTime ? formatTs(activation.startTime) : 'start time'}:</Text>
      {(activation.productsRequired || []).map((p: any, i: number) => (
        <Text key={i} style={A.prepItem}>☐ {p.productName} × {p.quantity} extra</Text>
      ))}
      {activation.displayRequirements && (
        <Text style={A.prepItem}>☐ Display: {activation.displayRequirements}</Text>
      )}
      <TouchableOpacity
        style={[A.readyBtn, marking && A.btnDisabled]}
        disabled={marking}
        onPress={onMarkReady}
      >
        <Text style={A.readyBtnText}>Mark ready</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalActivationsScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;

  const [activations, setActivations] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(FESTIVAL_BETA);
  const [showModal,   setShowModal]   = useState(false);
  const [showPrep,    setShowPrep]    = useState<string | null>(null);
  const [marking,     setMarking]     = useState<string | null>(null);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'activations'),
      snap => {
        setActivations(snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .map(a => ({
            ...a,
            status: isActivationNow(a) ? 'active' : a.status,
          }))
          .sort((a, b) => {
            const ta = a.startTime?.toDate?.()?.getTime() ?? 0;
            const tb = b.startTime?.toDate?.()?.getTime() ?? 0;
            return ta - tb;
          })
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venueId]);

  async function markReady(activationId: string) {
    if (!venueId || marking) return;
    setMarking(activationId);
    try {
      await updateDoc(doc(db, 'venues', venueId, 'activations', activationId), {
        status:    'ready',
        updatedAt: serverTimestamp(),
      });
      setShowPrep(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message);
    } finally {
      setMarking(null);
    }
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={A.comingSoon}>
        <Text style={A.csEmoji}>🎪</Text>
        <Text style={A.csTitle}>Festival mode</Text>
        <Text style={A.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={A.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return <View style={A.comingSoon}><ActivityIndicator color="#1b4f72" size="large" /></View>;
  }

  const upcoming  = activations.filter(a => a.status !== 'completed');
  const completed = activations.filter(a => a.status === 'completed');

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={A.scroll}>

        <Text style={A.screenTitle}>Activations</Text>

        <TouchableOpacity style={A.addBtn} onPress={() => setShowModal(true)}>
          <Text style={A.addBtnText}>+ Add activation</Text>
        </TouchableOpacity>

        {activations.length === 0 && (
          <View style={A.emptyCard}>
            <Text style={A.emptyText}>No activations scheduled.</Text>
            <Text style={A.emptyHint}>Add brand activations to track prep tasks and adjust velocity during events.</Text>
          </View>
        )}

        {upcoming.map(act => {
          const sc = statusConfig(act.status);
          const isShowingPrep = showPrep === act.id;
          return (
            <View key={act.id}>
              <View style={[A.card, act.status === 'active' && A.cardActive]}>
                <View style={A.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={A.brandName}>{act.brandName}</Text>
                    <Text style={A.barInfo}>{act.barName}{act.startTime ? ` — ${formatTs(act.startTime)}` : ''}{act.endTime ? ` - ${formatTs(act.endTime)}` : ''}</Text>
                  </View>
                  <View style={[A.statusBadge, { borderColor: sc.color }]}>
                    <Text style={[A.statusText, { color: sc.color }]}>{sc.icon} {sc.label}</Text>
                  </View>
                </View>
                {act.description && <Text style={A.description}>{act.description}</Text>}
                {act.displayRequirements && (
                  <Text style={A.displayReq}>Display: {act.displayRequirements}</Text>
                )}
                {(act.productsRequired || []).length > 0 && (
                  <Text style={A.productCount}>{act.productsRequired.length} product{act.productsRequired.length !== 1 ? 's' : ''} required</Text>
                )}
                {act.status === 'planned' && (
                  <TouchableOpacity style={A.prepBtn} onPress={() => setShowPrep(isShowingPrep ? null : act.id)}>
                    <Text style={A.prepBtnText}>{isShowingPrep ? 'Hide prep task ▲' : 'View prep task ▼'}</Text>
                  </TouchableOpacity>
                )}
                {act.status === 'ready' && (
                  <Text style={A.readyNote}>✓ Prep complete — ready to go</Text>
                )}
              </View>
              {isShowingPrep && (
                <PrepTaskCard
                  activation={act}
                  onMarkReady={() => markReady(act.id)}
                  marking={marking === act.id}
                />
              )}
            </View>
          );
        })}

        {completed.length > 0 && (
          <>
            <Text style={A.sectionLabel}>PAST ACTIVATIONS</Text>
            {completed.map(act => (
              <View key={act.id} style={[A.card, A.cardPast]}>
                <Text style={A.brandNamePast}>✓ {act.brandName} — {act.barName}</Text>
                {act.startTime && <Text style={A.barInfoPast}>{formatTs(act.startTime)}</Text>}
              </View>
            ))}
          </>
        )}

      </ScrollView>

      <AddActivationModal visible={showModal} onClose={() => setShowModal(false)} venueId={venueId} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const A = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:       { padding: 16, paddingBottom: 40 },
  screenTitle:  { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginTop: 20, marginBottom: 8 },

  addBtn:     { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  addBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },

  card:        { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  cardActive:  { borderColor: '#dc2626', borderWidth: 1.5 },
  cardPast:    { opacity: 0.6 },
  cardTop:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  brandName:   { fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 2 },
  brandNamePast: { fontSize: 14, fontWeight: '700', color: '#6b7280' },
  barInfo:     { fontSize: 12, color: '#6b7280' },
  barInfoPast: { fontSize: 12, color: '#9ca3af' },
  description: { fontSize: 13, color: '#374151', marginBottom: 6 },
  displayReq:  { fontSize: 12, color: '#d97706', marginBottom: 4 },
  productCount:{ fontSize: 12, color: '#9ca3af', marginTop: 2 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  statusText:  { fontSize: 11, fontWeight: '700' },
  prepBtn:     { marginTop: 10, alignSelf: 'flex-start' },
  prepBtnText: { fontSize: 13, color: '#1b4f72', fontWeight: '700' },
  readyNote:   { fontSize: 12, color: '#16a34a', fontWeight: '600', marginTop: 8 },

  prepCard:     { backgroundColor: '#fffbeb', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1.5, borderColor: '#fde68a', marginTop: -4 },
  prepTitle:    { fontSize: 11, fontWeight: '800', color: '#92400e', letterSpacing: 1, marginBottom: 4 },
  prepSubtitle: { fontSize: 14, fontWeight: '700', color: '#0B132B', marginBottom: 8 },
  prepDivider:  { height: 1, backgroundColor: '#fde68a', marginBottom: 8 },
  prepNote:     { fontSize: 12, color: '#374151', marginBottom: 6 },
  prepItem:     { fontSize: 13, color: '#374151', lineHeight: 22 },
  readyBtn:     { backgroundColor: '#16a34a', borderRadius: 999, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  readyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnDisabled:  { opacity: 0.5 },

  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#0B132B', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 18 },

  // Modal
  headerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle:   { fontSize: 22, fontWeight: '800', color: '#0B132B' },
  closeBtn:     { fontSize: 20, color: '#6b7280', padding: 4 },
  label:        { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 4 },
  helper:       { fontSize: 12, color: '#9ca3af', marginBottom: 6 },
  input:        { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, color: '#0f172a', marginBottom: 6 },
  radioCard:    { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 6 },
  radioCardOn:  { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  radioLabel:   { fontSize: 14, fontWeight: '600', color: '#374151' },
  radioLabelOn: { color: '#1b4f72' },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  addRowText:   { fontSize: 13, color: '#1b4f72', fontWeight: '600', marginTop: 4, marginBottom: 8 },
  saveBtn:      { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
});
