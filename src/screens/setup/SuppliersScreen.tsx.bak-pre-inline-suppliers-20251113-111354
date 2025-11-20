import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList, TextInput
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { listSuppliers, deleteSupplierById, Supplier } from '../../services/suppliers';

export default function SuppliersScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Supplier[]>([]);
  const [q, setQ] = useState('');

  async function load() {
    if (!venueId) { setRows([]); setLoading(false); return; }
    try {
      const data = await listSuppliers(venueId);
      setRows(data);
    } catch (e: any) {
      console.log('[Suppliers] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  function onNew() {
    nav.navigate('SupplierEdit', { supplierId: null });
  }
  function onEdit(s: Supplier) {
    nav.navigate('SupplierEdit', { supplierId: s.id, supplier: s });
  }
  function onDelete(s: Supplier) {
    Alert.alert('Delete Supplier', `Delete ${s.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            if (!venueId || !s.id) return;
            await deleteSupplierById(venueId, s.id);
            await load();
          } catch (e: any) {
            Alert.alert('Delete Failed', e?.message || 'Unknown error');
          }
        }
      }
    ]);
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((s) => {
      const name = (s.name || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      return name.includes(needle) || email.includes(needle) || phone.includes(needle);
    });
  }, [rows, q]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading suppliers…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Suppliers</Text>

      {/* Coming-soon pills (No-Op, lighter blue to signal future feature) */}
      <View style={styles.pillsRow}>
        <TouchableOpacity
          style={[styles.pill, styles.pillDisabled]}
          onPress={() => Alert.alert('Coming soon', 'Bulk import CSV (upload supplier & product catalogs).')}
        >
          <Text style={styles.pillText}>Bulk import CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, styles.pillDisabled]}
          onPress={() => Alert.alert('Coming soon', 'AI clean & dedupe supplier names.')}
        >
          <Text style={styles.pillText}>AI clean names</Text>
        </TouchableOpacity>
      </View>

      {/* Search + Add */}
      <View style={styles.row}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search suppliers (name, email, phone)"
          autoCapitalize="none"
          style={styles.search}
        />
        <TouchableOpacity style={styles.primary} onPress={onNew}>
          <Text style={styles.primaryText}>Add Supplier</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id!}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{item.email || item.phone || '-'}</Text>
            </View>
            <TouchableOpacity style={styles.smallBtn} onPress={() => onEdit(item)}>
              <Text style={styles.smallText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]} onPress={() => onDelete(item)}>
              <Text style={[styles.smallText, { color: 'white' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Text>{q.trim() ? 'No suppliers match your search.' : 'No suppliers yet.'}</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },

  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#D6E9FF' },
  pillDisabled: { opacity: 1 },
  pillText: { color: '#0A84FF', fontWeight: '700' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: {
    flex: 1, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff'
  },

  primary: { backgroundColor: '#0A84FF', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },

  rowCard: { backgroundColor: '#EFEFF4', padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontWeight: '700' },
  sub: { opacity: 0.7, marginTop: 2 },
  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  smallText: { fontWeight: '700' },
});
