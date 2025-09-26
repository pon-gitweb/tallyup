import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  Modal, Pressable, Alert, ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { db } from '../../services/firebase';
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { throttleNav } from '../../utils/pressThrottle';
import { dlog } from '../../utils/devlog';

type RouteParams = { departmentId: string; departmentName?: string };
type AreaRow = {
  id: string;
  name: string;
  startedAt?: any | null;
  completedAt?: any | null;
};

export default function AreaSelectionScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { departmentId, departmentName }: RouteParams = route.params || {};
  const venueId = useVenueId();

  const [q, setQ] = useState('');
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [areaName, setAreaName] = useState('');

  useEffect(() => { load(); }, [venueId, departmentId]);
  useFocusEffect(React.useCallback(() => { load(); return () => {}; }, [venueId, departmentId]));

  async function load() {
    if (!venueId || !departmentId) { setAreas([]); setLoading(false); return; }
    try {
      setLoading(true);
      const col = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
      const snap = await getDocs(query(col, orderBy('name')));
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AreaRow[];
      setAreas(list);
    } catch (e: any) {
      dlog('[Areas] load error', e?.message);
      setAreas([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!q.trim()) return areas;
    const needle = q.trim().toLowerCase();
    return areas.filter(a => (a.name || '').toLowerCase().includes(needle));
  }, [q, areas]);

  function openCreate() { setEditingId(null); setAreaName(''); setShowEdit(true); }
  function openEdit(row: AreaRow) { setEditingId(row.id); setAreaName(row.name || ''); setShowEdit(true); }

  async function commitEdit() {
    if (!venueId || !departmentId) return;
    const name = areaName.trim();
    if (!name) { Alert.alert('Missing name', 'Please enter an area name.'); return; }
    try {
      if (editingId) {
        const ref = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', editingId);
        await updateDoc(ref, { name, updatedAt: serverTimestamp() });
      } else {
        const col = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
        const now = serverTimestamp();
        await addDoc(col, { name, createdAt: now, updatedAt: now, startedAt: null, completedAt: null, cycleResetAt: null });
      }
      setShowEdit(false); setAreaName(''); setEditingId(null); await load();
    } catch (e: any) { Alert.alert('Save failed', e?.message || 'Unknown error'); }
  }

  async function confirmDelete(row: AreaRow) {
    Alert.alert(
      'Delete area',
      `Remove “${row.name}”? You won’t be able to count this area unless you recreate it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              if (!venueId) return;
              const ref = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', row.id);
              await deleteDoc(ref);
              await load();
            } catch (e: any) { Alert.alert('Delete failed', e?.message || 'Unknown error'); }
          }
        }
      ]
    );
  }

  async function fixLegacyAreas() {
    if (!venueId || !departmentId) return;
    try {
      const col = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
      const snap = await getDocs(query(col));
      let count = 0;
      for (const d of snap.docs) {
        const data: any = d.data();
        const needsFix =
          !('startedAt' in data) || !('completedAt' in data) ||
          data.startedAt === undefined || data.completedAt === undefined;
        if (needsFix) { await updateDoc(d.ref, { startedAt: null, completedAt: null }); count++; }
      }
      Alert.alert('Legacy Fix Complete', `Updated ${count} area(s).`); await load();
    } catch (e: any) { Alert.alert('Fix failed', e?.message || 'Unknown error'); }
  }

  const statusPill = (row: AreaRow) => {
    if (row.completedAt) return <Text style={[styles.pill, styles.pillDone]}>Done</Text>;
    if (row.startedAt) return <Text style={[styles.pill, styles.pillInProg]}>In progress</Text>;
    return <Text style={[styles.pill, styles.pillIdle]}>Not started</Text>;
  };

  const makeGoToAreaInventory = (areaId: string, areaName: string) =>
    throttleNav(() => nav.navigate('AreaInventory', { departmentId, areaId, areaName }));

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{departmentName || 'Areas'}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={fixLegacyAreas} style={[styles.smallBtn, { backgroundColor: '#D6E9FF', borderColor:'#A9D2FF', borderWidth:1 }]}>
            <Text style={[styles.smallText, { color: '#0A84FF' }]}>Fix legacy areas</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setEditingId(null); setAreaName(''); setShowEdit(true); }} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Add Area</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TextInput placeholder="Search areas…" value={q} onChangeText={setQ} style={styles.search} />

      {loading ? (
        <View style={styles.center}><ActivityIndicator /><Text>Loading areas…</Text></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={makeGoToAreaInventory(item.id, item.name)} onLongPress={() => { setEditingId(item.id); setAreaName(item.name || ''); setShowEdit(true); }} delayLongPress={250}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  {statusPill(item)}
                </View>
              </View>
              <TouchableOpacity onPress={() => { setEditingId(item.id); setAreaName(item.name || ''); setShowEdit(true); }} style={styles.smallBtn}>
                <Text style={styles.smallText}>⋯</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                Alert.alert('Delete area', `Remove “${item.name}”?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(item) },
                ]);
              }} style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]}>
                <Text style={[styles.smallText, { color: 'white' }]}>Del</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text>No areas yet. Tap “Add Area”.</Text>}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}

      {/* Create/Edit modal */}
      <Modal visible={showEdit} transparent animationType="fade" onRequestClose={() => setShowEdit(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingId ? 'Rename area' : 'Add area'}</Text>
            <TextInput value={areaName} onChangeText={setAreaName} placeholder="Area name" style={styles.modalInput} autoFocus />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowEdit(false)}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, !areaName.trim() && { opacity: 0.6 }]} onPress={async () => {
                await commitEdit();
              }} disabled={!areaName.trim()}>
                <Text style={styles.primaryText}>{editingId ? 'Save' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: 'white' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '800' },
  search: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'white' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F2F7', borderRadius: 12, padding: 12 },
  name: { fontWeight: '700' },
  primaryBtn: { backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  primaryText: { color: 'white', fontWeight: '700' },
  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginLeft: 6 },
  smallText: { fontWeight: '800', fontSize: 14 },
  pill: { fontWeight: '700', fontSize: 12, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999 },
  pillDone: { backgroundColor: '#def7ec', color: '#03543f' },
  pillInProg: { backgroundColor: '#e1effe', color: '#1e429f' },
  pillIdle: { backgroundColor: '#fdf2f8', color: '#9b1c1c' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { backgroundColor: 'white', padding: 16, borderRadius: 12, width: '90%' },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'white' },
  secondaryBtn: { backgroundColor: '#E5E7EB', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  secondaryText: { fontWeight: '700' },
});
