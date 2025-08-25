import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, FlatList } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { calcTotal, cancelOrder, getOrderWithLines, markReceived, submitOrder } from '../../services/orders';
import { listSuppliers } from '../../services/suppliers';

export default function OrderDetailScreen() {
  const venueId = useVenueId();
  const route = useRoute<any>();
  const orderId: string = route.params?.orderId;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [supplierName, setSupplierName] = useState<string>('');

  async function load() {
    if (!venueId || !orderId) { setLoading(false); return; }
    try {
      const [{ order, lines }, suppliers] = await Promise.all([
        getOrderWithLines(venueId, orderId),
        listSuppliers(venueId),
      ]);
      setOrder(order);
      setLines(lines);
      const s = suppliers.find(x => x.id === order.supplierId);
      setSupplierName(s?.name || order.supplierId);
    } catch (e: any) {
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId, orderId]);

  const total = useMemo(() => calcTotal(lines), [lines]);

  async function doSubmit() {
    try { await submitOrder(venueId!, orderId); Alert.alert('Submitted', 'Order submitted.'); load(); }
    catch (e: any) { Alert.alert('Submit Failed', e?.message || 'Unknown error'); }
  }
  async function doReceive() {
    try { await markReceived(venueId!, orderId); Alert.alert('Received', 'Order marked received.'); load(); }
    catch (e: any) { Alert.alert('Receive Failed', e?.message || 'Unknown error'); }
  }
  async function doCancel() {
    try { await cancelOrder(venueId!, orderId); Alert.alert('Cancelled', 'Order cancelled.'); load(); }
    catch (e: any) { Alert.alert('Cancel Failed', e?.message || 'Unknown error'); }
  }

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Loading order…</Text></View>);
  if (!order) return (<View style={styles.center}><Text>Order not found.</Text></View>);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{supplierName}</Text>
      <Text style={styles.sub}>Status: {order.status.toUpperCase()}</Text>
      {order.notes ? <Text style={styles.sub}>Notes: {order.notes}</Text> : null}

      <FlatList
        style={{ marginTop: 10 }}
        data={lines}
        keyExtractor={(l) => l.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{item.qty} @ {item.unitCost ?? '—'}</Text>
            </View>
            <Text style={styles.totCell}>
              {item.unitCost != null ? (Number(item.unitCost) * Number(item.qty)).toFixed(2) : '—'}
            </Text>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.totalRow}>
            <Text style={styles.totalLbl}>Total</Text>
            <Text style={styles.totalVal}>{total.toFixed(2)}</Text>
          </View>
        }
      />

      <View style={styles.rowBtns}>
        {order.status === 'draft' && (
          <TouchableOpacity style={[styles.btn, styles.primary]} onPress={doSubmit}>
            <Text style={styles.primaryText}>Submit</Text>
          </TouchableOpacity>
        )}
        {order.status === 'submitted' && (
          <TouchableOpacity style={[styles.btn, styles.primary]} onPress={doReceive}>
            <Text style={styles.primaryText}>Mark Received</Text>
          </TouchableOpacity>
        )}
        {order.status !== 'cancelled' && order.status !== 'received' && (
          <TouchableOpacity style={[styles.btn, styles.danger]} onPress={doCancel}>
            <Text style={styles.dangerText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { opacity: 0.7 },
  row: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  name: { fontWeight: '700' },
  totCell: { fontWeight: '700' },
  totalRow: { marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: '#EFEFF4', flexDirection: 'row', justifyContent: 'space-between' },
  totalLbl: { fontWeight: '800' },
  totalVal: { fontWeight: '800' },
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  primary: { backgroundColor: '#0A84FF' },
  primaryText: { color: 'white', fontWeight: '800' },
  danger: { backgroundColor: '#FF3B30' },
  dangerText: { color: 'white', fontWeight: '800' },
});
