// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';

export default function SuggestedOrderScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [rows, setRows] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venueId) { setRows([]); setMessage('No venue selected.'); return; }
    try {
      const ref = collection(db, 'venues', venueId, 'suggestedOrders');
      const snap = await getDocs(ref);
      setRows(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setMessage(null);
    } catch (e:any) {
      if (__DEV__) console.log('[SuggestedOrders] load error', e?.message || e);
      setRows([]);
      setMessage(e?.code === 'permission-denied'
        ? 'Suggestions are restricted by permissions right now. Ask a manager to grant access or use Variance report.'
        : 'Could not load suggestions. Pull to refresh or try again later.');
    }
  }, [db, venueId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const createAll = () => {
    Alert.alert('Create Drafts', 'This will create drafts for all suppliers (demo action).');
  };

  const openSupplier = (supplierId: string) => nav.navigate('NewOrderStart', { venueId, supplierId });

  const Item = ({ item }: { item: any }) => (
    <TouchableOpacity style={S.row} onPress={() => openSupplier(item.supplierId || item.id)}>
      <View style={{ flex: 1 }}>
        <Text style={S.rowTitle}>{item.supplierName || 'Supplier'}</Text>
        <Text style={S.rowSub}>{item.itemsCount || 0} items</Text>
      </View>
      <Text style={S.chev}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={S.wrap}>
      <View style={S.headerRow}>
        <Text style={S.title}>Suggested Orders</Text>
        <IdentityBadge />
      </View>

      <TouchableOpacity style={S.primary} onPress={createAll}>
        <Text style={S.primaryText}>Create Drafts (All)</Text>
      </TouchableOpacity>

      <FlatList
        data={rows}
        keyExtractor={(x) => x.id}
        renderItem={Item}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={{ padding: 16 }}>
            <Text style={{ color: '#6B7280' }}>{message ?? 'No suggestions yet.'}</Text>
          </View>
        }
      />
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'white', padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800' },
  primary: { backgroundColor: '#3B82F6', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: 'white', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#F9FAFB' },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowSub: { color: '#6B7280', marginTop: 2 },
  chev: { fontSize: 22, color: '#94A3B8', marginLeft: 8 },
});
