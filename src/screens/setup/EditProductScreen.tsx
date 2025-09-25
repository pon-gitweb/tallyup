import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { createProduct, updateProduct, Product } from '../../services/products';
import { listSuppliers, Supplier } from '../../services/suppliers';

export default function EditProductScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = useVenueId();
  const { productId, product }: { productId?: string|null; product?: Product } = route.params || {};

  const [name, setName] = useState(product?.name || '');
  const [sku, setSku] = useState(product?.sku || '');
  const [unit, setUnit] = useState(product?.unit || '');
  const [par, setPar] = useState(
    product?.parLevel !== undefined && product?.parLevel !== null ? String(product.parLevel) : ''
  );
  const [packSize, setPackSize] = useState(product?.packSize != null ? String(product.packSize) : '');
  const [cost, setCost] = useState(product?.cost != null ? String(product.cost) : '');
  const [defaultSupplierId, setDefaultSupplierId] = useState<string | undefined | null>(product?.defaultSupplierId || null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!venueId) return;
      try {
        const rows = await listSuppliers(venueId);
        setSuppliers(rows);
      } catch (e: any) {
        console.log('[Products] supplier list error', e?.message);
      }
    })();
  }, [venueId]);

  async function onSave() {
    if (!venueId) { Alert.alert('No Venue', 'Attach or create a venue first.'); return; }
    if (!name.trim()) { Alert.alert('Name required', 'Enter product name.'); return; }

    setBusy(true);
    try {
      const payload: Partial<Product> = {
        name: name.trim(),
        sku: sku.trim() || undefined,
        unit: unit.trim() || undefined,
        parLevel: par === '' ? null : Number(par),
        defaultSupplierId: defaultSupplierId || null,
        packSize: packSize === '' ? null : Number(packSize),
        cost: cost === '' ? null : Number(cost),
      };

      if (productId) {
        await updateProduct(venueId, productId, payload);
      } else {
        await createProduct(venueId, payload as Product);
      }
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{productId ? 'Edit Product' : 'New Product'}</Text>

      <Text style={styles.lbl}>Name</Text>
      <TextInput style={styles.inp} value={name} onChangeText={setName} />

      <Text style={styles.lbl}>SKU</Text>
      <TextInput style={styles.inp} value={sku} onChangeText={setSku} autoCapitalize="none" />

      <Text style={styles.lbl}>Unit (bottle, kg, each…)</Text>
      <TextInput style={styles.inp} value={unit} onChangeText={setUnit} autoCapitalize="none" />

      <Text style={styles.lbl}>Par Level</Text>
      <TextInput style={styles.inp} value={par} onChangeText={setPar} keyboardType="numeric" />

      <Text style={styles.lbl}>Pack Size</Text>
      <TextInput style={styles.inp} value={packSize} onChangeText={setPackSize} keyboardType="numeric" />

      <Text style={styles.lbl}>Cost</Text>
      <TextInput style={styles.inp} value={cost} onChangeText={setCost} keyboardType="numeric" />

      <Text style={styles.lbl}>Default Supplier ID</Text>
      <TextInput
        style={styles.inp}
        value={defaultSupplierId || ''}
        onChangeText={setDefaultSupplierId}
        autoCapitalize="none"
        placeholder={suppliers.length ? `e.g. ${suppliers[0].id}` : 'supplierId (optional)'}
      />

      <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={onSave} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  lbl: { fontWeight: '700', marginTop: 8 },
  inp: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  primary: { marginTop: 12, backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
});
