import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, FlatList, TextInput, TouchableOpacity, Modal, Pressable } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { createDraftOrderWithLines, OrderLine } from '../../services/orders';
import { listSuppliers, Supplier } from '../../services/suppliers';
import { listProducts } from '../../services/products';

type Product = {
  id: string;
  name: string;
  sku?: string | null;
  // We won't rely on prices structure here to avoid N+1; unitCost can be null for now.
};

export default function NewOrderScreen() {
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<OrderLine[]>([]);
  const [note, setNote] = useState<string>('');
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      if (!venueId) { setLoading(false); return; }
      try {
        setLoading(true);
        const [sups, prods] = await Promise.all([
          listSuppliers(venueId),
          listProducts(venueId) as unknown as Promise<Product[]>,
        ]);
        setSuppliers(sups);
        setProducts(prods);
      } catch (e: any) {
        Alert.alert('Load failed', e?.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
    );
  }, [products, search]);

  function addToCart(p: Product) {
    // If already in cart, bump qty
    setCart(prev => {
      const i = prev.findIndex(l => l.productId === p.id && !l.isCustom);
      if (i >= 0) {
        const copy = prev.slice();
        copy[i] = { ...copy[i], qty: (copy[i].qty || 0) + 1 };
        return copy;
      }
      return prev.concat([{ productId: p.id, name: p.name, sku: p.sku ?? null, qty: 1, unitCost: null, isCustom: false }]);
    });
  }

  function updateQty(idx: number, qty: number) {
    if (qty <= 0) {
      removeLine(idx);
      return;
    }
    setCart(prev => prev.map((l, i) => i === idx ? { ...l, qty } : l));
  }

  function removeLine(idx: number) {
    setCart(prev => prev.filter((_, i) => i !== idx));
  }

  function addCustomLine() {
    // Minimal inline "form": add a blank row the user can fill
    setCart(prev => prev.concat([{
      productId: null,
      name: 'Custom item',
      sku: null,
      qty: 1,
      unitCost: null,
      isCustom: true,
    }]));
  }

  async function saveDraft() {
    try {
      if (!venueId) { Alert.alert('Missing venue', 'Attach a venue first.'); return; }
      if (!supplierId) { Alert.alert('Pick a supplier', 'Please choose a supplier for this order.'); return; }
      const clean = cart.filter(l => l.qty && l.qty > 0);
      if (clean.length === 0) { Alert.alert('Empty cart', 'Add at least one line.'); return; }

      const res = await createDraftOrderWithLines(venueId, supplierId, clean, note || null);
      Alert.alert('Draft saved', `Order ${res.orderId} created under Orders.`);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Unknown error');
    }
  }

  if (loading) {
    return <View style={s.center}><ActivityIndicator /><Text>Loading…</Text></View>;
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>New Order</Text>

      {/* Supplier chooser */}
      <Pressable style={[s.card, s.rowBetween]} onPress={() => setSupplierPickerOpen(true)}>
        <View>
          <Text style={s.label}>Supplier</Text>
          <Text style={s.value}>{suppliers.find(s => s.id === supplierId)?.name || 'Choose supplier'}</Text>
        </View>
        <Text style={s.pick}>Pick</Text>
      </Pressable>

      <Modal transparent visible={supplierPickerOpen} animationType="fade" onRequestClose={() => setSupplierPickerOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Select Supplier</Text>
            <FlatList
              data={suppliers}
              keyExtractor={(it) => it.id}
              style={{ maxHeight: 360 }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.card, { padding: 12 }]}
                  onPress={() => { setSupplierId(item.id); setSupplierPickerOpen(false); }}
                >
                  <Text style={s.value}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={[s.btn, { marginTop: 12 }]} onPress={() => setSupplierPickerOpen(false)}>
              <Text style={s.btnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add lines */}
      <View style={[s.card, { gap: 8 }]}>
        <Text style={s.label}>Search Products</Text>
        <TextInput
          placeholder="Name or SKU"
          value={search}
          onChangeText={setSearch}
          style={s.input}
          autoCapitalize="none"
        />
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          style={{ maxHeight: 220 }}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
          renderItem={({ item }) => (
            <View style={[s.rowBetween, { paddingVertical: 6 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.value}>{item.name}</Text>
                {!!item.sku && <Text style={s.sub}>SKU: {item.sku}</Text>}
              </View>
              <TouchableOpacity style={[s.btnLite]} onPress={() => addToCart(item)}>
                <Text style={s.btnLiteText}>Add</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={<Text style={s.sub}>No products match your search.</Text>}
        />
        <TouchableOpacity onPress={addCustomLine} style={[s.btnGhost]}>
          <Text style={s.btnGhostText}>+ Add custom item</Text>
        </TouchableOpacity>
      </View>

      {/* Cart */}
      <View style={[s.card, { gap: 8 }]}>
        <Text style={s.label}>Cart</Text>
        {cart.length === 0 ? (
          <Text style={s.sub}>No lines yet.</Text>
        ) : (
          <FlatList
            data={cart}
            keyExtractor={(_, i) => String(i)}
            ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
            renderItem={({ item, index }) => (
              <View style={[s.rowBetween, { alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.value}>{item.name}{item.isCustom ? ' (custom)' : ''}</Text>
                  {!!item.sku && <Text style={s.sub}>SKU: {item.sku}</Text>}
                </View>
                <View style={s.qtyRow}>
                  <TouchableOpacity style={s.qtyBtn} onPress={() => updateQty(index, (item.qty || 0) - 1)}>
                    <Text style={s.qtyBtnText}>-</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={String(item.qty || 0)}
                    onChangeText={(t) => updateQty(index, Math.max(0, parseInt(t || '0', 10) || 0))}
                    keyboardType="numeric"
                    style={s.qtyInput}
                  />
                  <TouchableOpacity style={s.qtyBtn} onPress={() => updateQty(index, (item.qty || 0) + 1)}>
                    <Text style={s.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btnLite, { marginLeft: 8 }]} onPress={() => removeLine(index)}>
                    <Text style={s.btnLiteText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* Note + Save */}
      <View style={[s.card, { gap: 8 }]}>
        <Text style={s.label}>Note (optional)</Text>
        <TextInput
          placeholder="e.g. Deliver Friday AM"
          value={note}
          onChangeText={setNote}
          style={s.input}
        />
      </View>

      <TouchableOpacity
        style={[s.btnPrimary, (!venueId || !supplierId || cart.length === 0) && s.btnDisabled]}
        onPress={saveDraft}
        disabled={!venueId || !supplierId || cart.length === 0}
      >
        <Text style={s.btnPrimaryText}>Save as Draft</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12 },

  label: { fontWeight: '700' },
  value: { fontWeight: '600' },
  sub: { opacity: 0.7 },

  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },

  btn: { backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: '800' },

  btnLite: { backgroundColor: '#E5E7EB', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  btnLiteText: { fontWeight: '700' },

  btnGhost: { paddingVertical: 8, alignItems: 'center' },
  btnGhostText: { color: '#0A84FF', fontWeight: '700' },

  btnPrimary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  btnPrimaryText: { color: 'white', fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },

  qtyRow: { flexDirection: 'row', alignItems: 'center' },
  qtyBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5E7EB' },
  qtyBtnText: { fontSize: 18, fontWeight: '900' },
  qtyInput: { width: 56, textAlign: 'center', borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 8, marginHorizontal: 6, paddingVertical: 6 },

  pick: { color: '#0A84FF', fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: 'white', borderRadius: 14, padding: 16, width: '100%', maxWidth: 520 },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10 },
});
