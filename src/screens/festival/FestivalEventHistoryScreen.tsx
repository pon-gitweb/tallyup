// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Types ────────────────────────────────────────────────────────────────────

type HistoricEvent = {
  id: string;
  eventName: string;
  startDate: string | null;
  endDate: string | null;
  closedAt: any;
  status: string;
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalEventHistoryScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();

  const [events,  setEvents]  = useState<HistoricEvent[]>([]);
  const [loading, setLoading] = useState(FESTIVAL_BETA);

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
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'eventHistory'),
      snap => {
        const docs: HistoricEvent[] = snap.docs.map(d => ({
          id:        d.id,
          eventName: (d.data() as any).eventName || 'Unnamed event',
          startDate: (d.data() as any).startDate || null,
          endDate:   (d.data() as any).endDate   || null,
          closedAt:  (d.data() as any).closedAt  || null,
          status:    (d.data() as any).status    || 'closed',
        }));
        // Most recently closed first
        docs.sort((a, b) => {
          const ta = a.closedAt?.toMillis ? a.closedAt.toMillis() : 0;
          const tb = b.closedAt?.toMillis ? b.closedAt.toMillis() : 0;
          return tb - ta;
        });
        setEvents(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venueId]);

  if (loading) return <View style={S.center}><ActivityIndicator color="#1b4f72" size="large" /></View>;

  function formatClosedAt(ts: any): string {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.screenTitle}>Event history</Text>
        <Text style={S.sub}>{events.length} closed event{events.length !== 1 ? 's' : ''}</Text>

        {events.length === 0 ? (
          <View style={S.emptyCard}>
            <Text style={S.emptyText}>No closed events yet. Close your first event to see it here.</Text>
          </View>
        ) : (
          events.map(ev => (
            <View key={ev.id} style={S.eventCard}>
              <View style={S.eventRow}>
                <View style={{ flex: 1 }}>
                  <Text style={S.eventName}>{ev.eventName}</Text>
                  {(ev.startDate || ev.endDate) && (
                    <Text style={S.eventDates}>
                      {ev.startDate}
                      {ev.endDate && ev.endDate !== ev.startDate ? ` → ${ev.endDate}` : ''}
                    </Text>
                  )}
                  {ev.closedAt && (
                    <Text style={S.closedAt}>Closed {formatClosedAt(ev.closedAt)}</Text>
                  )}
                </View>
                <Text style={S.closedBadge}>✓ Closed</Text>
              </View>
              <View style={S.actionRow}>
                <TouchableOpacity
                  style={S.viewBtn}
                  onPress={() => nav.navigate('FestivalReconciliation', { eventId: ev.id, isHistorical: true })}
                >
                  <Text style={S.viewBtnText}>View reconciliation →</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={S.viewBtn}
                  onPress={() => nav.navigate('FestivalDebrief', { eventId: ev.id, eventName: ev.eventName })}
                >
                  <Text style={S.viewBtnText}>View debrief →</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
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

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub:         { fontSize: 14, color: '#6b7280', marginBottom: 20 },

  eventCard:  { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e5e1d8' },
  eventRow:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  eventName:  { fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 2 },
  eventDates: { fontSize: 13, color: '#6b7280', marginBottom: 2 },
  closedAt:   { fontSize: 12, color: '#9ca3af' },
  closedBadge:{ fontSize: 12, fontWeight: '700', color: '#16a34a', paddingTop: 2 },

  actionRow:  { flexDirection: 'row', gap: 8 },
  viewBtn:    { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  viewBtnText:{ fontSize: 13, fontWeight: '700', color: '#1b4f72' },

  emptyCard:  { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText:  { fontSize: 14, color: '#6b7280', textAlign: 'center' },
});
