// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, getFirestore, orderBy, query } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';

export default function OrdersScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [orders, setOrders] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!venueId) { setOrders([]); return; }
    try {
      const ref = collection(db, 'venues', venueId, 'orders');
      const snap = await getDocs(query(ref, orderBy('createdAt', 'desc')));
      setOrders(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    } catch (e:any) {
      if (__DEV__) console.log('[Orders] load error', e?.message);
      setOrders([]);
    }
  }, [db, venueId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const open = (orderId: string) => nav.navigate('OrderDetail', { venueId, orderId });

  const Item = ({ item }: { item: any }) => (
    <TouchableOpacity style={S.row} onPress={() => open(item.id)}>
      <View style={{ flex: 1 }}>
        <Text style={S.rowTitle}>{item.supplierName || 'Order'}</Text>
        <Text style={S.rowSub}>{item.status || 'draft'} • {item.itemsCount || 0} items</Text>
      </View>
      <Text style={S.chev}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={S.wrap}>
      <View style={S.headerRow}>
        <Text style={S.title}>Orders</Text>
        <IdentityBadge />
      </View>

      <FlatList
        data={orders}
        keyExtractor={(x) => x.id}
        renderItem={Item}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<View style={{ padding: 16 }}><Text style={{ color: '#6B7280' }}>No orders yet.</Text></View>}
      />
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'white', padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#F9FAFB' },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowSub: { color: '#6B7280', marginTop: 2 },
  chev: { fontSize: 22, color: '#94A3B8', marginLeft: 8 },
});
