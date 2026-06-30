// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { ref, uploadString } from 'firebase/storage';
import { collection, doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, storage } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { apiBase } from '../../services/apiBase';
import { useToast } from '../../components/common/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductReq = { product: string; quantity: string; unit: string; notes: string };

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusConfig(s: string): { icon: string; label: string; color: string } {
  if (s === 'delivered')    return { icon: '✓',  label: 'Delivered',    color: '#16a34a' };
  if (s === 'in-progress')  return { icon: '🚶', label: 'In progress',  color: '#1b4f72' };
  if (s === 'overdue')      return { icon: '🔴', label: 'Overdue',      color: '#dc2626' };
  return                           { icon: '⏳', label: 'Pending',      color: '#d97706' };
}

function isOverdue(rider: any): boolean {
  if (!rider.deliveryTime || rider.status !== 'pending') return false;
  const parts = String(rider.deliveryTime).split(':');
  if (parts.length < 2) return false;
  const [h, m] = [parseInt(parts[0]), parseInt(parts[1])];
  if (isNaN(h) || isNaN(m)) return false;
  const base = rider.createdAt?.toDate?.() ?? new Date();
  const target = new Date(base);
  target.setHours(h, m, 0, 0);
  return target < new Date();
}

// ─── Add Rider Modal ──────────────────────────────────────────────────────────

