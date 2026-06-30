// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { doc, onSnapshot, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalRiderDetailScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;
  const { riderId } = route.params || {};

  const [rider,      setRider]      = useState<any>(null);
  const [checked,    setChecked]    = useState<Record<string, boolean>>({});
  const [loading,    setLoading]    = useState(FESTIVAL_BETA);
  const [marking,    setMarking]    = useState(false);
  const [generating, setGenerating] = useState(false);
  const { showError, showSuccess } = useToast();
  const { confirm, modal } = useConfirmModal();

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !riderId) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'riders', riderId), snap => {
      setRider(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [venueId, riderId]);

  useEffect(() => {
    if (rider?.checkedItems) setChecked(rider.checkedItems);
  }, [rider?.id]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={D.comingSoon}>
        <Text style={D.csEmoji}>🎪</Text>
        <Text style={D.csTitle}>Festival mode</Text>
        <Text style={D.csBody}>Coming soon — we'll let you know when it's live.</Text>
        <Text style={D.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return <View style={D.comingSoon}><ActivityIndicator color="#1b4f72" size="large" /></View>;
  }

  if (!rider) {
    return (
      <View style={D.comingSoon}>
        <Text style={D.csTitle}>Rider not found</Text>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={D.back}>← Back</Text></TouchableOpacity>
      </View>
    );
  }

  async function toggleCheck(key: string) {
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    if (!venueId || !riderId) return;
    try {
      await updateDoc(doc(db, 'venues', venueId, 'riders', riderId), {
        checkedItems: next, updatedAt: serverTimestamp(),
      });
    } catch (_) {}
  }

  function itemKey(area: string, idx: number) {
    return `${area}_${idx}`;
  }

  async function markDelivered() {
    if (!venueId || marking) return;
    confirm({
      title: 'Mark as delivered?',
      message: 'This will record the rider as fully delivered.',
      confirmLabel: 'Mark delivered',
      onConfirm: async () => {
        setMarking(true);
        try {
          await updateDoc(doc(db, 'venues', venueId, 'riders', riderId), {
            status:      'delivered',
            deliveredBy: uid ?? 'unknown',
            deliveredAt: serverTimestamp(),
            updatedAt:   serverTimestamp(),
          });
          nav.goBack();
        } catch (e: any) {
          showError(e?.message || 'Could not mark as delivered.');
        } finally {
          setMarking(false);
        }
      },
    });
  }

  async function generateDeliveryTask() {
    if (!venueId || generating) return;
    setGenerating(true);
    try {
      const reqId = `rider_req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const allItems = [
        ...(rider.dressingRoom || []).map((i: any) => ({
          productId:   `rider_${i.product.toLowerCase().replace(/\s+/g, '_')}`,
          productName: i.product,
          quantity:    i.quantity,
          unit:        i.unit,
        })),
        ...(rider.stageArea || []).map((i: any) => ({
          productId:   `rider_${i.product.toLowerCase().replace(/\s+/g, '_')}`,
          productName: i.product,
          quantity:    i.quantity,
          unit:        i.unit,
        })),
      ];

      await setDoc(doc(db, 'venues', venueId, 'requests', reqId), {
        type:            'rider',
        riderId:         riderId,
        barName:         rider.deliveryLocation || 'Rider delivery',
        barId:           null,
        artistName:      rider.artistName,
        setTime:         rider.setTime || null,
        deliveryTime:    rider.deliveryTime || null,
        deliveryLocation:rider.deliveryLocation || null,
        products:        allItems,
        urgency:         rider.deliveryTime ? 'next-round' : 'planning',
        status:          'pending',
        note:            `Rider delivery for ${rider.artistName}${rider.deliveryLocation ? ` — ${rider.deliveryLocation}` : ''}.`,
        stockSource:     'central',
        excludeFromReconciliation: true,
        createdBy:       uid ?? 'unknown',
        createdAt:       serverTimestamp(),
      });

      showSuccess('Delivery task added to the task queue. Rider stock will be drawn from central store.');
    } catch (e: any) {
      showError(e?.message || 'Could not create delivery task.');
    } finally {
      setGenerating(false);
    }
  }

  const dressingRoom: any[] = rider.dressingRoom || [];
  const stageArea: any[] = rider.stageArea || [];
  const allDressingChecked = dressingRoom.length > 0 && dressingRoom.every((_, i) => checked[itemKey('dr', i)]);
  const allStageChecked    = stageArea.length > 0    && stageArea.every((_, i) => checked[itemKey('st', i)]);
  const isDelivered = rider.status === 'delivered';

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={D.scroll}>

        {/* Header */}
        <View style={D.headerCard}>
          <Text style={D.artistName}>{rider.artistName || 'Rider'}</Text>
          {rider.setTime && (
            <View style={D.infoRow}>
              <Text style={D.infoLabel}>Set time:</Text>
              <Text style={D.infoValue}>{rider.setTime}</Text>
            </View>
          )}
          {rider.deliveryTime && (
            <View style={D.infoRow}>
              <Text style={D.infoLabel}>Deliver by:</Text>
              <Text style={[D.infoValue, { color: '#d97706', fontWeight: '700' }]}>{rider.deliveryTime}</Text>
            </View>
          )}
          {rider.deliveryLocation && (
            <View style={D.infoRow}>
              <Text style={D.infoLabel}>Deliver to:</Text>
              <Text style={D.infoValue}>{rider.deliveryLocation}</Text>
            </View>
          )}
          {isDelivered && (
            <View style={D.deliveredBadge}>
              <Text style={D.deliveredText}>✓ Delivered</Text>
            </View>
          )}
        </View>

        {/* Dressing room */}
        {dressingRoom.length > 0 && (
          <>
            <Text style={D.sectionLabel}>DRESSING ROOM</Text>
            {dressingRoom.map((item, i) => {
              const key = itemKey('dr', i);
              return (
                <TouchableOpacity
                  key={i}
                  style={[D.checkItem, checked[key] && D.checkItemDone]}
                  onPress={() => !isDelivered && toggleCheck(key)}
                >
                  <Text style={[D.checkbox, checked[key] && D.checkboxDone]}>{checked[key] ? '☑' : '☐'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[D.itemText, checked[key] && D.itemTextDone]}>
                      {item.product} × {item.quantity} {item.unit}{item.temperature ? ` (${item.temperature})` : ''}
                    </Text>
                    {item.notes && <Text style={D.itemNotes}>{item.notes}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* Stage area */}
        {stageArea.length > 0 && (
          <>
            <Text style={[D.sectionLabel, { marginTop: 16 }]}>STAGE AREA</Text>
            {stageArea.map((item, i) => {
              const key = itemKey('st', i);
              return (
                <TouchableOpacity
                  key={i}
                  style={[D.checkItem, checked[key] && D.checkItemDone]}
                  onPress={() => !isDelivered && toggleCheck(key)}
                >
                  <Text style={[D.checkbox, checked[key] && D.checkboxDone]}>{checked[key] ? '☑' : '☐'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[D.itemText, checked[key] && D.itemTextDone]}>
                      {item.product} × {item.quantity} {item.unit}
                    </Text>
                    {item.notes && <Text style={D.itemNotes}>{item.notes}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {rider.specialRequests && (
          <View style={D.specialCard}>
            <Text style={D.specialTitle}>Special requests</Text>
            <Text style={D.specialText}>{rider.specialRequests}</Text>
          </View>
        )}

        {/* Stock note */}
        <View style={D.noteCard}>
          <Text style={D.noteText}>
            Rider stock drawn from central store. Excluded from bar variance calculations.
          </Text>
        </View>

        {/* Actions */}
        {!isDelivered && (
          <>
            <TouchableOpacity
              style={[D.primaryBtn, generating && D.btnDisabled]}
              disabled={generating}
              onPress={generateDeliveryTask}
            >
              {generating
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={D.primaryBtnText}>Generate delivery task</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[D.secondaryBtn, marking && D.btnDisabled]}
              disabled={marking}
              onPress={markDelivered}
            >
              {marking
                ? <ActivityIndicator color="#1b4f72" size="small" />
                : <Text style={D.secondaryBtnText}>Mark as delivered</Text>}
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
      {modal}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const D = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center' },
  back:       { fontSize: 14, color: '#1b4f72', fontWeight: '700', marginTop: 16 },

  scroll:       { padding: 16, paddingBottom: 40 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },

  headerCard:    { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e5e1d8' },
  artistName:    { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 10 },
  infoRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  infoLabel:     { fontSize: 13, color: '#9ca3af', width: 80 },
  infoValue:     { fontSize: 13, color: '#374151', fontWeight: '600', flex: 1 },
  deliveredBadge:{ backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 8 },
  deliveredText: { fontSize: 12, fontWeight: '800', color: '#16a34a' },

  checkItem:     { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e5e1d8', gap: 10 },
  checkItemDone: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  checkbox:      { fontSize: 18, color: '#9ca3af' },
  checkboxDone:  { color: '#16a34a' },
  itemText:      { fontSize: 14, fontWeight: '600', color: '#0B132B' },
  itemTextDone:  { color: '#9ca3af', textDecorationLine: 'line-through' },
  itemNotes:     { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  specialCard:  { backgroundColor: '#fef9c3', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#fde68a' },
  specialTitle: { fontSize: 12, fontWeight: '800', color: '#92400e', marginBottom: 4 },
  specialText:  { fontSize: 13, color: '#374151' },

  noteCard:     { backgroundColor: '#f3f4f6', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  noteText:     { fontSize: 12, color: '#6b7280', fontStyle: 'italic' },

  primaryBtn:         { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  primaryBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn:       { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  secondaryBtnText:   { color: '#1b4f72', fontWeight: '700', fontSize: 15 },
  btnDisabled:        { opacity: 0.5 },
});
