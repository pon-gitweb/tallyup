import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { listProducts, deleteProductById, Product } from '../../services/products';

export default function ProductsScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Product[]>([]);

  async function load() {
    if (!venueId) { setRows([]); setLoading(false); return; }
    try {
      const data = await listProducts(venueId);
      setRows(data);
    } catch (e: any) {
      console.log('[Products] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  function onNew() {
    nav.navigate('ProductEdit', { productId: null });
  }
  function onEdit(p: Product) {
    nav.navigate('ProductEdit', { productId: p.id, product: p });
  }
  function onDelete(p: Product) {
    Alert.alert('Delete Product', `Delete ${p.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            if (!venueId || !p.id) return;
            await deleteProductById(venueId, p.id);
            await load();
          } catch (e: any) {
            Alert.alert('Delete Failed', e?.message || 'Unknown error');
          }
        }
      }
    ]);
  }

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Loading products…</Text></View>);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Products</Text>
      <TouchableOpacity style={styles.primary} onPress={onNew}><Text style={styles.primaryText}>Add Product</Text></TouchableOpacity>

      <FlatList
        data={rows}
        keyExtractor={(p) => p.id!}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>
                {(item.sku ? `SKU ${item.sku} · ` : '')}
                {(item.unit || 'unit?')}
                {(typeof item.parLevel === 'number' ? ` · Par ${item.parLevel}` : '')}
              </Text>
            </View>
            <TouchableOpacity style={styles.smallBtn} onPress={() => onEdit(item)}><Text style={styles.smallText}>Edit</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]} onPress={() => onDelete(item)}><Text style={[styles.smallText, { color: 'white' }]}>Delete</Text></TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text>No products yet.</Text>}
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
