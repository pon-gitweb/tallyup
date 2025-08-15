import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Share, Alert } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { getDocs } from 'firebase/firestore';
import { departmentsCol, areasCol } from '../../services/paths';

type Row = {
  deptId: string;
  deptName: string;
  areasTotal: number;
  areasComplete: number;
  latestCompletion?: Date | null;
};

export default function LastCycleSummaryScreen() {
  const { params } = useRoute<any>();
  const { venueId } = params as { venueId: string };

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const dSnap = await getDocs(departmentsCol(venueId));
        const list: Row[] = [];
        for (const d of dSnap.docs) {
          const deptId = d.id;
          const name = (d.data() as any)?.name ?? d.id;
          const aSnap = await getDocs(areasCol(venueId, deptId));

          let total = aSnap.size;
          let complete = 0;
          let latest: Date | null = null;
          aSnap.forEach(a => {
            const ad = a.data() as any;
            if (ad?.completedAt) {
              complete++;
              const t = ad.completedAt?.toDate?.() || null;
              if (t && (!latest || t > latest)) latest = t;
            }
          });

          list.push({ deptId, deptName: name, areasTotal: total, areasComplete: complete, latestCompletion: latest });
        }
        // Sort by name
        list.sort((a, b) => a.deptName.localeCompare(b.deptName));
        setRows(list);
      } catch (e: any) {
        Alert.alert('Load failed', e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId]);

  const venueLastCompletedAt = useMemo(() => {
    // Define venue "last cycle end" as min of department latestCompletions if all depts have at least 1 completion,
    // else use max across whatever exists; this is a pragmatic heuristic for MVP.
    const completions = rows.map(r => r.latestCompletion).filter(Boolean) as Date[];
    if (completions.length === 0) return null;
    const allHave = rows.every(r => r.latestCompletion);
    if (allHave) {
      return new Date(Math.min(...completions.map(d => d.getTime())));
    }
    return new Date(Math.max(...completions.map(d => d.getTime())));
  }, [rows]);

  const onExportCSV = async () => {
    const header = ['Department','Areas Complete','Areas Total','Latest Completion'].join(',');
    const lines = rows.map(r => {
      const when = r.latestCompletion ? r.latestCompletion.toISOString() : '';
      return [csvEsc(r.deptName), r.areasComplete, r.areasTotal, when].join(',');
    });
    const csv = [header, ...lines].join('\n');
    try {
      await Share.share({ message: csv });
    } catch (e: any) {
      Alert.alert('Share failed', e?.message ?? 'Unknown error');
    }
  };

  const csvEsc = (s: string) => {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  if (loading) return <View style={S.center}><ActivityIndicator /></View>;

  return (
    <View style={S.c}>
      <Text style={S.h1}>Last Completed Cycle</Text>
      {venueLastCompletedAt && (
        <Text style={S.sub}>Venue completion (heuristic): {venueLastCompletedAt.toLocaleDateString()} {venueLastCompletedAt.toLocaleTimeString()}</Text>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.deptId}
        renderItem={({ item }) => (
          <View style={S.card}>
            <Text style={S.cardTitle}>{item.deptName}</Text>
            <Text style={S.cardLine}>Areas: {item.areasComplete} / {item.areasTotal}</Text>
            {item.latestCompletion && (
              <Text style={S.cardLine}>Completed: {item.latestCompletion.toLocaleDateString()} {item.latestCompletion.toLocaleTimeString()}</Text>
            )}
          </View>
        )}
        ListEmptyComponent={<Text>No data available.</Text>}
        contentContainerStyle={{ paddingBottom: 16 }}
      />

      <TouchableOpacity style={S.btn} onPress={onExportCSV}>
        <Text style={S.btnText}>Export CSV</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  c:{ flex:1, padding:16, backgroundColor:'#fff' },
  center:{ flex:1, alignItems:'center', justifyContent:'center' },
  h1:{ fontSize:22, fontWeight:'700', marginBottom:6 },
  sub:{ color:'#444', marginBottom:12 },
  card:{ backgroundColor:'#F7F7F8', padding:12, borderRadius:10, marginBottom:10 },
  cardTitle:{ fontWeight:'700', marginBottom:4 },
  cardLine:{ color:'#333' },
  btn:{ backgroundColor:'#0A84FF', padding:14, borderRadius:10, alignItems:'center', marginTop:6 },
  btnText:{ color:'#fff', fontWeight:'700' },
});
