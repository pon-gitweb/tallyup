import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity, Alert, Modal, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, query, orderBy, limit, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';

type Dept = { id: string; name: string };

export default function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Dept[]>([]);
  const [q, setQ] = useState('');

  // Add / Rename modal
  const [showEdit, setShowEdit] = useState(false);
  const [editId, setEditId] = useState<string|null>(null);
  const [editName, setEditName] = useState('');

  async function reload() {
    if (!venueId) { setList([]); setLoading(false); return; }
    setLoading(true);
    try {
      const colRef = collection(db, 'venues', venueId, 'departments');
      const snap = await getDocs(query(colRef, orderBy('name'), limit(1000)));
      const rows = snap.docs.map(d => ({ id: d.id, name: (d.data().name ?? d.id) as string }));
      setList(rows);
    } catch (e) {
      console.log('[DeptList] load error', (e as any)?.message);
      setList([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, [venueId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(d => d.name.toLowerCase().includes(needle));
  }, [q, list]);

  function openCreate() { setEditId(null); setEditName(''); setShowEdit(true); }
  function openRename(d: Dept) { setEditId(d.id); setEditName(d.name); setShowEdit(true); }
  async function onSave() {
    const name = editName.trim();
    if (!venueId || !name) { Alert.alert('Missing name', 'Enter a department name'); return; }
    try {
      if (editId) {
        // rename (update)
        const dRef = doc(db, 'venues', venueId, 'departments', editId);
        await updateDoc(dRef, { name, updatedAt: serverTimestamp() });
      } else {
        // create
        const colRef = collection(db, 'venues', venueId, 'departments');
        const now = serverTimestamp();
        await addDoc(colRef, { name, createdAt: now, updatedAt: now });
      }
      setShowEdit(false);
      await reload();
    } catch (e) {
      Alert.alert('Save failed', (e as any)?.message ?? 'Unknown error');
    }
  }

  async function onDelete(d: Dept) {
    if (!venueId) return;
    let confirmed = false;
    await new Promise<void>(resolve => {
      Alert.alert('Delete department', `Delete “${d.name}”?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
        { text: 'Delete', style: 'destructive', onPress: () => { confirmed = true; resolve(); } },
      ]);
    });
    if (!confirmed) return;
    try {
      const dRef = doc(db, 'venues', venueId, 'departments', d.id);
      await deleteDoc(dRef);
      await reload();
    } catch (e) {
      Alert.alert('Delete failed', (e as any)?.message ?? 'Unknown error');
    }
  }

  function goAreas(d: Dept) {
    nav.navigate('AreaSelection' as never, { venueId, departmentId: d.id } as never);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Departments</Text>
      <View style={styles.searchRow}>
        <TextInput placeholder="Search…" value={q} onChangeText={setQ} style={styles.search} />
        <TouchableOpacity style={styles.primaryBtn} onPress={openCreate}><Text style={styles.primaryText}>New</Text></TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator /><Text>Loading…</Text></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={d => d.id}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => goAreas(item)}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>Tap to manage areas</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => openRename(item)}><Text style={styles.smallText}>Rename</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]} onPress={() => onDelete(item)}>
                <Text style={[styles.smallText, { color: 'white' }]}>Del</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={<Text>No departments yet. Create one.</Text>}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}

      <Modal visible={showEdit} transparent animationType="fade" onRequestClose={() => setShowEdit(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.modalTitle}>{editId ? 'Rename department' : 'New department'}</Text>
            <TextInput value={editName} onChangeText={setEditName} placeholder="Department name" style={styles.modalInput} autoFocus />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable style={styles.secondaryBtn} onPress={() => setShowEdit(false)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryBtn} onPress={onSave}><Text style={styles.primaryText}>Save</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'white', padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  primaryBtn: { backgroundColor: '#0A84FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  primaryText: { color: 'white', fontWeight: '700' },
  center: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F2F7', borderRadius: 12, padding: 12 },
  name: { fontWeight: '700' },
  sub: { opacity: 0.6, marginTop: 2 },
  smallBtn: { backgroundColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginLeft: 8 },
  smallText: { fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: 'white', borderRadius: 12, padding: 16, gap: 10, width: '100%' },
  modalTitle: { fontWeight: '800', fontSize: 16 },
  modalInput: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  secondaryBtn: { backgroundColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  secondaryText: { fontWeight: '700' },
});
