/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { useProductSearch } from '../../services/hooks/useProductSearch';
import { ProductNotesService } from '../../services/productNotes';

type Props = {
  visible: boolean;
  onClose: () => void;
  venueId: string;
  filterProductId?: string | null;
  filterProductName?: string | null;
  defaultSupplierName?: string | null;
};

export default function StockNotesModal(props: Props) {
  const { visible, onClose, venueId } = props;
  const uid = getAuth(getApp())?.currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [suggestName, setSuggestName] = useState('');

  const { hits, loading: searching } = useProductSearch(venueId, productSearch, 10);

  const filteredNotes = useMemo(() => {
    const pid = props.filterProductId ?? null;
    if (!pid) return notes;
    return notes.filter(n => (n?.productId ?? null) === pid);
  }, [notes, props.filterProductId]);

  useEffect(() => {
    if (!visible || !venueId) return;

    setLoading(true);
    const db = getFirestore(getApp());
    const col = collection(db, 'venues', venueId, 'productNotes');

    const qOpen = query(col, where('status', '==', 'open'), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(
      qOpen,
      (snap) => {
        const out:any[] = [];
        snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
        setNotes(out);
        setLoading(false);
      },
      () => {
        setNotes([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [visible, venueId]);

  async function addNote() {
    const t = String(text || '').trim();
    if (!t) return;

    const pid = selectedProduct?.id ?? props.filterProductId ?? null;
    const pname = selectedProduct?.name ?? props.filterProductName ?? null;

    const supplierName =
      selectedProduct?.supplierName ??
      props.defaultSupplierName ??
      null;

    const suggestedProduct =
      !pid && String(suggestName || '').trim()
        ? { name: String(suggestName).trim(), supplierName: supplierName ?? null }
        : null;

    await ProductNotesService.createNote(
      venueId,
      {
        text: t,
        productId: pid,
        productName: pname,
        supplierName: supplierName ?? null,
        suggestedProduct,
        source: pid ? 'product' : 'other',
      },
      uid
    );

    setText('');
    setProductSearch('');
    setSelectedProduct(null);
    setSuggestName('');
  }

  async function resolveNote(note:any) {
    await ProductNotesService.setStatus(venueId, note.id, 'resolved', {}, uid);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={S.wrap}>
        <View style={S.top}>
          <Text style={S.title}>
            {props.filterProductId ? 'Product Notes' : 'Stock Notes'}
          </Text>
          <TouchableOpacity onPress={onClose} style={S.closeBtn}>
            <Text style={S.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={S.compose}>
          <Text style={S.label}>New note</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="e.g. Low stock / damaged / missing / add to next order…"
            style={S.input}
            multiline
          />

          {!props.filterProductId && (
            <>
              <Text style={[S.label, { marginTop: 10 }]}>Link to a product (optional)</Text>
              <TextInput
                value={productSearch}
                onChangeText={(v) => {
                  setProductSearch(v);
                  setSelectedProduct(null);
                }}
                placeholder="Search products…"
                style={S.input}
              />

              {searching && (
                <View style={{ paddingVertical: 8 }}>
                  <ActivityIndicator />
                </View>
              )}

              {!!productSearch.trim() && !selectedProduct && hits?.length > 0 && (
                <View style={S.hits}>
                  {hits.slice(0, 6).map((h) => (
                    <TouchableOpacity
                      key={h.id}
                      style={S.hitRow}
                      onPress={() => {
                        setSelectedProduct(h);
                        setProductSearch(h.name);
                      }}
                    >
                      <Text style={S.hitName}>{h.name}</Text>
                      {!!h.supplierName && <Text style={S.hitSub}>{h.supplierName}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {!selectedProduct && (
                <>
                  <Text style={[S.label, { marginTop: 10 }]}>
                    Suggest a new product (optional)
                  </Text>
                  <TextInput
                    value={suggestName}
                    onChangeText={setSuggestName}
                    placeholder="e.g. ‘House gin (unknown brand)’"
                    style={S.input}
                  />
                  <Text style={S.help}>
                    If you can’t find the product, add a note and suggest a name.
                    You can convert these into real products during setup later.
                  </Text>
                </>
              )}
            </>
          )}

          <TouchableOpacity style={S.primaryBtn} onPress={addNote}>
            <Text style={S.primaryText}>Add note</Text>
          </TouchableOpacity>
        </View>

        <View style={S.listWrap}>
          <Text style={S.sectionTitle}>
            {props.filterProductId ? 'Open notes for this product' : 'Open notes'}{' '}
            <Text style={S.sectionCount}>({filteredNotes.length})</Text>
          </Text>

          {loading ? (
            <View style={S.center}>
              <ActivityIndicator />
              <Text style={{ color: '#6B7280', marginTop: 6 }}>Loading…</Text>
            </View>
          ) : filteredNotes.length === 0 ? (
            <View style={S.center}>
              <Text style={{ color: '#6B7280' }}>
                No open notes. This is where service/prep/close signals live.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredNotes}
              keyExtractor={(x) => x.id}
              renderItem={({ item }) => (
                <View style={S.noteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.noteText}>{item.text}</Text>
                    {!!item.productName && <Text style={S.noteMeta}>Product: {item.productName}</Text>}
                    {!item.productName && !!item.suggestedProduct?.name && (
                      <Text style={S.noteMeta}>Suggested: {item.suggestedProduct.name}</Text>
                    )}
                    {!!item.supplierName && <Text style={S.noteMeta}>Supplier: {item.supplierName}</Text>}
                  </View>

                  <TouchableOpacity style={S.resolveBtn} onPress={() => resolveNote(item)}>
                    <Text style={S.resolveText}>Resolve</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  top: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '900', color: '#111827' },
  closeBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F3F4F6' },
  closeText: { fontWeight: '800', color: '#111827' },

  compose: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB' },
  label: { fontSize: 12, fontWeight: '800', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  help: { marginTop: 6, color: '#6B7280', fontSize: 12 },

  hits: { marginTop: 8, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, overflow: 'hidden' },
  hitRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB' },
  hitName: { fontWeight: '800', color: '#111827' },
  hitSub: { marginTop: 2, color: '#6B7280', fontSize: 12 },

  primaryBtn: { marginTop: 12, backgroundColor: '#111827', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '900' },

  listWrap: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '900', color: '#111827', marginBottom: 10 },
  sectionCount: { color: '#6B7280', fontWeight: '900' },

  center: { padding: 24, alignItems: 'center' },

  noteRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    marginBottom: 10,
  },
  noteText: { fontSize: 14, fontWeight: '800', color: '#111827' },
  noteMeta: { marginTop: 4, color: '#6B7280', fontSize: 12 },

  resolveBtn: { alignSelf: 'flex-start', backgroundColor: '#F3F4F6', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  resolveText: { fontWeight: '900', color: '#111827', fontSize: 12 },
});
