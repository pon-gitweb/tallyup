import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../services/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { finalizeVenueCycle, getCycleDurationHours } from '../../services/finalization';

type Stats = { totalAreas: number; inProgress: number; completed: number };

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ totalAreas: 0, inProgress: 0, completed: 0 });
  const [sessionStatus, setSessionStatus] = useState<string>('idle');

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!venueId) { setLoading(false); return; }
      try {
        const sref = doc(db, 'venues', venueId, 'sessions', 'current');
        const ssnap = await getDoc(sref);
        setSessionStatus((ssnap.data() as any)?.status || 'idle');

        const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
        let totalAreas = 0, inProg = 0, comp = 0;
        for (const d of deps.docs) {
          const areas = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
          areas.forEach(a => {
            const ad: any = a.data();
            totalAreas++;
            if (ad?.completedAt) comp++;
            else if (ad?.startedAt) inProg++;
          });
        }
        if (!cancel) setStats({ totalAreas, inProgress: inProg, completed: comp });
      } catch (e: any) {
        console.log('[TallyUp Dash] load error', JSON.stringify({ code: e?.code, message: e?.message }));
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [venueId]);

  const cta = useMemo(() => {
    const { totalAreas, inProgress, completed } = stats;
    const noneStarted = inProgress === 0 && completed === 0 && totalAreas > 0;
    const someInProgress = inProgress > 0;
    const allCompleted = totalAreas > 0 && completed === totalAreas;
    let label = 'Start Stock Take';
    let caption = '';
    if (noneStarted) { label = 'Start New Stock Take'; caption = 'No areas started yet.'; }
    else if (someInProgress) { label = 'Return to Stock Take'; caption = 'Stock take active in at least one area.'; }
    else if (allCompleted) { label = 'Start New Stock Take'; caption = 'All areas are complete. Finalize and start a new cycle.'; }
    else { label = 'Start / Return to Stock Take'; caption = 'Some departments complete, others not started.'; }
    return { label, caption, allCompleted };
  }, [stats]);

  async function onPrimary() {
    if (!venueId) return;
    if (cta.allCompleted) {
      try {
        const hours = await getCycleDurationHours(venueId);
        if (hours != null && hours >= 24) {
          let proceed = false;
          await new Promise<void>((resolve) => {
            Alert.alert(
              'Long Cycle Warning',
              `This stock take spanned about ${hours.toFixed(1)} hours.\n\nCounts may be less accurate. Finalize anyway?`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
                { text: 'Finalize', style: 'destructive', onPress: () => { proceed = true; resolve(); } },
              ]
            );
          });
          if (!proceed) return;
        }
        await finalizeVenueCycle(venueId);
        Alert.alert('Stock take finalized', 'Cycle marked complete.');
      } catch (e: any) {
        console.log('[TallyUp Dash] finalize/reset error', JSON.stringify({ code: e?.code, message: e?.message }));
      }
    }
    // Navigate regardless — either starting new or returning
    nav.navigate('Departments');
  }

  if (loading) {
    return (<View style={styles.center}><ActivityIndicator /><Text>Loading Dashboard…</Text></View>);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Dashboard</Text>

      <TouchableOpacity style={styles.primaryBtn} onPress={onPrimary}>
        <Text style={styles.primaryText}>{cta.label}</Text>
      </TouchableOpacity>
      {cta.caption ? <Text style={styles.caption}>{cta.caption}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <Text>Total areas: {stats.totalAreas}</Text>
        <Text>Completed: {stats.completed}</Text>
        <Text>In progress: {stats.inProgress}</Text>
        <Text>Session: {sessionStatus}</Text>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => nav.navigate('SetupWizard')}><Text style={styles.secondaryText}>Setup</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => nav.navigate('Reports')}><Text style={styles.secondaryText}>Reports</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => nav.navigate('Settings')}><Text style={styles.secondaryText}>Settings</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 24, fontWeight: '800' },
  primaryBtn: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
  caption: { opacity: 0.7, marginTop: 6 },
  card: { backgroundColor: '#F2F2F7', borderRadius: 12, padding: 12, gap: 6 },
  cardTitle: { fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  secondaryBtn: { backgroundColor: '#E5E7EB', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12 },
  secondaryText: { fontWeight: '700' },
});
