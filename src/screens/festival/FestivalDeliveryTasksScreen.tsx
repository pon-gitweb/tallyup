// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp, query, where, orderBy, writeBatch, increment } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgencyLabel(u: string, c: any) {
  if (u === 'asap')       return { icon: '⚡', text: 'ASAP',       color: c.error };
  if (u === 'next-round') return { icon: '📦', text: '30–60 min',  color: c.stellarAmber };
  return                         { icon: '📋', text: 'Planning',    color: c.slateMid };
}

function relativeTime(ts: any): string {
  if (!ts?.toDate) return '';
  const diffMs = Date.now() - ts.toDate().getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function isTodayTs(ts: any): boolean {
  if (!ts?.toDate) return false;
  const d = ts.toDate();
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalDeliveryTasksScreen() {
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);

  const [requests, setRequests] = useState<any[]>([]);
  const [loading,  setLoading]  = useState(FESTIVAL_BETA);
  const [acting,   setActing]   = useState<string | null>(null);

  const uid = auth.currentUser?.uid ?? '';

  // Live listener on all non-cancelled requests
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'requests'),
      snap => {
        setRequests(snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(r => r.status !== 'cancelled')
          .sort((a, b) => {
            // Sort: ASAP first, then by createdAt desc
            const urgencyOrder = { asap: 0, 'next-round': 1, planning: 2 };
            const uDiff = (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3);
            if (uDiff !== 0) return uDiff;
            const aTs = a.createdAt?.toDate?.()?.getTime() ?? 0;
            const bTs = b.createdAt?.toDate?.()?.getTime() ?? 0;
            return bTs - aTs;
          }));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venueId]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.comingSoon}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.comingSoon}>
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  // ── Categorise requests ───────────────────────────────────────────────────
  const pending   = requests.filter(r => r.status === 'pending');
  const myActive  = requests.filter(r => r.status === 'accepted' && r.assignedTo === uid);
  const collected = requests.filter(r => r.status === 'collected' && r.assignedTo === uid);
  const completedToday = requests.filter(r => r.status === 'delivered' && isTodayTs(r.completedAt));

  const activeCount = pending.length + myActive.length + collected.length;

  // ── Actions ───────────────────────────────────────────────────────────────
  async function acceptTask(reqId: string) {
    if (!venueId || acting) return;
    setActing(reqId);
    try {
      await updateDoc(doc(db, 'venues', venueId, 'requests', reqId), {
        status: 'accepted',
        assignedTo: uid,
        assignedToName: auth.currentUser?.displayName ?? 'Unknown',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      showError(e?.message || 'Could not accept task.');
    } finally {
      setActing(null);
    }
  }

  async function markCollected(reqId: string) {
    if (!venueId || acting) return;
    setActing(reqId);
    try {
      await updateDoc(doc(db, 'venues', venueId, 'requests', reqId), {
        status: 'collected',
        collectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      showError(e?.message || 'Could not update task.');
    } finally {
      setActing(null);
    }
  }

  async function doMarkDelivered(reqId: string) {
    if (!venueId || acting) return;
    const req = requests.find(r => r.id === reqId);
    setActing(reqId);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'venues', venueId, 'requests', reqId), {
        status: 'delivered', completedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      const now = serverTimestamp();
      if (req?.barId && Array.isArray(req.products)) {
        for (const p of req.products) {
          if (!p.productId) continue;
          batch.set(
            doc(db, 'venues', venueId, 'departments', req.barId, 'areas', 'back-of-house', 'items', p.productId),
            { lastCount: increment(p.quantity ?? 0), lastCountAt: now, updatedAt: now },
            { merge: true },
          );
          if (req.sourceLocationId) {
            batch.set(
              doc(db, 'venues', venueId, 'departments', 'hq', 'areas', req.sourceLocationId, 'items', p.productId),
              { lastCount: increment(-(p.quantity ?? 0)), updatedAt: now },
              { merge: true },
            );
          }
        }
      }
      await batch.commit();
      showSuccess('✓ Delivery marked as completed');
    } catch (e: any) {
      showError(e?.message || 'Could not update task.');
    } finally {
      setActing(null);
    }
  }

  function markDelivered(reqId: string) {
    if (!venueId || acting) return;
    confirm({
      title: 'Mark as delivered?',
      message: 'This will update stock levels at the bar and HQ.',
      confirmLabel: 'Mark delivered',
      onConfirm: () => doMarkDelivered(reqId),
    });
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderPendingCard(req: any) {
    const u = urgencyLabel(req.urgency, c);
    const isActing = acting === req.id;
    return (
      <View key={req.id} style={S.card}>
        <View style={S.cardTop}>
          <View style={[S.urgencyBadge, { borderColor: u.color, backgroundColor: u.color + '18' }]}>
            <Text style={[S.urgencyText, { color: u.color }]}>{u.icon} {u.text}</Text>
          </View>
          <Text style={S.timeAgo}>{relativeTime(req.createdAt)}</Text>
        </View>
        <Text style={S.cardBarName}>{req.barName}</Text>
        {(req.products || []).map((p: any) => (
          <Text key={p.productId} style={S.productLine}>
            • {p.productName} × {p.quantity} {p.unit}
          </Text>
        ))}
        {!!req.note && <Text style={S.noteText}>"{req.note}"</Text>}
        <TouchableOpacity
          style={[S.acceptBtn, isActing && S.btnDisabled]}
          disabled={!!acting}
          onPress={() => acceptTask(req.id)}
        >
          {isActing
            ? <ActivityIndicator color={c.surface} size="small" />
            : <Text style={S.acceptBtnText}>Accept task</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  function renderActiveCard(req: any) {
    const isCollected = req.status === 'collected';
    const isActing = acting === req.id;
    const u = urgencyLabel(req.urgency, c);
    return (
      <View key={req.id} style={[S.card, S.cardActive]}>
        <View style={S.cardTop}>
          <Text style={S.activeTitle}>TOP-UP TASK — {isCollected ? 'COLLECTED' : 'ACCEPTED'}</Text>
          <View style={[S.urgencyBadge, { borderColor: u.color, backgroundColor: u.color + '18' }]}>
            <Text style={[S.urgencyText, { color: u.color }]}>{u.icon} {u.text}</Text>
          </View>
        </View>

        <Text style={S.activeSection}>COLLECT FROM:</Text>
        {req.sourceLocationId ? (
          <Text style={S.activeLocationText}>📍 {req.sourceLocationId}</Text>
        ) : (
          <Text style={S.activeLocationNote}>Source location not yet assigned by ops</Text>
        )}

        <Text style={[S.activeSection, { marginTop: 10 }]}>ITEMS:</Text>
        {(req.products || []).map((p: any) => (
          <Text key={p.productId} style={S.productLine}>
            • {p.productName} × {p.quantity} {p.unit}
          </Text>
        ))}

        <Text style={[S.activeSection, { marginTop: 10 }]}>DELIVER TO:</Text>
        <Text style={S.activeLocationText}>📍 {req.barName}</Text>
        {!!req.note && <Text style={S.noteText}>Note: "{req.note}"</Text>}

        <TouchableOpacity
          style={[
            S.acceptBtn,
            isCollected ? S.deliverBtn : S.collectBtn,
            isActing && S.btnDisabled,
          ]}
          disabled={!!acting}
          onPress={() => isCollected ? markDelivered(req.id) : markCollected(req.id)}
        >
          {isActing
            ? <ActivityIndicator color={c.surface} size="small" />
            : <Text style={S.acceptBtnText}>
                {isCollected ? 'Mark delivered ✓' : 'Mark collected →'}
              </Text>}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={S.scroll}>

        {/* Header */}
        <View style={S.headerRow}>
          <Text style={S.screenTitle}>Delivery tasks</Text>
          {activeCount > 0 && (
            <View style={S.countBadge}>
              <Text style={S.countBadgeText}>{activeCount}</Text>
            </View>
          )}
        </View>

        {/* My active tasks */}
        {(myActive.length > 0 || collected.length > 0) && (
          <>
            <Text style={S.sectionLabel}>MY ACTIVE TASKS</Text>
            {[...myActive, ...collected].map(renderActiveCard)}
          </>
        )}

        {/* Pending tasks */}
        <Text style={S.sectionLabel}>
          PENDING TASKS{pending.length > 0 ? ` (${pending.length})` : ''}
        </Text>
        {pending.length === 0
          ? <Text style={S.emptyText}>No pending tasks right now.</Text>
          : pending.map(renderPendingCard)}

        {/* Completed today */}
        {completedToday.length > 0 && (
          <>
            <Text style={[S.sectionLabel, { marginTop: 16 }]}>
              COMPLETED TODAY ({completedToday.length})
            </Text>
            {completedToday.map(req => (
              <View key={req.id} style={[S.card, S.cardCompleted]}>
                <Text style={S.cardBarName}>{req.barName}</Text>
                {(req.products || []).map((p: any) => (
                  <Text key={p.productId} style={S.productLine}>
                    ✓ {p.productName} × {p.quantity}
                  </Text>
                ))}
                <Text style={S.timeAgo}>
                  {req.completedAt?.toDate
                    ? `Delivered at ${req.completedAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </Text>
              </View>
            ))}
          </>
        )}

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

    headerRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
    screenTitle: { fontSize: 22, fontWeight: '800', color: c.navy },
    countBadge:  { backgroundColor: c.error, borderRadius: 999, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    countBadgeText: { color: c.surface, fontWeight: '800', fontSize: 12 },

    sectionLabel: { fontSize: 11, fontWeight: '800', color: c.slateMid, letterSpacing: 1, marginBottom: 8 },
    emptyText:   { fontSize: 14, color: c.slateMid, marginBottom: 16, fontStyle: 'italic' },

    card:          { backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    cardActive:    { borderColor: c.deepBlue, borderWidth: 2 },
    cardCompleted: { opacity: 0.7 },
    cardTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },

    urgencyBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
    urgencyText:  { fontSize: 11, fontWeight: '700' },
    timeAgo:      { fontSize: 11, color: c.slateMid },

    cardBarName:  { fontSize: 16, fontWeight: '800', color: c.navy, marginBottom: 4 },
    productLine:  { fontSize: 13, color: c.text, lineHeight: 20 },
    noteText:     { fontSize: 12, color: c.slateMid, fontStyle: 'italic', marginTop: 4 },

    activeTitle:       { fontSize: 11, fontWeight: '800', color: c.deepBlue, letterSpacing: 0.5 },
    activeSection:     { fontSize: 11, fontWeight: '800', color: c.slateMid, letterSpacing: 0.5, marginBottom: 4 },
    activeLocationText:{ fontSize: 14, fontWeight: '600', color: c.navy },
    activeLocationNote:{ fontSize: 13, color: c.slateMid, fontStyle: 'italic' },

    acceptBtn:    { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
    collectBtn:   { backgroundColor: c.deepBlue },
    deliverBtn:   { backgroundColor: c.success },
    btnDisabled:  { opacity: 0.5 },
    acceptBtnText:{ color: c.surface, fontWeight: '700', fontSize: 14 },
  });
}
