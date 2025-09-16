import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, Alert, Modal, Pressable, ActivityIndicator
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  collection, query, orderBy, getDocs, addDoc,
  serverTimestamp, updateDoc, deleteDoc, doc, limit
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useVenueId } from '../context/VenueProvider';

type DeptRow = { id: string; name: string };

export default function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DeptRow[]>([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  // Edit modal
  const [editFor, setEditFor] = useState<DeptRow | null>(null);
  const [editName, setEditName] = useState('');

  async function reload() {
    if (!venueId) { setRows([]); setLoading(false); return; }
    try {
      setLoading(true);
      const colRef = collection(db, 'venues', venueId, 'departments');
      const snap = await getDocs(query(colRef, orderBy('name'), limit(1000)));
      const list: DeptRow[] = snap.docs.map(d => ({ id: d.id, name: String((d.data() as any)?.name || d.id) }));
      setRows(list);
    } catch (e: any) {
      console.log('[Departments] load error', e?.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, [venueId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(needle));
  }, [q, rows]);

  async function createDepartment() {
    if (!venueId) return;
    const name = newName.trim();
    if (!name) { Alert.alert('Name required', 'Please enter a department name.'); return; }
    try {
      const colRef = collection(db, 'venues', venueId, 'departments');
      const now = serverTimestamp();
      // Matches Firestore rules: keys exactly ['name','createdAt','updatedAt']
      await addDoc(colRef, { name, createdAt: now, updatedAt: now });
      setShowCreate(false);
      setNewName('');
      await reload();
    } catch (e: any) {
      Alert.alert('Create failed', e?.message || 'Unknown error');
    }
  }

  async function renameDepartment(deptId: string) {
    if (!venueId) return;
    const name = editName.trim();
    if (!name) { Alert.alert('Name required', 'Please enter a department name.'); return; }
    try {
      const dref = doc(db, 'venues', venueId, 'departments', deptId);
      // Matches rules: changedKeys only ['name','updatedAt']
      await updateDoc(dref, { name, updatedAt: serverTimestamp() });
      setEditFor(null);
      setEditName('');
      await reload();
    } catch (e: any) {
      Alert.alert('Rename failed', e?.message || 'Unknown error');
    }
  }

  async function deleteDepartment(deptId: string) {
    if (!venueId) return;
    try {
      // NOTE: We allow delete in rules. If the department has areas/items, the caller
      // should remove those first (or we add a guard here later).
      const dref = doc(db, 'venues', venueId, 'departments', deptId);
      await deleteDoc(dref);
      await reload();
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message || 'Unknown error');
    }
  }

  function openEdit(row: DeptRow) {
    setEditFor(row);
    setEditName(row.name);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Departments</Text>

      <View style={styles.searchRow}>
        <TextInput
          placeholder="Search departments…"
          value={q}
          onChangeText={setQ}
          style={styles.search}
        />
        <TouchableOpacity onPress={() => setShowCreate(true)} style={styles.primaryBtn}>
          <Text style={styles.primaryText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text>Loading…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => nav.navigate('AreaSelection', { departmentId: item.id, departmentName: item.name })}
              >
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.sub}>Tap to manage areas →</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => openEdit(item)}>
                <Text style={styles.smallText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]}
                onPress={() =>
                  Alert.alert('Delete department', `Delete “${item.name}”?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteDepartment(item.id) },
                  ])
                }
              >
                <Text style={[styles.smallText, { color: 'white' }]}>Del</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={{ padding: 12 }}>
              <Text>No departments yet. Create one to get started.</Text>
            </View>
          }
        />
      )}

      {/* Create modal */}
      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New Department</Text>
            <TextInput
              placeholder="Department name *"
              value={newName}
              onChangeText={setNewName}
              style={styles.input}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable style={styles.secondaryBtn} onPress={() => setShowCreate(false)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryBtn} onPress={createDepartment}><Text style={styles.primaryText}>Create</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit modal */}
      <Modal visible={!!editFor} transparent animationType="fade" onRequestClose={() => setEditFor(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rename Department</Text>
            <TextInput
              placeholder="New name *"
              value={editName}
              onChangeText={setEditName}
              style={styles.input}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable style={styles.secondaryBtn} onPress={() => setEditFor(null)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryBtn} onPress={() => renameDepartment(editFor!.id)}><Text style={styles.primaryText}>Save</Text></Pressable>
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
  search: { flex: 1, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'white' },

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 8 },

  row: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#F2F2F7', borderRadius: 12, gap: 8 },
  name: { fontWeight: '700' },
  sub: { opacity: 0.6, fontSize: 12 },

  primaryBtn: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#0A84FF', borderRadius: 10 },
  primaryText: { color: 'white', fontWeight: '700' },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#E5E7EB', borderRadius: 8 },
  smallText: { fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 480, backgroundColor: 'white', borderRadius: 14, padding: 16 },
  cardTitle: { fontWeight: '800', fontSize: 16, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'white' },

  secondaryBtn: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#E5E7EB', borderRadius: 10 },
  secondaryText: { fontWeight: '700' },
});
