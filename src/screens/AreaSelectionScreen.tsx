import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getDocs } from 'firebase/firestore';
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

  useEffect(() => {
    (async () => {
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
    })();
  }, [venueId, sessionId, departmentId]);

  const renderArea = ({ item }: { item: AreaRow }) => {
    const color =
      item.status === 'complete' ? '#D9FBE4' :
      item.status === 'in_progress' ? '#FFE8C2' :
      '#F0F0F0';

    return (
      <TouchableOpacity
        style={[S.card, { backgroundColor: color }]}
        onPress={() =>
          nav.navigate('StockTakeAreaInventory', {
            venueId, sessionId, departmentId, areaName: item.id, readOnly: item.status === 'complete'
          })
        }
      >
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
