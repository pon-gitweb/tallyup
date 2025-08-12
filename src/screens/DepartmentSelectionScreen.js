import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { db } from '../services/firebase';
import {
  collection, query, onSnapshot, doc, setDoc, updateDoc, serverTimestamp, getDoc
} from 'firebase/firestore';

export default function DepartmentSelectionScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { venueId, departments } = route.params || {};
  const [busy, setBusy] = useState(false);
  const [areaMap, setAreaMap] = useState({}); // deptId -> {total, completed, inProgress}

  // Subscribe to all departments' areas and compute progress
  useEffect(() => {
    if (!venueId || !Array.isArray(departments)) return;
    const unsubs = departments.map((d) => {
      const areasRef = collection(db, 'venues', venueId, 'departments', d.id, 'areas');
      const q = query(areasRef);
      return onSnapshot(q, (snap) => {
        let total = 0, completed = 0, inProgress = 0;
        snap.forEach((docSnap) => {
          total += 1;
          const status = (docSnap.data().status || 'pending');
          if (status === 'completed') completed += 1;
          else if (status === 'in_progress') inProgress += 1;
        });
        setAreaMap((prev) => ({ ...prev, [d.id]: { total, completed, inProgress } }));
      });
    });
    return () => unsubs.forEach((u) => u && u());
  }, [venueId, JSON.stringify(departments)]);

  // When a department reaches 100% completed, auto-close its active stock take
  useEffect(() => {
    if (!venueId || !departments?.length) return;

    const maybeClose = async () => {
      for (const d of departments) {
        const prog = areaMap[d.id];
        if (!prog || prog.total === 0) continue;
        const allDone = prog.completed === prog.total;

        // active doc path: venues/{venueId}/stockTakes/{deptId}
        const activeRef = doc(db, 'venues', venueId, 'stockTakes', d.id);
        const activeSnap = await getDoc(activeRef);

        if (allDone) {
          // Ensure there is an active doc; if not, create & immediately complete
          if (!activeSnap.exists()) {
            await setDoc(activeRef, {
              departmentId: d.id,
              departmentName: d.name,
              startedAt: serverTimestamp(),
              status: 'completed',
              completedAt: serverTimestamp(),
            });
          } else if (activeSnap.data()?.status !== 'completed') {
            await updateDoc(activeRef, {
              status: 'completed',
              completedAt: serverTimestamp(),
            });
          }
        } else {
          // Not complete: ensure there is an active record marked in_progress
          if (!activeSnap.exists()) {
            await setDoc(activeRef, {
              departmentId: d.id,
              departmentName: d.name,
              startedAt: serverTimestamp(),
              status: 'in_progress',
            });
          } else if (activeSnap.data()?.status === 'completed') {
            // If user re-opened areas, flip back to in_progress
            await updateDoc(activeRef, { status: 'in_progress' });
          }
        }
      }
    };

    // Fire and forget; UI shouldn’t hang
    maybeClose().catch((e) => console.log('[Dept auto-close] error', e));
  }, [venueId, JSON.stringify(areaMap), JSON.stringify(departments)]);

  const rows = useMemo(() => {
    return (departments || []).map((d) => {
      const p = areaMap[d.id] || { total: 0, completed: 0, inProgress: 0 };
      let hue = '#ddd';
      if (p.completed === p.total && p.total > 0) hue = '#B6F5C8';         // green-ish complete
      else if (p.inProgress > 0 || p.completed > 0) hue = '#FFE2B3';       // orange-ish in progress
      return { ...d, progress: p, hue };
    });
  }, [departments, areaMap]);

  const openDepartment = (dept) => {
    navigation.navigate('AreaSelection', {
      venueId,
      department: dept,
    });
  };

  if (!departments) {
    return (
      <View style={styles.center}>
        <Text>No departments found.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={styles.title}>Choose a Department</Text>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => openDepartment(item)} style={[styles.card, { backgroundColor: item.hue }]}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.small}>
              {item.progress.completed}/{item.progress.total} areas completed
              {item.progress.inProgress > 0 ? ` • ${item.progress.inProgress} in progress` : ''}
            </Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 24 }}>No departments yet.</Text>}
      />
      {busy && (
        <View style={styles.busy}>
          <ActivityIndicator />
          <Text style={{ marginLeft: 8 }}>Updating…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  card: { borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#ddd' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 12, color: '#555', marginTop: 4 },
  busy: { position: 'absolute', bottom: 16, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' }
});
