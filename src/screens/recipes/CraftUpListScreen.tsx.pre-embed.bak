// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';

type Recipe = {
  id: string;
  name: string;
  category?: string|null;
  portionsPerBatch?: number|null;
  totalCost?: number|null;
  sellPrice?: number|null;
  marginPct?: number|null;
};

export default function CraftUpListScreen() {
  const venueId = useVenueId();
  const [rows, setRows] = useState<Recipe[]>([]);
  const [search, setSearch] = useState('');

  useEffect(()=>{
    let alive = true;
    (async ()=>{
      try{
        if (!venueId) return;
        const q = query(collection(db, 'venues', venueId, 'recipes'), orderBy('name'));
        const snap = await getDocs(q);
        if (!alive) return;
        const out: Recipe[] = [];
        snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
        setRows(out);
      }catch(e){
        if (__DEV__) console.log('[CraftUpList] load failed', e?.message || e);
        setRows([]);
      }
    })();
    return ()=>{ alive=false; };
  },[venueId]);

  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => (r.name||'').toLowerCase().includes(q) || (r.category||'').toLowerCase().includes(q));
  },[rows,search]);

  const Row = ({ r }: { r: Recipe })=>{
    const cost = Number(r.totalCost ?? NaN);
    const sell = Number(r.sellPrice ?? NaN);
    const margin = typeof r.marginPct === 'number'
      ? r.marginPct
      : (Number.isFinite(cost) && Number.isFinite(sell) && sell>0 ? (1 - cost/sell) : null);
    return (
      <View style={S.row}>
        <View style={{flex:1}}>
          <Text style={S.rowTitle}>{r.name}</Text>
          <Text style={S.rowSub}>
            {(r.category||'—')} · {(r.portionsPerBatch==null?'—':`${r.portionsPerBatch} portions`)}
          </Text>
        </View>
        <View style={{alignItems:'flex-end'}}>
          <Text style={S.rowKpi}>
            {Number.isFinite(cost) ? `$${cost.toFixed(2)}` : '—'}
          </Text>
          <Text style={S.rowKpiSub}>
            {margin==null ? '—' : `${Math.round(Math.max(0,Math.min(1,margin))*100)}%`}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{flex:1, backgroundColor:'#fff'}}>
      <View style={S.header}>
        <Text style={S.title}>CraftUp — Recipes</Text>
        <TextInput
          placeholder="Search recipes or category"
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#64748B"
          style={S.search}
        />
      </View>
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:16, paddingTop:0}}>
        {filtered.length === 0 ? (
          <Text style={{ color:'#94A3B8', marginTop:12 }}>No recipes yet.</Text>
        ) : filtered.map(r => <Row key={r.id} r={r} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  header: { padding:16 },
  title: { fontSize:18, fontWeight:'900', marginBottom:10 },
  search: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingHorizontal:12, height:42, color:'#111827' },
  row: { padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, marginTop:10, flexDirection:'row', gap:12 },
  rowTitle: { fontWeight:'800' },
  rowSub: { color:'#6B7280', marginTop:2 },
  rowKpi: { fontWeight:'900' },
  rowKpiSub: { color:'#6B7280', marginTop:2, fontSize:12 },
});
