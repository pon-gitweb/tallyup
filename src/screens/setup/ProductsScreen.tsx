import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { listProducts, deleteProductById, Product } from '../../services/products';

const BRAND_BLUE = '#0A84FF';
const STUB_BG = '#EAF2FF';     // lighter brand blue for "no-op" pills
const STUB_TAG_BG = '#DDEBFF';  // even lighter tag
const STUB_TEXT = BRAND_BLUE;

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

      {/* Coming-soon pills (uniform 2-column, lighter brand blue) */}
      <View style={styles.stubGrid}>
        <TouchableOpacity
          style={styles.stub}
          onPress={() => Alert.alert('Bulk Edit', 'Coming soon')}
          activeOpacity={0.9}
        >
          <Text style={styles.stubTitle}>Bulk Edit</Text>
          <Text style={styles.stubTag}>Coming soon</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.stub}
          onPress={() => Alert.alert('CSV Import', 'Coming soon')}
          activeOpacity={0.9}
        >
          <Text style={styles.stubTitle}>CSV Import</Text>
          <Text style={styles.stubTag}>Coming soon</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.stub}
          onPress={() => Alert.alert('Barcode Scan', 'Coming soon')}
          activeOpacity={0.9}
        >
          <Text style={styles.stubTitle}>Barcode Scan</Text>
          <Text style={styles.stubTag}>Coming soon</Text>
        </TouchableOpacity>
      </View>

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

  // Uniform two-column pill grid (brand-aligned "no-op" look)
  stubGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 2 },
  stub: { backgroundColor: STUB_BG, padding: 12, borderRadius: 12, marginBottom: 10, flexBasis: '48%' },
  stubTitle: { fontWeight: '800', color: STUB_TEXT },
  stubTag: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: STUB_TAG_BG, color: STUB_TEXT, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: '700' },

  primary: { backgroundColor: BRAND_BLUE, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },

  row: { backgroundColor: '#EFEFF4', padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontWeight: '700' },
  sub: { opacity: 0.7, marginTop: 2 },
  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  smallText: { fontWeight: '700' },
});

