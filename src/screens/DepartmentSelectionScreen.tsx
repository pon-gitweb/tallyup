import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Platform, ActionSheetIOS, RefreshControl } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { getDocs, onSnapshot, serverTimestamp, setDoc, Unsubscribe, writeBatch } from 'firebase/firestore';
import { departmentsCol, areasCol, areaDoc, sessionDoc } from '../services/paths';
import { db } from '../services/firebase';

type Params = { venueId: string; sessionId: string };

type DeptComputed = {
  id: string;
  name: string;
  total: number;
  complete: number;
  inProgress: number;
  status: 'not_started' | 'in_progress' | 'complete';
  latestCompletion?: Date | null;
};

export default function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const { params } = useRoute<any>();
  const { venueId, sessionId } = params as Params;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<DeptComputed[]>([]);
  const [finalizeEnabled, setFinalizeEnabled] = useState(false);
  const unsubRefs = useRef<Unsubscribe[]>([]);

  const clearSubs = () => {
    unsubRefs.current.forEach(u => { try { u(); } catch {} });
    unsubRefs.current = [];
  };

  const computeOnce = useCallback(async () => {
    setLoading(true);
    try {
      const dSnap = await getDocs(departmentsCol(venueId));
      const results: DeptComputed[] = [];
      let allComplete = true;

      for (const d of dSnap.docs) {
        const deptId = d.id;
        const name = (d.data() as any)?.name ?? deptId;

        const aSnap = await getDocs(areasCol(venueId, deptId));
        const total = aSnap.size;
        let complete = 0;
        let inProgress = 0;
        let latest: Date | null = null;

        aSnap.forEach(a => {
          const data = a.data() as any;
          if (data?.completedAt) {
            complete += 1;
            const t = data.completedAt?.toDate?.() || null;
            if (t && (!latest || t > latest)) latest = t;
          } else if (data?.startedAt) {
            inProgress += 1;
          }
        });

        const status: DeptComputed['status'] =
          complete === total && total > 0
            ? 'complete'
            : inProgress > 0
            ? 'in_progress'
            : 'not_started';

        if (!(complete === total && total > 0)) allComplete = false;

        results.push({ id: deptId, name, total, complete, inProgress, status, latestCompletion: latest });
      }

      results.sort((a, b) => {
        const order = { in_progress: 0, not_started: 1, complete: 2 } as any;
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.name.localeCompare(b.name);
      });

      setRows(results);
      setFinalizeEnabled(allComplete && results.length > 0);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  const wireLive = useCallback(async () => {
    clearSubs();
    const dSnap = await getDocs(departmentsCol(venueId));
    if (dSnap.empty) { setRows([]); setFinalizeEnabled(false); return; }
    const computeFromLive = async () => { await computeOnce(); };
    dSnap.docs.forEach(d => {
      const u = onSnapshot(areasCol(venueId, d.id), () => { void computeFromLive(); });
      unsubRefs.current.push(u);
    });
  }, [venueId, computeOnce]);

  useEffect(() => {
    void computeOnce();
    void wireLive();
    return clearSubs;
  }, [venueId]);

  useFocusEffect(React.useCallback(() => { void computeOnce(); return () => {}; }, [computeOnce]));

  const confirmAndResetCycle = async (deptId: string, deptName: string) => {
    const doReset = async () => {
      try {
        setLoading(true);
        const aSnap = await getDocs(areasCol(venueId, deptId));
        const batch = writeBatch(db);
        aSnap.forEach(a => {
          batch.set(
            areaDoc(venueId, deptId, a.id),
            { cycleResetAt: serverTimestamp(), startedAt: null, completedAt: null },
            { merge: true }
          );
        });
        await batch.commit();
        nav.navigate('AreaSelection', { venueId, sessionId, departmentId: deptId });
      } catch (e: any) {
        Alert.alert('Reset error', e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', `Start New Stock Take for ${deptName}`],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
          title: 'Confirm Reset',
          message: 'This resets all areas in this department to Not started.'
        },
        (i) => { if (i === 1) void doReset(); }
      );
    } else {
      Alert.alert(
        'Confirm Reset',
        `Start a new stock take for ${deptName}? This resets all areas to Not started.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start New Stock Take', style: 'destructive', onPress: () => void doReset() }
        ],
        { cancelable: true }
      );
    }
  };

  const onDeptPress = (dept: DeptComputed) => {
    if (dept.status !== 'complete') {
      nav.navigate('AreaSelection', { venueId, sessionId, departmentId: dept.id });
      return;
    }
    // Completed: offer view/read-only and reset via confirm
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'View Areas (read-only)', 'Start New Stock Take'], cancelButtonIndex: 0, destructiveButtonIndex: 2, title: dept.name },
        (i) => {
          if (i === 1) nav.navigate('AreaSelection', { venueId, sessionId, departmentId: dept.id });
          if (i === 2) void confirmAndResetCycle(dept.id, dept.name);
        }
      );
    } else {
      Alert.alert(
        dept.name,
        'Department complete',
        [
          { text: 'View Areas (read-only)', onPress: () => nav.navigate('AreaSelection', { venueId, sessionId, departmentId: dept.id }) },
          { text: 'Start New Stock Take', style: 'destructive', onPress: () => void confirmAndResetCycle(dept.id, dept.name) },
          { text: 'Cancel', style: 'cancel' },
        ],
        { cancelable: true }
      );
    }
  };

  const onFinalizeVenue = async () => {
    try {
      setLoading(true);
      await setDoc(sessionDoc(venueId, 'current'), { status: 'idle', finalizedAt: new Date() }, { merge: true });
      Alert.alert('Stock Take Completed', 'Venue stock take finalized. You can start a new cycle anytime.');
    } catch (e: any) {
      Alert.alert('Finalize error', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await computeOnce();
    setRefreshing(false);
  };

  if (loading) return <View style={S.center}><ActivityIndicator /></View>;

  const renderDept = ({ item }: { item: DeptComputed }) => {
    const color =
      item.status === 'complete' ? '#D9FBE4' :
      item.status === 'in_progress' ? '#FFE8C2' :
      '#F0F0F0';
    const statusText =
      item.status === 'complete' ? `Complete • ${item.complete}/${item.total}` :
      item.status === 'in_progress' ? `In Progress • ${item.inProgress}/${item.total}` :
      `Not started • 0/${item.total}`;

    return (
      <TouchableOpacity style={[S.card, { backgroundColor: color }]} onPress={() => onDeptPress(item)}>
        <Text style={S.cardTitle}>{item.name}</Text>
        <Text style={S.cardStatus}>{statusText}</Text>
        {item.status === 'complete' && item.latestCompletion && (
          <Text style={S.cardSub}>Completed: {item.latestCompletion.toLocaleDateString()} {item.latestCompletion.toLocaleTimeString()}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={rows}
        keyExtractor={(it) => it.id}
        renderItem={renderDept}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
      <TouchableOpacity disabled={!finalizeEnabled} style={[S.finalizeBtn, { opacity: finalizeEnabled ? 1 : 0.4 }]} onPress={onFinalizeVenue}>
        <Text style={S.finalizeText}>Complete Venue Stock Take</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, borderRadius: 12, marginBottom: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  cardStatus: { fontSize: 14, color: '#333' },
  cardSub: { fontSize: 13, color: '#555', marginTop: 4 },
  finalizeBtn: { backgroundColor: '#10B981', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  finalizeText: { color: '#fff', fontWeight: '700' },
});
