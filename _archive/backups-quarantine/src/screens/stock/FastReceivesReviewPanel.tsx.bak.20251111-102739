// @ts-nocheck
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

type FastRec = {
  id: string;
  source?: 'csv'|'pdf'|'manual'|string;
  storagePath?: string;
  parsedPo?: string|null;
  status?: 'pending'|'attached'|'reconciled';
  createdAt?: any;
  payload?: any;
};

export default function FastReceivesReviewPanel({ onClose }: { onClose: ()=>void }) {
  const venueId = useVenueId();
  const db = getFirestore(getApp());
  const [rows, setRows] = useState<FastRec[]>([]);

  useEffect(()=>{
    let alive = true;
    (async ()=>{
      try{
        if (!venueId) return;
        const q = query(
          collection(db, 'venues', venueId, 'fastReceives'),
          orderBy('createdAt', 'desc'),
          limit(200)
        );
        const snap = await getDocs(q);
        if (!alive) return;
        const out: FastRec[] = [];
        snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
        setRows(out);
      } catch (e) {
        if (__DEV__) console.log('[FastReceivesReviewPanel] load failed', e);
      }
    })();
    return ()=>{ alive = false; };
  }, [db, venueId]);

  const items = useMemo(()=> rows, [rows]);

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      <View style={{ padding:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#e5e7eb' }}>
        <Text style={{ fontSize:18, fontWeight:'900' }}>Fast Receives (Pending)</Text>
        <Text style={{ color:'#6B7280', marginTop:4 }}>
          These are invoice snapshots saved without an order. Managers can review and attach them to a PO later.
        </Text>
      </View>

      <ScrollView style={{ flex:1 }}>
        <View style={{ padding:16, gap:10 }}>
          {items.length === 0 ? (
            <Text style={{ color:'#94A3B8' }}>No pending fast receives.</Text>
          ) : items.map(it => {
            const when = it.createdAt?.toDate ? it.createdAt.toDate().toISOString() : '—';
            return (
              <View key={it.id} style={S.card}>
                <Text style={S.title}>Snapshot {it.id}</Text>
                <Text style={S.sub}>
                  Source: {it.source || '—'} · PO: {it.parsedPo || '—'} · Status: {it.status || 'pending'}
                </Text>
                <Text style={S.sub}>Path: {it.storagePath || '—'}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ padding:16, borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:'#e5e7eb' }}>
        <TouchableOpacity onPress={onClose} style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6' }}>
          <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  card: {
    backgroundColor:'#F9FAFB', borderRadius:12, borderWidth:1, borderColor:'#E5E7EB',
    padding:12
  },
  title: { fontWeight:'800' },
  sub: { color:'#6B7280', marginTop:4 },
});
