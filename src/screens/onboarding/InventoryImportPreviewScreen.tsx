// @ts-nocheck
/**
 * InventoryImportPreviewScreen
 * Shows Claude's extraction result for user review before importing.
 * User can rename areas, move products, delete items before confirming.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { getFirestore, setDoc, addDoc, collection, getDocs, doc, serverTimestamp } from 'firebase/firestore';
import { matchProductInList } from '../../services/matching';
import { getAuth } from 'firebase/auth';
import { incrementFullStocktakeCompleted, hasExistingBaseline } from '../../services/trialStocktake';
import {
  ActivityIndicator, Alert, Modal, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { inferDefaultPAR, getPARDescription } from '../../services/parDefaults';
import { markStepComplete } from '../../services/guide/SetupGuideService';
import type { ExtractionResult, ExtractedProduct } from './InventoryImportScreen';

type AreaRef = { deptId: string; areaId: string; areaName: string };
type AreaMapResult = { byName: Record<string, AreaRef>; defaultArea: AreaRef | null };

async function loadVenueAreaMap(db: ReturnType<typeof getFirestore>, venueId: string): Promise<AreaMapResult> {
  const byName: Record<string, AreaRef> = {};
  let defaultArea: AreaRef | null = null;
  const deptSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const deptDoc of deptSnap.docs) {
    const areaSnap = await getDocs(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'));
    for (const areaDoc of areaSnap.docs) {
      const entry: AreaRef = { deptId: deptDoc.id, areaId: areaDoc.id, areaName: (areaDoc.data() as any).name || 'Area' };
      byName[entry.areaName.toLowerCase()] = entry;
      if (!defaultArea) defaultArea = entry;
    }
  }
  return { byName, defaultArea };
}

function InventoryImportPreviewScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const themeColours = useColours();
  const db = getFirestore();

  const { result, venueId } = route.params as { result: ExtractionResult; venueId: string };
  const [products, setProducts] = useState<ExtractedProduct[]>(result.products);
  const [importing, setImporting] = useState(false);
  const [showImportGuide, setShowImportGuide] = useState(false);
  const [importGuideCount, setImportGuideCount] = useState(0);
  const [areaMap, setAreaMap] = useState<AreaMapResult>({ byName: {}, defaultArea: null });
  const [areaMapLoaded, setAreaMapLoaded] = useState(false);

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

  React.useEffect(() => {
    loadVenueAreaMap(db, venueId)
      .then((map) => { setAreaMap(map); setAreaMapLoaded(true); })
      .catch(() => setAreaMapLoaded(true)); // degrade gracefully — don't block import indefinitely
  }, [db, venueId]);

  const unmatchedAreaKeys = useMemo(() => {
    if (!areaMapLoaded || !areaMap.defaultArea) return new Set<string>();
    return new Set(Object.keys(grouped).filter(key => !areaMap.byName[key.toLowerCase()]));
  }, [grouped, areaMap, areaMapLoaded]);

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

      // Load existing products once for deduplication matching
      const existingSnap = await getDocs(productsCol);
      const existingProducts = existingSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

      const toCreate: typeof products = [];
      let skippedCount = 0;

      for (const product of products) {
        const mr = matchProductInList(existingProducts, { name: product.name });
        if (mr.confidence >= 0.95) {
          // Exact match — skip creation to avoid duplicate
          skippedCount++;
        } else {
          toCreate.push(product);
        }
      }

      const productRefs: { ref: ReturnType<typeof doc>; product: (typeof toCreate)[0] }[] = [];
      const batch: Promise<void>[] = [];
      for (const product of toCreate) {
        const ref = doc(productsCol);
        productRefs.push({ ref, product });
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

      // FIX 4: Create area items with productId links
      try {
        const { byName: areaByName, defaultArea } = await loadVenueAreaMap(db, venueId);
        if (defaultArea) {
          // Group products by resolved target area
          const byArea = new Map<string, { area: AreaRef; refs: typeof productRefs }>();
          for (const pr of productRefs) {
            const areaKey = (pr.product.area || '').toLowerCase();
            const target = areaByName[areaKey] || defaultArea;
            const mapKey = `${target.deptId}:${target.areaId}`;
            if (!byArea.has(mapKey)) byArea.set(mapKey, { area: target, refs: [] });
            byArea.get(mapKey)!.refs.push(pr);
          }
          for (const { area, refs } of byArea.values()) {
            const areaItemsPromises: Promise<void>[] = [];
            for (const { ref: prodRef, product } of refs) {
              const itemRef = doc(db, 'venues', venueId, 'departments', area.deptId, 'areas', area.areaId, 'items', prodRef.id);
              areaItemsPromises.push(setDoc(itemRef, {
                name: product.name,
                unit: product.unit || null,
                productId: prodRef.id,
                inductionStatus: 'pending',
                inductionSource: 'bulk-assign',
                lastCount: null,
                lastCountAt: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }));
            }
            await Promise.all(areaItemsPromises);
          }
        }
      } catch (e: any) {
        console.warn('[InventoryImport] area items error (non-fatal):', e?.message);
      }
      await markStepComplete('products_loaded');

      // Write baseline import record + increment cycle counter — first import only
      let alreadyHasBaseline = false;
      try { alreadyHasBaseline = await hasExistingBaseline(venueId); } catch {}
      if (!alreadyHasBaseline) {
        try {
          const uid = getAuth().currentUser?.uid ?? null;
          await addDoc(collection(db, 'venues', venueId, 'stockTakes'), {
            completedAt: serverTimestamp(),
            source: 'inventory-import',
            importedBy: uid,
            cycleNumber: 1,
            totalItems: products.length,
            stockValue: 0,
            venueId,
            note: 'Imported from stocktake sheet',
          });
        } catch {}
        try { await incrementFullStocktakeCompleted(venueId); } catch {}
      }

      setImporting(false);
      setImportGuideCount(toCreate.length);
      setShowImportGuide(true);
    } catch (e: any) {
      setImporting(false);
      Alert.alert('Import failed', e?.message || 'Please try again.');
    }
  }, [products, venueId, db, nav, result.hasPricing]);

  return (
    <>
    <ScrollView style={{ flex: 1, backgroundColor: themeColours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <View style={{ backgroundColor: themeColours.primary, borderRadius: 16, padding: 20, gap: 6 }}>
        <Text style={{ fontSize: 22, fontWeight: '900', color: themeColours.primaryText }}>
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

      {areaMapLoaded && unmatchedAreaKeys.size > 0 && areaMap.defaultArea && (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FDE68A' }}>
          <Text style={{ fontWeight: '800', color: '#92400E', marginBottom: 4 }}>
            {unmatchedAreaKeys.size} area{unmatchedAreaKeys.size !== 1 ? 's' : ''} from your file don't match your venue
          </Text>
          <Text style={{ color: '#92400E', fontSize: 13 }}>
            Products in those groups will be placed in "{areaMap.defaultArea.areaName}". You can move them to the right area after importing.
          </Text>
        </View>
      )}

      {/* Product groups */}
      <Text style={{ fontWeight: '900', color: themeColours.text, fontSize: 16 }}>
        Review your products — remove anything that doesn't look right
      </Text>

      {Object.entries(grouped).map(([area, items]) => (
        <View key={area} style={{ backgroundColor: themeColours.surface, borderRadius: 14, borderWidth: 1, borderColor: themeColours.border, overflow: 'hidden' }}>
          {/* Area header */}
          <View style={{ backgroundColor: themeColours.primaryLight, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, flexWrap: 'wrap' }}>
              <Text style={{ fontWeight: '900', color: themeColours.accent }}>{area}</Text>
              {areaMapLoaded && unmatchedAreaKeys.has(area) && areaMap.defaultArea && (
                <View style={{ backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: '#FDE68A' }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#92400E' }}>
                    {'->'} {areaMap.defaultArea.areaName}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{ color: themeColours.textSecondary, fontSize: 12 }}>{items.length} items</Text>
          </View>
          {/* Items */}
          {items.map((product, i) => (
            <View key={product.name + i} style={{
              flexDirection: 'row', alignItems: 'center', padding: 12,
              borderTopWidth: i > 0 ? 1 : 0, borderTopColor: themeColours.border,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: themeColours.text }}>{product.name}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  {product.unit && (
                    <Text style={{ color: themeColours.textSecondary, fontSize: 11 }}>{product.unit}</Text>
                  )}
                  {product.costPrice != null && (
                    <Text style={{ color: themeColours.success, fontSize: 11, fontWeight: '700' }}>${product.costPrice.toFixed(2)}</Text>
                  )}
                  <Text style={{ color: themeColours.textSecondary, fontSize: 11 }}>
                    PAR: {product.parLevel ?? inferDefaultPAR(product.name, product.unit)} (suggested)
                  </Text>
                  <View style={{
                    backgroundColor: product.confidence === 'high' ? '#F0FDF4' : product.confidence === 'medium' ? '#FEF3C7' : '#FEF2F2',
                    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999,
                  }}>
                    <Text style={{
                      fontSize: 10, fontWeight: '700',
                      color: product.confidence === 'high' ? '#166534' : product.confidence === 'medium' ? '#92400E' : themeColours.error,
                    }}>
                      {product.confidence === 'high' ? 'Confident' : product.confidence === 'medium' ? 'Check' : 'Unsure'}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity onPress={() => onRemove(product.name)}
                style={{ padding: 8 }}>
                <Text style={{ color: themeColours.error, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}

      {/* Import button */}
      <TouchableOpacity onPress={onConfirm} disabled={importing || !areaMapLoaded}
        style={{ backgroundColor: themeColours.primary, borderRadius: 12, padding: 18, alignItems: 'center', opacity: areaMapLoaded ? 1 : 0.5 }}>
        {importing
          ? <ActivityIndicator color={themeColours.primaryText} />
          : <Text style={{ color: themeColours.primaryText, fontWeight: '900', fontSize: 16 }}>
              Import {products.length} products →
            </Text>
        }
      </TouchableOpacity>
      {!areaMapLoaded && (
        <Text style={{ color: themeColours.textSecondary, fontSize: 12, textAlign: 'center', marginTop: -8 }}>
          Checking your venue's areas...
        </Text>
      )}

      <TouchableOpacity onPress={() => nav.goBack()} style={{ alignItems: 'center', padding: 8 }}>
        <Text style={{ color: themeColours.textSecondary, fontSize: 13 }}>Start over with a different file</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>

    <Modal visible={showImportGuide} animationType="slide" transparent onRequestClose={() => {}}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <View style={{ backgroundColor: '#f5f3ee', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36 }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: '#065f46', marginBottom: 4 }}>✓ Import complete</Text>
          <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>{importGuideCount} products added to your venue</Text>
          <Text style={{ fontSize: 13, fontWeight: '800', color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>What's next</Text>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' }}>
            <Text style={{ fontWeight: '800', color: '#0f172a', marginBottom: 4 }}>1. Run your first stocktake</Text>
            <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>Your products are ready to count.</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#065f46', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' }}
              onPress={() => { setShowImportGuide(false); nav.navigate('DepartmentSelection'); }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Go to stocktake →</Text>
            </TouchableOpacity>
          </View>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' }}>
            <Text style={{ fontWeight: '800', color: '#0f172a', marginBottom: 4 }}>2. Add cost prices</Text>
            <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>Add prices to products for dollar variance in reports.</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' }}
              onPress={() => { setShowImportGuide(false); nav.navigate('Products'); }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add prices →</Text>
            </TouchableOpacity>
          </View>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#e5e1d8' }}>
            <Text style={{ fontWeight: '800', color: '#0f172a', marginBottom: 4 }}>3. Scan your first invoice</Text>
            <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>We'll automatically link products to suppliers and update prices.</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#92400e', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' }}
              onPress={() => { setShowImportGuide(false); nav.navigate('Orders'); }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Scan invoice →</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={{ alignItems: 'center', paddingVertical: 12 }}
            onPress={() => { setShowImportGuide(false); nav.navigate('Dashboard'); }}
          >
            <Text style={{ color: '#6b7280', fontSize: 15, fontWeight: '600' }}>Got it — go to dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

export default withErrorBoundary(InventoryImportPreviewScreen, 'InventoryImportPreview');
