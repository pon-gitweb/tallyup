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
import { listSuppliers } from '../../services/suppliers';

type Row = {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: string | null;
  displayStatus?: string | null;
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

  const bindOrders = useCallback(() => {
    if (!venueId) return () => {};
    const db = getFirestore(getApp());
    const q = query(collection(db, 'venues', venueId, 'orders'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: Row[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
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

      {/* Quick actions (uniform two-column pills; blue for active, light blue dashed for upcoming) */}
      <View style={styles.pillGrid}>
        <TouchableOpacity style={[styles.pill, styles.pillActive]} onPress={() => nav.navigate('NewOrder')}>
          <Text style={styles.pillTitle}>New Order</Text>
          <Text style={styles.pillSub}>Choose supplier, add lines</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.pill, styles.pillSoon]}
          onPress={() => Alert.alert('Coming soon', 'Invoices list & search will live here.')}
        >
          <Text style={styles.pillTitle}>Invoices (Soon)</Text>
          <Text style={styles.pillSub}>Search by supplier/date/total</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.pill, styles.pillSoon]}
          onPress={() => Alert.alert('Coming soon', 'Export purchase history (CSV) coming soon.')}
        >
          <Text style={styles.pillTitle}>Export CSV (Soon)</Text>
          <Text style={styles.pillSub}>Purchase history export</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.pill, styles.pillSoon]}
          onPress={() => Alert.alert('Coming soon', 'Budget impact preview per supplier will appear here.')}
        >
          <Text style={styles.pillTitle}>Budget Impact (Soon)</Text>
          <Text style={styles.pillSub}>Per-supplier preview</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </SafeAreaView>
  );
}

const BLUE = '#0A84FF';
const BLUE_LIGHT = '#DCEBFF';

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

  pillGrid: {
    paddingHorizontal: 12, paddingBottom: 6,
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  pill: {
    flexBasis: '48%',
    backgroundColor: BLUE,
    padding: 12,
    borderRadius: 12,
  },
  pillActive: {
    backgroundColor: BLUE,
  },
  pillSoon: {
    backgroundColor: BLUE_LIGHT,
    borderWidth: 1,
    borderColor: '#BBD4FF',
    borderStyle: 'dashed',
  },
  pillTitle: { color: '#fff', fontWeight: '800' },
  pillSub: { color: '#fff', opacity: 0.9, marginTop: 4, fontSize: 12 },

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
