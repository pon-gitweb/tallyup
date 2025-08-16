import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { seedVenueStructureIfEmpty } from '../services/venueSeed';

type RouteParams = { venueId: string; sessionId?: string };

export default function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId } = (route.params as RouteParams) ?? {};
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        if (!venueId) throw new Error('Missing venueId');
        const snap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e: any) {
        Alert.alert('Load failed', e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId]);

  const onSeedNow = async () => {
    try {
      setLoading(true);
      const res = await seedVenueStructureIfEmpty(venueId);
      if (res.seeded) {
        Alert.alert('Seeded', 'Default departments and areas have been created.');
      } else {
        Alert.alert('Nothing to do', 'Structure already exists.');
      }
      // re-read
      const snap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e: any) {
      Alert.alert('Seed failed', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const goDept = (departmentId: string) => {
    nav.navigate('AreaSelection', { venueId, departmentId });
  };

  if (loading) return <View style={S.center}><ActivityIndicator /></View>;

  if (!departments.length) {
    return (
      <View style={[S.center, { padding: 24 }]}>
        <Text style={S.emptyTitle}>No departments yet</Text>
        <Text style={S.emptyCopy}>Let’s create a sensible default so you can start counting right away.</Text>
        <TouchableOpacity style={S.seedBtn} onPress={onSeedNow}>
          <Text style={S.seedBtnText}>Seed default structure</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={S.container}>
      <Text style={S.h1}>Select a Department</Text>
      <FlatList
        data={departments}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={S.card} onPress={() => goDept(item.id)}>
            <Text style={S.cardTitle}>{item.name ?? item.id}</Text>
            <Text style={S.cardMeta}>Tap to view areas</Text>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  card: { backgroundColor: '#F3F4F6', padding: 16, borderRadius: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardMeta: { color: '#555', marginTop: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptyCopy: { color: '#555', textAlign: 'center', marginBottom: 12 },
  seedBtn: { backgroundColor: '#0A84FF', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  seedBtnText: { color: '#fff', fontWeight: '700' },
});
