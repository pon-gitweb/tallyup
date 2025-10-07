// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVenueId } from '../../context/VenueProvider';
import { listSuppliers, Supplier } from '../../services/suppliers';
import { listProducts, Product } from '../../services/products';
import { createDraftOrderWithLines, OrderLine } from '../../services/orders';

type Line = OrderLine & { key: string };

export default function NewOrderScreen() {
  const insets = useSafeAreaInsets();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!venueId) return;
      try {
        setLoading(true);
        const [ss, ps] = await Promise.all([listSuppliers(venueId), listProducts(venueId)]);
        if (!mounted) return;
        setSuppliers(ss);
        setProducts(ps);
        // preselect first supplier if none
        if (!supplierId && ss.length > 0) setSupplierId(ss[0].id);
      } catch (e: any) {
        Alert.alert('Load failed', e?.message || 'Unknown error');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [venueId]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter(p => {
        // Supplier-scoped list (client-side only)
        if (!supplierId) return false;
        if ((p as any)?.supplierId !== supplierId) return false;

        // Optional search on name/SKU
        if (!q) return true;
        const name = (p.name || '').toLowerCase();
        const sku  = (p.sku  || '').toLowerCase();
        return name.includes(q) || sku.includes(q);
      })
      .slice(0, 100);
  }, [products, search, supplierId]);

  function addProduct(p: Product) {
    const exists = lines.find(l => l.productId === p.id);
    if (exists) {
      setLines(ls => ls.map(l => l.productId === p.id ? { ...l, qty: Number(l.qty || 0) + 1 } : l));
      return;
    }
    const key = `${p.id}-${Date.now()}`;
    const unitCost =
      typeof (p as any)?.unitCost === 'number'
        ? Number((p as any).unitCost)
        : undefined;
    const packSize = (p as any)?.packSize ? Number((p as any).packSize) : undefined;

    setLines(ls => [
      ...ls,
      {
        key,
        productId: p.id,
        name: p.name || p.sku || 'Item',
        unit: (p as any)?.unit || '',
        unitCost,
        packSize,
        qty: 1,
      },
    ]);
  }

  function updateQty(productId: string, qty: number) {
    if (Number.isNaN(qty) || qty < 0) qty = 0;
    setLines(ls => ls.map(l => l.productId === productId ? { ...l, qty } : l));
  }

  function removeLine(productId: string) {
    setLines(ls => ls.filter(l => l.productId !== productId));
  }

  const total = useMemo(() => {
    return lines.reduce((acc, l) => {
      const price = Number(l.unitCost || 0);
      const q = Number(l.qty || 0);
      return acc + price * q;
    }, 0);
  }, [lines]);

  async function saveDraft() {
    if (!venueId) return Alert.alert('No venue', 'You are not attached to a venue.');
    if (!supplierId) return Alert.alert('Choose supplier', 'Please select a supplier first.');
    const nonZero = lines.filter(l => Number(l.qty) > 0);
    if (nonZero.length === 0) {
      return Alert.alert('Nothing to save', 'Add at least one product with a quantity.');
    }
    try {
      const __oid = await createDraftOrderWithLines(venueId, supplierId, nonZero, note || null);
      const orderId = typeof __oid === 'string' ? __oid : (__oid?.orderId ?? '');
      Alert.alert('Draft created', 'Your order was saved as a draft.');
      console.log('[Orders] save draft ok', JSON.stringify({ orderId, supplierId }));
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Unknown error');
    }
  }

  // Sticky footer is always visible; add spacer at bottom of ScrollView so content isn't hidden.
  const footerHeight = 72 + insets.bottom;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingBottom: footerHeight + 12 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>New Order</Text>

          {/* Supplier selector (simple) */}
          <View style={styles.card}>
            <Text style={styles.label}>Supplier</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {suppliers.map(s => {
                const active = s.id === supplierId;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setSupplierId(s.id)}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>{s.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Search */}
          <View style={styles.card}>
            <Text style={styles.label}>Search products</Text>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Type a name or SKU"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>

          {/* Product list to add */}
          <View style={styles.card}>
            <Text style={styles.label}>Products</Text>
            <FlatList
              data={filteredProducts}
              keyExtractor={(p) => p.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              renderItem={({ item: p }) => {
                return (
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{p.name || p.sku}</Text>
                      {!!(p as any)?.unit && <Text style={styles.sub}>Unit: {(p as any).unit}</Text>}
                    </View>
                    <TouchableOpacity onPress={() => addProduct(p)} style={styles.addBtn}>
                      <Text style={styles.addText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={{ opacity: 0.6 }}>No products match your search.</Text>}
            />
          </View>

          {/* Lines (cart) */}
          <View style={styles.card}>
            <Text style={styles.label}>Order Lines</Text>
            {lines.length === 0 ? (
              <Text style={{ opacity: 0.6 }}>No items added yet.</Text>
            ) : (
              lines.map(l => (
                <View key={l.key} style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{l.name}</Text>
                    <Text style={styles.sub}>
                      {(l.unitCost != null ? `@ ${Number(l.unitCost).toFixed(2)}` : '@ —')}
                      {l.packSize ? ` · pack ${l.packSize}` : ''}
                      {!!l.unit ? ` · ${l.unit}` : ''}
                    </Text>
                  </View>
                  <View style={styles.qtyWrap}>
                    <TouchableOpacity onPress={() => updateQty(l.productId, Number(l.qty || 0) - 1)} style={styles.qtyBtn}><Text style={styles.qtyBtnText}>-</Text></TouchableOpacity>
                    <TextInput
                      value={String(l.qty ?? 0)}
                      onChangeText={(t) => updateQty(l.productId, Number(t.replace(/[^0-9.]/g, '')))}
                      keyboardType="numeric"
                      style={styles.qtyInput}
                    />
                    <TouchableOpacity onPress={() => updateQty(l.productId, Number(l.qty || 0) + 1)} style={styles.qtyBtn}><Text style={styles.qtyBtnText}>+</Text></TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => removeLine(l.productId)} style={styles.removeBtn}>
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          {/* Note */}
          <View style={styles.card}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Delivery window, access notes, specials…"
              multiline
              textAlignVertical="top"
              style={[styles.input, { height: 90 }]}
            />
          </View>

          {/* Totals */}
          <View style={[styles.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <Text style={styles.totalLabel}>Estimated total</Text>
            <Text style={styles.totalValue}>${total.toFixed(2)}</Text>
          </View>
        </ScrollView>

        {/* Sticky footer */}
        <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity
            onPress={saveDraft}
            disabled={!supplierId || lines.length === 0}
            style={[styles.primary, (!supplierId || lines.length === 0) && styles.primaryDisabled]}
          >
            <Text style={styles.primaryText}>Save Draft</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, gap: 8 },
  label: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { fontWeight: '700' },
  sub: { opacity: 0.6 },
  addBtn: { backgroundColor: '#E5F0FF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  addText: { color: '#0A84FF', fontWeight: '800' },

  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  qtyWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { backgroundColor: '#E8E8ED', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  qtyBtnText: { fontWeight: '900' },
  qtyInput: { width: 56, textAlign: 'center', paddingVertical: 6, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 8, backgroundColor: '#fff' },
  removeBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  removeText: { color: '#C0392B', fontWeight: '700' },

  totalLabel: { fontWeight: '800' },
  totalValue: { fontWeight: '900', fontSize: 18 },

  footer: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E0E5',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: '#fff', fontWeight: '800' },
  pill: { backgroundColor: '#E8E8ED', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  pillActive: { backgroundColor: '#0A84FF' },
  pillText: { fontWeight: '700' },
  pillTextActive: { color: '#fff', fontWeight: '800' },
});
