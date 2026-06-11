// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDocs, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type Bar = {
  id: string;
  name: string;
  location: string;
  hasLowStock?: boolean;
  lastCountAt?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCountTime(iso: string | null | undefined): string {
  if (!iso) return 'Not yet counted';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `Last count: ${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `Last count: ${diffHrs}h ago`;
  return `Last count: ${d.toLocaleDateString()}`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalBarSelectionScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);

  const [event,   setEvent]   = useState<any>(null);
  const [bars,    setBars]    = useState<Bar[]>([]);
  const [loading, setLoading] = useState(FESTIVAL_BETA);
  const [role,    setRole]    = useState<string>('staff');

  // Load role
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
      if (snap.exists()) setRole((snap.data() as any).role || 'staff');
    });
    return () => unsub();
  }, [venueId]);

  // Load event details
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      setEvent(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [venueId]);

  // Load bars from departments filtered by isFestivalBar
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    const unsub = onSnapshot(collection(db, 'venues', venueId, 'departments'), snap => {
      const barDepts = snap.docs.filter(d => (d.data() as any).isFestivalBar === true);
      Promise.all(barDepts.map(async d => {
        const data = d.data() as any;
        let lastCountAt: string | null = null;
        let hasLowStock = false;
        try {
          const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas', 'back-of-house', 'items'));
          for (const s of itemsSnap.docs) {
            const sd = s.data() as any;
            if (sd.lastCountAt?.toDate) {
              const t = sd.lastCountAt.toDate().toISOString();
              if (!lastCountAt || t > lastCountAt) lastCountAt = t;
            }
          }
        } catch (_) {}
        return { id: d.id, name: data.name || d.id, location: data.location || '', lastCountAt, hasLowStock };
      })).then(barList => { setBars(barList); setLoading(false); }).catch(() => setLoading(false));
    }, () => setLoading(false));
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

  const isOpsManager = role === 'owner' || role === 'manager';

  // ── Day calculation ───────────────────────────────────────────────────────
  let dayLabel = '';
  if (event?.startDate && event?.endDate) {
    try {
      const [sd, sm, sy] = event.startDate.split('/').map(Number);
      const start = new Date(sy, sm - 1, sd);
      const today = new Date();
      const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
      const [ed, em, ey] = event.endDate.split('/').map(Number);
      const end = new Date(ey, em - 1, ed);
      const totalDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      if (diffDays >= 1 && diffDays <= totalDays) {
        dayLabel = `Day ${diffDays} of ${totalDays}`;
      }
    } catch (_) {}
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={S.scroll}>

        {/* Event header */}
        <View style={S.eventHeader}>
          <Text style={S.eventName}>{event?.eventName || 'Event'}</Text>
          {(event?.startDate || dayLabel) ? (
            <Text style={S.eventDate}>
              {event?.startDate}
              {event?.endDate && event.endDate !== event.startDate ? ` → ${event.endDate}` : ''}
              {dayLabel ? `  ·  ${dayLabel}` : ''}
            </Text>
          ) : null}
        </View>

        {/* Bar list */}
        {bars.length === 0 ? (
          <View style={S.emptyCard}>
            <Text style={S.emptyText}>No bars set up yet.{'\n'}Complete event setup first.</Text>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => nav.navigate('FestivalEventSetup')}>
              <Text style={S.secondaryBtnText}>Go to Event Setup →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          bars.map(bar => (
            <TouchableOpacity
              key={bar.id}
              style={S.barCard}
              onPress={() => nav.navigate('FestivalBarDashboard', {
                barId: bar.id,
                barName: bar.name,
                barLocation: bar.location,
              })}
              activeOpacity={0.75}
            >
              <View style={S.barCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={S.barName}>{bar.name}</Text>
                  {!!bar.location && <Text style={S.barLocation}>{bar.location}</Text>}
                </View>
                {bar.hasLowStock && (
                  <View style={S.alertBadge}>
                    <Text style={S.alertBadgeText}>⚠️ Low stock</Text>
                  </View>
                )}
                <Text style={S.chevron}>›</Text>
              </View>
              <Text style={[S.countTime, !bar.lastCountAt && S.countTimeEmpty]}>
                {formatCountTime(bar.lastCountAt)}
              </Text>
            </TouchableOpacity>
          ))
        )}

        {/* Ops manager actions */}
        {isOpsManager && (
          <View style={S.opsRow}>
            <TouchableOpacity
              style={S.opsBtn}
              onPress={() => nav.navigate('FestivalEventSetup')}
            >
              <Text style={S.opsBtnText}>+ Add bar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.opsBtn, S.opsBtnSecondary]}
              onPress={() => nav.navigate('FestivalOps')}
            >
              <Text style={[S.opsBtnText, S.opsBtnTextSecondary]}>View all tasks</Text>
            </TouchableOpacity>
          </View>
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

    eventHeader: { marginBottom: 20 },
    eventName:   { fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 2 },
    eventDate:   { fontSize: 14, color: c.slateMid },

    barCard: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16,
      marginBottom: 10, borderWidth: 1, borderColor: c.border,
    },
    barCardTop:  { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    barName:     { fontSize: 16, fontWeight: '800', color: c.navy },
    barLocation: { fontSize: 13, color: c.slateMid, marginTop: 2 },
    chevron:     { fontSize: 22, color: c.slateMid, marginLeft: 8 },
    alertBadge:  { backgroundColor: c.stellarAmber + '22', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, borderWidth: 1, borderColor: c.stellarAmber },
    alertBadgeText: { fontSize: 11, fontWeight: '700', color: c.stellarAmber },
    countTime:   { fontSize: 12, color: c.slateMid },
    countTimeEmpty: { color: c.slateMid, fontStyle: 'italic' },

    emptyCard:  { backgroundColor: c.surface, borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    emptyText:  { fontSize: 15, color: c.slateMid, textAlign: 'center', lineHeight: 22, marginBottom: 16 },

    secondaryBtn:     { borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, alignItems: 'center' },
    secondaryBtnText: { color: c.deepBlue, fontWeight: '700', fontSize: 14 },

    opsRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
    opsBtn: { flex: 1, backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
    opsBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: c.deepBlue },
    opsBtnText: { color: c.primaryText, fontWeight: '700', fontSize: 14 },
    opsBtnTextSecondary: { color: c.deepBlue },
  });
}
