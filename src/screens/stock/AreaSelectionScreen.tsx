// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  Modal, Pressable, Alert, RefreshControl, ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { db } from '../../services/firebase';
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot,
  doc, serverTimestamp
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import IdentityBadge from '../../components/IdentityBadge';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { MaterialIcons } from '@expo/vector-icons';

type Params = { venueId: string; departmentId: string };
type AreaRow = {
  id: string;
  name?: string;
  startedAt?: any;
  completedAt?: any;
  lockedByUid?: string | null;
  lockedByName?: string | null;
  lockedAt?: any | null;
};

function Stars({ status }: { status: 'idle' | 'inprog' | 'done' }) {
  const fillCount = status === 'done' ? 3 : status === 'inprog' ? 1 : 0;
  const star = (filled: boolean, key: number) =>
    <MaterialIcons key={key} name={filled ? 'star' : 'star-border'} size={16} color={filled ? '#F59E0B' : '#CBD5E1'} />;
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {star(fillCount >= 1, 1)}
      {star(fillCount >= 2, 2)}
      {star(fillCount >= 3, 3)}
    </View>
  );
}

function AreaSelectionInner() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params || {}) as Params;

  const uid = getAuth().currentUser?.uid || null;

  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 120);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const didAlertRef = useRef(false);

  // If nav is broken or missing params, show a safe fallback instead of crashing
  const paramsMissing = !venueId || !departmentId;

  useEffect(() => {
    if (paramsMissing) {
      setLoading(false);
      setAreas([]);
      return;
    }

    setLoading(true);
    try {
      const ref = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
      const qy = query(ref, orderBy('name', 'asc'));
      const unsub = onSnapshot(qy, (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setAreas(rows);
        setLoading(false);
      }, (e:any) => {
        if (__DEV__) console.log('[Areas] listener error', e?.message);
        setAreas([]);
        setLoading(false);
        if (!didAlertRef.current) {
          didAlertRef.current = true;
          Alert.alert('Could not load areas', e?.message || 'Permission or connectivity issue');
        }
      });
      return () => unsub();
    } catch (e:any) {
      if (__DEV__) console.log('[Areas] listener setup failed', e?.message);
      setLoading(false);
    }
  }, [venueId, departmentId, paramsMissing]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Realtime listener keeps fresh; nothing to pull.
    setRefreshing(false);
  }, []);

  const filtered = useMemo(() => {
    const term = dq.trim().toLowerCase();
    if (!term) return areas;
    return areas.filter(a => (a.name || a.id).toLowerCase().includes(term));
  }, [areas, dq]);

  const openArea = useCallback((area: AreaRow) => {
    // Hard lock at selection level: if someone else holds the lock, block.
    if (area.lockedByUid && area.lockedByUid !== uid) {
      Alert.alert(
        'Area in use',
        `“${area.name || area.id}” is currently being counted by ${area.lockedByName || 'another user'}.`,
      );
      return;
    }
    nav.navigate('AreaInventory', { venueId, departmentId, areaId: area.id });
  }, [nav, venueId, departmentId, uid]);

  const deleteArea = useCallback(async (id: string) => {
    Alert.alert('Delete area?', 'This removes the area and its items.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteDoc(doc(db, 'venues', venueId, 'departments', departmentId, 'areas', id));
          } catch (e:any) {
            Alert.alert('Delete failed', e?.message || 'Unknown error');
          }
        }
      }
    ]);
  }, [venueId, departmentId]);

  async function addArea() {
    if (!newName.trim()) {
      Alert.alert('Name required', 'Please enter an area name.');
      return;
    }
    if (paramsMissing) {
      Alert.alert('Missing details', 'Please go back and reopen this department from Stock Control.');
      return;
    }
    setAdding(true);
    try {
      const ref = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
      await addDoc(ref, {
        name: newName.trim(),
        startedAt: null,
        completedAt: null,
        lockedByUid: null,
        lockedByName: null,
        lockedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowAdd(false);
      setNewName('');
    } catch (e:any) {
      Alert.alert('Add failed', e?.message || 'Unknown error');
    } finally {
      setAdding(false);
    }
  }

  async function fixLegacyNulls() {
    if (paramsMissing) {
      Alert.alert('Missing details', 'Please go back and reopen this department from Stock Control.');
      return;
    }
    try {
      const ref = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
      const snap = await getDocs(ref);
      let count = 0;
      for (const d of snap.docs) {
        const data:any = d.data();
        const patch:any = {};
        let needsPatch = false;

        if (!('startedAt' in data)) { patch.startedAt = null; needsPatch = true; }
        if (!('completedAt' in data)) { patch.completedAt = null; needsPatch = true; }
        if (!('lockedByUid' in data)) { patch.lockedByUid = null; needsPatch = true; }
        if (!('lockedByName' in data)) { patch.lockedByName = null; needsPatch = true; }
        if (!('lockedAt' in data)) { patch.lockedAt = null; needsPatch = true; }

        if (needsPatch) {
          await updateDoc(d.ref, patch);
          count++;
        }
      }
      Alert.alert('Fixed', `Updated ${count} area(s).`);
    } catch (e:any) {
      Alert.alert('Fix failed', e?.message || 'Unknown error');
    }
  }

  const Item = ({ item }: { item: AreaRow }) => {
    const status: 'idle'|'inprog'|'done' = item.completedAt ? 'done' : item.startedAt ? 'inprog' : 'idle';
    const statusLabel = status === 'done' ? 'Completed' : status === 'inprog' ? 'In Progress' : 'Not started';
    const pillStyle = status === 'done' ? styles.pillDone : status === 'inprog' ? styles.pillInProg : styles.pillIdle;

    const lockedByOther = !!item.lockedByUid && item.lockedByUid !== uid;
    const lockedByMe = !!item.lockedByUid && item.lockedByUid === uid;

    return (
      <TouchableOpacity
        style={[
          styles.row,
          lockedByOther && { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
        ]}
        onPress={() => openArea(item)}
        onLongPress={() => deleteArea(item.id)}
        disabled={lockedByOther}
      >
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.rowTitle}>{item.name || item.id}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <Stars status={status} />
            <Text style={[styles.pill, pillStyle]}>{statusLabel}</Text>

            {lockedByOther && (
              <Text style={[styles.pill, styles.pillLocked]}>
                In use by {item.lockedByName || 'another user'}
              </Text>
            )}

            {lockedByMe && (
              <Text style={[styles.pill, styles.pillMine]}>
                You are in this area
              </Text>
            )}
          </View>
        </View>
        <MaterialIcons name="chevron-right" size={20} color="#9CA3AF" />
      </TouchableOpacity>
    );
  };

  // If params are missing, show a gentle error + back button
  if (paramsMissing) {
    return (
      <View style={styles.wrap}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Areas</Text>
            <Text style={styles.sub}>We couldn&apos;t find the department details.</Text>
          </View>
          <IdentityBadge />
        </View>

        <Text style={{ color: '#6B7280', marginTop: 8 }}>
          Please go back to Stock Control or Departments and reopen this department. This prevents partial or
          orphaned stock takes.
        </Text>

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 16, alignSelf: 'flex-start' }]}
          onPress={() => nav.goBack()}
        >
          <Text style={styles.primaryText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Areas</Text>
          <Text style={styles.sub}>Choose an area to count</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IdentityBadge />
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <Stars status="idle" />
          <Text style={styles.legendText}>Not started</Text>
        </View>
        <View style={styles.legendItem}>
          <Stars status="inprog" />
          <Text style={styles.legendText}>In progress</Text>
        </View>
        <View style={styles.legendItem}>
          <Stars status="done" />
          <Text style={styles.legendText}>Completed</Text>
        </View>
      </View>

      {/* Search + Actions */}
      <View style={styles.searchRow}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search areas"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          blurOnSubmit={false}
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowAdd(true)}>
          <Text style={styles.primaryText}>Add Area</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={fixLegacyNulls}>
          <Text style={styles.smallText}>Fix</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => <Item item={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <Text style={{ color: '#6B7280' }}>No matching areas.</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 60 }}
        />
      )}

      {/* Add Modal */}
      <Modal visible={showAdd} transparent animationType="fade" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowAdd(false)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Area</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Area name"
              placeholderTextColor="#94A3B8"
              style={styles.modalInput}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="done"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={styles.secondaryBtn} disabled={adding} onPress={() => setShowAdd(false)}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} disabled={adding} onPress={addArea}>
                <Text style={styles.primaryText}>{adding ? 'Adding…' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'white', padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { color: '#6B7280', marginTop: 2 },

  legendRow: { flexDirection: 'row', justifyContent: 'flex-start', gap: 14, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendText: { color: '#6B7280', marginLeft: 4, fontSize: 12 },

  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  searchInput: {
    flex: 1, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'white'
  },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB',
    marginBottom: 10, backgroundColor: '#F9FAFB'
  },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowSub: { color: '#6B7280' },

  primaryBtn: { backgroundColor: '#3B82F6', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, marginLeft: 8 },
  primaryText: { color: 'white', fontWeight: '800' },

  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, marginLeft: 8 },
  smallText: { fontWeight: '700', color: '#374151' },

  pill: { fontWeight: '700', fontSize: 12, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999 },
  pillDone: { backgroundColor: '#def7ec', color: '#03543f' },
  pillInProg: { backgroundColor: '#e1effe', color: '#1e429f' },
  pillIdle: { backgroundColor: '#fdf2f8', color: '#9b1c1c' },
  pillLocked: { backgroundColor: '#FEE2E2', color: '#B91C1C' },
  pillMine: { backgroundColor: '#DBEAFE', color: '#1D4ED8' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { backgroundColor: 'white', padding: 16, borderRadius: 12, width: '90%' },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'white' },
  secondaryBtn: { backgroundColor: '#E5E7EB', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  secondaryText: { fontWeight: '700' },
});

export default withErrorBoundary(AreaSelectionInner, 'AreaSelection');