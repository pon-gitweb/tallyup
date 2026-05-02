// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

type VenueProduct = { id: string; name: string; unit?: string; supplierName?: string; costPrice?: number; parLevel?: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  venueId: string | null | undefined;
  onSelect: (product: VenueProduct) => void;
};

export default function VenueProductSearchModal({ visible, onClose, venueId, onSelect }: Props) {
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<VenueProduct[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!visible || !venueId) return;
    setLoading(true);
    (async () => {
      try {
        const db = getFirestore();
        const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
        setProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, venueId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(p => (p.name || '').toLowerCase().includes(needle));
  }, [products, q]);

  const handleClose = () => { setQ(''); onClose(); };
  const handleSelect = (p: VenueProduct) => { onSelect(p); setQ(''); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={S.wrap}>
        <TouchableOpacity style={S.backdrop} onPress={handleClose} activeOpacity={1} />
        <View style={S.sheet}>
          <View style={S.header}>
            <View style={{ flex: 1 }}>
              <Text style={S.title}>Search venue products</Text>
              <Text style={S.sub}>Add an existing product from your venue to this area</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
              <Text style={{ fontSize: 18, color: '#64748b', fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search by name…"
              placeholderTextColor="#94a3b8"
              style={S.searchInput}
              autoFocus
              clearButtonMode="while-editing"
            />
          </View>

          {loading ? (
            <View style={{ alignItems: 'center', padding: 32 }}>
              <ActivityIndicator color="#1b4f72" />
              <Text style={{ color: '#64748b', marginTop: 10, fontSize: 13 }}>Loading products…</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={p => p.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 32 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={S.row} onPress={() => handleSelect(item)} activeOpacity={0.75}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.rowName}>{item.name}</Text>
                    <Text style={S.rowSub}>
                      {item.unit || 'unit?'}
                      {item.supplierName ? ` · ${item.supplierName}` : ''}
                      {typeof item.parLevel === 'number' ? ` · Par ${item.parLevel}` : ''}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20, color: '#94a3b8' }}>›</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 28, fontSize: 14 }}>
                  {q.trim()
                    ? 'No products match your search.'
                    : 'No products in this venue yet.\nAdd products via Settings → Products first.'}
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '78%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  searchInput: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#0f172a',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  rowName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  rowSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
});
