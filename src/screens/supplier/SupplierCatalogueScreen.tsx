// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRoute } from '@react-navigation/native';
import { SupplierPortalService, CatalogueProduct } from '../../services/supplier/SupplierPortalService';
import { useColours } from '../../context/ThemeContext';
import { AI_BASE_URL } from '../../config/ai';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function SupplierCatalogueScreen() {
  const route = useRoute<any>();
  const { supplierId } = route.params;
  const colours = useColours();
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setProducts(await SupplierPortalService.getCatalogue(supplierId));
    setLoading(false);
  }, [supplierId]);

  useEffect(() => { load(); }, [load]);

  const onUploadCatalogue = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      setUploading(true);
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      // Use the extract-inventory endpoint to parse catalogue
      const resp = await fetch(`${AI_BASE_URL}/api/extract-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId: supplierId, fileBase64: base64, fileName: asset.name, mimeType: asset.mimeType || 'text/csv' }),
      });
      const data = await resp.json();
      if (data.products?.length > 0) {
        for (const p of data.products) {
          await SupplierPortalService.upsertProduct(supplierId, {
            name: p.name, unit: p.unit || 'unit', price: p.costPrice || 0,
            category: p.category || null, sku: null, available: true,
          });
        }
        Alert.alert('Catalogue updated', `${data.products.length} products imported.`);
        await load();
      }
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Please try again.');
    } finally {
      setUploading(false);
    }
  }, [supplierId, load]);

  const onUpdatePrice = useCallback((product: CatalogueProduct) => {
    Alert.prompt('Update price', `Current: $${product.price.toFixed(2)}\nEnter new price:`, async (val) => {
      const price = parseFloat(val);
      if (isNaN(price) || price < 0) { Alert.alert('Invalid price'); return; }
      await SupplierPortalService.updatePrice(supplierId, product.id, price);
      Alert.alert('Price updated', 'Connected venues will be notified.');
      await load();
    }, 'plain-text', String(product.price));
  }, [supplierId, load]);

  const filtered = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <View style={{ flex: 1, backgroundColor: colours.background }}>
      <View style={{ padding: 16, gap: 10 }}>
        <TouchableOpacity onPress={onUploadCatalogue} disabled={uploading}
          style={{ backgroundColor: colours.primary, borderRadius: 12, padding: 14, alignItems: 'center' }}>
          {uploading ? <ActivityIndicator color="#fff" /> :
            <Text style={{ color: '#fff', fontWeight: '900' }}>📤 Upload price list (PDF, CSV, Excel)</Text>}
        </TouchableOpacity>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search products..."
          style={{ backgroundColor: colours.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colours.border, color: colours.text }} />
      </View>
      {loading ? <ActivityIndicator color={colours.accent} /> : (
        <FlatList data={filtered} keyExtractor={i => i.id}
          renderItem={({ item }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colours.border, backgroundColor: colours.surface }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colours.text }}>{item.name}</Text>
                <Text style={{ color: colours.textSecondary, fontSize: 12 }}>{item.unit} {item.category ? `· ${item.category}` : ''}</Text>
              </View>
              <TouchableOpacity onPress={() => onUpdatePrice(item)} style={{ backgroundColor: colours.primaryLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ fontWeight: '800', color: colours.accent }}>${item.price.toFixed(2)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => SupplierPortalService.markOutOfStock(supplierId, item.id, !item.available).then(load)}
                style={{ marginLeft: 8, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: item.available ? '#F0FDF4' : '#FEF2F2' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: item.available ? colours.success : colours.error }}>{item.available ? 'In stock' : 'OOS'}</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: colours.textSecondary, marginTop: 40 }}>No products yet — upload a price list</Text>}
        />
      )}
    </View>
  );
}
export default withErrorBoundary(SupplierCatalogueScreen, 'SupplierCatalogue');
