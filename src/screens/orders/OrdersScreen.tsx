// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Alert,
  TouchableOpacity, FlatList, RefreshControl, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot, query, orderBy } from 'firebase/firestore';

import { useVenueId } from '../../context/VenueProvider';
// If your suppliers API lives elsewhere, tweak this import path:
import { listSuppliers } from '../../services/suppliers';

type Row = {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: string | null;          // 'draft' | 'submitted' | 'received' | ...
  displayStatus?: string | null;   // human label (fallback)
  createdAt?: any;
  updatedAt?: any;
};

function millis(x: any) {
  if (!x) return 0;
  if (typeof x === 'number') return x;
  if (x?.toMillis) return x.toMillis();
  if (x?.toDate) return x.toDate().getTime();
  return 0;
}

function humanStatus(o: Row) {
  const s = (o?.status || '').toString().toLowerCase();
  if (s === 'submitted') return 'Submitted';
  if (s === 'received')  return 'Received';
  if (s === 'draft')     return 'Draft';
  return (o?.displayStatus || 'Draft');
}

function whenLabel(o: Row) {
  const ms = millis(o.updatedAt) || millis(o.createdAt);
  if (!ms) return '—';
  const d = new Date(ms);
  const dd = new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit' }).format(d);
  const tt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${dd}, ${tt}`;
}

export default function OrdersScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [supplierNames, setSupplierNames] = useState<Record<string, string>>({});

  // One-time supplier name map (for nice labels)
  const loadSuppliers = useCallback(async () => {
    try {
      if (!venueId) return;
      const list = await listSuppliers(venueId);
      const map: Record<string, string> = {};
      list.forEach((s: any) => { if (s?.id) map[s.id] = s.name ?? s.id; });
      setSupplierNames(map);
    } catch (e) {
      console.warn('[OrdersScreen] suppliers load failed', e);
    }
  }, [venueId]);

  // Live subscription to orders (reacts to submit instantly)
  const bindOrders = useCallback(() => {
    if (!venueId) return () => {};
    const db = getFirestore(getApp());
    const q = query(collection(db, 'venues', venueId, 'orders'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Row[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        // Secondary sort when updatedAt is still serverTimestamp()
        next.sort((a, b) => (millis(b.updatedAt) || millis(b.createdAt)) - (millis(a.updatedAt) || millis(a.createdAt)));
        setRows(next);
        setLoading(false);
        setRefreshing(false);
      },
      (err) => {
        console.warn('[OrdersScreen] onSnapshot error', err);
        setLoading(false);
        setRefreshing(false);
        Alert.alert('Orders', 'Failed to load orders.');
      }
    );
    return unsub;
  }, [venueId]);

  useEffect(() => {
    setLoading(true);
    const off = bindOrders();
    loadSuppliers();
    return () => off && off();
  }, [bindOrders, loadSuppliers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const off = bindOrders();
    loadSuppliers();
    // Unbind the previous listener shortly after to avoid flicker
    setTimeout(() => off && off(), 200);
  }, [bindOrders, loadSuppliers]);

  const renderItem = ({ item }: { item: Row }) => {
    const supplier =
      item.supplierName ||
      (item.supplierId ? supplierNames[item.supplierId] : '') ||
      item.supplierId ||
      'Supplier';

    return (
      <TouchableOpacity onPress={() => nav.navigate('OrderDetail', { orderId: item.id })} style={styles.card}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{supplier}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {humanStatus(item)} • {whenLabel(item)}
          </Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading orders…</Text>
      </SafeAreaView>
    );
  }

  if (!rows.length) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ fontWeight: '800', marginBottom: 6 }}>No orders yet</Text>
        <Text style={{ color: '#6b7280', marginBottom: 16, textAlign: 'center' }}>
          Create a new order, or generate drafts from Suggested Orders.
        </Text>
        <TouchableOpacity onPress={() => nav.navigate('SuggestedOrders')} style={styles.primary}>
          <Text style={styles.primaryText}>Open Suggested Orders</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fafafa' }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Orders</Text>
        <TouchableOpacity onPress={() => nav.navigate('SuggestedOrders')}>
          <Text style={styles.link}>Suggested Orders</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fafafa' },
  primary: { backgroundColor: '#111827', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  primaryText: { color: 'white', fontWeight: '700' },

  header: {
    paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  link: { textDecorationLine: 'underline' },

  card: {
    backgroundColor: '#fff',
    marginHorizontal: 12, marginVertical: 6,
    padding: 12, borderRadius: 12, elevation: 2,
    flexDirection: 'row', alignItems: 'center',
  },
  rowTitle: { fontWeight: '700' },
  rowSub: { color: '#6b7280', marginTop: 2 },
  chev: { fontSize: 20, color: '#9CA3AF', marginLeft: 8 },
});

