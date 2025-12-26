// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useVenueId } from 'src/context/VenueProvider';
import SupplierBadge from 'src/components/SupplierBadge';
import { savedToast } from '../../utils/toast';

type Line = { productId: string; name?: string | null; qty: number };
type Props = { orderId: string; onSubmitted?: () => void };

export default function OrderEditor({ orderId, onSubmitted }: Props) {
  const venueId = useVenueId();
  const [order, setOrder] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  const db = getFirestore(getApp());
  const orderRef = venueId ? doc(db, 'venues', venueId, 'orders', orderId) : null;

  useEffect(() => {
    if (!orderRef) return;
    const unsub = onSnapshot(orderRef, (snap) => {
      setOrder(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [orderRef]);

  useEffect(() => {
    if (!orderRef) return;
    const col = collection(orderRef, 'lines');
    const qy = query(col, orderBy('name'));
    const unsub = onSnapshot(qy, (snap) => {
      const next: Line[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        next.push({ productId: d.id, name: v?.name ?? d.id, qty: Number(v?.qty ?? 0) });
      });
      setLines(next);
      setLoading(false);
    });
    return () => unsub();
  }, [orderRef]);

  const totalQty = useMemo(
    () => lines.reduce((a, b) => a + (Number(b.qty) || 0), 0),
    [lines]
  );

  const bumpQty = useCallback(async (productId: string, delta: number) => {
    if (!orderRef) return;
    const lr = doc(orderRef, 'lines', productId);
    const snap = await getDoc(lr);
    const prev = Number(snap.exists() ? (snap.data() as any)?.qty ?? 0 : 0);
    const next = prev + delta;
    if (next <= 0) {
      await deleteDoc(lr);
      savedToast('Line removed');
    } else {
      await setDoc(lr, { qty: next, updatedAt: serverTimestamp() }, { merge: true });
      savedToast('Draft updated');
    }
  }, [orderRef]);

  const deleteLine = useCallback(async (productId: string) => {
    if (!orderRef) return;
    await deleteDoc(doc(orderRef, 'lines', productId));
    savedToast('Line removed');
  }, [orderRef]);

  const submit = useCallback(async () => {
    try {
      if (!orderRef) throw new Error('No order');
      if (!lines.length) {
        Alert.alert('Submit', 'This draft has no lines.');
        return;
      }
      await updateDoc(orderRef, {
        status: 'submitted',
        displayStatus: 'Submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Order', 'Order marked as submitted.');
      onSubmitted?.();
    } catch (e: any) {
      Alert.alert('Order', e?.message ?? 'Failed to submit order.');
    }
  }, [orderRef, lines, onSubmitted]);

  if (!venueId) {
    return <View style={{ padding: 16 }}><Text>No venue selected.</Text></View>;
  }
  if (loading) {
    return <View style={{ padding: 16 }}><Text>Loading…</Text></View>;
  }
  if (!order) {
    return <View style={{ padding: 16 }}><Text>Order not found.</Text></View>;
  }

  const supplierId = order?.supplierId || null;
  const supplierName = order?.supplierName || 'Supplier';

  return (
    <View style={{ flex: 1, backgroundColor: '#fafafa' }}>
      {/* Header */}
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fff' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SupplierBadge supplierId={supplierId} name={supplierName} />
          <View style={{ marginLeft: 8 }}>
            <Text style={{ fontWeight: '800' }}>{supplierName}</Text>
            <Text style={{ color: '#6b7280' }}>{order?.displayStatus ?? order?.status ?? 'Draft'}</Text>
          </View>
        </View>
        <Text style={{ marginTop: 8, color: '#6b7280' }}>
          {lines.length} line{lines.length === 1 ? '' : 's'} • total qty {totalQty}
        </Text>
      </View>

      {/* Lines */}
      <FlatList
        data={lines}
        keyExtractor={(l) => l.productId}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderColor: '#eee', borderWidth: 1 }}>
            <Text style={{ fontWeight: '700' }}>{item.name ?? item.productId}</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
              <TouchableOpacity onPress={() => bumpQty(item.productId, -1)}
                                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}>
                <Text style={{ fontSize: 18 }}>–</Text>
              </TouchableOpacity>

              <Text style={{ width: 56, textAlign: 'center', fontWeight: '800' }}>{item.qty}</Text>

              <TouchableOpacity onPress={() => bumpQty(item.productId, +1)}
                                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}>
                <Text style={{ fontSize: 18 }}>+</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => deleteLine(item.productId)}
                                style={{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ color: '#b00020' }}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Footer actions */}
      <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff' }}>
        <TouchableOpacity
          onPress={submit}
          style={{ backgroundColor: '#111827', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '800' }}>Submit Order</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
