import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { db } from '../../services/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

type AreaRow = { id: string; name: string; startedAt?: any; completedAt?: any };

export default function AreaSelectionScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { departmentId, departmentName } = (route.params || {}) as { departmentId: string; departmentName?: string };
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<AreaRow[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!venueId || !departmentId) { setLoading(false); return; }
      try {
        const snap = await getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'areas'));
        const rows: AreaRow[] = [];
        snap.forEach(a => {
          const d: any = a.data();
          rows.push({ id: a.id, name: d?.name || a.id, startedAt: d?.startedAt, completedAt: d?.completedAt });
        });
        if (!cancel) setAreas(rows);
      } catch (e: any) {
        console.log('[TallyUp Areas] load error', JSON.stringify({ code: e?.code, message: e?.message }));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [venueId, departmentId]);

  function statusOf(a: AreaRow) {
    if (a.completedAt) return 'Completed';
    if (a.startedAt) return 'In Progress';
    return 'Not Started';
  }

  if (loading) {
    return (<View style={styles.center}><ActivityIndicator /><Text>Loading areas…</Text></View>);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{departmentName || departmentId}</Text>

      {areas.map(a => {
        const status = statusOf(a);
        const badgeStyle =
          status === 'In Progress' ? styles.badgeWarn :
          status === 'Completed'  ? styles.badgeOk   :
                                    styles.badgeDim;
        return (
          <TouchableOpacity
            key={a.id}
            style={styles.row}
            onPress={() => nav.navigate('AreaInventory', { departmentId, areaId: a.id, areaName: a.name })}
          >
            <Text style={styles.rowTitle}>{a.name}</Text>
            <Text style={[styles.badge, badgeStyle]}>{status}</Text>
          </TouchableOpacity>
        );
      })}
      {!areas.length ? <Text>No areas configured.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  row: { padding: 14, borderRadius: 12, backgroundColor: '#EFEFF4', marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontWeight: '700', fontSize: 16 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, color: 'white', fontWeight: '700' },
  badgeOk: { backgroundColor: '#34C759' },
  badgeWarn: { backgroundColor: '#FF9500' },
  badgeDim: { backgroundColor: '#8E8E93' },
});
