import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList, TextInput
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { listProducts, deleteProductById, Product } from '../../services/products';

export default function ProductsScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Product[]>([]);
  const [q, setQ] = useState('');

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((p) => {
      const name = (p.name || '').toLowerCase();
      const sku = (p.sku || '').toLowerCase();
      const unit = (p.unit || '').toLowerCase();
      const supplierName = (p as any)?.supplierName ? String((p as any).supplierName).toLowerCase() : '';
      return name.includes(needle) || sku.includes(needle) || unit.includes(needle) || supplierName.includes(needle);
    });
  }, [rows, q]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading products…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Products</Text>

      {/* Coming-soon pills (No-Op, lighter blue to signal future feature) */}
      <View style={styles.pillsRow}>
        <TouchableOpacity
          style={[styles.pill, styles.pillDisabled]}
          onPress={() => Alert.alert('Coming soon', 'Bulk CSV import for products.')}
        >
          <Text style={styles.pillText}>Bulk CSV Import</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, styles.pillDisabled]}
          onPress={() => Alert.alert('Coming soon', 'Scan UPCs in batch to add/update products.')}
        >
          <Text style={styles.pillText}>Scan UPC batch</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, styles.pillDisabled]}
          onPress={() => Alert.alert('Coming soon', 'Suggest PAR levels from history.')}
        >
          <Text style={styles.pillText}>Suggest PARs</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, styles.pillDisabled]}
          onPress={() => Alert.alert('Coming soon', 'AI normalize units / pack sizes.')}
        >
          <Text style={styles.pillText}>AI normalize units</Text>
        </TouchableOpacity>
      </View>

      {/* Search + Add */}
      <View style={styles.row}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search products (name, SKU, unit, supplier)"
          autoCapitalize="none"
          style={styles.search}
        />
        <TouchableOpacity style={styles.primary} onPress={onNew}>
          <Text style={styles.primaryText}>Add Product</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id!}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>
                {(item.sku ? `SKU ${item.sku} · ` : '')}
                {(item.unit || 'unit?')}
                {(typeof item.parLevel === 'number' ? ` · Par ${item.parLevel}` : '')}
              </Text>
            </View>
            <TouchableOpacity style={styles.smallBtn} onPress={() => onEdit(item)}>
              <Text style={styles.smallText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]} onPress={() => onDelete(item)}>
              <Text style={[styles.smallText, { color: 'white' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Text>{q.trim() ? 'No products match your search.' : 'No products yet.'}</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },

  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#D6E9FF' },
  pillDisabled: { opacity: 1 },
  pillText: { color: '#0A84FF', fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: {
    flex: 1, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff'
  },

  primary: { backgroundColor: '#0A84FF', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },

  rowCard: { backgroundColor: '#EFEFF4', padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontWeight: '700' },
  sub: { opacity: 0.7, marginTop: 2 },
  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  smallText: { fontWeight: '700' },
});