function AddRiderModal({ visible, onClose, venueId, onAdded }: any) {
  const uid = auth.currentUser?.uid;
  const [mode,         setMode]         = useState<'pdf' | 'manual'>('manual');
  const [artistName,   setArtistName]   = useState('');
  const [setTime,      setSetTime]      = useState('');
  const [delivTime,    setDelivTime]    = useState('');
  const [delivLoc,     setDelivLoc]     = useState('');
  const [dressingRoom, setDressingRoom] = useState<ProductReq[]>([{ product: '', quantity: '', unit: '', notes: '' }]);
  const [stageArea,    setStageArea]    = useState<ProductReq[]>([{ product: '', quantity: '', unit: '', notes: '' }]);
  const [saving,       setSaving]       = useState(false);
  const [pendingFile,  setPendingFile]  = useState<{ name: string; uri: string } | null>(null);
  const { showError } = useToast();

  function addRow(list: ProductReq[], setter: any) {
    setter([...list, { product: '', quantity: '', unit: '', notes: '' }]);
  }
  function updateRow(list: ProductReq[], setter: any, idx: number, field: string, val: string) {
    setter(list.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  }

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true }).catch(() => null);
    if (!result || result.canceled || !result.assets?.length) return;
    setPendingFile({ name: result.assets[0].name, uri: result.assets[0].uri });
  }

  async function save() {
    if (!artistName.trim() && mode === 'manual') { showError('Artist name is required.'); return; }
    if (!venueId) return;
    setSaving(true);
    try {
      const riderId = `rider_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      if (mode === 'pdf' && pendingFile) {
        // Upload PDF then call extraction function
        const base64 = await FileSystem.readAsStringAsync(pendingFile.uri, { encoding: FileSystem.EncodingType.Base64 });
        const dataUrl = `data:application/pdf;base64,${base64}`;
        const storagePath = `festival-riders/${venueId}/${riderId}_${pendingFile.name}`;
        await uploadString(ref(storage, storagePath), dataUrl, 'data_url');

        await setDoc(doc(db, 'venues', venueId, 'riders', riderId), {
          artistName:      null,
          setTime:         null,
          deliveryTime:    null,
          deliveryLocation:null,
          dressingRoom:    [],
          stageArea:       [],
          status:          'processing',
          storageRef:      storagePath,
          deliveredBy:     null,
          deliveredAt:     null,
          specialRequests: null,
          createdAt:       serverTimestamp(),
        });

        const token = await auth.currentUser?.getIdToken();
        await fetch(`${apiBase()}/extract-festival-rider`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ venueId, riderId, storageRef: storagePath }),
        }).catch(() => {});
      } else {
        // Manual entry
        await setDoc(doc(db, 'venues', venueId, 'riders', riderId), {
          artistName:      artistName.trim(),
          setTime:         setTime.trim() || null,
          deliveryTime:    delivTime.trim() || null,
          deliveryLocation:delivLoc.trim() || null,
          dressingRoom:    dressingRoom.filter(r => r.product.trim()).map(r => ({
            product: r.product.trim(),
            quantity: parseFloat(r.quantity) || 1,
            unit: r.unit.trim() || 'units',
            temperature: null,
            notes: r.notes.trim() || null,
          })),
          stageArea: stageArea.filter(r => r.product.trim()).map(r => ({
            product: r.product.trim(),
            quantity: parseFloat(r.quantity) || 1,
            unit: r.unit.trim() || 'units',
            notes: r.notes.trim() || null,
          })),
          status:          'pending',
          deliveredBy:     null,
          deliveredAt:     null,
          specialRequests: null,
          createdAt:       serverTimestamp(),
        });
      }

      onAdded?.();
      onClose();
    } catch (e: any) {
      showError(e?.message || 'Could not save rider.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={M.headerRow}>
            <Text style={M.title}>Add rider</Text>
            <TouchableOpacity onPress={onClose}><Text style={M.closeBtn}>✕</Text></TouchableOpacity>
          </View>

          {/* Mode selector */}
          <View style={M.modeRow}>
            {(['manual', 'pdf'] as const).map(m => (
              <TouchableOpacity key={m} style={[M.modeBtn, mode === m && M.modeBtnOn]} onPress={() => setMode(m)}>
                <Text style={[M.modeBtnText, mode === m && M.modeBtnTextOn]}>
                  {m === 'manual' ? 'Manual entry' : 'Upload PDF'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'pdf' && (
            <>
              {pendingFile ? (
                <View style={M.fileCard}>
                  <Text style={M.fileName}>📄 {pendingFile.name}</Text>
                  <TouchableOpacity onPress={() => setPendingFile(null)}><Text style={M.removeFile}>Remove</Text></TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={M.pdfBtn} onPress={pickPdf}>
                  <Text style={M.pdfBtnText}>Select PDF rider</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {mode === 'manual' && (
            <>
              <Text style={M.label}>Artist name *</Text>
              <TextInput value={artistName} onChangeText={setArtistName} placeholder="e.g. The Beths" placeholderTextColor="#9ca3af" style={M.input} />

              <Text style={M.label}>Set time (e.g. Saturday 8:45pm)</Text>
              <TextInput value={setTime} onChangeText={setSetTime} placeholder="e.g. Saturday 8:45pm" placeholderTextColor="#9ca3af" style={M.input} />

              <Text style={M.label}>Delivery required by</Text>
              <TextInput value={delivTime} onChangeText={setDelivTime} placeholder="e.g. Saturday 7:30pm" placeholderTextColor="#9ca3af" style={M.input} />

              <Text style={M.label}>Delivery location</Text>
              <TextInput value={delivLoc} onChangeText={setDelivLoc} placeholder="e.g. Dressing room C, Stage 2" placeholderTextColor="#9ca3af" style={M.input} />

              <Text style={M.sectionLabel}>DRESSING ROOM</Text>
              {dressingRoom.map((row, i) => (
                <View key={i} style={M.productRow}>
                  <TextInput
                    value={row.product} onChangeText={v => updateRow(dressingRoom, setDressingRoom, i, 'product', v)}
                    placeholder="Product" placeholderTextColor="#9ca3af" style={[M.input, { flex: 2 }]}
                  />
                  <TextInput
                    value={row.quantity} onChangeText={v => updateRow(dressingRoom, setDressingRoom, i, 'quantity', v)}
                    placeholder="Qty" placeholderTextColor="#9ca3af" style={[M.input, { width: 56 }]}
                    keyboardType="numeric"
                  />
                  <TextInput
                    value={row.unit} onChangeText={v => updateRow(dressingRoom, setDressingRoom, i, 'unit', v)}
                    placeholder="Unit" placeholderTextColor="#9ca3af" style={[M.input, { width: 60 }]}
                  />
                </View>
              ))}
              <TouchableOpacity onPress={() => addRow(dressingRoom, setDressingRoom)}>
                <Text style={M.addRowText}>+ Add item</Text>
              </TouchableOpacity>

              <Text style={[M.sectionLabel, { marginTop: 14 }]}>STAGE AREA</Text>
              {stageArea.map((row, i) => (
                <View key={i} style={M.productRow}>
                  <TextInput
                    value={row.product} onChangeText={v => updateRow(stageArea, setStageArea, i, 'product', v)}
                    placeholder="Product" placeholderTextColor="#9ca3af" style={[M.input, { flex: 2 }]}
                  />
                  <TextInput
                    value={row.quantity} onChangeText={v => updateRow(stageArea, setStageArea, i, 'quantity', v)}
                    placeholder="Qty" placeholderTextColor="#9ca3af" style={[M.input, { width: 56 }]}
                    keyboardType="numeric"
                  />
                  <TextInput
                    value={row.unit} onChangeText={v => updateRow(stageArea, setStageArea, i, 'unit', v)}
                    placeholder="Unit" placeholderTextColor="#9ca3af" style={[M.input, { width: 60 }]}
                  />
                </View>
              ))}
              <TouchableOpacity onPress={() => addRow(stageArea, setStageArea)}>
                <Text style={M.addRowText}>+ Add item</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={[M.saveBtn, saving && M.saveBtnDisabled]}
            disabled={saving || (mode === 'pdf' && !pendingFile)}
            onPress={save}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={M.saveBtnText}>{mode === 'pdf' ? 'Upload and extract' : 'Add rider'}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalRidersScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();

  const [riders,    setRiders]    = useState<any[]>([]);
  const [loading,   setLoading]   = useState(FESTIVAL_BETA);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'riders'),
      snap => {
        setRiders(snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .map(r => ({ ...r, status: isOverdue(r) ? 'overdue' : r.status }))
          .sort((a, b) => (a.status === 'delivered' ? 1 : 0) - (b.status === 'delivered' ? 1 : 0))
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venueId]);

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

  const pending   = riders.filter(r => r.status !== 'delivered');
  const delivered = riders.filter(r => r.status === 'delivered');

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={R.scroll}>

        <Text style={R.screenTitle}>Artist Riders</Text>

        <TouchableOpacity style={R.addBtn} onPress={() => setShowModal(true)}>
          <Text style={R.addBtnText}>+ Add rider</Text>
        </TouchableOpacity>

        {pending.length === 0 && delivered.length === 0 && (
          <View style={R.emptyCard}>
            <Text style={R.emptyText}>No riders added yet.</Text>
            <Text style={R.emptyHint}>Add artist riders to track dressing room and stage beverage requirements.</Text>
          </View>
        )}

        {pending.map(rider => {
          const sc = statusConfig(rider.status);
          const totalItems = (rider.dressingRoom?.length ?? 0) + (rider.stageArea?.length ?? 0);
          return (
            <TouchableOpacity
              key={rider.id}
              style={[R.card, rider.status === 'overdue' && R.cardOverdue]}
              onPress={() => nav.navigate('FestivalRiderDetail', { riderId: rider.id })}
            >
              <View style={R.cardTop}>
                <Text style={R.artistName} numberOfLines={1}>
                  {rider.artistName || (rider.status === 'processing' ? 'Extracting…' : 'Unknown artist')}
                </Text>
                <View style={[R.statusBadge, { borderColor: sc.color }]}>
                  <Text style={[R.statusText, { color: sc.color }]}>{sc.icon} {sc.label}</Text>
                </View>
              </View>
              {rider.setTime && <Text style={R.setTime}>Set: {rider.setTime}</Text>}
              {rider.deliveryTime && <Text style={R.delivTime}>Deliver by: {rider.deliveryTime}</Text>}
              {totalItems > 0 && <Text style={R.itemCount}>{totalItems} item{totalItems !== 1 ? 's' : ''}</Text>}
            </TouchableOpacity>
          );
        })}

        {delivered.length > 0 && (
          <>
            <Text style={R.sectionLabel}>DELIVERED</Text>
            {delivered.map(rider => (
              <TouchableOpacity
                key={rider.id}
                style={[R.card, R.cardDelivered]}
                onPress={() => nav.navigate('FestivalRiderDetail', { riderId: rider.id })}
              >
                <Text style={R.artistNameDone}>{rider.artistName || 'Unknown artist'} ✓</Text>
                {rider.setTime && <Text style={R.setTimeDone}>{rider.setTime}</Text>}
              </TouchableOpacity>
            ))}
          </>
        )}

      </ScrollView>

      <AddRiderModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        venueId={venueId}
        onAdded={() => {}}
      />
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

  scroll:       { padding: 16, paddingBottom: 40 },
  screenTitle:  { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginTop: 20, marginBottom: 8 },

  addBtn:     { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  addBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },

  card:         { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  cardOverdue:  { borderColor: '#dc2626', borderWidth: 1.5 },
  cardDelivered:{ opacity: 0.6 },
  cardTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  artistName:   { fontSize: 16, fontWeight: '800', color: '#0B132B', flex: 1, marginRight: 8 },
  artistNameDone:{ fontSize: 15, fontWeight: '700', color: '#6b7280' },
  setTime:      { fontSize: 13, color: '#374151', marginBottom: 2 },
  setTimeDone:  { fontSize: 12, color: '#9ca3af' },
  delivTime:    { fontSize: 12, color: '#d97706', fontWeight: '600' },
  itemCount:    { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  statusBadge:  { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  statusText:   { fontSize: 11, fontWeight: '700' },

  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#0B132B', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 18 },
});

const M = StyleSheet.create({
  headerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title:        { fontSize: 22, fontWeight: '800', color: '#0B132B' },
  closeBtn:     { fontSize: 20, color: '#6b7280', padding: 4 },
  modeRow:      { flexDirection: 'row', gap: 10, marginBottom: 16 },
  modeBtn:      { flex: 1, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', alignItems: 'center' },
  modeBtnOn:    { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  modeBtnText:  { fontSize: 13, fontWeight: '600', color: '#374151' },
  modeBtnTextOn:{ color: '#1b4f72', fontWeight: '700' },
  pdfBtn:       { backgroundColor: '#f3f4f6', borderRadius: 10, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 12 },
  pdfBtnText:   { fontSize: 14, color: '#374151', fontWeight: '600' },
  fileCard:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#eff6ff', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#bfdbfe' },
  fileName:     { fontSize: 13, color: '#1e40af', fontWeight: '600', flex: 1 },
  removeFile:   { fontSize: 12, color: '#dc2626', fontWeight: '700' },
  label:        { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },
  input:        { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, color: '#0f172a', marginBottom: 6 },
  productRow:   { flexDirection: 'row', gap: 6, marginBottom: 4 },
  addRowText:   { fontSize: 13, color: '#1b4f72', fontWeight: '600', marginTop: 4, marginBottom: 8 },
  saveBtn:      { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
});
