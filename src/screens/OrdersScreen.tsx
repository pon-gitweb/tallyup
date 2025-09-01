import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, FlatList, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../context/VenueProvider';
import { db } from '../services/firebase';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { isDraftStale, listDraftOrders, archiveStaleDrafts, snoozeDraft, TOrder } from '../services/orders.stale';

type Tab = 'draft'|'submitted'|'received'|'archived';

export default function OrdersScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('draft');
  const [orders, setOrders] = useState<TOrder[]>([]);
  const [staleCount, setStaleCount] = useState(0);

  async function load() {
    if (!venueId) { setOrders([]); setStaleCount(0); setLoading(false); return; }
    try {
      setLoading(true);
      if (tab === 'draft') {
        const drafts = await listDraftOrders(venueId);
        setOrders(drafts);
        setStaleCount(drafts.filter(d => isDraftStale(d)).length);
      } else {
        const q = query(
          collection(db, 'venues', venueId, 'orders'),
          where('status', '==', tab),
          orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        const arr: TOrder[] = [];
        snap.forEach(d => arr.push({ id: d.id, ...(d.data() as any) }));
        setOrders(arr);
        setStaleCount(0);
      }
    } catch (e: any) {
      console.log('[OrdersScreen] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId, tab]);

  function openOrder(orderId: string) {
    nav.navigate('OrderDetail', { orderId });
  }

  async function onArchiveStale() {
    if (!venueId) return;
    try {
      const count = await archiveStaleDrafts(venueId);
      Alert.alert('Archived', `${count} stale draft${count === 1 ? '' : 's'} archived.`);
      load();
    } catch (e: any) {
      Alert.alert('Archive Failed', e?.message || 'Unknown error');
    }
  }

  async function onSnooze(orderId: string) {
    if (!venueId) return;
    try {
      const in3days = Date.now() + 3 * 24 * 60 * 60 * 1000;
      await snoozeDraft(venueId, orderId, in3days);
      load();
    } catch (e: any) {
      Alert.alert('Snooze Failed', e?.message || 'Unknown error');
    }
  }

  const header = useMemo(() => {
    return (
      <View style={styles.tabs}>
        {(['draft','submitted','received','archived'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t[0].toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }, [tab]);

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
        <Text>Loading orders…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Orders</Text>
      {header}

      {tab === 'draft' && staleCount > 0 && (
        <View style={styles.warn}>
          <Text style={styles.warnText}>
            {staleCount} draft{staleCount === 1 ? '' : 's'} haven’t been actioned for a few days.
          </Text>
          <TouchableOpacity style={styles.warnBtn} onPress={onArchiveStale}>
            <Text style={styles.warnBtnText}>Archive stale drafts</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        style={{ marginTop: 10 }}
        data={orders}
        keyExtractor={(o) => o.id}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item: o }) => (
          <TouchableOpacity
            onPress={() => openOrder(o.id)}
            style={[styles.row, tab === 'draft' && isDraftStale(o) ? styles.rowStale : null]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Order {o.id.slice(0,8)}…</Text>
              <Text style={styles.rowSub}>Status: {o.status}</Text>
            </View>
            {tab === 'draft' && (
              <TouchableOpacity style={styles.snooze} onPress={() => onSnooze(o.id)}>
                <Text style={styles.snoozeText}>Snooze 3d</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text>No orders.</Text>}
      />

      <TouchableOpacity style={styles.primary} onPress={() => nav.navigate('NewOrder')}>
        <Text style={styles.primaryText}>New Order</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },

  tabs: { flexDirection: 'row', gap: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F2F2F7' },
  tabActive: { backgroundColor: '#0A84FF22' },
  tabText: { fontWeight: '700', color: '#333' },
  tabTextActive: { color: '#0A84FF' },

  warn: { backgroundColor: '#FFF4E5', borderRadius: 12, padding: 12, gap: 8 },
  warnText: { color: '#8A5200', fontWeight: '600' },
  warnBtn: { alignSelf: 'flex-start', backgroundColor: '#8A5200', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  warnBtnText: { color: 'white', fontWeight: '800' },

  row: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#F2F2F7', borderRadius: 12, gap: 10 },
  rowStale: { backgroundColor: '#FFEFD9' },
  rowTitle: { fontWeight: '800' },
  rowSub: { opacity: 0.7 },

  snooze: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#E5F3FF', borderRadius: 8 },
  snoozeText: { color: '#0A84FF', fontWeight: '800' },

  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  primaryText: { color: 'white', fontWeight: '800' },
});
