import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Platform, ActionSheetIOS } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
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
};

export default function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const { params } = useRoute<any>();
  const { venueId, sessionId } = params as Params;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DeptComputed[]>([]);
  const [finalizeEnabled, setFinalizeEnabled] = useState(false);

  useEffect(() => {
    (async () => {
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

          aSnap.forEach(a => {
            const data = a.data() as any;
            if (data?.completedAt) complete += 1;
            else if (data?.startedAt) inProgress += 1;
          });

          const status: DeptComputed['status'] =
            complete === total && total > 0
              ? 'complete'
              : inProgress > 0
              ? 'in_progress'
              : 'not_started';

          if (!(complete === total && total > 0)) allComplete = false;

          results.push({ id: deptId, name, total, complete, inProgress, status });
        }

        results.sort((a, b) => {
          const order = { in_progress: 0, not_started: 1, complete: 2 } as any;
          if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
          return a.name.localeCompare(b.name);
        });

        setRows(results);
        setFinalizeEnabled(allComplete && results.length > 0);
      } catch (e: any) {
        Alert.alert('Load error', e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId, sessionId]);

  const onDeptPress = (dept: DeptComputed) => {
    if (dept.status !== 'complete') {
      nav.navigate('AreaSelection', { venueId, sessionId, departmentId: dept.id });
      return;
    }

    const resetCycle = async () => {
      try {
        setLoading(true);
        const aSnap = await getDocs(areasCol(venueId, dept.id));
        const batch = writeBatch(db);
        aSnap.forEach(a => {
          batch.set(
            areaDoc(venueId, dept.id, a.id),
            { cycleResetAt: serverTimestamp(), startedAt: null, completedAt: null },
            { merge: true }
          );
        });
        await batch.commit();
        nav.navigate('AreaSelection', { venueId, sessionId, departmentId: dept.id });
      } catch (e: any) {
        Alert.alert('Reset error', e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'View Areas (read-only)', 'Start New Stock Take'], cancelButtonIndex: 0, destructiveButtonIndex: 2, title: dept.name },
        (i) => {
          if (i === 1) nav.navigate('AreaSelection', { venueId, sessionId, departmentId: dept.id });
          if (i === 2) void resetCycle();
        }
      );
    } else {
      Alert.alert(
        dept.name,
        'Department complete',
        [
          { text: 'View Areas (read-only)', onPress: () => nav.navigate('AreaSelection', { venueId, sessionId, departmentId: dept.id }) },
          { text: 'Start New Stock Take', style: 'destructive', onPress: () => void resetCycle() },
          { text: 'Cancel', style: 'cancel' },
        ],
        { cancelable: true }
      );
    }
  };

  const onFinalizeVenue = async () => {
    try {
      setLoading(true);
      // Allowed: write to sessions/current
      await import('firebase/firestore').then(async ({ setDoc }) => {
        await setDoc(sessionDoc(venueId, 'current'), { status: 'idle', finalizedAt: new Date() }, { merge: true });
      });
      Alert.alert('Stock Take Completed', 'Venue stock take finalized. You can start a new cycle anytime.');
    } catch (e: any) {
      Alert.alert('Finalize error', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
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
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View style={S.banner}><Text style={S.bannerText}>EOM Tip: Finish all areas, then tap “Complete Venue Stock Take”.</Text></View>
      <FlatList data={rows} keyExtractor={(it) => it.id} renderItem={renderDept} contentContainerStyle={{ paddingBottom: 24 }} />
      <TouchableOpacity disabled={!finalizeEnabled} style={[S.finalizeBtn, { opacity: finalizeEnabled ? 1 : 0.4 }]} onPress={onFinalizeVenue}>
        <Text style={S.finalizeText}>Complete Venue Stock Take</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { backgroundColor: '#E8F1FF', padding: 10, borderRadius: 10, marginBottom: 12 },
  bannerText: { color: '#0A4C9A' },
  card: { padding: 16, borderRadius: 12, marginBottom: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  cardStatus: { fontSize: 14, color: '#333' },
  finalizeBtn: { backgroundColor: '#10B981', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  finalizeText: { color: '#fff', fontWeight: '700' },
});
