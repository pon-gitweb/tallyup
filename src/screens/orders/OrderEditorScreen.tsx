// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, StyleSheet } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, collection, setDoc, getDocs,
  serverTimestamp, writeBatch, updateDoc, onSnapshot, orderBy, query
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { ProductRow, listProductsBySupplierPage, searchProductsBySupplierPrefixPage } from '../../services/products';
import { savedToast } from '../../utils/toast';

type LineRow = { id: string; name: string; qty: number };
type RouteParams = { orderId: string; supplierName?: string };

export default function OrderEditorScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const orderId = route.params?.orderId;
  const supplierName = route.params?.supplierName ?? 'Supplier';

  const db = getFirestore(getApp());

  const [orderOk, setOrderOk] = useState(false);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [defaultQty, setDefaultQty] = useState('1');

  // existing lines (live)
  const [lines, setLines] = useState<LineRow[]>([]);
  const totalQty = useMemo(() => lines.reduce((a, b) => a + (Number(b.qty) || 0), 0), [lines]);

  // catalog/search
  const [queryText, setQueryText] = useState('');
  const [items, setItems] = useState<ProductRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle'|'browse'|'search'>('idle');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    nav.setOptions({ title: `Order: ${supplierName}` });
  }, [nav, supplierName]);

  // Load order header (get supplier + notes)
  useEffect(() => {
    (async () => {
      try {
        if (!venueId || !orderId) return;
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
      } catch {
        setOrderOk(false);
      }
    })();
  }, [db, venueId, orderId]);

  // Subscribe to lines (sorted by name)
  useEffect(() => {
    if (!venueId || !orderId) return;
    const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
    const qy = query(collection(orderRef, 'lines'), orderBy('name'));
    const unsub = onSnapshot(qy, (snap) => {
      const next: LineRow[] = [];
      snap.forEach((d) => {
        const v:any = d.data()||{};
        next.push({ id: d.id, name: v?.name ?? d.id, qty: Number(v?.qty ?? 0) });
      });
      setLines(next);
    });
    return () => unsub();
  }, [db, venueId, orderId]);

  const persistNotes = useCallback(async () => {
    try {
      if (!venueId || !orderId) return;
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      await updateDoc(orderRef, {
        notes: (notes || '').trim(),
        updatedAt: serverTimestamp(),
      });
      savedToast('Notes saved');
    } catch {}
  }, [db, venueId, orderId, notes]);

  // Browse first page
  const browseFirstPage = useCallback(async () => {
    if (!venueId || !supplierId) return;
    try {
      setLoading(true);
      setMode('browse');
      const { items: page, nextCursor } = await listProductsBySupplierPage(venueId, supplierId, 50, true, null);
      setItems(page);
      setNextCursor(nextCursor);
    } finally {
      setLoading(false);
    }
  }, [venueId, supplierId]);

  // Search first page
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
    } finally {
      setLoading(false);
    }
  }, [venueId, supplierId]);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      if (queryText.trim().length >= 2) {
        searchFirstPage(queryText);
      } else {
        if (mode !== 'browse') {
          setItems([]); setNextCursor(null); setMode('idle');
        }
      }
    }, 220);
    return () => clearTimeout(id);
  }, [queryText, searchFirstPage, mode]);

  // Load more
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
        const clean = queryText.trim(); if (!clean) return;
        const { items: page, nextCursor: nc } = await searchProductsBySupplierPrefixPage(venueId, supplierId, clean, 30, nextCursor);
        setItems(prev => [...prev, ...page]);
        setNextCursor(nc);
      }
    } finally {
      setLoading(false);
    }
  }, [venueId, supplierId, mode, nextCursor, queryText]);

  // Add/catalog item → write to {lines}/{productId} with qty
  const addCatalogItem = useCallback(async (prod: ProductRow, qtyRaw?: string) => {
    try {
      if (!venueId || !orderId) return;
      const qty = Math.max(1, parseInt(((qtyRaw ?? defaultQty) || '1'), 10) || 1);
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const lineRef = doc(orderRef, 'lines', String(prod.id));
      // read current to accumulate
      let prev = 0;
      try {
        const snap = await getDoc(lineRef);
        if (snap.exists()) prev = Number((snap.data() as any)?.qty ?? 0);
      } catch {}
      await setDoc(lineRef, {
        name: prod.name ?? String(prod.id),
        qty: prev + qty,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      savedToast('Added to draft');
    } catch (e:any) {
      Alert.alert('Error', e?.message ?? 'Failed adding line.');
    }
  }, [db, venueId, orderId, defaultQty]);

  // Manual add (free text)
  const addManual = useCallback(async (nameRaw: string, qtyRaw?: string) => {
    try {
      if (!venueId || !orderId) return;
      const name = (nameRaw || '').trim();
      const qty = Math.max(1, parseInt(((qtyRaw ?? defaultQty) || '1'), 10) || 1);
      if (!name) { Alert.alert('Missing name', 'Pick or type a product name.'); return; }
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      // create a line doc keyed by name (so edits overwrite)
      const lineRef = doc(orderRef, 'lines', name);
      let prev = 0;
      try {
        const snap = await getDoc(lineRef);
        if (snap.exists()) prev = Number((snap.data() as any)?.qty ?? 0);
      } catch {}
      await setDoc(lineRef, { name, qty: prev + qty, updatedAt: serverTimestamp() }, { merge: true });
      savedToast('Added to draft');
    } catch (e:any) {
      Alert.alert('Error', e?.message ?? 'Failed adding line.');
    }
  }, [db, venueId, orderId, defaultQty]);

  const bumpQty = useCallback(async (lineId: string, delta: number) => {
    try {
      if (!venueId || !orderId) return;
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const lineRef = doc(orderRef, 'lines', lineId);
      const snap = await getDoc(lineRef);
      const prev = Number(snap.exists() ? (snap.data() as any)?.qty ?? 0 : 0);
      const next = prev + delta;
      if (next <= 0) {
        await updateDoc(lineRef, { qty: 0, updatedAt: serverTimestamp() });
      } else {
        await updateDoc(lineRef, { qty: next, updatedAt: serverTimestamp() });
      }
    } catch {}
  }, [db, venueId, orderId]);

  const removeLine = useCallback(async (lineId: string) => {
    try {
      if (!venueId || !orderId) return;
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      await updateDoc(doc(orderRef,'lines',lineId), { qty: 0, updatedAt: serverTimestamp() });
    } catch {}
  }, [db, venueId, orderId]);

  const submitOrder = useCallback(async () => {
    try {
      if (!venueId || !orderId) return;
      if (!lines.some(l => (l.qty||0) > 0)) {
        Alert.alert('No lines', 'Add at least one line before submitting.');
        return;
      }
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      await updateDoc(orderRef, {
        status: 'submitted',
        displayStatus: 'Submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Submitted', 'Order submitted successfully.');
      nav.navigate('Orders');
    } catch (e:any) {
      Alert.alert('Error', e?.message ?? 'Failed to submit order.');
    }
  }, [db, venueId, orderId, lines, nav]);

  const renderProduct = ({ item }: { item: ProductRow }) => (
    <View style={styles.productRow}>
      <Text style={styles.productName}>{item.name ?? 'Product'}</Text>
      <TouchableOpacity style={styles.quickAdd} onPress={() => addCatalogItem(item, defaultQty)}>
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
          {/* Header / notes */}
          <Text style={styles.label}>Notes</Text>
          <TextInput
            placeholder="Optional notes for this order"
            value={notes}
            onChangeText={setNotes}
            onBlur={persistNotes}
            style={styles.notes}
            multiline
          />

          {/* Existing lines */}
          <Text style={[styles.label, { marginTop: 12 }]}>Lines</Text>
          <FlatList
            data={lines}
            keyExtractor={(l) => l.id}
            ListEmptyComponent={<Text style={styles.muted}>No lines yet.</Text>}
            renderItem={({ item }) => (
              <View style={styles.lineCard}>
                <Text style={styles.lineName}>{item.name ?? item.id}</Text>
                <View style={styles.lineControls}>
                  <TouchableOpacity onPress={() => bumpQty(item.id, -1)} style={styles.bumpBtn}><Text>–</Text></TouchableOpacity>
                  <Text style={styles.qtyText}>{item.qty}</Text>
                  <TouchableOpacity onPress={() => bumpQty(item.id, +1)} style={styles.bumpBtn}><Text>+</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => removeLine(item.id)} style={styles.removeBtn}><Text style={{color:'#b00020'}}>Remove</Text></TouchableOpacity>
                </View>
              </View>
            )}
          />

          {/* Catalog add */}
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
            <TouchableOpacity style={styles.customAdd} onPress={() => addManual(queryText, defaultQty)}>
              <Text style={styles.customAddText}>Add “{queryText}” ×{Math.max(1, parseInt(defaultQty || '1', 10) || 1)}</Text>
            </TouchableOpacity>
          )}

          <FlatList
            data={items}
            keyExtractor={(i)=>String(i.id)}
            renderItem={renderProduct}
            onEndReached={loadMore}
            onEndReachedThreshold={0.7}
            ListFooterComponent={<View style={{height:24}}/>}
          />

          {/* Submit */}
          <View style={{ paddingVertical: 12 }}>
            <TouchableOpacity onPress={submitOrder} style={styles.submitBtn}>
              <Text style={styles.submitText}>Submit Order</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, backgroundColor:'#fff', padding:12 },
  label:{ fontWeight:'800', marginBottom:6 },
  notes:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, padding:10, minHeight:60 },
  muted:{ color:'#6b7280' },

  lineCard:{ backgroundColor:'#fff', borderRadius:12, padding:12, marginBottom:10, borderColor:'#eee', borderWidth:1 },
  lineName:{ fontWeight:'700' },
  lineControls:{ flexDirection:'row', alignItems:'center', marginTop:8 },
  bumpBtn:{ paddingHorizontal:14, paddingVertical:6, borderRadius:8, borderWidth:1, borderColor:'#e5e7eb' },
  qtyText:{ width:56, textAlign:'center', fontWeight:'800' },
  removeBtn:{ marginLeft:'auto', paddingHorizontal:10, paddingVertical:6 },

  rowBetween:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  qtyWrap:{ flexDirection:'row', alignItems:'center', gap:6 },
  qtyLabel:{ color:'#6b7280' },
  qtyInput:{ width:52, borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingVertical:4, paddingHorizontal:8, textAlign:'center' },

  input:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, paddingHorizontal:10, paddingVertical:8, marginTop:8 },
  browseBtn:{ marginTop:10, paddingVertical:10, alignItems:'center', borderRadius:10, borderWidth:1, borderColor:'#e5e7eb' },
  browseText:{ fontWeight:'700' },

  customAdd:{ marginTop:10, paddingVertical:10, alignItems:'center', borderRadius:10, backgroundColor:'#111827' },
  customAddText:{ color:'#fff', fontWeight:'800' },

  productRow:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:10, borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#eee' },
  productName:{ fontWeight:'700' },
  quickAdd:{ paddingHorizontal:10, paddingVertical:6, borderRadius:8, backgroundColor:'#111827' },
  quickAddText:{ color:'#fff', fontWeight:'700' },

  submitBtn:{ backgroundColor:'#111827', paddingVertical:12, borderRadius:10, alignItems:'center' },
  submitText:{ color:'#fff', fontWeight:'800' },
});
