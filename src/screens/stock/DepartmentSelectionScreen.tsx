import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  getFirestore, collection, onSnapshot, Unsubscribe, QuerySnapshot, DocumentData
} from 'firebase/firestore';

type Dept = { id: string; name?: string };

type DeptStatus = {
  total: number;
  completed: number;
  startedOnly: number; // startedAt set but not completed
  statusText: 'Not started' | 'In progress' | 'Completed';
};

export default function DepartmentSelectionScreen() {
  const route = useRoute() as any;
  const navigation = useNavigation() as any;

  const venueId: string | undefined = route?.params?.venueId;
  const sessionId = route?.params?.sessionId; // kept for compatibility / future use

  const db = getFirestore();

  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [statusByDept, setStatusByDept] = useState<Record<string, DeptStatus>>({});

  // Track child subscriptions so we can clean them up when departments list changes
  const areaUnsubsRef = useRef<Record<string, Unsubscribe>>({});

  useEffect(() => {
    if (!venueId) return;
    setLoading(true);

    // Subscribe to departments for this venue
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'departments'),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setDepartments(list);
        setLoading(false);
      },
      (err) => {
        console.warn('[Departments subscribe error]', err?.message || err);
        setLoading(false);
      }
    );

    return () => {
      unsub();
      // cleanup areas subs when screen unmounts
      Object.values(areaUnsubsRef.current).forEach(fn => fn?.());
      areaUnsubsRef.current = {};
    };
  }, [db, venueId]);

  // For each department, subscribe to its areas to compute live status
  useEffect(() => {
    if (!venueId) return;
    // Unsubscribe previous area listeners that no longer match current departments
    const keepIds = new Set(departments.map(d => d.id));
    for (const k of Object.keys(areaUnsubsRef.current)) {
      if (!keepIds.has(k)) {
        areaUnsubsRef.current[k]?.();
        delete areaUnsubsRef.current[k];
      }
    }

    departments.forEach((dept) => {
      if (areaUnsubsRef.current[dept.id]) return; // already subscribed

      const areasCol = collection(db, 'venues', venueId, 'departments', dept.id, 'areas');
      const unsub = onSnapshot(
        areasCol,
        (areasSnap: QuerySnapshot<DocumentData>) => {
          const totals = computeDeptStatus(areasSnap);
          setStatusByDept(prev => ({ ...prev, [dept.id]: totals }));
        },
        (err) => {
          console.warn('[Dept areas subscribe error]', dept.id, err?.message || err);
        }
      );
      areaUnsubsRef.current[dept.id] = unsub;
    });

    return () => {
      // We keep listeners while the screen is active; cleaned in the outer cleanup and when deps change
    };
  }, [db, venueId, departments]);

  const rows = useMemo(() => {
    return departments.map(d => {
      const s = statusByDept[d.id];
      return {
        id: d.id,
        name: d.name || d.id,
        status: s?.statusText ?? 'Not started',
        meta:
          s
            ? `${s.completed}/${s.total} completed • ${s.startedOnly} in progress`
            : '—',
      };
    });
  }, [departments, statusByDept]);

  if (!venueId) {
    return (
      <View style={styles.center}>
        <Text>No venue selected.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading departments…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Departments</Text>
      {sessionId ? <Text style={styles.subtle}>Session active</Text> : <Text style={styles.subtle}>Start or continue stock take</Text>}
      <FlatList
        data={rows}
        keyExtractor={(i) => i.id}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('Areas', { venueId, departmentId: item.id })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text
                style={[
                  styles.status,
                  item.status === 'Completed'
                    ? styles.statusComplete
                    : item.status === 'In progress'
                    ? styles.statusInProgress
                    : styles.statusIdle,
                ]}
              >
                {item.status}
              </Text>
              <Text style={styles.meta}>{item.meta}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function computeDeptStatus(areasSnap: QuerySnapshot<DocumentData>): DeptStatus {
  const docs = areasSnap.docs.map(d => d.data() as any);
  const total = docs.length;
  const completed = docs.filter(a => !!a?.completedAt).length;
  const startedOnly = docs.filter(a => !!a?.startedAt && !a?.completedAt).length;

  let statusText: DeptStatus['statusText'] = 'Not started';
  if (total > 0) {
    if (completed === total) statusText = 'Completed';
    else if (completed > 0 || startedOnly > 0) statusText = 'In progress';
  }
  return { total, completed, startedOnly, statusText };
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  heading: { fontSize: 18, fontWeight: '700' },
  subtle: { color: '#666' },
  row: { paddingVertical: 12, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '600' },
  status: { marginTop: 4, fontSize: 12 },
  statusComplete: { color: '#0a7a0a' },
  statusInProgress: { color: '#8a5a00' },
  statusIdle: { color: '#666' },
  meta: { marginTop: 2, color: '#888', fontSize: 12 },
  sep: { height: 1, backgroundColor: '#eee' },
  chev: { fontSize: 24, marginLeft: 8, color: '#999' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
