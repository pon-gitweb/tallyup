import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { listSuppliers, Supplier } from '../../services/suppliers';
import { listProducts } from '../../services/products';
import { createDraftOrderWithLines, OrderLine } from '../../services/orders';

type Product = {
  id: string;
  name: string;
  // optional fields we don't rely on
  sku?: string;
  defaultSupplierId?: string | null;
};

export default function NewOrderScreen() {
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);

  // supplier selection
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);

  // product picking
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState('');

  // local cart
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!venueId) { setLoading(false); return; }
      try {
        setLoading(true);
        const [sups, prods] = await Promise.all([
          listSuppliers(venueId),
          listProducts(venueId),
        ]);
        if (cancelled) return;
        // sort suppliers by name
        sups.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        // sort products by name
        (prods as any[]).sort?.((a, b) => (a.name || '').localeCompare(b.name || ''));

        setSuppliers(sups);
        setProducts(prods as Product[]);
      } catch (e: any) {
        Alert.alert('Load failed', e?.message || 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s =>
      (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q));
  }, [supplierQuery, suppliers]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    let arr = products;
    if (selectedSupplier) {
      // prefer products that have this supplier as default (if present in data)
      const top = arr.filter(p => p.defaultSupplierId === selectedSupplier.id);
      const rest = arr.filter(p => p.defaultSupplierId !== selectedSupplier.id);
      arr = [...top, ...rest];
    }
    if (!q) return arr;
    return arr.filter(p =>
      (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
  }, [productQuery, products, selectedSupplier]);

  const totalLines = useMemo(
    () => Object.values(qtyByProduct).filter(q => (q || 0) > 0).length,
    [qtyByProduct]
  );

  function inc(id: string, by = 1) {
    setQtyByProduct(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + by) }));
  }
  function setQty(id: string, v: string) {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    setQtyByProduct(prev => ({ ...prev, [id]: n }));
  }

  async function saveDraft() {
    try {
      if (!venueId) return;
      if (!selectedSupplier) {
        Alert.alert('Missing supplier', 'Please choose a supplier first.');
        return;
      }
      const lines: OrderLine[] = Object.keys(qtyByProduct)
        .filter(pid => (qtyByProduct[pid] || 0) > 0)
        .map(pid => {
          const p = products.find(x => x.id === pid)!;
          return {
            productId: p.id,
            name: p.name,
            qty: qtyByProduct[pid],
            // unitCost is optional here; Order detail can show "—" if unknown
          } as OrderLine;
        });

      if (!lines.length) {
        Alert.alert('No items', 'Add at least one product with quantity > 0.');
        return;
      }

      await createDraftOrderWithLines(venueId, selectedSupplier.id, lines, note || null);
      Alert.alert('Draft created', 'You can review and submit it from Orders.', [{ text: 'OK' }]);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Unknown error');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading suppliers & products…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <View style={styles.wrap}>
        <Text style={styles.title}>New Order</Text>

        {/* Supplier chooser */}
        <View style={styles.card}>
          <Text style={styles.label}>Supplier</Text>
          <TextInput
            placeholder="Search supplier…"
            value={supplierQuery}
            onChangeText={setSupplierQuery}
            style={styles.input}
            autoCapitalize="none"
          />
          <FlatList
            data={filteredSuppliers}
            keyExtractor={s => s.id}
            style={{ maxHeight: 160, marginTop: 6 }}
            ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
            renderItem={({ item }) => {
              const selected = selectedSupplier?.id === item.id;
              return (
                <TouchableOpacity style={[styles.rowItem, selected && styles.rowItemSelected]} onPress={() => setSelectedSupplier(item)}>
                  <Text style={[styles.rowTitle, selected && styles.bold]}>{item.name || '(no name)'}</Text>
                  {item.email ? <Text style={styles.sub}>{item.email}</Text> : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text>No suppliers</Text>}
          />
          {selectedSupplier ? <Text style={styles.selectedPill}>Selected: {selectedSupplier.name}</Text> : null}
        </View>

        {/* Product picker */}
        <View style={styles.card}>
          <Text style={styles.label}>Products</Text>
          <TextInput
            placeholder="Search product…"
            value={productQuery}
            onChangeText={setProductQuery}
            style={styles.input}
            autoCapitalize="none"
          />
          <FlatList
            data={filteredProducts}
            keyExtractor={p => p.id}
            style={{ maxHeight: 260, marginTop: 6 }}
            ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
            renderItem={({ item }) => {
              const q = qtyByProduct[item.id] || 0;
              return (
                <View style={styles.prodRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    {!!item.sku && <Text style={styles.sub}>SKU {item.sku}</Text>}
                  </View>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => inc(item.id, -1)}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                  <TextInput
                    style={styles.qtyInput}
                    keyboardType="number-pad"
                    value={String(q)}
                    onChangeText={(v) => setQty(item.id, v)}
                  />
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => inc(item.id, +1)}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                </View>
              );
            }}
            ListEmptyComponent={<Text>No products</Text>}
          />
        </View>

        {/* Note & Submit */}
        <View style={styles.card}>
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            placeholder="e.g., Requested delivery Thursday"
            value={note}
            onChangeText={setNote}
            style={styles.input}
            autoCapitalize="sentences"
          />
        </View>

        <TouchableOpacity
          style={[styles.primary, (!selectedSupplier || totalLines === 0) && styles.primaryDisabled]}
          onPress={saveDraft}
          disabled={!selectedSupplier || totalLines === 0}
        >
          <Text style={styles.primaryText}>Save Draft ({totalLines} item{totalLines === 1 ? '' : 's'})</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  card: { backgroundColor: '#F2F2F7', padding: 10, borderRadius: 12, gap: 6 },
  label: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  rowItem: { backgroundColor: 'white', borderRadius: 10, padding: 10 },
  rowItemSelected: { borderWidth: 2, borderColor: '#0A84FF' },
  rowTitle: { fontWeight: '700' },
  sub: { opacity: 0.7 },
  selectedPill: { marginTop: 6, fontWeight: '700', color: '#0A84FF' },

  prodRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderRadius: 10, padding: 10, gap: 6 },
  qtyBtn: { backgroundColor: '#E5E7EB', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  qtyBtnText: { fontWeight: '900' },
  qtyInput: { width: 56, textAlign: 'center', borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 8, paddingVertical: 6 },

  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: 'white', fontWeight: '800' },
  bold: { fontWeight: '800' },
});
