import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
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
  invoiceId?: string | null;
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

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    (async () => {
      if (!venueId || !orderId) { Alert.alert('Missing', 'No venue/order provided'); navigation.goBack(); return; }
      try {
        setLoading(true);
        const oref = doc(db, 'venues', venueId, 'orders', orderId);
        const osnap = await getDoc(oref);
        if (!osnap.exists()) throw new Error('Order not found');
        setOrder({ id: osnap.id, ...(osnap.data() as any) });

        const lref = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
        const lsnap = await getDocs(lref);
        setLines(lsnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (e: any) {
        console.log('[OrderDetail] load error', e?.message);
        Alert.alert('Load failed', e?.message || 'Unknown error');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId, orderId]);

  const total = useMemo(() => {
    return lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
  }, [lines]);

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Loading order…</Text></View>);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>Order Detail</Text>
      <Text style={styles.sub}>Order: {orderId}</Text>
      <View style={styles.card}>
        <Text>Status: <Text style={styles.bold}>{order?.status}</Text></Text>
        {order?.invoiceId ? <Text>Invoice: {order.invoiceId}</Text> : null}
        {order?.notes ? <Text>Notes: {order.notes}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Lines</Text>
        {lines.map(l => (
          <View key={l.id} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{l.name || l.productId}</Text>
              <Text style={styles.muted}>{l.productId}</Text>
            </View>
            <Text style={styles.qty}>{l.qty}</Text>
            <Text style={styles.cost}>@ {Number(l.unitCost ?? 0).toFixed(2)}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.card, styles.total]}>
        <Text style={styles.totalText}>Total</Text>
        <Text style={styles.totalText}>${total.toFixed(2)}</Text>
      </View>

      {order?.status === 'received' && (
        <TouchableOpacity
          style={styles.primary}
          onPress={() => navigation.navigate('Invoice', { orderId })}
        >
          <Text style={styles.primaryText}>Log Invoice</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { opacity: 0.7, marginBottom: 8 },
  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, gap: 8 },
  section: { fontWeight: '800', marginBottom: 8 },
  bold: { fontWeight: '800' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  lineName: { fontWeight: '700' },
  muted: { opacity: 0.6, fontSize: 12 },
  qty: { width: 54, textAlign: 'right', fontWeight: '700' },
  cost: { width: 90, textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalText: { fontWeight: '900', fontSize: 18 },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryText: { color: 'white', fontWeight: '800' },
});
