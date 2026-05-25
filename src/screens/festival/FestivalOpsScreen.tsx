// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgencyLabel(u: string): { icon: string; text: string; color: string } {
  if (u === 'asap')       return { icon: '⚡', text: 'ASAP',      color: '#dc2626' };
  if (u === 'next-round') return { icon: '📦', text: '30–60 min', color: '#d97706' };
  return                         { icon: '📋', text: 'Planning',   color: '#6b7280' };
}

function relTime(ts: any): string {
  if (!ts?.toDate) return '';
  const mins = Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalOpsScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();

  const [requests,  setRequests]  = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(FESTIVAL_BETA);
  const [acting,    setActing]    = useState<string | null>(null);

  // Live listeners
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }

    const unsubReq = onSnapshot(
      collection(db, 'venues', venueId, 'requests'),
      snap => {
        setRequests(snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(r => r.status !== 'cancelled' && r.status !== 'delivered')
          .sort((a, b) => {
            const order = { asap: 0, 'next-round': 1, planning: 2 };
            const ud = (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
            if (ud !== 0) return ud;
            return (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0);
          }));
        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubXfr = onSnapshot(
      collection(db, 'venues', venueId, 'transfers'),
      snap => {
        const today = new Date();
        setTransfers(snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(x => {
            if (!x.createdAt?.toDate) return false;
            const d = x.createdAt.toDate();
            return d.getFullYear() === today.getFullYear()
              && d.getMonth() === today.getMonth()
              && d.getDate() === today.getDate();
          })
          .sort((a, b) =>
            (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0)
          ));
      },
    );

    return () => { unsubReq(); unsubXfr(); };
  }, [venueId]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={O.comingSoon}>
        <Text style={O.csEmoji}>🎪</Text>
        <Text style={O.csTitle}>Festival mode</Text>
        <Text style={O.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={O.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={O.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  async function assignSource(reqId: string) {
    // Placeholder: in Phase 4 this opens a source-location picker
    Alert.alert('Assign source', 'Source location assignment coming in Phase 4.');
  }

  async function cancelRequest(reqId: string) {
    if (!venueId || acting) return;
    Alert.alert('Cancel request', 'Are you sure?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel', style: 'destructive', onPress: async () => {
          setActing(reqId);
          try {
            await updateDoc(doc(db, 'venues', venueId, 'requests', reqId), {
              status: 'cancelled',
              cancelledBy: auth.currentUser?.uid ?? 'unknown',
              updatedAt: serverTimestamp(),
            });
          } catch (e: any) {
            Alert.alert('Error', e?.message);
          } finally {
            setActing(null);
          }
        },
      },
    ]);
  }

  const pending  = requests.filter(r => r.status === 'pending');
  const accepted = requests.filter(r => r.status === 'accepted' || r.status === 'collected');
  const criticalAlerts = requests.filter(r => r.urgency === 'asap' && r.status === 'pending');

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={O.scroll}>

        <Text style={O.screenTitle}>Ops overview</Text>

        {/* Phase 4 placeholder banner */}
        <View style={O.phase4Banner}>
          <Text style={O.phase4Text}>📊 Velocity graphs — Phase 4</Text>
        </View>

        {/* Critical alerts */}
        {criticalAlerts.length > 0 && (
          <View style={O.alertBanner}>
            <Text style={O.alertBannerText}>
              ⚡ {criticalAlerts.length} ASAP request{criticalAlerts.length !== 1 ? 's' : ''} waiting
            </Text>
          </View>
        )}

        {/* Pending requests */}
        <Text style={O.sectionLabel}>PENDING REQUESTS ({pending.length})</Text>
        {pending.length === 0 ? (
          <Text style={O.emptyText}>No pending requests.</Text>
        ) : (
          pending.map(req => {
            const u = urgencyLabel(req.urgency);
            const isActing = acting === req.id;
            return (
              <View key={req.id} style={O.card}>
                <View style={O.cardTop}>
                  <View style={[O.urgencyBadge, { borderColor: u.color, backgroundColor: u.color + '18' }]}>
                    <Text style={[O.urgencyText, { color: u.color }]}>{u.icon} {u.text}</Text>
                  </View>
                  <Text style={O.timeText}>{relTime(req.createdAt)}</Text>
                </View>
                <Text style={O.cardBarName}>{req.barName}</Text>
                {(req.products || []).map((p: any) => (
                  <Text key={p.productId} style={O.productLine}>
                    • {p.productName} × {p.quantity} {p.unit}
                  </Text>
                ))}
                {req.assignedToName && (
                  <Text style={O.assignedText}>Assigned to: {req.assignedToName}</Text>
                )}
                {!!req.note && <Text style={O.noteText}>"{req.note}"</Text>}
                <View style={O.cardActions}>
                  <TouchableOpacity
                    style={[O.approveBtn, isActing && O.btnDisabled]}
                    disabled={!!acting}
                    onPress={() => assignSource(req.id)}
                  >
                    <Text style={O.approveBtnText}>Assign source</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[O.cancelBtn, isActing && O.btnDisabled]}
                    disabled={!!acting}
                    onPress={() => cancelRequest(req.id)}
                  >
                    <Text style={O.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        {/* Active tasks */}
        {accepted.length > 0 && (
          <>
            <Text style={[O.sectionLabel, { marginTop: 16 }]}>
              ACTIVE TASKS ({accepted.length})
            </Text>
            {accepted.map(req => (
              <View key={req.id} style={[O.card, O.cardActive]}>
                <Text style={O.cardBarName}>{req.barName}</Text>
                <Text style={O.assignedText}>
                  {req.status === 'collected' ? '📦 Collected —' : '🚶 In progress —'} {req.assignedToName || 'Unassigned'}
                </Text>
                {(req.products || []).map((p: any) => (
                  <Text key={p.productId} style={O.productLine}>
                    • {p.productName} × {p.quantity}
                  </Text>
                ))}
              </View>
            ))}
          </>
        )}

        {/* Recent transfers */}
        {transfers.length > 0 && (
          <>
            <Text style={[O.sectionLabel, { marginTop: 16 }]}>
              TRANSFERS TODAY ({transfers.length})
            </Text>
            {transfers.map(xfr => {
              const riskIcon = xfr.velocityCheckResult === 'safe' ? '✅'
                : xfr.velocityCheckResult === 'caution' ? '⚠️' : '🚫';
              return (
                <View key={xfr.id} style={O.transferCard}>
                  <Text style={O.transferText}>
                    {riskIcon} {xfr.quantity} × {xfr.productName}
                  </Text>
                  <Text style={O.transferSub}>
                    {xfr.fromBarName} → {xfr.toBarName}  ·  {relTime(xfr.createdAt)}
                  </Text>
                  {xfr.overrideReason && (
                    <Text style={O.overrideText}>Override: {xfr.overrideReason}</Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* Quick actions */}
        <View style={O.quickActions}>
          <TouchableOpacity style={O.quickBtn} onPress={() => nav.navigate('FestivalTransfer', {})}>
            <Text style={O.quickBtnText}>🔄 New transfer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[O.quickBtn, O.quickBtnSecondary]} onPress={() => nav.navigate('FestivalBarSelection')}>
            <Text style={[O.quickBtnText, O.quickBtnTextSecondary]}>🍺 View bars</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const O = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 16 },

  phase4Banner: { backgroundColor: '#fef9c3', borderRadius: 10, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: '#fde68a', alignItems: 'center' },
  phase4Text:   { fontSize: 13, fontWeight: '700', color: '#92400e' },

  alertBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1.5, borderColor: '#dc2626' },
  alertBannerText: { fontSize: 14, fontWeight: '800', color: '#dc2626', textAlign: 'center' },

  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },
  emptyText:    { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', marginBottom: 12 },

  card:       { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  cardActive: { borderColor: '#1b4f72', borderWidth: 1.5 },
  cardTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },

  urgencyBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  urgencyText:  { fontSize: 11, fontWeight: '700' },
  timeText:     { fontSize: 11, color: '#9ca3af' },

  cardBarName:  { fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  productLine:  { fontSize: 13, color: '#374151', lineHeight: 20 },
  assignedText: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  noteText:     { fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginTop: 4 },

  cardActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  approveBtn:  { flex: 1, backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cancelBtn:   { paddingHorizontal: 16, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  cancelBtnText:  { color: '#6b7280', fontWeight: '700', fontSize: 13 },
  btnDisabled:    { opacity: 0.5 },

  transferCard: { backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  transferText: { fontSize: 14, fontWeight: '700', color: '#0B132B' },
  transferSub:  { fontSize: 12, color: '#6b7280', marginTop: 2 },
  overrideText: { fontSize: 11, color: '#d97706', marginTop: 2, fontStyle: 'italic' },

  quickActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  quickBtn:     { flex: 1, backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  quickBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#1b4f72' },
  quickBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  quickBtnTextSecondary: { color: '#1b4f72' },
});
