import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, TextInput, FlatList } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { collection, doc, getDocs, serverTimestamp, writeBatch, getDoc } from 'firebase/firestore';
import { db, auth } from '../services/firebase';

type RouteParams = { venueId: string; departmentId: string; areaId: string };

export default function StockTakeAreaInventoryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId, areaId } = (route.params as RouteParams) ?? {};
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Array<any>>([]);
  const [qty, setQty] = useState<Record<string, string>>({}); // itemId -> entry

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const snap = await getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items'));
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setItems(rows);
      } catch (e: any) {
        Alert.alert('Load failed', e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId, departmentId, areaId]);

  const onSubmit = async () => {
    try {
      const now = serverTimestamp();
      const uid = auth.currentUser?.uid ?? 'unknown';
      const aRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
      const aSnap = await getDoc(aRef);

      const batch = writeBatch(db);

      // If not started, mark startedAt now (first submission)
      if (aSnap.exists() && !(aSnap.data() as any)?.startedAt) {
        batch.set(aRef, { startedAt: now }, { merge: true });
      }

      // Write count updates
      items.forEach((it) => {
        const v = qty[it.id];
        if (v !== undefined && v !== null && v !== '') {
          const iRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', it.id);
          batch.set(iRef, { lastCount: Number(v), lastCountAt: now }, { merge: true });
        }
      });

      // Mark area complete + append audit log
      batch.set(aRef, { completedAt: now }, { merge: true });
      const logRef = doc(collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'logs'));
      batch.set(logRef, { type: 'area_completed', by: uid, at: now });

      await batch.commit();

      Alert.alert('Saved', 'Area completed.');
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message ?? 'Unknown error');
    }
  };

  if (loading) return <View style={S.center}><ActivityIndicator /></View>;

  return (
    <View style={S.container}>
      <Text style={S.h1}>Inventory • {areaId}</Text>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <View style={S.row}>
            <Text style={S.name}>{item.name ?? item.id}</Text>
            <TextInput
              style={S.input}
              placeholder={item.expectedQuantity ? `Expected: ${item.expectedQuantity} ${item.unit ?? ''}` : 'Enter count'}
              keyboardType="numeric"
              value={qty[item.id] ?? ''}
              onChangeText={(t) => setQty((s) => ({ ...s, [item.id]: t }))}
            />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      />
      <TouchableOpacity style={S.primary} onPress={onSubmit}>
        <Text style={S.primaryText}>Submit Area</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  row: { backgroundColor: '#F3F4F6', padding: 12, borderRadius: 12 },
  name: { fontWeight: '700', marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 },
  primary: { backgroundColor: '#10B981', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
});
