import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { listSuppliers, deleteSupplierById, Supplier } from '../../services/suppliers';

export default function SuppliersScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Supplier[]>([]);

  async function load() {
    if (!venueId) { setRows([]); setLoading(false); return; }
    try {
      const data = await listSuppliers(venueId);
      setRows(data);
    } catch (e: any) {
      console.log('[Suppliers] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  function onNew() {
    nav.navigate('SupplierEdit', { supplierId: null });
  }
  function onEdit(s: Supplier) {
    nav.navigate('SupplierEdit', { supplierId: s.id, supplier: s });
  }
  function onDelete(s: Supplier) {
    Alert.alert('Delete Supplier', `Delete ${s.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            if (!venueId || !s.id) return;
            await deleteSupplierById(venueId, s.id);
            await load();
          } catch (e: any) {
            Alert.alert('Delete Failed', e?.message || 'Unknown error');
          }
        }
      }
    ]);
  }

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Loading suppliers…</Text></View>);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Suppliers</Text>
      <TouchableOpacity style={styles.primary} onPress={onNew}><Text style={styles.primaryText}>Add Supplier</Text></TouchableOpacity>

      <FlatList
        data={rows}
        keyExtractor={(s) => s.id!}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{item.email || item.phone || '-'}</Text>
            </View>
            <TouchableOpacity style={styles.smallBtn} onPress={() => onEdit(item)}><Text style={styles.smallText}>Edit</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]} onPress={() => onDelete(item)}><Text style={[styles.smallText, { color: 'white' }]}>Delete</Text></TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text>No suppliers yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
  row: { backgroundColor: '#EFEFF4', padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontWeight: '700' },
  sub: { opacity: 0.7, marginTop: 2 },
  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  smallText: { fontWeight: '700' },
});
