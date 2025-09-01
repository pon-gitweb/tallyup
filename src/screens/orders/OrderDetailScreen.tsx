import React, { useEffect, useMemo, useState, useLayoutEffect } from 'react';
import { useRoute, useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, ActivityIndicator, Alert, FlatList, TouchableOpacity } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { db } from '../../services/firebase';
import {
  doc, getDoc, collection, getDocs, updateDoc, serverTimestamp,
} from 'firebase/firestore';

type Order = {
  id: string;
  supplierId: string;
  status: 'draft' | 'submitted' | 'received' | string;
  notes?: string | null;
  createdAt?: any;
  submittedAt?: any;
  receivedAt?: any;
};

type Line = {
  id: string;
  productId: string;
  name?: string;
  unitCost?: number;
  qty?: number;
  packSize?: number | null;
};

export default function OrderDetailScreen() {
  const venueId = useVenueId();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const orderId: string = route.params?.orderId;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Text onPress={() => navigation.navigate('ReceiveOrder', { orderId })} style={{color:'#0A84FF',fontWeight:'800'}}>Receive</Text>
      ),
    });
  }, [navigation, orderId]);

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  async function load() {
    if (!venueId || !orderId) {
      setOrder(null); setLines([]); setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const oref = doc(db, 'venues', venueId, 'orders', orderId);
      const osnap = await getDoc(oref);
      if (!osnap.exists()) {
        Alert.alert('Not found', 'This order no longer exists.');
        setOrder(null); setLines([]); return;
      }
      const odata = osnap.data() as any;
      const orderObj: Order = { id: osnap.id, ...odata };

      const lsnap = await getDocs(collection(db, 'venues', venueId, 'orders', orderId, 'lines'));
      const larr: Line[] = [];
      lsnap.forEach(d => larr.push({ id: d.id, ...(d.data() as any) }));

      setOrder(orderObj);
      setLines(larr);
    } catch (e: any) {
      console.log('[OrderDetail] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId, orderId]);

  const total = useMemo(() => {
    return lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
  }, [lines]);

  async function onSubmit() {
    if (!venueId || !orderId) return;
    try {
      const oref = doc(db, 'venues', venueId, 'orders', orderId);
      await updateDoc(oref, {
        status: 'submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Submitted', 'Order has been submitted.');
      await load();
    } catch (e: any) {
      Alert.alert('Submit Failed', e?.message || 'Unknown error');
    }
  }

  async function onReceive() {
    if (!venueId || !orderId) return;
    try {
      // Minimal receive: mark order as received and stamp the time.
      // (If you also create an invoice doc, rules below already allow it.)
      const oref = doc(db, 'venues', venueId, 'orders', orderId);
      await updateDoc(oref, {
        status: 'received',
        receivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Received', 'Order marked as received.');
      // Optionally go back to Orders list; for now, just refresh in place:
      await load();
    } catch (e: any) {
      Alert.alert('Receive Failed', e?.message || 'Unknown error');
    }
  }

  if (!venueId) {
    return (
      <View style={styles.center}>
        <Text>You are not attached to a venue.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading order…</Text>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text>Order not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Order Detail</Text>
      <Text style={styles.sub}>Order: {order.id}</Text>
      <Text style={styles.sub}>Status: {order.status}</Text>

      <FlatList
        style={{ marginTop: 10 }}
        data={lines}
        keyExtractor={(l) => l.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item: l }) => (
          <View style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{l.name || l.productId}</Text>
              <Text style={styles.muted}>
                {l.qty ?? 0} × {l.unitCost != null ? Number(l.unitCost).toFixed(2) : '—'}
                {l.packSize ? ` · pack ${l.packSize}` : ''}
              </Text>
            </View>
            <Text style={styles.price}>
              {((Number(l.qty) || 0) * (Number(l.unitCost) || 0)).toFixed(2)}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text>No lines.</Text>}
      />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{total.toFixed(2)}</Text>
      </View>

      {/* Footer actions by status */}
      {order.status === 'draft' ? (
        <TouchableOpacity style={styles.primary} onPress={onSubmit}>
          <Text style={styles.primaryText}>Submit Order</Text>
        </TouchableOpacity>
      ) : order.status === 'submitted' ? (
        <TouchableOpacity style={styles.primary} onPress={onReceive}>
          <Text style={styles.primaryText}>Receive & Mark Complete</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.pill}><Text style={styles.pillText}>Received ✓</Text></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { opacity: 0.7 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: '#F2F2F7', borderRadius: 12 },
  name: { fontWeight: '700' },
  muted: { opacity: 0.7 },
  price: { fontWeight: '900', width: 80, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#D0D3D7' },
  totalLabel: { fontWeight: '800' },
  totalValue: { fontWeight: '900' },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryText: { color: 'white', fontWeight: '800' },
  pill: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#E7F8EC', borderRadius: 999, alignSelf: 'flex-start', marginTop: 8 },
  pillText: { color: '#0A7D37', fontWeight: '800' },
});
