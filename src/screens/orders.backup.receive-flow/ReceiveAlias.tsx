// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator, FlatList } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, onSnapshot,
  collection, getDocs, writeBatch, serverTimestamp, setDoc
} from 'firebase/firestore';
import { useVenueId } from 'src/context/VenueProvider';

type Line = {
  productId: string;
  name?: string | null;
  qty?: number;           // ordered qty
  receivedQty?: number;   // received for this session
};

export default function ReceiveAlias() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const orderId: string | undefined = route?.params?.orderId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [supplierName, setSupplierName] = useState<string>('Order');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [lines, setLines] = useState<Line[]>([]);

  // live order doc
  useEffect(() => {
    if (!venueId || !orderId) return;
    const db = getFirestore(getApp());
    const ref = doc(db, 'venues', venueId, 'orders', orderId);
    const unsub = onSnapshot(ref, (snap) => {
      const v = snap.data() as any;
      setSupplierName(v?.supplierName || v?.supplierId || 'Order');
      setStatus(v?.status);
    });
    return () => unsub();
  }, [venueId, orderId]);

  // load lines; prefill receivedQty with ordered qty
  useEffect(() => {
    (async () => {
      if (!venueId || !orderId) { setLoading(false); return; }
      try {
        const db = getFirestore(getApp());
        const ls = await getDocs(collection(db, 'venues', venueId, 'orders', orderId, 'lines'));
        const out: Line[] = [];
        ls.forEach(d => {
          const v = d.data() as any;
          const ordered = Number(v?.qty ?? 0);
          out.push({
            productId: v?.productId || d.id,
            name: v?.name || d.id,
            qty: ordered,
            receivedQty: Number(v?.receivedQty ?? ordered), // PREFILL from ordered
          });
        });
        out.sort((a, b) => (a.name || a.productId).localeCompare(b.name || b.productId));
        setLines(out);
      } catch (e) {
        Alert.alert('Receive', (e as any)?.message ?? 'Failed to load lines.');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId, orderId]);

  // derived totals (for header)
  const totals = useMemo(() => {
    const ordered = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
    const received = lines.reduce((s, l) => s + Number(l.receivedQty || 0), 0);
    const allReceived = lines.length > 0 && lines.every(l => Number(l.receivedQty || 0) >= Number(l.qty || 0));
    const anyReceived = lines.some(l => Number(l.receivedQty || 0) > 0);
    return { ordered, received, allReceived, anyReceived };
  }, [lines]);

  // UI helpers
  const bump = useCallback((productId: string, delta: number) => {
    setLines(prev => prev.map(l => {
      if (l.productId !== productId) return l;
      const ordered = Number(l.qty || 0);
      const next = Math.max(0, Math.min(ordered, Number(l.receivedQty || 0) + delta));
      return { ...l, receivedQty: next };
    }));
  }, []);

  const receiveAll = useCallback(() => {
    setLines(prev => prev.map(l => ({ ...l, receivedQty: Number(l.qty || 0) })));
  }, []);

  // persist helper (keeps submitted) or finalize (received)
  const persist = useCallback(async (finalize: boolean) => {
    if (!venueId || !orderId) return;
    try {
      setSaving(true);
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      // write per-line receivedQty
      lines.forEach(l => {
        const lineRef = doc(orderRef, 'lines', l.productId);
        batch.set(lineRef, {
          productId: l.productId,
          name: l.name || l.productId,
          receivedQty: Number(l.receivedQty || 0),
          updatedAt: now
        }, { merge: true });
      });

      if (finalize) {
        batch.set(orderRef, {
          status: 'received',
          displayStatus: 'Received',
          receivedAt: now,
          updatedAt: now,
        }, { merge: true });
      } else {
        // Save without changing phase: ensure it's not draft
        batch.set(orderRef, {
          status: 'submitted',
          displayStatus: 'Submitted',
          updatedAt: now,
        }, { merge: true });
      }

      await batch.commit();

      Alert.alert('Receive', finalize ? 'Order marked as Received.' : 'Saved.');
      nav.goBack(); // back to OrderDetail -> header will refresh
    } catch (e) {
      console.warn('[Receive] save error', e);
      Alert.alert('Receive', (e as any)?.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }, [venueId, orderId, lines, nav]);

  if (!venueId || !orderId) {
    return <Centered><Text>Missing venue/order id.</Text></Centered>;
  }

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading…</Text>
      </Centered>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header area */}
      <View style={{ padding: 12, borderBottomWidth: 1, borderColor: '#eee', backgroundColor: '#fff' }}>
        <Text style={{ fontWeight: '800' }}>{supplierName}</Text>
        <Text style={{ color: '#6b7280', marginTop: 2 }}>
          {status ? status[0].toUpperCase() + status.slice(1) : '—'} • Ordered {totals.ordered} • Received {totals.received}
        </Text>

        {/* Actions row */}
        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap' }}>
          <Button onPress={() => Alert.alert('Scan Invoice', 'Invoice OCR (coming soon).')} text="Scan Invoice (coming soon)" />
          <View style={{ width: 8 }} />
          <Button onPress={receiveAll} text="Receive All" />
          <View style={{ width: 8 }} />
          <Button onPress={() => persist(false)} text={saving ? 'Saving…' : 'Save'} />
          <View style={{ width: 8 }} />
          <Button onPress={() => persist(true)} text={saving ? 'Working…' : 'Complete Receiving'} primary disabled={saving} />
        </View>
      </View>

      {/* Lines */}
      <FlatList
        data={lines}
        keyExtractor={(l) => l.productId}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => {
          const ordered = Number(item.qty || 0);
          const received = Number(item.receivedQty || 0);
          return (
            <View style={{
              backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10,
              borderWidth: 1, borderColor: '#eee'
            }}>
              <Text style={{ fontWeight: '700' }}>{item.name || item.productId}</Text>
              <Text style={{ color: '#6b7280', marginTop: 2 }}>Ordered: {ordered}</Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <TouchableOpacity onPress={() => bump(item.productId, -1)} style={pill(false)}>
                  <Text>−</Text>
                </TouchableOpacity>
                <Text style={{ marginHorizontal: 14, fontWeight: '700' }}>{received}</Text>
                <TouchableOpacity onPress={() => bump(item.productId, +1)} style={pill(false)}>
                  <Text>＋</Text>
                </TouchableOpacity>

                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  onPress={() => setLines(prev => prev.map(l => l.productId === item.productId ? { ...l, receivedQty: ordered } : l))}
                  style={pill(true)}
                >
                  <Text style={{ color: '#fff' }}>All</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function Centered({ children }: any) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</View>;
}
function Button({ text, onPress, primary, disabled }: any) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={{
        paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8,
        backgroundColor: primary ? (disabled ? '#9CA3AF' : '#111827') : '#F3F4F6'
      }}>
      <Text style={{ color: primary ? '#fff' : '#111827', fontWeight: '700' }}>{text}</Text>
    </TouchableOpacity>
  );
}
function pill(primary: boolean) {
  return {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: primary ? '#111827' : '#F3F4F6'
  };
}

