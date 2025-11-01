import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

type SupplierRow = {
  id: string;
  name?: string | null;
  logoUrl?: string | null;
  active?: boolean | null;
};

export default function NewOrderStartScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  useEffect(() => {
    if (!venueId) return;
    const db = getFirestore(getApp());
    const ref = collection(db, 'venues', venueId, 'suppliers');
    const q = query(ref, orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      const rows: SupplierRow[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setSuppliers(rows);
      setLoading(false);
    }, (err) => {
      console.warn('[NewOrderStart] suppliers snapshot error', err);
      setLoading(false);
      Alert.alert('Error', 'Could not load suppliers.');
    });
    return () => unsub();
  }, [venueId]);

  const openSupplier = (s: SupplierRow) => {
    // Do NOT create a draft yet — go to product picker first
    nav.navigate('NewOrder', { supplierId: s.id, supplierName: s.name ?? 'Supplier' });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading suppliers…</Text>
      </View>
    );
  }

  if (!suppliers.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No suppliers yet</Text>
        <Text style={styles.muted}>Add suppliers to begin creating manual orders.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={suppliers}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <TouchableOpacity testID={`supplier-${item.id}`} style={styles.supplier} onPress={() => openSupplier(item)}>
            <Text style={styles.name}>{item.name ?? 'Supplier'}</Text>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  muted: { color: '#666' },
  supplier: { paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 16 },
  chev: { fontSize: 22, color: '#999' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#e5e5e5', marginLeft: 16 },
});