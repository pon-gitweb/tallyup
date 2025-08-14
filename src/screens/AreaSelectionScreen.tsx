// src/screens/AreaSelectionScreen.tsx
import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { areaCardStyle } from 'src/services/areaStatus';
import { setLastLocation } from 'src/services/activeTake';

type RouteParams = { venueId: string; departmentId: string };

type Area = {
  id: string;
  name: string;
  startedAt?: any;
  completedAt?: any;
  [key: string]: any;
};

export default function AreaSelectionScreen() {
  const nav = useNavigation();
  const { venueId, departmentId } = (useRoute().params || {}) as RouteParams;

  const [loading, setLoading] = React.useState(true);
  const [areas, setAreas] = React.useState<Area[]>([]);

  React.useEffect(() => {
    if (!venueId || !departmentId) return;
    const unsub = onSnapshot(
      collection(db, `venues/${venueId}/departments/${departmentId}/areas`),
      (snap) => {
        const next: Area[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          next.push({ id: d.id, name: data?.name || d.id, ...data });
        });
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

  const goInventory = async (areaId: string) => {
    try {
      // Store resume pointer so Dashboard can return directly here
      await setLastLocation(venueId, { lastDepartmentId: departmentId, lastAreaId: areaId });
    } catch {
      // non-fatal
    }
    nav.navigate('StockTakeAreaInventory' as never, { venueId, departmentId, areaId } as never);
  };

  if (!venueId || !departmentId) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <Text style={{ textAlign: 'center' }}>
          Missing parameters. Please go back to Departments and try again.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading areas…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={areas}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => goInventory(item.id)}
            style={areaCardStyle(item)}
          >
            <Text style={{ fontWeight: '700' }}>{item.name}</Text>
            <Text style={{ color: '#555', marginTop: 4 }}>{item.id}</Text>
            {!!item.startedAt && !item.completedAt && (
              <Text style={{ color: '#e17055', marginTop: 6, fontSize: 12 }}>
                In progress
              </Text>
            )}
            {!!item.completedAt && (
              <Text style={{ color: '#00b894', marginTop: 6, fontSize: 12 }}>
                Completed
              </Text>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#777' }}>No areas yet.</Text>
        }
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}

