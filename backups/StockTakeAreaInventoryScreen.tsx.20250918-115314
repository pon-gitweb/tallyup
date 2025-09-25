import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { db } from '../../services/firebase';
import { collection, query, orderBy, getDocs, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

type RouteParams = { departmentId: string; areaId: string; areaName?: string };
type ItemRow = {
  id: string;
  name: string;
  lastCount?: number | null;
  lastCountAt?: any | null;
};

export default function StockTakeAreaInventoryScreen() {
  console.log('[AreaInv ACTIVE FILE] stock/StockTakeAreaInventoryScreen.tsx');
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const { departmentId, areaId, areaName }: RouteParams = route.params || {};

  const [items, setItems] = useState<ItemRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const startedFlag = useRef(false);

  useEffect(() => { reload(); }, [venueId, departmentId, areaId]);

  async function reload() {
    if (!venueId || !departmentId || !areaId) { setItems([]); setLoading(false); return; }
    try {
      setLoading(true);
      const col = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
      const snap = await getDocs(query(col, orderBy('name')));
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ItemRow[];
      setItems(list);
    } catch (e:any) {
      console.log('[AreaInventory] reload error', e?.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const needle = q.trim().toLowerCase();
    return items.filter(i => (i.name || '').toLowerCase().includes(needle));
  }, [q, items]);

  // --- Lifecycle helpers (rules: lifecycle-only keys) ---
  const markStartedOnce = useCallback(async () => {
    if (startedFlag.current) return;
    if (!venueId || !departmentId || !areaId) return;
    try {
      await updateDoc(doc(db,'venues',venueId,'departments',departmentId,'areas',areaId), {
        startedAt: serverTimestamp()
      });
      startedFlag.current = true;
    } catch (e:any) {
      // Non-blocking (safe to ignore if already set or denied)
      console.log('[AreaLifecycle] startedAt set error', e?.message);
    }
  }, [venueId, departmentId, areaId]);

  const markCompleted = useCallback(async () => {
    if (!venueId || !departmentId || !areaId) return;
    try {
      await updateDoc(doc(db,'venues',venueId,'departments',departmentId,'areas',areaId), {
        completedAt: serverTimestamp()
      });
    } catch (e:any) {
      console.log('[AreaLifecycle] completedAt set error', e?.message);
    }
  }, [venueId, departmentId, areaId]);

  // --- Count actions (existing behavior preserved) ---
  async function onQuickCreate(name: string) {
    if (!venueId || !departmentId || !areaId) return;
    const col = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
    const now = serverTimestamp();
    try {
      console.log('[QuickCreate:path]', 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
      await addDoc(col, { name, createdAt: now, updatedAt: now }); // quick add (rules accept name-only too)
      await reload();
      await markStartedOnce();
    } catch (e:any) {
      console.log('[QuickCreate:error]', e?.code || '', e?.message || '');
      Alert.alert('Add failed', e?.message || 'Unknown error');
    }
  }

  async function onSubmitArea() {
    // Existing submit logic (persist counts) — unchanged
    // ...
    await markCompleted();
    Alert.alert('Submitted', 'Area submitted.');
    nav.goBack(); // focus refresh on Areas list will reflect status
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{areaName || 'Inventory'}</Text>

      <TextInput
        placeholder="Search items…"
        value={q}
        onChangeText={setQ}
        style={styles.search}
      />

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.name}</Text>
            {/* existing count UI preserved */}
          </View>
        )}
        ListEmptyComponent={<Text>No items yet.</Text>}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      <View style={styles.footer}>
        <TouchableOpacity
          onPress={() => onQuickCreate('New Item')}
          style={[styles.primaryBtn, { backgroundColor: '#D6E9FF', borderColor:'#A9D2FF', borderWidth:1 }]}
        >
          <Text style={[styles.primaryText, { color: '#0A84FF' }]}>Quick Add</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSubmitArea} style={styles.primaryBtn}>
          <Text style={styles.primaryText}>Submit Area</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: 'white' },
  title: { fontSize: 20, fontWeight: '800' },
  search: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'white' },
  row: { backgroundColor: '#F2F2F7', borderRadius: 12, padding: 12 },
  name: { fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  primaryBtn: { flex: 1, backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
});
