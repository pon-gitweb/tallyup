// @ts-nocheck
/**
 * InventoryImportPreviewScreen
 * Shows Claude's extraction result for user review before importing.
 * User can rename areas, move products, delete items before confirming.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { inferDefaultPAR, getPARDescription } from '../../services/parDefaults';
import { markStepComplete } from '../../services/guide/SetupGuideService';
import type { ExtractionResult, ExtractedProduct } from './InventoryImportScreen';

function InventoryImportPreviewScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const C = useColours();
  const db = getFirestore();

  const { result, venueId } = route.params as { result: ExtractionResult; venueId: string };
  const [products, setProducts] = useState<ExtractedProduct[]>(result.products);
  const [importing, setImporting] = useState(false);

  // Group products by area/department
  const grouped = useMemo(() => {
    const groups: Record<string, ExtractedProduct[]> = {};
    for (const p of products) {
      const key = p.area || p.department || p.category || 'General';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }, [products]);

  const onRemove = useCallback((name: string) => {
    setProducts(prev => prev.filter(p => p.name !== name));
  }, []);

  const onConfirm = useCallback(async () => {
    if (products.length === 0) {
      Alert.alert('No products', 'Add at least one product before importing.');
      return;
    }
    setImporting(true);
    try {
      const productsCol = collection(db, 'venues', venueId, 'products');
      const batch: Promise<void>[] = [];

      for (const product of products) {
        const ref = doc(productsCol);
        batch.push(setDoc(ref, {
          name: product.name,
          unit: product.unit || 'unit',
          category: product.category || null,
          area: product.area || null,
          department: product.department || null,
          costPrice: product.costPrice ?? null,
          parLevel: product.parLevel ?? inferDefaultPAR(product.name, product.unit),
          importedAt: serverTimestamp(),
          importSource: 'inventory-import',
        }));
      }

      await Promise.all(batch);
      await markStepComplete('products_loaded');
      setImporting(false);

      Alert.alert(
        `${products.length} products imported!`,
        result.hasPricing
          ? 'Your inventory is ready. Start your first stocktake now!'
          : 'Your inventory is ready. Prices were not found in your file — you can add them later when you link suppliers.',
        [
          { text: 'Start stocktake', onPress: () => nav.navigate('StockControl') },
          { text: 'Go to dashboard', onPress: () => nav.navigate('Dashboard') },
        ]
      );
    } catch (e: any) {
      setImporting(false);
      Alert.alert('Import failed', e?.message || 'Please try again.');
    }
  }, [products, venueId, db, nav, result.hasPricing]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <View style={{ backgroundColor: C.primary, borderRadius: 16, padding: 20, gap: 6 }}>
        <Text style={{ fontSize: 22, fontWeight: '900', color: '#fff' }}>
          We found {products.length} products
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
          {result.summary}
        </Text>
      </View>

      {/* Warnings */}
      {result.warnings?.length > 0 && (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FDE68A' }}>
          <Text style={{ fontWeight: '800', color: '#92400E', marginBottom: 6 }}>A few things to check</Text>
          {result.warnings.map((w, i) => (
            <Text key={i} style={{ color: '#92400E', fontSize: 13, marginBottom: 2 }}>• {w}</Text>
          ))}
        </View>
      )}

      {/* No pricing notice */}
      {!result.hasPricing && (
        <View style={{ backgroundColor: '#EFF6FF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BFDBFE' }}>
          <Text style={{ fontWeight: '800', color: '#1D4ED8', marginBottom: 4 }}>No pricing found</Text>
          <Text style={{ color: '#1D4ED8', fontSize: 13 }}>
            Your file didn't include cost prices. That's fine — you can still start stocktaking now and add prices later when you link your suppliers.
          </Text>
        </View>
      )}

      {/* Structure suggestion */}
      {!result.hasStructure && (
        <View style={{ backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' }}>
          <Text style={{ fontWeight: '800', color: '#166534', marginBottom: 4 }}>We organised your products</Text>
          <Text style={{ color: '#166534', fontSize: 13 }}>
            Your file didn't have departments or areas, so we've grouped everything under "General". You can reorganise into departments and areas after importing.
          </Text>
        </View>
      )}

      {/* Product groups */}
      <Text style={{ fontWeight: '900', color: C.text, fontSize: 16 }}>
        Review your products — remove anything that doesn't look right
      </Text>

      {Object.entries(grouped).map(([area, items]) => (
        <View key={area} style={{ backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
          {/* Area header */}
          <View style={{ backgroundColor: C.primaryLight, padding: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '900', color: C.accent }}>{area}</Text>
            <Text style={{ color: C.textSecondary, fontSize: 12 }}>{items.length} items</Text>
          </View>
          {/* Items */}
          {items.map((product, i) => (
            <View key={product.name + i} style={{
              flexDirection: 'row', alignItems: 'center', padding: 12,
              borderTopWidth: i > 0 ? 1 : 0, borderTopColor: C.border,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: C.text }}>{product.name}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  {product.unit && (
                    <Text style={{ color: C.textSecondary, fontSize: 11 }}>{product.unit}</Text>
                  )}
                  {product.costPrice != null && (
                    <Text style={{ color: C.success, fontSize: 11, fontWeight: '700' }}>${product.costPrice.toFixed(2)}</Text>
                  )}
                  <Text style={{ color: C.textSecondary, fontSize: 11 }}>
                    PAR: {product.parLevel ?? inferDefaultPAR(product.name, product.unit)} (suggested)
                  </Text>
                  <View style={{
                    backgroundColor: product.confidence === 'high' ? '#F0FDF4' : product.confidence === 'medium' ? '#FEF3C7' : '#FEF2F2',
                    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999,
                  }}>
                    <Text style={{
                      fontSize: 10, fontWeight: '700',
                      color: product.confidence === 'high' ? '#166534' : product.confidence === 'medium' ? '#92400E' : '#DC2626',
                    }}>
                      {product.confidence === 'high' ? 'Confident' : product.confidence === 'medium' ? 'Check' : 'Unsure'}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity onPress={() => onRemove(product.name)}
                style={{ padding: 8 }}>
                <Text style={{ color: C.error, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}

      {/* Import button */}
      <TouchableOpacity onPress={onConfirm} disabled={importing}
        style={{ backgroundColor: C.primary, borderRadius: 12, padding: 18, alignItems: 'center' }}>
        {importing
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
              Import {products.length} products →
            </Text>
        }
      </TouchableOpacity>

      <TouchableOpacity onPress={() => nav.goBack()} style={{ alignItems: 'center', padding: 8 }}>
        <Text style={{ color: C.textSecondary, fontSize: 13 }}>Start over with a different file</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(InventoryImportPreviewScreen, 'InventoryImportPreview');
