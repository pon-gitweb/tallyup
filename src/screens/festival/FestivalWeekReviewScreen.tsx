// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { apiBase } from '../../services/apiBase';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

export default function FestivalWeekReviewScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { weekNumber } = route.params ?? {};
  const venueId = useVenueId();

  const [snapshot, setSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const uid = auth.currentUser?.uid;
  const { showError, showSuccess } = useToast();
  const { confirm, modal } = useConfirmModal();

  useEffect(() => {
    if (!venueId || !weekNumber) { setLoading(false); return; }
    let unsubMembers: (() => void) | null = null;
    if (uid) {
      unsubMembers = onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
        setRole(snap.exists() ? (snap.data() as any).role ?? null : null);
      });
    }
    getDoc(doc(db, 'venues', venueId, 'event', 'details', 'weeklySnapshots', `week-${weekNumber}`))
      .then(snap => {
        setSnapshot(snap.exists() ? snap.data() : null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { unsubMembers?.(); };
  }, [venueId, weekNumber]);

  function handleCloseWeek() {
    if (!venueId || !weekNumber) return;
    confirm({
      title: `Close Week ${weekNumber}`,
      message: 'This will mark Week ' + weekNumber + ' as closed and snapshot the current state. Continue?',
      confirmLabel: 'Close Week',
      destructive: true,
      onConfirm: async () => {
        setClosing(true);
        try {
          const token = await auth.currentUser?.getIdToken();
          const res = await fetch(`${apiBase()}/closeEventWeek`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ venueId, weekNumber }),
          });
          const data = await res.json();
          if (data.ok) {
            showSuccess(`Week ${weekNumber} has been closed.`);
            nav.goBack();
          } else {
            showError(data.error || 'Could not close week.');
          }
        } catch (e: any) {
          showError(e?.message || 'Could not close week.');
        } finally {
          setClosing(false);
        }
      },
    });
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

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={S.heading}>Week {weekNumber} Review</Text>

        {!snapshot ? (
          <View style={S.card}>
            <Text style={S.empty}>No snapshot data for Week {weekNumber} yet.</Text>
            <Text style={S.hint}>Write a snapshot first from the dashboard.</Text>
          </View>
        ) : (
          <>
            <View style={S.card}>
              <Text style={S.cardTitle}>Period</Text>
              <Text style={S.meta}>
                {new Date(snapshot.weekStart).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                {' → '}
                {new Date(snapshot.weekEnd).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
              </Text>
            </View>

            <View style={S.card}>
              <Text style={S.cardTitle}>Activity</Text>
              <View style={S.statRow}>
                <StatBox label="Sessions" value={snapshot.sessionCount ?? 0} />
                <StatBox label="Transfers" value={snapshot.transferCount ?? 0} />
                <StatBox label="Requests" value={snapshot.requestCount ?? 0} />
              </View>
            </View>

            {Object.keys(snapshot.soldTotals || {}).length > 0 && (
              <View style={S.card}>
                <Text style={S.cardTitle}>Units sold this week</Text>
                {Object.entries(snapshot.soldTotals).map(([pid, info]: [string, any]) => (
                  <View key={pid} style={S.lineRow}>
                    <Text style={S.lineName}>{info.name}</Text>
                    <Text style={S.lineVal}>{info.sold}</Text>
                  </View>
                ))}
              </View>
            )}

            {Object.keys(snapshot.barStockAtClose || {}).length > 0 && (
              <View style={S.card}>
                <Text style={S.cardTitle}>Stock at close of week</Text>
                {Object.entries(snapshot.barStockAtClose)
                  .sort((a: any, b: any) => b[1].total - a[1].total)
                  .map(([pid, info]: [string, any]) => (
                    <View key={pid} style={S.lineRow}>
                      <Text style={S.lineName}>{info.name}</Text>
                      <Text style={[S.lineVal, info.total <= 0 && S.lineValZero]}>{info.total}</Text>
                    </View>
                  ))}
              </View>
            )}

            {Object.keys(snapshot.wastageTotals || {}).length > 0 && (
              <View style={S.card}>
                <Text style={S.cardTitle}>Wastage this week</Text>
                {Object.entries(snapshot.wastageTotals).map(([pid, qty]: [string, any]) => (
                  <View key={pid} style={S.lineRow}>
                    <Text style={S.lineName}>{pid}</Text>
                    <Text style={[S.lineVal, { color: '#dc2626' }]}>{qty}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {(role === 'owner' || role === 'manager') && (
          <TouchableOpacity
            style={[S.btn, closing && S.btnDisabled]}
            disabled={closing}
            onPress={handleCloseWeek}
          >
            {closing
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={S.btnText}>Close Week {weekNumber} →</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
      {modal}
    </View>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#0B132B' }}>{value}</Text>
      <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e1d8', padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 12, fontWeight: '800', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  meta: { fontSize: 14, color: '#374151' },
  statRow: { flexDirection: 'row', gap: 8 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#f0ede8' },
  lineName: { fontSize: 13, color: '#374151', flex: 1 },
  lineVal: { fontSize: 14, fontWeight: '700', color: '#0B132B' },
  lineValZero: { color: '#d1d5db' },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },
  hint: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 6 },
  btn: { backgroundColor: '#1b4f72', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});
