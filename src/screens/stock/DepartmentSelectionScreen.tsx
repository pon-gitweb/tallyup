import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { db } from '../../services/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { finalizeVenueCycle, getCycleDurationHours } from '../../services/finalization';

type DeptRow = {
  id: string;
  name: string;
  areasTotal: number;
  areasCompleted: number;
  areasInProgress: number;
};

export default function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DeptRow[]>([]);
  const [sessionStatus, setSessionStatus] = useState<string>('idle');

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!venueId) { setLoading(false); return; }
      try {
        // Session status (optional UI)
        const sref = doc(db, 'venues', venueId, 'sessions', 'current');
        const ssnap = await getDoc(sref);
        setSessionStatus((ssnap.data() as any)?.status || 'idle');

        const dcol = collection(db, 'venues', venueId, 'departments');
        const deps = await getDocs(dcol);

        const out: DeptRow[] = [];
        for (const d of deps.docs) {
          const depId = d.id;
          const name = (d.data() as any)?.name || depId;

          const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', depId, 'areas'));
          let total = 0, completed = 0, inprog = 0;

          areasSnap.forEach(a => {
            total++;
            const ad: any = a.data();
            if (ad?.completedAt) completed++;
            else if (ad?.startedAt) inprog++;
          });

          out.push({ id: depId, name, areasTotal: total, areasCompleted: completed, areasInProgress: inprog });
        }
        if (!cancel) setRows(out);
      } catch (e: any) {
        console.log('[TallyUp Dept] load error', JSON.stringify({ code: e?.code, message: e?.message }));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [venueId]);

  const allCompleted = useMemo(() => {
    if (!rows.length) return false;
    return rows.every(r => r.areasTotal > 0 && r.areasCompleted === r.areasTotal);
  }, [rows]);

  function statusFor(r: DeptRow) {
    if (r.areasInProgress > 0) return 'In Progress';
    if (r.areasTotal > 0 && r.areasCompleted === r.areasTotal) return 'Completed';
    return 'Not Started';
  }

  async function onFinalize() {
    if (!venueId) return;
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
      Alert.alert('Stock take complete', 'Cycle marked complete. You can start a new one.');
    } catch (e: any) {
      console.log('[TallyUp Dept] finalize error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Finalize failed', e?.message || 'Unknown error.');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator /><Text>Loading departments…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Departments</Text>
      <Text style={styles.sub}>Session: {sessionStatus}</Text>

      {rows.map(r => {
        const status = statusFor(r);
        const badgeStyle =
          status === 'In Progress' ? styles.badgeWarn :
          status === 'Completed'  ? styles.badgeOk   :
                                    styles.badgeDim;

        return (
          <TouchableOpacity
            key={r.id}
            style={styles.row}
            onPress={() => nav.navigate('Areas', { departmentId: r.id, departmentName: r.name })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.name}</Text>
              <Text style={styles.rowSub}>
                Areas: {r.areasCompleted}/{r.areasTotal} complete · {r.areasInProgress} in progress
              </Text>
            </View>
            <Text style={[styles.badge, badgeStyle]}>{status}</Text>
          </TouchableOpacity>
        );
      })}

      {allCompleted ? (
        <TouchableOpacity style={styles.finalBtn} onPress={onFinalize}>
          <Text style={styles.finalText}>Finalize Stock Take</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { opacity: 0.7, marginBottom: 6 },
  row: { padding: 14, borderRadius: 12, backgroundColor: '#EFEFF4', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  rowTitle: { fontWeight: '700', fontSize: 16 },
  rowSub: { opacity: 0.7, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, color: 'white', fontWeight: '700' },
  badgeOk: { backgroundColor: '#34C759' },
  badgeWarn: { backgroundColor: '#FF9500' },
  badgeDim: { backgroundColor: '#8E8E93' },
  finalBtn: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  finalText: { color: 'white', fontWeight: '700' },
});
