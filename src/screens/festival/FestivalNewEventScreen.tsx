// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useToast } from '../../components/common/Toast';

type PriorProduct = {
  id: string;
  name: string;
  supplierName: string;
  velocityHistory: number[];
  avgVelocity: number;
  include: boolean;
  continuityFlag: 'keep' | 'review' | 'new';
  note: string;
};

type PriorEvent = {
  id: string;
  eventName: string;
  startDate: string | null;
  endDate: string | null;
  closedAt: any;
  attendance: number | null;
};

export default function FestivalNewEventScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showError, showSuccess, showInfo } = useToast();

  const [priorEvents, setPriorEvents] = useState<PriorEvent[]>([]);
  const [selectedPriorId, setSelectedPriorId] = useState<string | null>(null);
  const [priorData, setPriorData] = useState<any>(null);

  const [products, setProducts] = useState<PriorProduct[]>([]);
  const [newEventName, setNewEventName] = useState('');
  const [newAttendance, setNewAttendance] = useState('');
  const [continuityNotes, setContinuityNotes] = useState('');

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    loadPriorEvents();
  }, [venueId]);

  async function loadPriorEvents() {
    if (!venueId) return;
    try {
      const snap = await getDocs(collection(db, 'venues', venueId, 'eventHistory'));
      const events: PriorEvent[] = snap.docs.map(d => ({
        id: d.id,
        eventName: (d.data() as any).eventName || 'Unnamed event',
        startDate: (d.data() as any).startDate || null,
        endDate: (d.data() as any).endDate || null,
        closedAt: (d.data() as any).closedAt || null,
        attendance: (d.data() as any).dailyAttendance || null,
      }));
      events.sort((a, b) => {
        const ta = a.closedAt?.toMillis ? a.closedAt.toMillis() : 0;
        const tb = b.closedAt?.toMillis ? b.closedAt.toMillis() : 0;
        return tb - ta;
      });
      setPriorEvents(events);
    } catch {}
    setLoading(false);
  }

  async function loadProductsFromPrior(eventId: string) {
    if (!venueId) return;
    setLoading(true);
    try {
      const [eventSnap, productsSnap] = await Promise.all([
        getDoc(doc(db, 'venues', venueId, 'eventHistory', eventId)),
        getDocs(collection(db, 'venues', venueId, 'products')),
      ]);
      setPriorData(eventSnap.exists() ? eventSnap.data() : null);

      const prods: PriorProduct[] = productsSnap.docs.map(d => {
        const data = d.data() as any;
        const velocityHistory: number[] = data.velocityHistory || [];
        const avgVelocity = velocityHistory.length > 0
          ? velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length
          : 0;
        const continuityFlag: 'keep' | 'review' | 'new' =
          velocityHistory.length >= 2 ? 'keep'
          : velocityHistory.length === 1 ? 'review'
          : 'new';
        return {
          id: d.id,
          name: data.name || d.id,
          supplierName: data.supplierName || data.primarySupplierName || 'Unknown',
          velocityHistory,
          avgVelocity,
          include: continuityFlag !== 'new',
          continuityFlag,
          note: '',
        };
      });
      prods.sort((a, b) => b.avgVelocity - a.avgVelocity);
      setProducts(prods);
    } catch (e: any) {
      showError(e?.message || 'Could not load prior event data.');
    }
    setLoading(false);
  }

  function toggleProduct(id: string) {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, include: !p.include } : p));
  }

  async function handleCreate() {
    if (!venueId || !newEventName.trim()) {
      showInfo('Event name is required.');
      return;
    }
    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      // Write the new event/details doc with carried-forward products marked
      const carriedProducts = products.filter(p => p.include).map(p => ({
        productId: p.id,
        productName: p.name,
        continuityFlag: p.continuityFlag,
        velocityHistory: p.velocityHistory,
        avgVelocity: p.avgVelocity,
        note: p.note,
      }));

      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), {
        eventName: newEventName.trim(),
        status: 'setup',
        priorEventId: selectedPriorId || null,
        priorAttendance: priorData?.dailyAttendance || null,
        carriedProducts,
        continuityNotes: continuityNotes.trim() || null,
        setupProgress: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: false });

      showSuccess('Event created — complete the setup wizard to configure bars, suppliers, and more.');
      nav.navigate('FestivalEventSetup');
    } catch (e: any) {
      showError(e?.message || 'Could not create event.');
    } finally {
      setSaving(false);
    }
  }

  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.empty}>Festival mode is not enabled.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  // Step 1: Choose whether to carry forward from prior event
  if (step === 1) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={S.heading}>New Event</Text>
          <Text style={S.sub}>Start fresh or carry forward from a previous event.</Text>

          {priorEvents.length === 0 ? (
            <View style={S.card}>
              <Text style={S.cardTitle}>First event</Text>
              <Text style={S.body}>No prior events found. You'll start with a clean setup.</Text>
              <TouchableOpacity style={S.btn} onPress={() => setStep(4)}>
                <Text style={S.btnText}>Start setup →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={S.label}>Carry forward from a prior event?</Text>
              {priorEvents.slice(0, 5).map(ev => (
                <TouchableOpacity
                  key={ev.id}
                  style={[S.card, selectedPriorId === ev.id && S.cardSelected]}
                  onPress={() => setSelectedPriorId(ev.id === selectedPriorId ? null : ev.id)}
                >
                  <Text style={S.cardTitle}>{ev.eventName}</Text>
                  <Text style={S.meta}>
                    {ev.startDate}{ev.endDate && ev.endDate !== ev.startDate ? ` → ${ev.endDate}` : ''}
                    {ev.attendance ? ` · ${ev.attendance.toLocaleString()} daily attendance` : ''}
                  </Text>
                  {selectedPriorId === ev.id && (
                    <Text style={{ color: '#1b4f72', fontWeight: '700', fontSize: 13, marginTop: 4 }}>✓ Selected</Text>
                  )}
                </TouchableOpacity>
              ))}

              <View style={S.btnRow}>
                <TouchableOpacity
                  style={[S.btn, { flex: 1 }]}
                  onPress={() => {
                    if (selectedPriorId) {
                      loadProductsFromPrior(selectedPriorId);
                      setStep(2);
                    } else {
                      setStep(4);
                    }
                  }}
                >
                  <Text style={S.btnText}>
                    {selectedPriorId ? 'Review products →' : 'Start fresh →'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // Step 2: Year-on-year product review
  if (step === 2) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={S.heading}>Product Review</Text>
          <Text style={S.sub}>
            {products.filter(p => p.include).length} of {products.length} products selected to carry forward.
          </Text>

          {products.length === 0 && (
            <Text style={S.empty}>No products found.</Text>
          )}

          {(['keep', 'review', 'new'] as const).map(flag => {
            const group = products.filter(p => p.continuityFlag === flag);
            if (group.length === 0) return null;
            const labels = { keep: 'Proven performers (2+ events)', review: 'One event only — review', new: 'New products' };
            const colors = { keep: '#16a34a', review: '#d97706', new: '#6b7280' };
            return (
              <View key={flag}>
                <Text style={[S.groupHeading, { color: colors[flag] }]}>{labels[flag].toUpperCase()}</Text>
                {group.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[S.productRow, p.include && S.productRowSelected]}
                    onPress={() => toggleProduct(p.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={S.productName}>{p.name}</Text>
                      <Text style={S.productMeta}>
                        {p.supplierName} · avg {p.avgVelocity.toFixed(1)} units/day
                        {p.velocityHistory.length > 0 ? ` · ${p.velocityHistory.length} event${p.velocityHistory.length !== 1 ? 's' : ''} data` : ''}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 18, color: p.include ? '#1b4f72' : '#d1d5db' }}>
                      {p.include ? '✓' : '○'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}

          <TouchableOpacity style={[S.btn, { marginTop: 20 }]} onPress={() => setStep(3)}>
            <Text style={S.btnText}>Continue →</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // Step 3: Year-on-year notes
  if (step === 3) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={S.heading}>Year-on-Year Notes</Text>
          <Text style={S.sub}>What's changing compared to last time?</Text>

          <View style={S.card}>
            {priorData && (
              <View style={{ marginBottom: 12 }}>
                <Text style={S.cardTitle}>Prior event: {priorData.eventName}</Text>
                {priorData.dailyAttendance && (
                  <Text style={S.meta}>Last attendance: {priorData.dailyAttendance.toLocaleString()}/day</Text>
                )}
                {priorData.historicalNotes && (
                  <Text style={[S.meta, { marginTop: 4 }]}>{priorData.historicalNotes}</Text>
                )}
              </View>
            )}
            <Text style={S.label}>Notes on changes this year</Text>
            <Text style={S.helper}>e.g. new stage, different headliner, attendance up 20%, new bar zones</Text>
            <TextInput
              value={continuityNotes}
              onChangeText={setContinuityNotes}
              placeholder="What's different this year compared to last time..."
              placeholderTextColor="#9ca3af"
              style={[S.input, { minHeight: 100 }]}
              multiline
            />
          </View>

          <TouchableOpacity style={S.btn} onPress={() => setStep(4)}>
            <Text style={S.btnText}>Continue →</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // Step 4: New event name and attendance
  if (step === 4) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={S.heading}>New Event Details</Text>

          <View style={S.card}>
            <Text style={S.label}>Event name *</Text>
            <TextInput
              value={newEventName}
              onChangeText={setNewEventName}
              placeholder="e.g. Winery Summer Fest 2026"
              placeholderTextColor="#9ca3af"
              style={S.input}
            />

            <Text style={S.label}>Expected daily attendance</Text>
            <TextInput
              value={newAttendance}
              onChangeText={setNewAttendance}
              placeholder="e.g. 3000"
              placeholderTextColor="#9ca3af"
              style={S.input}
              keyboardType="numeric"
            />
          </View>

          <TouchableOpacity style={S.btn} onPress={() => setStep(5)}>
            <Text style={S.btnText}>Review & create →</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // Step 5: Review and confirm
  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={S.heading}>Review</Text>

        <View style={S.card}>
          <Text style={S.cardTitle}>New event</Text>
          <Text style={S.meta}>{newEventName || '(no name)'}</Text>
          {newAttendance ? <Text style={S.meta}>{parseInt(newAttendance).toLocaleString()} daily attendance</Text> : null}
        </View>

        {selectedPriorId && (
          <View style={S.card}>
            <Text style={S.cardTitle}>Carrying forward</Text>
            <Text style={S.meta}>
              {products.filter(p => p.include).length} products from prior event
            </Text>
            {continuityNotes ? <Text style={[S.meta, { marginTop: 4, fontStyle: 'italic' }]}>{continuityNotes}</Text> : null}
          </View>
        )}

        <TouchableOpacity
          style={[S.btn, saving && S.btnDisabled]}
          disabled={saving}
          onPress={handleCreate}
        >
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={S.btnText}>Create event →</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  body: { fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 4 },
  helper: { fontSize: 12, color: '#9ca3af', marginBottom: 6 },
  meta: { fontSize: 13, color: '#6b7280' },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },

  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e1d8', padding: 14, marginBottom: 12 },
  cardSelected: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 4 },

  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0f172a', marginBottom: 4,
  },

  groupHeading: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 16, marginBottom: 8 },
  productRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e1d8', padding: 12, marginBottom: 6 },
  productRowSelected: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  productName: { fontSize: 14, fontWeight: '700', color: '#0B132B', marginBottom: 2 },
  productMeta: { fontSize: 12, color: '#6b7280' },

  btn: { backgroundColor: '#1b4f72', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
});
