import React from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from 'src/services/firebase';

type RouteParams = { venueId: string; departmentId: string };

export default function AreaSelectionScreen() {
  const nav = useNavigation();
  const { venueId, departmentId } = (useRoute().params || {}) as RouteParams;

  const [loading, setLoading] = React.useState(true);
  const [areas, setAreas] = React.useState<Array<{ id: string; name: string }>>([]);

  React.useEffect(() => {
    if (!venueId || !departmentId) return;
    const unsub = onSnapshot(
      collection(db, `venues/${venueId}/departments/${departmentId}/areas`),
      (snap) => {
        const next: Array<{ id: string; name: string }> = [];
        snap.forEach((d) => next.push({ id: d.id, name: (d.data() as any)?.name || d.id }));
        setAreas(next);
        setLoading(false);
      },
      (err) => {
        console.warn('[AreaSelection] load error', err);
        Alert.alert('Load error', 'Could not load areas.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [venueId, departmentId]);

  const goInventory = (areaId: string) => {
    nav.navigate('StockTakeAreaInventory' as never, { venueId, departmentId, areaId } as never);
  };

  if (loading) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading areas…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, padding:16 }}>
      <FlatList
        data={areas}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => goInventory(item.id)}
            style={{ padding:14, borderRadius:10, borderWidth:1, borderColor:'#ddd', marginBottom:12 }}>
            <Text style={{ fontWeight:'700' }}>{item.name}</Text>
            <Text style={{ color:'#555', marginTop:4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign:'center', color:'#777' }}>No areas yet.</Text>
        }
      />
    </View>
  );
}
