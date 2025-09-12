// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Modal, Text, TextInput, TouchableOpacity, View, FlatList, ActivityIndicator
} from 'react-native';
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp, collection
} from 'firebase/firestore';
import { searchProducts, quickCreateProduct } from '../../services/products';

type Props = {
  venueId: string;
  orderId: string;
  supplierId?: string | null;     // optional; we’ll fetch from order if missing
  onAdded?: () => void;           // callback after successful add
  compact?: boolean;              // renders a small inline button if true
};

export default function AddLineToDraft(props: Props) {
  const { venueId, orderId, compact } = props;
  const [visible, setVisible] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  const supplierId = useMemo(() => props.supplierId ?? order?.supplierId ?? null, [props.supplierId, order?.supplierId]);
  const supplierName = useMemo(() => order?.supplierName ?? null, [order?.supplierName]);

  // Load order if not provided
  useEffect(() => {
    (async () => {
      if (!venueId || !orderId || props.supplierId) return;
      setLoadingOrder(true);
      try {
        const db = getFirestore(getApp());
        const snap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
        if (snap.exists()) setOrder({ id: snap.id, ...(snap.data() as any) });
      } finally { setLoadingOrder(false); }
    })();
  }, [venueId, orderId, props.supplierId]);

  if (loadingOrder) {
    return (
      <View style={{ padding: 8 }}>
        <ActivityIndicator />
      </View>
    );
  }

  const Button = (
    <TouchableOpacity
      onPress={() => setVisible(true)}
      style={{
        paddingHorizontal: compact ? 10 : 14,
        paddingVertical: compact ? 8 : 10,
        borderRadius: 10,
        backgroundColor: '#111827'
      }}
    >
      <Text style={{ color: 'white', fontWeight: '700' }}>Add item</Text>
    </TouchableOpacity>
  );

  return (
    <>
      {Button}
      {visible && (
        <PickerModal
          venueId={venueId}
          orderId={orderId}
          supplierId={supplierId}
          supplierName={supplierName}
          onClose={() => setVisible(false)}
          onAdded={props.onAdded}
        />
      )}
    </>
  );
}

/** Modal content */
function PickerModal({ venueId, orderId, supplierId, supplierName, onClose, onAdded }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState('1');

  async function load() {
    if (!venueId) return;
    setLoading(true);
    try {
      const out = await searchProducts(venueId, { q, supplierId });
      setRows(out);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [q, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addToDraft(product: { id: string; name?: string }) {
    if (!venueId || !orderId) return;
    const n = Number(String(qty).trim());
    if (!Number.isFinite(n) || n <= 0) { Alert.alert('Add item', 'Enter a positive quantity.'); return; }

    // Optional supplier check (warn only)
    if (supplierId && product?.supplierId && product.supplierId !== supplierId) {
      const ok = await ask(
        'Supplier mismatch',
        `This product is assigned to a different supplier.\n\nAdd it to this draft anyway?`
      );
      if (!ok) return;
    }

    const db = getFirestore(getApp());
    const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
    const lineRef  = doc(collection(orderRef, 'lines'), product.id);
    const prev = await getDoc(lineRef);
    const prevQty = prev.exists() ? Number((prev.data() as any)?.qty ?? 0) : 0;
    await setDoc(lineRef, {
      productId: product.id,
      name: product.name || product.id,
      qty: prevQty + n,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    onAdded?.();
    Alert.alert('Draft', `Added ${n} × “${product.name || product.id}”`);
  }

  async function quickCreateAndAdd() {
    if (!supplierId) { Alert.alert('Add item', 'This draft has no supplier set.'); return; }
    const name = q.trim();
    if (!name) { Alert.alert('Add item', 'Type a product name first.'); return; }
    const created = await quickCreateProduct(venueId, name, supplierId, supplierName);
    await addToDraft(created);
    // refresh product list to include the new item
    await load();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, maxHeight: '80%' }}>
          <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>
            Add item {supplierName ? `for “${supplierName}”` : ''}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={supplierId ? 'Search products for this supplier' : 'Search products'}
              style={{
                flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, height: 40,
              }}
            />
            <TextInput
              value={qty}
              onChangeText={setQty}
              keyboardType="number-pad"
              placeholder="Qty"
              style={{
                width: 64, marginLeft: 8, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, textAlign: 'center', height: 40,
              }}
            />
          </View>

          {supplierId ? (
            <Text style={{ marginBottom: 6, color: '#6b7280' }}>Showing items for this supplier.</Text>
          ) : (
            <Text style={{ marginBottom: 6, color: '#b45309' }}>This draft has no supplier set – showing all products.</Text>
          )}

          {loading ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 8 }}>Loading…</Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(it) => it.id}
              renderItem={({ item }) => (
                <View style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#eee', flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600' }}>{item.name || item.id}</Text>
                    {!!item.supplierName && <Text style={{ color: '#6b7280' }}>{item.supplierName}</Text>}
                  </View>
                  <TouchableOpacity
                    onPress={() => addToDraft(item)}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#111827' }}
                  >
                    <Text style={{ color: 'white', fontWeight: '700' }}>Add</Text>
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={
                <View style={{ paddingVertical: 20 }}>
                  <Text style={{ marginBottom: 8 }}>No products found.</Text>
                  <TouchableOpacity
                    onPress={quickCreateAndAdd}
                    style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}
                  >
                    <Text style={{ fontWeight: '600' }}>Quick-create “{q || 'New product'}” and add</Text>
                  </TouchableOpacity>
                </View>
              }
            />
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ textDecorationLine: 'underline' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ask(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', onPress: () => resolve(true) },
    ]);
  });
}
