import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';

type AreaRow = { id: string; name?: string; startedAt?: any; completedAt?: any };

export default function LastCycleSummaryScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = React.useState(true);
  const [summary, setSummary] = React.useState<{
    departments: number;
    areasTotal: number;
    areasCompleted: number;
    areasInProgress: number;
    sessionStatus: string | null;
  }>({ departments: 0, areasTotal: 0, areasCompleted: 0, areasInProgress: 0, sessionStatus: null });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!venueId) {
        setLoading(false);
        Alert.alert('No Venue', 'You are not attached to a venue.');
        return;
      }
      try {
        const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        const depIds = depsSnap.docs.map(d => d.id);
        let areas: AreaRow[] = [];
        for (const depId of depIds) {
          const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas'));
          areas = areas.concat(areasSnap.docs.map(a => ({ id: a.id, ...(a.data() as any) })));
        }
        const areasTotal = areas.length;
        const areasCompleted = areas.filter(a => !!a.completedAt).length;
        const areasInProgress = areas.filter(a => !!a.startedAt && !a.completedAt).length;

        // "current" session info (status only; expand later)
        let sessionStatus: string | null = null;
        try {
          const cur = await getDoc(doc(db, 'venues', venueId, 'sessions', 'current'));
          sessionStatus = cur.exists() ? ((cur.data() as any)?.status ?? null) : null;
        } catch {}

        if (!cancelled) {
          setSummary({
            departments: depIds.length,
            areasTotal,
            areasCompleted,
            areasInProgress,
            sessionStatus,
          });
          setLoading(false);
        }
        console.log('[TallyUp Reports] LastCycleSummary', JSON.stringify({ venueId, ...summary }));
      } catch (e: any) {
        console.log('[TallyUp Reports] last summary error', JSON.stringify({ code: e?.code, message: e?.message }));
        if (!cancelled) setLoading(false);
        Alert.alert('Load Failed', e?.message ?? 'Unknown error.');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading summary…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.title}>Last Cycle Summary</Text>

      <View style={styles.card}>
        <Text style={styles.metric}>Departments: <Text style={styles.bold}>{summary.departments}</Text></Text>
        <Text style={styles.metric}>Areas: <Text style={styles.bold}>{summary.areasTotal}</Text></Text>
        <Text style={styles.metric}>Completed: <Text style={styles.bold}>{summary.areasCompleted}</Text></Text>
        <Text style={styles.metric}>In Progress: <Text style={styles.bold}>{summary.areasInProgress}</Text></Text>
        <Text style={styles.metric}>Session Status: <Text style={styles.bold}>{summary.sessionStatus ?? '—'}</Text></Text>
      </View>

      <Text style={styles.note}>This report summarizes the latest stock-take “current” session and area completion state.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  card: { backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, gap: 8 },
  metric: { fontSize: 16 },
  bold: { fontWeight: '700' },
  note: { opacity: 0.7, marginTop: 14 },
});
