// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDocs, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { apiBase } from '../../services/apiBase';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useToast } from '../../components/common/Toast';

type DebriefRec = {
  id: string;
  category: 'worked_well' | 'improve' | 'year2_seed';
  title: string;
  body: string;
  productId?: string;
  productName?: string;
  supplierId?: string;
  supplierName?: string;
};

export default function FestivalDebriefScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { eventId, eventName: routeEventName } = route.params ?? {};
  const venueId = useVenueId();
  const { showError } = useToast();

  const [recs, setRecs] = useState<DebriefRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !eventId) { setLoading(false); return; }
    if (uid) {
      onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
        setRole(snap.exists() ? (snap.data() as any).role ?? null : null);
      });
    }
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'eventHistory', eventId, 'debriefRecommendations'),
      snap => {
        const docs: DebriefRec[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as DebriefRec));
        docs.sort((a, b) => {
          const order = { worked_well: 0, improve: 1, year2_seed: 2 };
          return (order[a.category] ?? 3) - (order[b.category] ?? 3);
        });
        setRecs(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venueId, eventId]);

  async function generateDebrief() {
    if (!venueId || !eventId) return;
    setGenerating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${apiBase()}/writeFestivalDebrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, eventId }),
      });
      const data = await res.json();
      if (!data.ok) {
        showError(data.error || 'Could not generate debrief.');
      }
    } catch (e: any) {
      showError(e?.message || 'Could not generate debrief.');
    } finally {
      setGenerating(false);
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

  const workedWell = recs.filter(r => r.category === 'worked_well');
  const improve = recs.filter(r => r.category === 'improve');
  const year2 = recs.filter(r => r.category === 'year2_seed');

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={S.heading}>Event Debrief</Text>
        {routeEventName && <Text style={S.sub}>{routeEventName}</Text>}

        {recs.length === 0 ? (
          <View style={S.card}>
            <Text style={S.cardTitle}>No debrief generated yet</Text>
            <Text style={S.body}>
              Generate a debrief to get an AI-powered summary of what worked, what to improve,
              and recommendations for next year.
            </Text>
            {(role === 'owner' || role === 'manager') && (
              <TouchableOpacity
                style={[S.btn, generating && S.btnDisabled]}
                disabled={generating}
                onPress={generateDebrief}
              >
                {generating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={S.btnText}>Generate debrief →</Text>}
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {workedWell.length > 0 && (
              <View style={[S.section, { borderLeftColor: '#16a34a' }]}>
                <Text style={[S.sectionTitle, { color: '#16a34a' }]}>What worked well</Text>
                {workedWell.map(r => (
                  <RecCard key={r.id} rec={r} />
                ))}
              </View>
            )}

            {improve.length > 0 && (
              <View style={[S.section, { borderLeftColor: '#d97706' }]}>
                <Text style={[S.sectionTitle, { color: '#d97706' }]}>What to improve</Text>
                {improve.map(r => (
                  <RecCard key={r.id} rec={r} />
                ))}
              </View>
            )}

            {year2.length > 0 && (
              <View style={[S.section, { borderLeftColor: '#1b4f72' }]}>
                <Text style={[S.sectionTitle, { color: '#1b4f72' }]}>Year 2 seeds</Text>
                <Text style={S.hint}>These recommendations have been stored and will appear when you set up your next event.</Text>
                {year2.map(r => (
                  <RecCard key={r.id} rec={r} />
                ))}
              </View>
            )}

            {(role === 'owner' || role === 'manager') && (
              <TouchableOpacity
                style={[S.btnSecondary, generating && S.btnDisabled]}
                disabled={generating}
                onPress={generateDebrief}
              >
                {generating
                  ? <ActivityIndicator color="#1b4f72" size="small" />
                  : <Text style={S.btnSecondaryText}>Regenerate debrief</Text>}
              </TouchableOpacity>
            )}
          </>
        )}

        <TouchableOpacity style={S.linkBtn} onPress={() => nav.navigate('FestivalNewEvent')}>
          <Text style={S.linkBtnText}>Plan next event →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function RecCard({ rec }: { rec: DebriefRec }) {
  return (
    <View style={S.recCard}>
      <Text style={S.recTitle}>{rec.title}</Text>
      <Text style={S.recBody}>{rec.body}</Text>
      {(rec.productName || rec.supplierName) && (
        <Text style={S.recMeta}>
          {[rec.productName, rec.supplierName].filter(Boolean).join(' · ')}
        </Text>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  body: { fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 12 },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },
  hint: { fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginBottom: 8 },

  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e1d8', padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 6 },

  section: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },

  recCard: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e1d8', padding: 12, marginBottom: 8 },
  recTitle: { fontSize: 14, fontWeight: '700', color: '#0B132B', marginBottom: 4 },
  recBody: { fontSize: 13, color: '#374151', lineHeight: 19 },
  recMeta: { fontSize: 11, color: '#9ca3af', marginTop: 6, fontStyle: 'italic' },

  btn: { backgroundColor: '#1b4f72', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  btnSecondary: { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  btnSecondaryText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },
  linkBtn: { alignItems: 'center', marginTop: 16 },
  linkBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },
});
