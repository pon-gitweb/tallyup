import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, RefreshControl } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { listAreas } from '../services/stockTakeService';

export default function AreaSelectionScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { venueId, stockTakeId, deptId } = route.params;

  const [areas, setAreas] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const rows = await listAreas(venueId, stockTakeId, deptId);
      // Keep completed at bottom, then in-progress, then not-started at top
      const order = { 'not_started': 0, 'in_progress': 1, 'completed': 2 };
      rows.sort((a, b) => {
        const c = order[a.status] - order[b.status];
        return c !== 0 ? c : a.name.localeCompare(b.name);
      });
      setAreas(rows);
    } catch (err) {
      console.error('[AreaSelection] load error', err);
      Alert.alert('Error', 'Could not load areas.');
    }
  };

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation]);

  const getColor = (status) => {
    if (status === 'completed') return '#4CAF50';
    if (status === 'in_progress') return '#FF9800';
    return '#e0e0e0';
    };

  const statusLabel = (status) => {
    if (status === 'completed') return '✓ Completed';
    if (status === 'in_progress') return 'In Progress';
    return 'Not Started';
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Area</Text>
      <FlatList
        data={areas}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.areaButton, { backgroundColor: getColor(item.status) }]}
            onPress={() => navigation.navigate('StockTakeAreaInventory', {
              venueId, stockTakeId, deptId, areaId: item.id
            })}
          >
            <Text style={styles.areaText}>{item.name}</Text>
            <Text style={styles.statusText}>{statusLabel(item.status)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  areaButton: { padding: 16, borderRadius: 8, marginBottom: 12 },
  areaText: { fontSize: 18, color: '#000', fontWeight: '600' },
  statusText: { fontSize: 14, color: '#222', opacity: 0.9, marginTop: 4 },
});
