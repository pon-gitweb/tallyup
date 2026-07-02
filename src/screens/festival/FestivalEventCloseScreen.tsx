// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  collection, getDocs, doc, onSnapshot, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckItem = {
  key: string;
  label: string;
  description: string;
  done: boolean;
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalEventCloseScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;

  const [event,   setEvent]   = useState<any>(null);
  const [role,    setRole]    = useState<string | null>(null);
  const [checks,  setChecks]  = useState<CheckItem[]>([
    { key: 'barsCounted',     label: 'All bars counted',           description: 'End-of-event stock count complete for every bar', done: false },
    { key: 'photosAdded',     label: 'Photo evidence captured',    description: 'Remaining stock photographed per product',        done: false },
    { key: 'packingSlips',    label: 'Packing slips generated',    description: 'PDF packing slips created for each supplier',     done: false },
    { key: 'emailsSent',      label: 'Return emails prepared',     description: 'Return advice sent to all suppliers',             done: false },
    { key: 'chepReconciled',  label: 'CHEP pallets reconciled',    description: 'CHEP pallet counts balanced or discrepancy noted',done: false },
    { key: 'reconciled',      label: 'Reconciliation complete',    description: 'Financial reconciliation report saved',           done: false },
  ]);
  const [loading,  setLoading]  = useState(FESTIVAL_BETA);
  const [closing,  setClosing]  = useState(false);
  const { showSuccess, showError } = useToast();
  const { confirm, modal } = useConfirmModal();

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

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }

    if (uid) {
      onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
        setRole(snap.exists() ? (snap.data() as any).role ?? null : null);
      });
    }

    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), async snap => {
      const ev = snap.exists() ? snap.data() : null;
      setEvent(ev);
      await deriveChecks(ev);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [venueId]);

  async function deriveChecks(ev: any) {
    if (!venueId) return;
    try {
      // 1. All bars counted
      const [barsSnap, barCountsSnap] = await Promise.all([
        getDocs(collection(db, 'venues', venueId, 'bars')),
        getDocs(collection(db, 'venues', venueId, 'returns', 'eventClose', 'barCounts')),
      ]);
      const barsCounted = barsSnap.docs.length > 0 &&
        barsSnap.docs.every(b => barCountsSnap.docs.some(bc => bc.id === b.id));

      // 2. Photos added
      const photosSnap = await getDocs(
        collection(db, 'venues', venueId, 'returns', 'eventReturn', 'photos')
      );
      const photosAdded = photosSnap.docs.length > 0;

      // 3. CHEP reconciled (any chep_ doc present)
      const returnsSnap = await getDocs(collection(db, 'venues', venueId, 'returns'));
      const chepReconciled = returnsSnap.docs.some(d => d.id.startsWith('chep_'));

      // 4. Reconciliation saved
      const reconDoc = returnsSnap.docs.find(d => d.id === 'eventReconciliation');
      const reconciled = !!reconDoc;

      setChecks(prev => prev.map(c => {
        switch (c.key) {
          case 'barsCounted':    return { ...c, done: barsCounted };
          case 'photosAdded':    return { ...c, done: photosAdded };
          case 'chepReconciled': return { ...c, done: chepReconciled };
          case 'reconciled':     return { ...c, done: reconciled };
          // packingSlips + emailsSent are manual confirmations
          default: return c;
        }
      }));
    } catch (e: any) {
      console.log('[EventClose] deriveChecks error', e?.message);
    }
  }

  function toggleManual(key: string) {
    setChecks(prev => prev.map(c => c.key === key ? { ...c, done: !c.done } : c));
  }

  async function confirmClose() {
    const incomplete = checks.filter(c => !c.done);
    if (incomplete.length > 0) {
      confirm({
        title: 'Incomplete checklist',
        message: `${incomplete.length} item${incomplete.length !== 1 ? 's' : ''} not confirmed. You can still close, but unresolved items may cause issues.\n\nClose anyway?`,
        confirmLabel: 'Close anyway',
        destructive: true,
        onConfirm: doClose,
      });
      return;
    }
    confirm({
      title: 'Close this event?',
      message: 'This marks the event as closed and archives it to history. You can still view it but not reopen it.',
      confirmLabel: 'Close event',
      destructive: true,
      onConfirm: doClose,
    });
  }

  async function doClose() {
    if (!venueId || !event || closing) return;
    setClosing(true);
    try {
      const eventId = `${(event.eventName || 'event').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_${Date.now()}`;

      // Capture actual consumption across all sessions for year-on-year reference
      let actualsPerProduct: Record<string, { name: string; consumed: number; unit: string | null }> = {};
      try {
        const sessionsSnap = await getDocs(collection(db, 'venues', venueId, 'sessions'));
        for (const sessDoc of sessionsSnap.docs) {
          const sess = sessDoc.data() as any;
          for (const count of (sess.counts || [])) {
            const { productId, productName, openingCount, actualCount, receivedQty, unit } = count;
            if (!productId) continue;
            const consumed = Math.max(0, (openingCount ?? 0) + (receivedQty ?? 0) - (actualCount ?? 0));
            if (!actualsPerProduct[productId]) {
              actualsPerProduct[productId] = { name: productName || productId, consumed: 0, unit: unit || null };
            }
            actualsPerProduct[productId].consumed += consumed;
          }
        }
      } catch (e: any) {
        console.log('[eventClose] actuals capture error:', e?.message);
      }

      // Compute eventDays from startDate/endDate if available
      let eventDays: number | null = null;
      if (event.startDate && event.endDate) {
        try {
          const [ds, ms, ys] = event.startDate.split('/').map(Number);
          const [de, me, ye] = event.endDate.split('/').map(Number);
          const diff = new Date(ye, me - 1, de).getTime() - new Date(ys, ms - 1, ds).getTime();
          eventDays = Math.max(1, Math.round(diff / 86400000) + 1);
        } catch {}
      }

      const closedPayload = {
        ...event,
        status:              'closed',
        closedAt:            serverTimestamp(),
        closedBy:            uid ?? 'unknown',
        actualsPerProduct,
        dailyAttendance:     event.dailyAttendance ?? null,
        eventDays:           event.eventDays ?? eventDays,
      };

      // Update current event
      await updateDoc(doc(db, 'venues', venueId, 'event', 'details'), {
        status:   'closed',
        closedAt: serverTimestamp(),
        closedBy: uid ?? 'unknown',
      });

      // Archive to eventHistory
      await setDoc(doc(db, 'venues', venueId, 'eventHistory', eventId), closedPayload);

      showSuccess('Event closed and archived to history.');
      nav.navigate('FestivalDashboard');
    } catch (e: any) {
      showError(e?.message || 'Could not close event.');
    } finally {
      setClosing(false);
    }
  }

  if (loading) return <View style={S.center}><ActivityIndicator color="#1b4f72" size="large" /></View>;

  if (role !== 'owner') {
    return (
      <View style={S.center}>
        <Text style={S.csTitle}>Owner only</Text>
        <Text style={S.csBody}>Only the venue owner can close an event.</Text>
      </View>
    );
  }

  if (event?.status === 'closed') {
    return (
      <View style={S.center}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>✓</Text>
        <Text style={S.csTitle}>Event already closed</Text>
        <Text style={S.csBody}>{event.eventName || 'This event'} has been closed and archived.</Text>
        <TouchableOpacity style={S.primaryBtn} onPress={() => nav.navigate('FestivalEventHistory')}>
          <Text style={S.primaryBtnText}>View event history</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const doneCount = checks.filter(c => c.done).length;
  const allDone   = doneCount === checks.length;

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.screenTitle}>Close event</Text>
        {event?.eventName && <Text style={S.sub}>{event.eventName}</Text>}

        <Text style={S.sectionHeading}>PRE-CLOSE CHECKLIST · {doneCount}/{checks.length}</Text>

        {checks.map(item => {
          const isManual = item.key === 'packingSlips' || item.key === 'emailsSent';
          return (
            <TouchableOpacity
              key={item.key}
              style={[S.checkCard, item.done && S.checkCardDone]}
              activeOpacity={isManual ? 0.7 : 1}
              onPress={() => isManual && toggleManual(item.key)}
            >
              <Text style={[S.checkDot, item.done && S.checkDotDone]}>
                {item.done ? '●' : '○'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[S.checkLabel, item.done && S.checkLabelDone]}>{item.label}</Text>
                <Text style={S.checkDesc}>{item.description}</Text>
                {isManual && !item.done && (
                  <Text style={S.tapToConfirm}>Tap to confirm</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {!allDone && (
          <View style={S.warningCard}>
            <Text style={S.warningText}>
              {checks.length - doneCount} item{checks.length - doneCount !== 1 ? 's' : ''} not yet complete. You can still close, but it's recommended to complete all steps first.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[S.closeBtn, closing && S.btnDisabled]}
          disabled={closing}
          onPress={confirmClose}
        >
          {closing
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={S.closeBtnText}>🔒 Close this event</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={[S.secondaryBtn, { marginTop: 10 }]} onPress={() => nav.goBack()}>
          <Text style={S.secondaryBtnText}>Cancel</Text>
        </TouchableOpacity>

      </ScrollView>
      {modal}
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

  scroll:          { padding: 16, paddingBottom: 40 },
  screenTitle:     { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub:             { fontSize: 14, color: '#6b7280', marginBottom: 20 },
  sectionHeading:  { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 10 },

  checkCard:      { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e5e1d8', gap: 12 },
  checkCardDone:  { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  checkDot:       { fontSize: 18, color: '#d1d5db', marginTop: 1 },
  checkDotDone:   { color: '#16a34a' },
  checkLabel:     { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 2 },
  checkLabelDone: { color: '#16a34a' },
  checkDesc:      { fontSize: 12, color: '#6b7280' },
  tapToConfirm:   { fontSize: 11, color: '#9ca3af', marginTop: 4, fontStyle: 'italic' },

  warningCard:  { backgroundColor: '#fef9c3', borderRadius: 10, padding: 12, marginTop: 4, marginBottom: 12 },
  warningText:  { fontSize: 13, color: '#92400e', lineHeight: 18 },

  closeBtn:     { backgroundColor: '#dc2626', borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  closeBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  primaryBtn:     { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn:   { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  secondaryBtnText:{ color: '#1b4f72', fontWeight: '700', fontSize: 14 },
  btnDisabled:    { opacity: 0.5 },
});
