import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, FlatList, TextInput, Switch, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { listSuppliers, Supplier } from '../../services/suppliers';
import { listProducts, Product } from '../../services/products';
import { createDraftOrderWithLines } from '../../services/orders';

type CartLine = {
  productId: string | null;   // null for free-text
  name: string;
  sku?: string | null;
  qty: number;
  unitCost?: number | null;
  packSize?: number | null;
  isCustom?: boolean;
};

export default function NewOrderScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);

  // Supplier & delivery
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState<string>(''); // YYYY-MM-DD

  // Product search & local cache
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // simple name/sku match
    return allProducts
      .filter(p => (p.name || '').toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q))
      .slice(0, 40);
  }, [allProducts, query]);

  // Cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const [roundToPack, setRoundToPack] = useState(true);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customSku, setCustomSku] = useState('');
  const [customQty, setCustomQty] = useState('1');
  const [customPrice, setCustomPrice] = useState('');

  useEffect(() => {
    (async () => {
      if (!venueId) { setLoading(false); return; }
      try {
        setLoading(true);
        const [sups, prods] = await Promise.all([
          listSuppliers(venueId),
          listProducts(venueId),
        ]);
        setSuppliers(sups);
        setAllProducts(prods);
        if (!supplierId && sups.length) setSupplierId(sups[0].id);
      } catch (e: any) {
        Alert.alert('Load Failed', e?.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId]);

  function addProductToCart(p: Product) {
    // Try to pull any price for the selected supplier if present on product
    // (Keep robust: price might live in prices subcollection; listProducts may not include it.
    // We'll default undefined; user can edit.)
    const existing = cart.find(l => l.productId === p.id);
    if (existing) {
      setCart(cart.map(l => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      return;
    }
    setCart([
      ...cart,
      {
        productId: p.id,
        name: p.name || p.id,
        sku: (p as any).sku ?? null,
        qty: 1,
        unitCost: (p as any).unitCost ?? null,   // best-effort if present on your model
        packSize: (p as any).packSize ?? null,
        isCustom: false,
      }
    ]);
    setQuery('');
  }

  function addCustomLine() {
    const name = customName.trim();
    if (!name) { Alert.alert('Missing name', 'Please enter a product name.'); return; }
    const qty = Math.max(0, Number(customQty) || 0);
    if (qty <= 0) { Alert.alert('Invalid quantity', 'Quantity must be at least 1.'); return; }
    const price = customPrice.trim() ? Number(customPrice) : null;
    setCart([
      ...cart,
      {
        productId: null,
        name,
        sku: customSku.trim() || null,
        qty,
        unitCost: isNaN(price as any) ? null : price,
        packSize: null,
        isCustom: true,
      }
    ]);
    setShowCustomForm(false);
    setCustomName(''); setCustomSku(''); setCustomQty('1'); setCustomPrice('');
  }

  function updateQty(idx: number, delta: number) {
    const next = [...cart];
    const cur = next[idx];
    const pack = roundToPack && (cur.packSize || 1) > 1 ? (cur.packSize || 1) : 1;
    const newQty = Math.max(0, (cur.qty + delta*pack));
    next[idx] = { ...cur, qty: newQty };
    setCart(next);
  }

  function updatePrice(idx: number, val: string) {
    const next = [...cart];
    next[idx] = { ...next[idx], unitCost: val.trim() === '' ? null : Number(val) };
    setCart(next);
  }

  function removeLine(idx: number) {
    const next = [...cart];
    next.splice(idx, 1);
    setCart(next);
  }

  async function saveDraft() {
    if (!venueId) return;
    if (!supplierId) { Alert.alert('Pick a supplier'); return; }
    const lines = cart
      .filter(l => l.qty > 0)
      .map(l => ({
        productId: l.productId!,
        name: l.name,
        sku: l.sku ?? null,
        qty: l.qty,
        unitCost: l.unitCost ?? null,
        packSize: l.packSize ?? null,
        isCustom: !!l.isCustom,
      }));
    if (lines.length === 0) { Alert.alert('Nothing to save', 'Add at least one line with qty > 0'); return; }
    try {
      await createDraftOrderWithLines(
        venueId,
        supplierId,
        lines as any,
        deliveryDate ? `Requested delivery: ${deliveryDate}` : null
      );

      // if custom lines present, offer to email supplier for confirmation/new item setup
      const sup = suppliers.find(s => s.id === supplierId);
      const hasCustom = lines.some(l => (l as any).isCustom);
      if (hasCustom && sup?.email) {
        const body = [
          `Hello ${sup.name || 'Supplier'},`,
          ``,
          `We placed a draft order containing new/unknown items:`,
          ...lines
            .filter(l => (l as any).isCustom)
            .map(l => `- ${l.name}${l.sku ? ` (SKU: ${l.sku})` : ''} × ${l.qty}${l.unitCost ? ` @ ${l.unitCost}` : ''}`),
          ``,
          `Could you please confirm availability and pricing (and add these to our price list if possible)?`,
          ``,
          `Thanks,`,
          `TallyUp`,
        ].join('%0D%0A');
        const uri = `mailto:${encodeURIComponent(sup.email)}?subject=${encodeURIComponent('New / unknown items in order')}&body=${body}`;
        Linking.openURL(uri).catch(() => {/* no-op */});
      }

      Alert.alert('Draft saved', 'Your new order has been created in Drafts.');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Unknown error');
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator/><Text>Loading…</Text></View>;
  }

  const supplier = suppliers.find(s => s.id === supplierId || '');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.wrap}>
        <Text style={styles.title}>New Order</Text>

        {/* Supplier & delivery */}
        <View style={styles.row}>
          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.label}>Supplier</Text>
            <View style={styles.pillRow}>
              {suppliers.map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => setSupplierId(s.id)}
                  style={[styles.pill, supplierId === s.id && styles.pillActive]}
                >
                  <Text style={[styles.pillText, supplierId === s.id && styles.pillTextActive]} numberOfLines={1}>
                    {s.name || s.id}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.label}>Requested delivery (YYYY-MM-DD)</Text>
            <TextInput
              placeholder="2025-09-01"
              value={deliveryDate}
              onChangeText={setDeliveryDate}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <View style={[styles.card, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={styles.label}>Round to pack</Text>
            <Switch value={roundToPack} onValueChange={setRoundToPack} />
          </View>
        </View>

        {/* Search existing products */}
        <View style={[styles.card, { gap: 8 }]}>
          <Text style={styles.label}>Search products (name or SKU)</Text>
          <TextInput
            placeholder="Search…"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            style={styles.input}
          />
          {!!query && (
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={results}
              keyExtractor={(p) => (p as any).id}
              style={{ maxHeight: 180 }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.searchRow} onPress={() => addProductToCart(item as any)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineName} numberOfLines={1}>{(item as any).name}</Text>
                    {!!(item as any).sku && <Text style={styles.sub}>SKU: {(item as any).sku}</Text>}
                  </View>
                  <Text style={styles.addBtn}>Add</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{ opacity: 0.6 }}>No matches.</Text>}
            />
          )}
        </View>

        {/* Free-text add */}
        <View style={[styles.card, { gap: 10 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.label}>Add free-text item</Text>
            <TouchableOpacity onPress={() => setShowCustomForm(s => !s)}>
              <Text style={[styles.link]}>{showCustomForm ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>
          {showCustomForm && (
            <View style={{ gap: 8 }}>
              <TextInput placeholder="Name *" value={customName} onChangeText={setCustomName} style={styles.input} />
              <TextInput placeholder="SKU (optional)" value={customSku} onChangeText={setCustomSku} style={styles.input} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput placeholder="Qty" keyboardType="numeric" value={customQty} onChangeText={setCustomQty} style={[styles.input, { flex: 1 }]} />
                <TextInput placeholder="Unit cost" keyboardType="decimal-pad" value={customPrice} onChangeText={setCustomPrice} style={[styles.input, { flex: 1 }]} />
              </View>
              <TouchableOpacity style={styles.secondary} onPress={addCustomLine}>
                <Text style={styles.secondaryText}>Add custom line</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Cart */}
        <View style={[styles.card, { gap: 8, flex: 1 }]}>
          <Text style={styles.label}>Lines ({cart.length})</Text>
          {cart.length === 0 ? <Text style={{ opacity: 0.6 }}>No items yet.</Text> : null}
          <FlatList
            data={cart}
            keyExtractor={(_, i) => String(i)}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item, index }) => (
              <View style={styles.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName} numberOfLines={1}>
                    {item.name}{item.isCustom ? ' (custom)' : ''}
                  </Text>
                  {!!item.sku && <Text style={styles.sub}>SKU: {item.sku}</Text>}
                </View>
                <View style={styles.qtyBox}>
                  <TouchableOpacity onPress={() => updateQty(index, -1)}><Text style={styles.qtyBtn}>−</Text></TouchableOpacity>
                  <Text style={styles.qtyText}>{item.qty}</Text>
                  <TouchableOpacity onPress={() => updateQty(index, +1)}><Text style={styles.qtyBtn}>+</Text></TouchableOpacity>
                </View>
                <TextInput
                  placeholder="@"
                  keyboardType="decimal-pad"
                  value={item.unitCost == null ? '' : String(item.unitCost)}
                  onChangeText={(v) => updatePrice(index, v)}
                  style={[styles.input, { width: 80 }]}
                />
                <TouchableOpacity onPress={() => removeLine(index)}>
                  <Text style={[styles.link, { marginLeft: 8 }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>

        <TouchableOpacity style={[styles.primary, { opacity: supplier ? 1 : 0.5 }]} onPress={saveDraft} disabled={!supplier}>
          <Text style={styles.primaryText}>Save Draft</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  card: { backgroundColor: '#F2F2F7', padding: 10, borderRadius: 12 },
  row: { flexDirection: 'row', gap: 10 },
  label: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  link: { color: '#0A84FF', fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  lineName: { fontWeight: '700' },
  sub: { opacity: 0.7 },
  addBtn: { color: '#0A84FF', fontWeight: '800' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#E5E7EB' },
  pillActive: { backgroundColor: '#0A84FF' },
  pillText: { fontWeight: '700', color: '#111' },
  pillTextActive: { color: 'white' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4 },
  qtyBtn: { fontSize: 20, fontWeight: '900', paddingHorizontal: 6 },
  qtyText: { fontWeight: '900', width: 36, textAlign: 'center' },
  secondary: { backgroundColor: '#E5E7EB', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  secondaryText: { fontWeight: '800' },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '800' },
});
