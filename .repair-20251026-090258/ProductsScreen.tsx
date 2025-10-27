// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
import type { Product } from '../../types/Product';

View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList, TextInput
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { listProducts, deleteProductById} from '../../services/products';
import ProductSupplierTools from '../../components/products/ProductSupplierTools';

// Optional, best-effort read of global catalogs (won't throw if firebase/firestore isn't present)
let getFirestore: any, collection: any, getDocs: any;
try {
  // Modular SDK (already used elsewhere in the app)
  ({ getFirestore, collection, getDocs } = require('firebase/firestore'));
} catch (e) {
  // If the module isn't available in this build target, we just won't show the count.
}

export default function ProductsScreen() {
  const nav = useNavigation<any>();
  try {
    const rn = (nav.getState()?.routeNames ?? []) as string[];
    // eslint-disable-next-line no-console
    console.log("[Products] routeNames:", rn);
  } catch (e) {}

  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Product[]>([]);
  const [q, setQ] = useState('');

  // Supplier Tools toggle
  const [toolsOpen, setToolsOpen] = useState(false);

  // Optional: tiny badge showing global supplier catalogs available
  const [globalSupplierCount, setGlobalSupplierCount] = useState<number | null>(null);

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

  // Read global supplier catalog count (optional; silent on error)
  useEffect(() => {
    (async () => {
      try {
        if (!getFirestore || !collection || !getDocs) return;
        const db = getFirestore();
        const snap = await getDocs(collection(db, 'global_suppliers'));
        setGlobalSupplierCount(snap.size ?? 0);
      } catch {
        // ignore: purely informational
      }
    })();
  }, []);

  function onNew() {
    // keep route name the same as currently wired
    nav.navigate('EditProductScreen', { productId: null, product: null });
  }

  function onEdit(p: Product) {
    // Avoid non-serializable refs in params (DocumentReference, functions, Maps, etc.)
    // JSON stringify/parse gives us a plain object clone suitable for navigation state.
    let safeProduct: any = null;
    try {
      safeProduct = JSON.parse(JSON.stringify(p));
    } catch {
      // Fallback: pass minimal shape if something was still not serializable
      safeProduct = { id: p.id, name: (p as any)?.name ?? '', parLevel: (p as any)?.parLevel ?? null, supplierName: (p as any)?.supplierName ?? null };
    }
    nav.navigate('EditProductScreen', { productId: p.id, product: safeProduct });
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
      const sku = (p as any)?.sku ? String((p as any).sku).toLowerCase() : '';
      const unit = (p as any)?.unit ? String((p as any).unit).toLowerCase() : '';
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

      {/* Pills row (includes Supplier Tools toggle) */}
      <View style={styles.pillsRow}>
        <TouchableOpacity
          style={[styles.pill, styles.pillPrimary]}
          onPress={() => setToolsOpen(v => !v)}
        >
          <Text style={[styles.pillText, styles.pillTextPrimary]}>
            {toolsOpen ? 'Hide Supplier Tools' : 'Supplier Tools'}
          </Text>
        </TouchableOpacity>

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

      {/* Supplier Tools panel */}
      {toolsOpen ? (
        <View style={styles.toolsPanel}>
          {typeof globalSupplierCount === 'number' ? (
            <View style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.hint}>
                Global catalogs available: {globalSupplierCount}
              </Text>
            </View>
          ) : null}
          <ProductSupplierTools
            existingProducts={rows}
            onApplied={(s) => {
              console.log('[SupplierTools applied]', s);
              // After apply, refresh products so preferred supplier badges update
              load();
            }}
          />
        </View>
      ) : null}

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
        renderItem={({ item }) => {
          const supplierName = (item as any)?.supplierName ? String((item as any).supplierName) : '';
          const hasPreferred = !!supplierName;
          return (
            <View style={styles.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>
                  {(item as any)?.sku ? `SKU ${(item as any).sku} · ` : ''}
                  {(item as any)?.unit || 'unit?'}
                  {(typeof (item as any).parLevel === 'number' ? ` · Par ${(item as any).parLevel}` : '')}
                </Text>
                <View style={{ marginTop: 6 }}>
                  {hasPreferred ? (
                    <Text style={[styles.badge, styles.badgeOk]}>Preferred: {supplierName}</Text>
                  ) : (
                    <Text style={[styles.badge, styles.badgeWarn]}>Needs supplier</Text>
                  )}
                </View>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={() => onEdit(item)}>
                <Text style={styles.smallText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]} onPress={() => onDelete(item)}>
                <Text style={[styles.smallText, { color: 'white' }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          );
        }}
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
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  pillDisabled: { backgroundColor: '#D6E9FF' },
  pillText: { fontWeight: '700' },
  pillPrimary: { backgroundColor: '#111827' },
  pillTextPrimary: { color: '#fff' },

  toolsPanel: { backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: 12 },
  hint: { fontSize: 12, color: '#6b7280' },

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
  badge: { fontSize: 11, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, alignSelf: 'flex-start' },
  badgeOk: { backgroundColor: '#ecfdf5', color: '#065f46' },
  badgeWarn: { backgroundColor: '#fffbeb', color: '#92400e' }});
