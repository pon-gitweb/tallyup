/* @ts-nocheck */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';

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
  const [busyId, setBusyId] = useState<string|null>(null);

  const load = useCallback(async ()=>{
    try{
      if (!venueId) return;
      const q = query(
        collection(db, 'venues', venueId, 'fastReceives'),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
      const snap = await getDocs(q);
      const out: FastRec[] = [];
      snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
      setRows(out);
    } catch (e) {
      if (__DEV__) console.log('[FastReceivesReviewPanel] load failed', e);
    }
  }, [db, venueId]);

  useEffect(()=>{ (async()=>{ await load(); })(); }, [load]);

  const items = useMemo(()=> rows, [rows]);

  const tryAttach = useCallback(async (it: FastRec)=>{
    try{
      if (!venueId) throw new Error('No venue');
      if (!it?.payload) throw new Error('No snapshot payload to attach');
      setBusyId(it.id);

      const result = await tryAttachToOrderOrSavePending({
        venueId,
        parsed: {
          invoice: {
            poNumber: it?.parsedPo ?? it?.payload?.invoice?.poNumber ?? null,
            source: (it?.source || it?.payload?.invoice?.source || 'unknown') as any,
            storagePath: it?.storagePath || it?.payload?.invoice?.storagePath || '',
          },
          lines: it?.payload?.lines || [],
          confidence: it?.payload?.confidence ?? null,
          warnings: it?.payload?.warnings ?? [],
        },
        storagePath: it?.storagePath || '',
        noPendingFallback: true, // do NOT create duplicates
      });

      if (result.attached && result.orderId) {
        Alert.alert('Attached', `Linked to order ${result.orderId} and sent for reconciliation.`);
        await load();
      } else {
        Alert.alert('Not Found', 'No submitted order matched this PO yet. Keep pending or update PO.');
      }
    } catch (e:any) {
      Alert.alert('Attach failed', String(e?.message||e));
    } finally {
      setBusyId(null);
    }
  }, [venueId, load]);

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      <View style={{ padding:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#e5e7eb' }}>
        <Text style={{ fontSize:18, fontWeight:'900' }}>Fast Receives (Pending)</Text>
        <Text style={{ color:'#6B7280', marginTop:4 }}>
          These are invoice snapshots saved without an order. Managers can try to attach by PO.
        </Text>
      </View>

      <ScrollView style={{ flex:1 }}>
        <View style={{ padding:16, gap:10 }}>
          {items.length === 0 ? (
            <Text style={{ color:'#94A3B8' }}>No pending fast receives.</Text>
          ) : items.map(it => {
            const when = it.createdAt?.toDate ? it.createdAt.toDate().toISOString() : '—';
            const po = it.parsedPo || it?.payload?.invoice?.poNumber || '—';
            const isBusy = busyId === it.id;
            return (
              <View key={it.id} style={S.card}>
                <Text style={S.title}>Snapshot {it.id}</Text>
                <Text style={S.sub}>
                  Source: {it.source || '—'} · PO: {po} · Status: {it.status || 'pending'}
                </Text>
                <Text style={S.sub}>Path: {it.storagePath || '—'}</Text>

                <View style={{ flexDirection:'row', gap:8, marginTop:10 }}>
                  <TouchableOpacity
                    disabled={isBusy}
                    onPress={() => tryAttach(it)}
                    style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#111' }}>
                    <Text style={{ color:'#fff', fontWeight:'800' }}>
                      {isBusy ? 'Attaching…' : 'Try Attach to Order'}
                    </Text>
                  </TouchableOpacity>
                </View>
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
