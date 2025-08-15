import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { getDocs, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { areasCol } from '../services/paths';

type Params = { venueId: string; sessionId: string; departmentId: string };
type AreaStatus = 'not_started' | 'in_progress' | 'complete';
type AreaRow = { id: string; name: string; status: AreaStatus };

export default function AreaSelectionScreen() {
  const nav = useNavigation<any>();
  const { params } = useRoute<any>();
  const { venueId, sessionId, departmentId } = params as Params;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AreaRow[]>([]);
  const unsub = useRef<Unsubscribe | null>(null);

  const compute = useCallback(async () => {
    setLoading(true);
    try {
      const aSnap = await getDocs(areasCol(venueId, departmentId));
      const list: AreaRow[] = aSnap.docs.map(d => {
        const data = d.data() as any;
        const status: AreaStatus = data?.completedAt ? 'complete' : data?.startedAt ? 'in_progress' : 'not_started';
        return { id: d.id, name: data?.name ?? d.id, status };
      });
      list.sort((a, b) => {
        const order = { in_progress: 0, not_started: 1, complete: 2 } as any;
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.name.localeCompare(b.name);
      });
      setRows(list);
    } finally {
      setLoading(false);
    }
  }, [venueId, departmentId]);

  const wireLive = useCallback(() => {
    if (unsub.current) { try { unsub.current(); } catch {} }
    unsub.current = onSnapshot(areasCol(venueId, departmentId), () => void compute());
  }, [venueId, departmentId, compute]);

  useEffect(() => { void compute(); wireLive(); return () => { if (unsub.current) unsub.current(); }; }, [venueId, departmentId]);
  useFocusEffect(useCallback(() => { void compute(); return () => {}; }, [compute]));

  const onPress = (item: AreaRow) => {
    // Optimistic: immediately reflect as in_progress (UI only); snapshot will confirm after startedAt write.
    if (item.status === 'not_started') {
      setRows(prev => prev.map(r => r.id === item.id ? { ...r, status: 'in_progress' } : r));
    }
    nav.navigate('StockTakeAreaInventory', {
      venueId, sessionId, departmentId, areaName: item.id, readOnly: item.status === 'complete'
    });
  };

  const renderArea = ({ item }: { item: AreaRow }) => {
    const color =
      item.status === 'complete' ? '#D9FBE4' :
      item.status === 'in_progress' ? '#FFE8C2' :
      '#F0F0F0';

    return (
      <TouchableOpacity style={[S.card, { backgroundColor: color }]} onPress={() => onPress(item)}>
        <Text style={S.cardTitle}>{item.name}</Text>
        <Text style={S.cardStatus}>
          {item.status === 'complete' ? 'Complete' :
           item.status === 'in_progress' ? 'In Progress' : 'Not started'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) return <View style={S.center}><ActivityIndicator /></View>;

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList data={rows} keyExtractor={(it) => it.id} renderItem={renderArea} ListEmptyComponent={<Text>No areas found.</Text>} />
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, borderRadius: 12, marginBottom: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  cardStatus: { fontSize: 14, color: '#333' },
});
