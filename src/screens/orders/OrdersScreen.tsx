import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { listOrders, Order } from '../../services/orders';
import { listSuppliers, Supplier } from '../../services/suppliers';

type Row = Order & { supplierName?: string };

export default function OrdersScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!venueId) { setRows([]); setLoading(false); return; }
    try {
      const [orders, suppliers] = await Promise.all([
        listOrders(venueId),
        listSuppliers(venueId),
      ]);
      const supplierMap: Record<string, Supplier> = {};
      suppliers.forEach(s => { if (s.id) supplierMap[s.id] = s; });
      const merged: Row[] = orders.map(o => ({
        ...o,
        supplierName: supplierMap[o.supplierId]?.name || o.supplierId,
      }));
      setRows(merged);
    } catch (e: any) {
      console.log('[OrdersScreen] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openOrder(o: Row) {
    nav.navigate('OrderDetail', { orderId: o.id });
  }

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Loading orders…</Text></View>);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Orders</Text>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id!}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => openOrder(item)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.supplierName}</Text>
              <Text style={styles.sub}>
                {item.status.toUpperCase()}
                {item.createdAt ? ` · ${new Date(item.createdAt.seconds * 1000).toLocaleString()}` : ''}
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text>No orders yet. Generate Suggested Orders from Settings.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  row: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  name: { fontWeight: '700' },
  sub: { opacity: 0.7, marginTop: 2 },
  chev: { fontSize: 22, opacity: 0.4, paddingHorizontal: 6 },
});
