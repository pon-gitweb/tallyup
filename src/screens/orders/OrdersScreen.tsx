// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, getFirestore, orderBy, query } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';

// Utility: get the most recent stock-take completion time across all areas
async function getLastStockTakeCompletedAt(db:any, venueId:string){
  let latest: any = null;
  const deps = await getDocs(collection(db,'venues',venueId,'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(collection(db,'venues',venueId,'departments',dep.id,'areas'));
    areas.forEach(a=>{
      const data:any = a.data()||{};
      const c = data?.completedAt;
      if (c && typeof c.toMillis === 'function') {
        const ms = c.toMillis();
        if (latest == null || ms > latest) latest = ms;
      }
    });
  }
  return latest; // number (ms) or null
}

export default function OrdersScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [orders, setOrders] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!venueId) { setOrders([]); return; }

    // 1) Determine last completed stock-take time (ms); fallback = now - 7 days
    const lastCompletedMs = await getLastStockTakeCompletedAt(db, venueId);
    const sevenDaysAgo = Date.now() - 7*24*60*60*1000;
    const cutoffMs = lastCompletedMs ?? sevenDaysAgo;

    // 2) Load orders (desc by createdAt)
    const ref = collection(db, 'venues', venueId, 'orders');
    const snap = await getDocs(query(ref, orderBy('createdAt', 'desc')));

    // 3) Filter: keep all non-draft; keep drafts with createdAt >= cutoff
    const filtered: any[] = [];
    snap.forEach(d => {
      const data:any = d.data()||{};
      const status = (data.displayStatus || data.status || 'draft').toLowerCase();
      const ts = data?.createdAt;
      const createdMs = ts && typeof ts.toMillis==='function' ? ts.toMillis() : 0;

      const isDraft = status === 'draft';
      const keep = !isDraft ? true : (createdMs >= cutoffMs);
      if (keep) filtered.push({ id: d.id, ...data });
    });

    setOrders(filtered);
  }, [db, venueId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const open = (orderId: string) => nav.navigate('OrderEditor', { orderId, id: orderId });

  const Item = ({ item }: { item: any }) => {
    const statusText = item.displayStatus || item.status || 'Draft';
    const count = item.linesCount ?? item.itemsCount ?? 0;
    return (
      <TouchableOpacity style={S.row} onPress={() => open(item.id)}>
        <View style={{ flex: 1 }}>
          <Text style={S.rowTitle}>{item.supplierName || 'Order'}</Text>
          <Text style={S.rowSub}>{statusText} • {count} item{count===1?'':'s'}</Text>
        </View>
        <Text style={S.chev}>›</Text>
      </TouchableOpacity>
    );
  };

  const header = useMemo(() => (
    <View style={S.headerRow}>
      <Text style={S.title}>Orders</Text>
      <IdentityBadge />
    </View>
  ), []);

  return (
    <View style={S.wrap}>
      {header}
      <FlatList
        data={orders}
        keyExtractor={(x) => x.id}
        renderItem={Item}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<View style={{ padding: 16 }}><Text style={{ color: '#6B7280' }}>No recent orders.</Text></View>}
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

