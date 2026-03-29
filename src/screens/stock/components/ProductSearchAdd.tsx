// @ts-nocheck
/**
 * ProductSearchAdd
 * Smart product search for stocktake area quick-add.
 * - Type 2+ chars → shows dropdown of matching venue products
 * - Tap to select → auto-fills fields
 * - "Add as new" always available for unlisted products
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { listProducts } from '../../../services/products';

type ProductHit = {
  id: string;
  name: string;
  unit?: string | null;
  supplierName?: string | null;
  supplierId?: string | null;
  costPrice?: number | null;
  parLevel?: number | null;
};

type Props = {
  venueId: string | null | undefined;
  onSelect: (product: ProductHit) => void;
  onAddNew: (name: string) => void;
  nameInputRef?: any;
};

export default function ProductSearchAdd({ venueId, onSelect, onAddNew, nameInputRef }: Props) {
  const [query, setQuery] = useState('');
  const [allProducts, setAllProducts] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const loadedVenue = useRef<string | null>(null);

  // Load all venue products once
  useEffect(() => {
    if (!venueId || loadedVenue.current === venueId) return;
    loadedVenue.current = venueId;
    setLoading(true);
    listProducts(venueId, { limit: 200 })
      .then(rows => setAllProducts(rows.map(r => ({
        id: r.id || r.productId || '',
        name: r.name || '',
        unit: r.unit || null,
        supplierName: r.supplierName || null,
        supplierId: r.supplierId || null,
        costPrice: r.costPrice ?? r.cost ?? null,
        parLevel: r.parLevel ?? r.par ?? null,
      }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [venueId]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return allProducts
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, allProducts]);

  const onChangeText = useCallback((text: string) => {
    setQuery(text);
    setOpen(text.trim().length >= 2);
  }, []);

  const handleSelect = useCallback((product: ProductHit) => {
    setQuery(product.name);
    setOpen(false);
    onSelect(product);
  }, [onSelect]);

  const handleAddNew = useCallback(() => {
    const name = query.trim();
    if (!name) return;
    setOpen(false);
    onAddNew(name);
    setQuery('');
  }, [query, onAddNew]);

  const handleClear = useCallback(() => {
    setQuery('');
    setOpen(false);
  }, []);

  return (
    <View style={{ position: 'relative', zIndex: 100 }}>
      {/* Search input */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, position: 'relative' }}>
          <TextInput
            ref={nameInputRef}
            value={query}
            onChangeText={onChangeText}
            placeholder="Search or add product..."
            style={{
              flex: 1,
              paddingVertical: 10,
              paddingHorizontal: 12,
              paddingRight: query.length > 0 ? 36 : 12,
              borderWidth: 1,
              borderColor: open ? '#0A84FF' : '#ccc',
              borderRadius: 12,
              fontSize: 15,
              backgroundColor: '#fff',
            }}
            returnKeyType="done"
            blurOnSubmit={false}
            onFocus={() => query.trim().length >= 2 && setOpen(true)}
          />
          {loading && (
            <View style={{ position: 'absolute', right: 10, top: 10 }}>
              <ActivityIndicator size="small" />
            </View>
          )}
          {query.length > 0 && !loading && (
            <TouchableOpacity
              onPress={handleClear}
              style={{ position: 'absolute', right: 10, top: 10 }}
            >
              <Text style={{ color: '#9CA3AF', fontWeight: '800', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={handleAddNew}
          disabled={!query.trim()}
          style={{
            backgroundColor: query.trim() ? '#0A84FF' : '#E5E7EB',
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: query.trim() ? '#fff' : '#9CA3AF', fontWeight: '800' }}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Dropdown */}
      {open && (
        <View style={{
          position: 'absolute',
          top: 48,
          left: 0,
          right: 52,
          backgroundColor: '#fff',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
          elevation: 8,
          zIndex: 999,
          maxHeight: 280,
          overflow: 'hidden',
        }}>
          {filtered.length === 0 ? (
            <View style={{ padding: 14 }}>
              <Text style={{ color: '#6B7280', fontSize: 13 }}>No matching products.</Text>
              <TouchableOpacity onPress={handleAddNew} style={{ marginTop: 8 }}>
                <Text style={{ color: '#0A84FF', fontWeight: '700' }}>+ Add "{query.trim()}" as new product</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={p => p.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: p }) => (
                <TouchableOpacity
                  onPress={() => handleSelect(p)}
                  style={{
                    padding: 12,
                    borderBottomWidth: 1,
                    borderColor: '#F3F4F6',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 15 }}>{p.name}</Text>
                    <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 2 }}>
                      {[p.unit, p.supplierName, p.parLevel != null ? 'PAR ' + p.parLevel : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {p.costPrice != null && (
                    <Text style={{ color: '#374151', fontWeight: '700', fontSize: 13 }}>
                      ${Number(p.costPrice).toFixed(2)}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              ListFooterComponent={
                <TouchableOpacity onPress={handleAddNew} style={{ padding: 12, borderTopWidth: 1, borderColor: '#F3F4F6' }}>
                  <Text style={{ color: '#0A84FF', fontWeight: '700' }}>+ Add "{query.trim()}" as new product</Text>
                </TouchableOpacity>
              }
            />
          )}
        </View>
      )}
    </View>
  );
}
