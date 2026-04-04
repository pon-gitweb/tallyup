import React, { useEffect, useState, useLayoutEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useVenueId } from '../context/VenueProvider';

type Row = {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: string | null;
  displayStatus?: string | null;
  updatedAt?: any;
  createdAt?: any;
  origin?: string | null;
  source?: string | null;
};

export default function OrdersScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  useLayoutEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => nav.navigate('NewOrder')}>
          <Text style={styles.newBtn}>New</Text>
        </TouchableOpacity>
      ),
    });
  }, [nav]);

  useEffect(() => {
    if (!venueId) return;
    const db = getFirestore(getApp());
    const ref = collection(db, 'venues', venueId, 'orders');
    const q = query(ref, orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: Row[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setRows(list);
      setLoading(false);
    }, (err) => {
      console.warn('[OrdersScreen] snapshot error', err);
      setLoading(false);
    });
    return () => unsub();
  }, [venueId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading orders…</Text>
      </View>
    );
  }

  const renderItem = ({ item }: { item: Row }) => {
    const status = item.displayStatus ?? (item.status ? (item.status[0].toUpperCase() + item.status.slice(1)) : 'Draft');
    return (
      <TouchableOpacity style={styles.row} onPress={() => {
        if (item.status === 'draft') {
          nav.navigate('OrderEditor', { orderId: item.id, supplierName: item.supplierName ?? 'Supplier' });
        }
      }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.supplierName ?? 'Supplier'}</Text>
          <Text style={[styles.badge, status === 'Submitted' ? styles.badgeSubmitted : status === 'Received' ? styles.badgeReceived : styles.badgeDraft]}>
            {status}
          </Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.title}>No orders yet</Text>
          <Text style={styles.muted}>Tap “New” to create your first order.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          contentContainerStyle={{ paddingVertical: 8 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  muted: { color: '#666' },
  newBtn: { color: '#0a7', fontWeight: '700', fontSize: 16, paddingHorizontal: 8 },
  row: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 16, marginBottom: 6 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', fontSize: 12, color: '#fff' },
  badgeDraft: { backgroundColor: '#888' },
  badgeSubmitted: { backgroundColor: '#0a5' },
  badgeReceived: { backgroundColor: '#0a2' },
  chev: { fontSize: 22, color: '#999' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e5e5', marginLeft: 16 },
});
