import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, TextInput, FlatList } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../services/firebase';

type RouteParams = { venueId: string; departmentId: string; areaId: string };
type Mode = 'count' | 'weight' | 'photo';

export default function StockTakeAreaInventoryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId, areaId } = (route.params as RouteParams) ?? {};

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Array<any>>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('count');

  useEffect(() => {
    if (!venueId || !departmentId || !areaId) {
      console.log('[Inventory] Missing route params', route.params);
      Alert.alert('Missing info', 'No area specified.'); nav.goBack(); return;
    }
    (async () => {
      try {
        setLoading(true);
        const snap = await getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items'));
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setItems(rows);
        console.log('[Inventory] Loaded items', { venueId, departmentId, areaId, count: rows.length });
      } catch (e: any) {
        console.log('[Inventory] Load failed', e);
        Alert.alert('Load failed', e?.message ?? 'Unknown error');
      } finally { setLoading(false); }
    })();
  }, [venueId, departmentId, areaId]);

  const filtered = useMemo(() => {
    const q = (query ?? '').toString().trim().toLowerCase();
    if (!q) return items;
    return items.filter(it => {
      const name = (it?.name ?? it?.id ?? '').toString().toLowerCase();
      return name.includes(q);
    });
  }, [items, query]);

  const stubWeight = () => Alert.alert('Bluetooth scale', 'Weight mode is a stub in MVP. (No hardware write)');
  const stubPhoto = () => Alert.alert('Photo capture', 'Photo mode is a stub in MVP.');

  const computeUncounted = () => {
    const uncounted: string[] = [];
    items.forEach(it => {
      const raw = qty[it.id];
      if (raw === undefined || String(raw).trim() === '') uncounted.push(it.id);
    });
    return uncounted;
  };

  const fillZeros = (ids: string[]) => {
    const next = { ...qty };
    ids.forEach(id => { next[id] = '0'; });
    setQty(next);
  };

  const onSubmit = async () => {
    const uncounted = computeUncounted();
    if (uncounted.length > 0) {
      Alert.alert(
        'Some items uncounted',
        `You have ${uncounted.length} uncounted item(s).`,
        [
          { text: 'Go Back', style: 'cancel' },
          {
            text: 'Skip & Fill Zeros',
            onPress: async () => { fillZeros(uncounted); await actuallySubmit(); }
          },
        ]
      );
      return;
    }
    await actuallySubmit();
  };

  const actuallySubmit = async () => {
    try {
      const now = serverTimestamp();
      const aRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
      const aSnap = await getDoc(aRef);
      const batch = writeBatch(db);

      // mark started
      if (!aSnap.exists() || !(aSnap.data() as any)?.startedAt) {
        batch.set(aRef, { startedAt: now }, { merge: true });
      }

      // write counts
      items.forEach((it) => {
        const raw = qty[it.id];
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
          const v = Number(raw);
          const iRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', it.id);
          batch.set(iRef, { lastCount: v, lastCountAt: now }, { merge: true });
          console.log('[Inventory] Write item', { path: iRef.path, lastCount: v });
        }
      });

      // complete area
      batch.set(aRef, { completedAt: now }, { merge: true });

      await batch.commit();
      console.log('[Inventory] Commit OK', { venueId, departmentId, areaId });
      Alert.alert('Saved', 'Area completed.');
      nav.goBack();
    } catch (e: any) {
      console.log('[Inventory] Submit failed', e);
      Alert.alert('Submit failed', e?.message ?? 'Unknown error');
    }
  };

  if (loading) return <View style={S.center}><ActivityIndicator /></View>;

  return (
    <View style={S.container}>
      <Text style={S.h1}>Inventory • {areaId}</Text>

      <View style={S.modeBar}>
        <TouchableOpacity onPress={() => setMode('count')} style={[S.modeBtn, mode==='count' && S.modeOn]}><Text style={S.modeTxt}>Count</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => { setMode('weight'); stubWeight(); }} style={[S.modeBtn, mode==='weight' && S.modeOn]}><Text style={S.modeTxt}>Weight</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => { setMode('photo'); stubPhoto(); }} style={[S.modeBtn, mode==='photo' && S.modeOn]}><Text style={S.modeTxt}>Photo</Text></TouchableOpacity>
      </View>

      <TextInput style={S.search} placeholder="Search items" value={query} onChangeText={setQuery} autoCapitalize="none" />

      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <View style={S.row}>
            <Text style={S.name}>{item?.name ?? item?.id}</Text>
            <TextInput
              style={S.input}
              placeholder={item?.expectedQuantity ? `Expected: ${item.expectedQuantity} ${item?.unit ?? ''}` : 'Enter count'}
              keyboardType="numeric"
              value={qty[item.id] ?? ''}
              onChangeText={(t) => setQty((s) => ({ ...s, [item.id]: t }))}
            />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      />

      <TouchableOpacity style={S.primary} onPress={onSubmit}>
        <Text style={S.primaryText}>Submit Area</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  modeBar: { flexDirection: 'row', marginBottom: 8 },
  modeBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#E5E7EB', borderRadius: 999, marginRight: 8 },
  modeOn: { backgroundColor: '#0A84FF' },
  modeTxt: { color: '#111827', fontWeight: '700' },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 10 },
  row: { backgroundColor: '#F3F4F6', padding: 12, borderRadius: 12 },
  name: { fontWeight: '700', marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 },
  primary: { backgroundColor: '#10B981', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
});
