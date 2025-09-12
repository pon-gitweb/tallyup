import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, StyleSheet } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, collection, addDoc, serverTimestamp, writeBatch, updateDoc
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { ProductRow, listProductsBySupplierPage, searchProductsBySupplierPrefixPage } from '../../services/products';

type LineRow = { id: string; name: string; qty: number };
type RouteParams = { orderId: string; supplierName?: string };

export default function OrderEditorScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const orderId = route.params?.orderId;
  const supplierName = route.params?.supplierName ?? 'Supplier';

  const [orderOk, setOrderOk] = useState(false);
  const [supplierId, setSupplierId] = useState<string | null>(null);

  const [notes, setNotes] = useState('');
  const [defaultQty, setDefaultQty] = useState('1');

  const [lines, setLines] = useState<LineRow[]>([]);

  // Server-backed catalog/search
  const [queryText, setQueryText] = useState('');
  const [items, setItems] = useState<ProductRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle'|'browse'|'search'>('idle'); // idle until the user types or taps browse
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    nav.setOptions({ title: `Order: ${supplierName}` });
  }, [nav, supplierName]);

  // Load order → supplierId + notes
  useEffect(() => {
    (async () => {
      try {
        if (!venueId || !orderId) return;
        const db = getFirestore(getApp());
        const ref = doc(db, 'venues', venueId, 'orders', orderId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          setNotes(data?.notes ?? '');
          setSupplierId(data?.supplierId ?? null);
          setOrderOk(true);
        } else {
          setOrderOk(false);
        }
      } catch (e) {
        console.warn('[OrderEditor] verify draft error', e);
        setOrderOk(false);
      }
    })();
  }, [venueId, orderId]);

  const persistNotes = useCallback(async () => {
    try {
      if (!venueId || !orderId) return;
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      await updateDoc(orderRef, {
        notes: (notes || '').trim(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[OrderEditor] persistNotes error', e);
    }
  }, [venueId, orderId, notes]);

  // Browse first page
  const browseFirstPage = useCallback(async () => {
    if (!venueId || !supplierId) return;
    try {
      setLoading(true);
      setMode('browse');
      const { items: page, nextCursor } = await listProductsBySupplierPage(venueId, supplierId, 50, true, null);
      setItems(page);
      setNextCursor(nextCursor);
    } catch (e) {
      console.warn('[OrderEditor] browseFirstPage error', e);
      Alert.alert('Error', 'Could not load supplier catalog.');
    } finally {
      setLoading(false);
    }
  }, [venueId, supplierId]);

  // Search (first page)
  const searchFirstPage = useCallback(async (term: string) => {
    if (!venueId || !supplierId) return;
    const clean = term.trim();
    if (!clean) { setItems([]); setNextCursor(null); setMode('idle'); return; }
    try {
      setLoading(true);
      setMode('search');
      const { items: page, nextCursor } = await searchProductsBySupplierPrefixPage(venueId, supplierId, clean, 30, null);
      setItems(page);
      setNextCursor(nextCursor);
    } catch (e) {
      console.warn('[OrderEditor] searchFirstPage error', e);
    } finally {
      setLoading(false);
    }
  }, [venueId, supplierId]);

  // Load more (depending on mode)
  const loadMore = useCallback(async () => {
    if (!venueId || !supplierId) return;
    if (!nextCursor) return;
    try {
      setLoading(true);
      if (mode === 'browse') {
        const { items: page, nextCursor: nc } = await listProductsBySupplierPage(venueId, supplierId, 50, true, nextCursor);
        setItems(prev => [...prev, ...page]);
        setNextCursor(nc);
      } else if (mode === 'search') {
        const clean = queryText.trim();
        if (!clean) return;
        const { items: page, nextCursor: nc } = await searchProductsBySupplierPrefixPage(venueId, supplierId, clean, 30, nextCursor);
        setItems(prev => [...prev, ...page]);
        setNextCursor(nc);
      }
    } catch (e) {
      console.warn('[OrderEditor] loadMore error', e);
    } finally {
      setLoading(false);
    }
  }, [venueId, supplierId, mode, nextCursor, queryText]);

  // Debounce search typing
  useEffect(() => {
    const id = setTimeout(() => {
      if (queryText.trim().length >= 2) {
        searchFirstPage(queryText);
      } else {
        // too short → clear results unless we’re browsing
        if (mode !== 'browse') {
          setItems([]);
          setNextCursor(null);
          setMode('idle');
        }
      }
    }, 220);
    return () => clearTimeout(id);
  }, [queryText, searchFirstPage, mode]);

  const addLineWithName = useCallback(async (nameRaw: string, qtyRaw?: string) => {
    try {
      if (!venueId || !orderId) return;
      const name = (nameRaw || '').trim();
      const qty = Math.max(1, parseInt(qtyRaw ?? defaultQty || '1', 10) || 1);
      if (!name) {
        Alert.alert('Missing name', 'Pick or type a product name.');
        return;
      }
      const db = getFirestore(getApp());
      const ref = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
      const added = await addDoc(ref, {
        name,
        qtyOrdered: qty,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        source: 'manual',
      });
      setLines(prev => [{ id: added.id, name, qty }, ...prev]);
    } catch (e: any) {
      console.warn('[OrderEditor] addLine error', e);
      Alert.alert('Error', e?.message ?? 'Failed adding line.');
    }
  }, [venueId, orderId, defaultQty]);

  const submitOrder = useCallback(async () => {
    try {
      if (!venueId || !orderId) return;
      if (!lines.length) {
        Alert.alert('No lines', 'Add at least one line before submitting.');
        return;
      }
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const batch = writeBatch(db);
      batch.update(orderRef, {
        status: 'submitted',
        displayStatus: 'Submitted',
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      Alert.alert('Submitted', 'Order submitted successfully.');
      nav.navigate('Orders');
    } catch (e: any) {
      console.warn('[OrderEditor] submit error', e);
      Alert.alert('Error', e?.message ?? 'Failed to submit order.');
    }
  }, [venueId, orderId, lines.length, nav]);

  const renderItem = ({ item }: { item: ProductRow }) => (
    <View style={styles.productRow}>
      <Text style={styles.productName}>{item.name ?? 'Product'}</Text>
      <TouchableOpacity style={styles.quickAdd} onPress={() => addLineWithName(item.name ?? '', defaultQty)}>
        <Text style={styles.quickAddText}>Add ×{Math.max(1, parseInt(defaultQty || '1', 10) || 1)}</Text>
      </TouchableOpacity>
    </View>
  );

  const showCustomAdd = queryText.trim().length >= 2 && items.length === 0 && !loading;

  return (
    <View style={styles.container}>
      {!orderOk ? (
        <Text style={styles.muted}>Preparing order…</Text>
      ) : (
        <>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            placeholder="Optional notes for this order"
            value={notes}
            onChangeText={setNotes}
            onBlur={persistNotes}
            style={styles.notes}
            multiline
          />

          <View style={styles.rowBetween}>
            <Text style={[styles.label, { marginTop: 12 }]}>Products from {supplierName}</Text>
            <View style={styles.qtyWrap}>
              <Text style={styles.qtyLabel}>Qty</Text>
              <TextInput
                value={defaultQty}
                onChangeText={setDefaultQty}
                keyboardType="number-pad"
                style={styles.qtyInput}
              />
            </View>
          </View>

          <TextInput
            placeholder="Type at least 2 letters to search this supplier’s catalog"
            value={queryText}
            onChangeText={setQueryText}
            style={styles.input}
            autoCorrect={false}
          />

          {mode !== 'browse' && (
            <TouchableOpacity style={styles.browseBtn} onPress={browseFirstPage} disabled={loading || !supplierId}>
              <Text style={styles.browseText}>{loading ? 'Loading…' : 'Load supplier catalog'}</Text>
            </TouchableOpacity>
          )}

          {showCustomAdd && (
            <TouchableOpacity style={styles.customAdd} onPress={() => addLineWithName(queryText, defaultQty)}>
              <Text style={styles.customAddText}>Add “{queryText.trim()}” as a custom item ×{Math.max(1, parseInt(defaultQty || '1', 10) || 1)}</Text>
            </TouchableOpacity>
          )}

          <FlatList
            data={items}
            keyExtractor={(p) => p.id}
            style={styles.list}
            ListEmptyComponent={!loading ? <Text style={styles.muted}>No products yet. Try searching or “Load supplier catalog”.</Text> : null}
            renderItem={renderItem}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />

          {nextCursor && (
            <TouchableOpacity style={styles.loadMore} onPress={loadMore} disabled={loading}>
              <Text style={styles.loadMoreText}>{loading ? 'Loading…' : 'Load more'}</Text>
            </TouchableOpacity>
          )}

          <FlatList
            data={lines}
            keyExtractor={(l) => l.id}
            ListEmptyComponent={<Text style={styles.muted}>No lines yet. Use Add ×Qty above.</Text>}
            renderItem={({ item }) => (
              <View style={styles.line}>
                <Text style={styles.lineName}>{item.name}</Text>
                <Text style={styles.lineQty}>× {item.qty}</Text>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            contentContainerStyle={{ paddingVertical: 8 }}
          />

          <TouchableOpacity style={styles.submit} onPress={submitOrder}>
            <Text style={styles.submitText}>Submit Order</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  muted: { color: '#666', padding: 12 },

  label: { fontWeight: '600', marginBottom: 6 },
  notes: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minHeight: 64 },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qtyWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyLabel: { color: '#333' },
  qtyInput: { width: 54, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'center' },

  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },

  browseBtn: { marginTop: 8, alignSelf: 'flex-start' },
  browseText: { color: '#0a7', fontWeight: '600' },

  customAdd: { marginTop: 8, backgroundColor: '#eefaf3', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#cfeede' },
  customAddText: { color: '#0a7', fontWeight: '600' },

  list: { maxHeight: 280, marginTop: 8, borderWidth: 1, borderColor: '#eee', borderRadius: 8 },
  productRow: { paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  productName: { fontSize: 15 },
  quickAdd: { backgroundColor: '#0a7', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  quickAddText: { color: '#fff', fontWeight: '700' },

  loadMore: { marginTop: 8, alignSelf: 'center' },
  loadMoreText: { color: '#0a7', fontWeight: '600' },

  line: { paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between' },
  lineName: { fontSize: 16 },
  lineQty: { fontSize: 16, color: '#444' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e5e5', marginHorizontal: 8 },

  submit: { marginTop: 12, backgroundColor: '#0a5', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '700' },
});
