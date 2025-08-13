import React from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { seedVenueDefaults } from 'src/services/seed';

type RouteParams = { venueId: string };

export default function DepartmentSelectionScreen() {
  const nav = useNavigation();
  const { venueId } = (useRoute().params || {}) as RouteParams;

  const [loading, setLoading] = React.useState(true);
  const [departments, setDepartments] = React.useState<Array<{ id: string; name: string }>>([]);

  React.useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(
      collection(db, `venues/${venueId}/departments`),
      (snap) => {
        const next: Array<{ id: string; name: string }> = [];
        snap.forEach((d) => next.push({ id: d.id, name: (d.data() as any)?.name || d.id }));
        setDepartments(next);
        setLoading(false);
      },
      (err) => {
        console.warn('[DepartmentSelection] load error', err);
        Alert.alert('Load error', 'Could not load departments for this venue.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [venueId]);

  const onSeed = async () => {
    try {
      setLoading(true);
      await seedVenueDefaults(venueId);
    } catch (e: any) {
      Alert.alert('Seed failed', e?.message ?? 'Could not seed defaults.');
    } finally {
      setLoading(false);
    }
  };

  const goAreas = (departmentId: string) => {
    nav.navigate('AreaSelection' as never, { venueId, departmentId } as never);
  };

  if (loading) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading departments…</Text>
      </View>
    );
  }

  if (departments.length === 0) {
    return (
      <View style={{ flex:1, padding:20, alignItems:'center', justifyContent:'center' }}>
        <Text style={{ marginBottom: 12 }}>No departments found for this venue.</Text>
        <TouchableOpacity onPress={onSeed}
          style={{ backgroundColor:'#2ecc71', padding:14, borderRadius:10 }}>
          <Text style={{ color:'#fff', fontWeight:'700' }}>Seed Default Departments/Areas/Items</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex:1, padding: 16 }}>
      <FlatList
        data={departments}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => goAreas(item.id)}
            style={{ padding:14, borderRadius:10, borderWidth:1, borderColor:'#ddd', marginBottom:12 }}>
            <Text style={{ fontWeight:'700' }}>{item.name}</Text>
            <Text style={{ color:'#555', marginTop:4 }}>{item.id}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
