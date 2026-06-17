// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  Modal, FlatList, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { collection, getDocs, addDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId, useVenue } from '../../context/VenueProvider';
import { MockPOSAdapter } from '../../services/pos/adapters/MockPOSAdapter';
import { suggestMatch } from '../../services/pos/posMatching';
import { useToast } from '../../components/common/Toast';
import type { POSSaleItem } from '../../services/pos/POSService';
import type { MatchSuggestion } from '../../services/pos/posMatching';

// ─── Types ────────────────────────────────────────────────────────────────────

type MappingState = 'pending' | 'confirmed' | 'skipped';

type ItemState = {
  posItem: POSSaleItem;
  suggestion: MatchSuggestion;
  state: MappingState;
  resolvedType: 'product' | 'recipe' | null;
  resolvedId: string | null;
  resolvedName: string | null;
  conversionQty: string;   // decimal string, e.g. "1" or "0.0417"
  conversionUnit: string;  // 'each', 'bottle', 'case', 'ml', etc.
};

type PickerEntry = { id: string; name: string; type: 'product' | 'recipe' };

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function POSMappingScreen() {
  const venueId = useVenueId();
  const { user } = useVenue();
  const { showSuccess, showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ItemState[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; category?: string }>>([]);
  const [recipes, setRecipes] = useState<Array<{ id: string; name: string }>>([]);

  // Picker modal
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerFilter, setPickerFilter] = useState<'any' | 'product' | 'recipe'>('any');

  const mapped = items.filter(i => i.state !== 'pending').length;

  useEffect(() => {
    if (!venueId) return;
    loadAll();
  }, [venueId]);

  async function loadAll() {
    try {
      setLoading(true);
      const [prodsSnap, recsSnap, mappingsSnap] = await Promise.all([
        getDocs(collection(db, 'venues', venueId, 'products')),
        getDocs(query(collection(db, 'venues', venueId, 'recipes'), where('status', '==', 'confirmed'))),
        getDocs(collection(db, 'venues', venueId, 'posProductMappings')),
      ]);

      const prods = prodsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const recs = recsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const existingMap = new Map(
        mappingsSnap.docs.map(d => [(d.data() as any).posItemId as string, d.data() as any])
      );

      setProducts(prods);
      setRecipes(recs);

      const adapter = new MockPOSAdapter();
      const posItems = await adapter.getSaleItems();

      const newItems: ItemState[] = posItems.map(posItem => {
        const existing = existingMap.get(posItem.posItemId);
        if (existing) {
          const isSkipped = existing.mappingType === 'skipped';
          return {
            posItem,
            suggestion: { type: 'none', confidence: 'low' },
            state: isSkipped ? 'skipped' : 'confirmed',
            resolvedType: existing.mappingType === 'direct_product' ? 'product'
              : existing.mappingType === 'recipe' ? 'recipe' : null,
            resolvedId: existing.productId || existing.recipeId || null,
            resolvedName: existing.productName || existing.recipeName || null,
            conversionQty: String(existing.conversionRatio ?? 1),
            conversionUnit: existing.conversionUnit ?? 'each',
          };
        }

        const suggestion = suggestMatch(posItem, prods, recs);
        return {
          posItem,
          suggestion,
          state: 'pending',
          resolvedType: suggestion.type !== 'none' ? suggestion.type : null,
          resolvedId: suggestion.productId || suggestion.recipeId || null,
          resolvedName: suggestion.productName || suggestion.recipeName || null,
          conversionQty: '1',
          conversionUnit: 'each',
        };
      });

      setItems(newItems);
    } catch (e: any) {
      showError(e?.message || 'Could not load POS items');
    } finally {
      setLoading(false);
    }
  }

  function updateItem(idx: number, patch: Partial<ItemState>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  async function confirmMapping(idx: number) {
    const item = items[idx];
    if (!item.resolvedId || !item.resolvedType) {
      showError('Select a product or recipe first');
      return;
    }
    try {
      const isProduct = item.resolvedType === 'product';
      const ratio = isProduct ? (parseFloat(item.conversionQty) || 1) : null;
      const confidence =
        item.suggestion.type !== 'none' && (
          item.resolvedId === item.suggestion.productId ||
          item.resolvedId === item.suggestion.recipeId
        )
          ? (item.suggestion.confidence === 'high' ? 'auto-high' : 'auto-medium')
          : 'manual';

      await addDoc(collection(db, 'venues', venueId, 'posProductMappings'), {
        posSystem: 'mock',
        posItemId: item.posItem.posItemId,
        posItemName: item.posItem.posItemName,
        posSku: item.posItem.posSku,
        mappingType: isProduct ? 'direct_product' : 'recipe',
        productId: isProduct ? item.resolvedId : null,
        productName: isProduct ? item.resolvedName : null,
        conversionRatio: ratio,
        conversionUnit: isProduct ? (item.conversionUnit || 'each') : null,
        recipeId: !isProduct ? item.resolvedId : null,
        recipeName: !isProduct ? item.resolvedName : null,
        mappingConfidence: confidence,
        createdAt: serverTimestamp(),
        createdBy: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      });

      updateItem(idx, { state: 'confirmed' });
      showSuccess('Mapping saved');
    } catch (e: any) {
      showError(e?.message || 'Could not save mapping');
    }
  }

  async function skipItem(idx: number) {
    const item = items[idx];
    try {
      await addDoc(collection(db, 'venues', venueId, 'posProductMappings'), {
        posSystem: 'mock',
        posItemId: item.posItem.posItemId,
        posItemName: item.posItem.posItemName,
        posSku: item.posItem.posSku,
        mappingType: 'skipped',
        productId: null, productName: null,
        conversionRatio: null, conversionUnit: null,
        recipeId: null, recipeName: null,
        mappingConfidence: 'manual',
        createdAt: serverTimestamp(),
        createdBy: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      });
      updateItem(idx, { state: 'skipped' });
    } catch (e: any) {
      showError(e?.message || 'Could not skip item');
    }
  }

  function openPicker(idx: number, filter?: 'product' | 'recipe') {
    setPickerIdx(idx);
    setPickerSearch('');
    setPickerFilter(filter ?? 'any');
  }

  function onPickerSelect(entry: PickerEntry) {
    if (pickerIdx === null) return;
    updateItem(pickerIdx, {
      resolvedType: entry.type,
      resolvedId: entry.id,
      resolvedName: entry.name,
    });
    setPickerIdx(null);
  }

  const pickerEntries: PickerEntry[] = (() => {
    const q = pickerSearch.trim().toLowerCase();
    const filteredProds = products
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .map(p => ({ id: p.id, name: p.name, type: 'product' as const }));
    const filteredRecs = recipes
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .map(r => ({ id: r.id, name: r.name, type: 'recipe' as const }));
    if (pickerFilter === 'product') return filteredProds;
    if (pickerFilter === 'recipe') return filteredRecs;
    return [...filteredRecs, ...filteredProds]; // recipes listed first
  })();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator size="large" color="#0A84FF" />
        <Text style={{ color: '#6B7280' }}>Loading POS items…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>

      {/* Progress header */}
      <View style={{
        backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontWeight: '700', fontSize: 15, color: '#111' }}>Mock POS · {items.length} items</Text>
          <Text style={{ fontWeight: '800', color: mapped === items.length && items.length > 0 ? '#059669' : '#6B7280' }}>
            {mapped} of {items.length} mapped
          </Text>
        </View>
        <View style={{ height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, marginTop: 8 }}>
          <View style={{
            height: 4, borderRadius: 2,
            backgroundColor: mapped === items.length && items.length > 0 ? '#059669' : '#0A84FF',
            width: items.length > 0 ? `${Math.round((mapped / items.length) * 100)}%` : '0%',
          }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
        {items.map((item, idx) => (
          <ItemCard
            key={item.posItem.posItemId}
            item={item}
            onUpdate={patch => updateItem(idx, patch)}
            onConfirm={() => confirmMapping(idx)}
            onSkip={() => skipItem(idx)}
            onChooseDifferent={filter => openPicker(idx, filter)}
          />
        ))}
      </ScrollView>

      {/* Picker modal */}
      <Modal visible={pickerIdx !== null} animationType="slide" onRequestClose={() => setPickerIdx(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>Choose match</Text>
              <TouchableOpacity onPress={() => setPickerIdx(null)}>
                <Text style={{ color: '#6B7280', fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
              {([['any', 'All'], ['recipe', 'Recipes'], ['product', 'Products']] as const).map(([k, label]) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => setPickerFilter(k)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                    backgroundColor: pickerFilter === k ? '#0A84FF' : '#F3F4F6',
                    borderWidth: 1, borderColor: pickerFilter === k ? '#0A84FF' : '#E5E7EB',
                  }}
                >
                  <Text style={{ color: pickerFilter === k ? '#fff' : '#374151', fontWeight: '600', fontSize: 13 }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              placeholder="Search products and recipes…"
              value={pickerSearch}
              onChangeText={setPickerSearch}
              autoFocus
              style={{
                borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: '#111',
              }}
            />
          </View>
          <FlatList
            data={pickerEntries}
            keyExtractor={it => `${it.type}-${it.id}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => onPickerSelect(item)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingHorizontal: 16, paddingVertical: 12,
                  borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
                }}
              >
                <Text style={{ fontSize: 18, marginRight: 10 }}>{item.type === 'recipe' ? '🍹' : '📦'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', color: '#111' }}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 1 }}>
                    {item.type === 'recipe' ? 'CraftIt recipe' : 'Stock product'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={{ padding: 24, color: '#9CA3AF', textAlign: 'center' }}>
                {pickerSearch ? 'No results.' : 'No products or recipes yet.'}
              </Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ─── Item card ─────────────────────────────────────────────────────────────────

type CardProps = {
  item: ItemState;
  onUpdate: (patch: Partial<ItemState>) => void;
  onConfirm: () => void;
  onSkip: () => void;
  onChooseDifferent: (filter?: 'product' | 'recipe') => void;
};

function ItemCard({ item, onUpdate, onConfirm, onSkip, onChooseDifferent }: CardProps) {
  const { posItem, suggestion, state, resolvedType, resolvedName, resolvedId, conversionQty, conversionUnit } = item;

  if (state === 'confirmed') {
    return (
      <View style={[card, { borderColor: '#D1FAE5', backgroundColor: '#F0FDF4' }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: '#065F46', flex: 1 }}>{posItem.posItemName}</Text>
          <Text style={{ color: '#059669', fontWeight: '900' }}>✓</Text>
        </View>
        <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
          {posItem.posSku ?? '—'} · {posItem.category ?? '—'}
        </Text>
        <Text style={{ color: '#059669', fontWeight: '600', fontSize: 13, marginTop: 6 }}>
          {resolvedType === 'recipe' ? '🍹' : '📦'} {resolvedName}
          {resolvedType === 'product' ? `  ·  ${conversionQty} ${conversionUnit} per sale` : '  ·  depletes via recipe'}
        </Text>
      </View>
    );
  }

  if (state === 'skipped') {
    return (
      <View style={[card, { opacity: 0.6 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '700', color: '#9CA3AF' }}>{posItem.posItemName}</Text>
          <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Skipped</Text>
        </View>
        <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>Not stock tracked</Text>
      </View>
    );
  }

  // ── Pending ────────────────────────────────────────────────────────────────

  const hasMatch = resolvedId !== null;
  const isSuggestion =
    resolvedId !== null &&
    (resolvedId === suggestion.productId || resolvedId === suggestion.recipeId);

  return (
    <View style={card}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ fontWeight: '800', fontSize: 15, flex: 1, color: '#111' }}>{posItem.posItemName}</Text>
        {posItem.sellPrice != null && (
          <Text style={{ fontWeight: '700', color: '#374151' }}>${posItem.sellPrice.toFixed(2)}</Text>
        )}
      </View>
      <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
        {posItem.posSku ?? '—'} · {posItem.category ?? '—'}
      </Text>

      {/* Match box */}
      {hasMatch ? (
        <View style={{
          marginTop: 10, padding: 10, backgroundColor: '#F0F9FF',
          borderRadius: 8, borderWidth: 1, borderColor: '#BAE6FD',
        }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            {isSuggestion ? 'Suggested match' : 'Selected match'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>{resolvedType === 'recipe' ? '🍹' : '📦'}</Text>
            <Text style={{ fontWeight: '700', color: '#111', flex: 1 }}>{resolvedName}</Text>
          </View>
          {resolvedType === 'recipe' && (
            <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
              Depletes via recipe ingredients
            </Text>
          )}
          {isSuggestion && (
            <Text style={{
              fontSize: 12, marginTop: 4,
              color: suggestion.confidence === 'high' ? '#059669' : '#D97706',
            }}>
              {suggestion.confidence === 'high' ? '● high confidence' : '○ medium confidence'}
            </Text>
          )}
        </View>
      ) : (
        <View style={{
          marginTop: 10, padding: 10, backgroundColor: '#FEF3C7',
          borderRadius: 8, borderWidth: 1, borderColor: '#FDE68A',
        }}>
          <Text style={{ fontWeight: '700', color: '#92400E', fontSize: 13 }}>No match found</Text>
          <Text style={{ fontSize: 12, color: '#78350F', marginTop: 2 }}>Choose a product or recipe, or skip.</Text>
        </View>
      )}

      {/* Conversion inputs — direct product only */}
      {resolvedType === 'product' && (
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 6 }}>
            Conversion: 1 sale depletes
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={conversionQty}
              onChangeText={v => onUpdate({ conversionQty: v })}
              keyboardType="decimal-pad"
              placeholder="qty"
              style={inputStyle}
            />
            <TextInput
              value={conversionUnit}
              onChangeText={v => onUpdate({ conversionUnit: v })}
              placeholder="unit (each, bottle, case…)"
              style={[inputStyle, { flex: 2 }]}
            />
          </View>
        </View>
      )}

      {/* Action buttons */}
      <View style={{ marginTop: 12, gap: 7 }}>
        {hasMatch ? (
          <>
            <TouchableOpacity onPress={onConfirm} style={btnPrimary}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm match</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onChooseDifferent()} style={btnSecondary}>
              <Text style={{ color: '#374151', fontWeight: '600' }}>Choose different</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => onChooseDifferent('product')}
              style={[btnSecondary, { flex: 1 }]}
            >
              <Text style={{ color: '#374151', fontWeight: '600', fontSize: 13 }}>📦 Map to product</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onChooseDifferent('recipe')}
              style={[btnSecondary, { flex: 1 }]}
            >
              <Text style={{ color: '#374151', fontWeight: '600', fontSize: 13 }}>🍹 Map to recipe</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity onPress={onSkip} style={{ paddingVertical: 7, alignItems: 'center' }}>
          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>Skip — not stock tracked</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const card = {
  backgroundColor: '#fff',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  padding: 14,
} as const;

const btnPrimary = {
  backgroundColor: '#0A84FF',
  paddingVertical: 11,
  borderRadius: 9,
  alignItems: 'center' as const,
};

const btnSecondary = {
  backgroundColor: '#F3F4F6',
  paddingVertical: 11,
  borderRadius: 9,
  alignItems: 'center' as const,
};

const inputStyle = {
  flex: 1,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  borderRadius: 8,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: '#111',
};
