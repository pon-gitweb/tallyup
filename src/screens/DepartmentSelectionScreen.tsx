import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, FlatList } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';

type RouteParams = { venueId: string; sessionId?: string };
type DeptRow = { id: string; name: string; total: number; done: number };

export default function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId } = (route.params as RouteParams) ?? {};
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DeptRow[]>([]);

  useEffect(() => {
    if (!venueId) { Alert.alert('Missing venue'); nav.goBack(); return; }
    setLoading(true);
    const unsub = onSnapshot(collection(db, 'venues', venueId, 'departments'), (ds) => {
      const list: DeptRow[] = [];
      const pendingAreasLoads: Array<Promise<void>> = [];
      ds.forEach((d) => {
        const dn: any = d.data(); const name = dn?.name ?? d.id;
        pendingAreasLoads.push(new Promise((resolve) => {
          const unsubAreas = onSnapshot(collection(db, 'venues', venueId, 'departments', d.id, 'areas'), (as) => {
            let total = 0, done = 0;
            as.forEach(a => { total++; if ((a.data() as any)?.completedAt) done++; });
            const idx = list.findIndex(x => x.id === d.id);
            if (idx >= 0) list[idx] = { id: d.id, name, total, done };
            else list.push({ id: d.id, name, total, done });
            // sort incomplete first
            list.sort((a,b)=>{ const ac=a.done===a.total; const bc=b.done===b.total; if(ac&&!bc) return 1; if(!ac&&bc) return -1; return a.name.localeCompare(b.name); });
            setRows([...list]);
            resolve();
          });
          // automatically cleaned up by outer unsubscribe
          // @ts-ignore
          list._unsubs = (list._unsubs||[]).concat(unsubAreas);
        }));
      });
      Promise.all(pendingAreasLoads).finally(()=>setLoading(false));
    });
    return () => {
      // @ts-ignore
      (rows as any)?._unsubs?.forEach((u:()=>void)=>u());
      unsub();
    };
  }, [venueId]);

  const pill = (r: DeptRow) => {
    if (r.total === 0) return { t: 'No areas', s: S.pillGray };
    if (r.done === 0) return { t: 'Not started', s: S.pillGray };
    if (r.done < r.total) return { t: `In Progress • ${r.done}/${r.total}`, s: S.pillAmber };
    return { t: `Complete • ${r.total}/${r.total}`, s: S.pillGreen };
  };

  const openDept = (r: DeptRow) => nav.navigate('AreaSelection', { venueId, departmentId: r.id });

  if (loading) return <View style={S.center}><ActivityIndicator/></View>;
  return (
    <View style={S.container}>
      <FlatList
        data={rows}
        keyExtractor={(r)=>r.id}
        renderItem={({item})=>{
          const p=pill(item);
          return (
            <TouchableOpacity style={S.card} onPress={()=>openDept(item)}>
              <Text style={S.name}>{item.name}</Text>
              <View style={[S.pill,p.s]}><Text style={S.pillText}>{p.t}</Text></View>
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={()=> <View style={{height:10}}/>}
      />
    </View>
  );
}

const S = StyleSheet.create({
  container:{flex:1,padding:16,backgroundColor:'#fff'},
  center:{flex:1,alignItems:'center',justifyContent:'center'},
  card:{backgroundColor:'#F3F4F6',padding:16,borderRadius:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  name:{fontSize:16,fontWeight:'700'},
  pill:{paddingVertical:6,paddingHorizontal:10,borderRadius:999},
  pillText:{color:'#111827',fontWeight:'700'},
  pillGray:{backgroundColor:'#E5E7EB'},
  pillAmber:{backgroundColor:'#FDE68A'},
  pillGreen:{backgroundColor:'#BBF7D0'},
});
