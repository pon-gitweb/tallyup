// @ts-nocheck
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal } from 'react-native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { listSubmittedOrders } from '../../services/orders/listSubmittedOrders';
import { attachPendingToOrder } from '../../services/fastReceive/attachPendingToOrder';

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

  // attach modal state
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachForId, setAttachForId] = useState<string|null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(()=>{
    let alive = true;
    (async ()=>{
      try{
        if (!venueId) return;
        const qy = query(
          collection(db, 'venues', venueId, 'fastReceives'),
          orderBy('createdAt', 'desc'),
          limit(200)
        );
        const snap = await getDocs(qy);
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

  const openAttach = useCallback(async (pendingId: string) => {
    try {
      setAttachForId(pendingId);
      setAttachOpen(true);
      setLoadingOrders(true);
      const list = await listSubmittedOrders(venueId, 200);
      setOrders(list);
    } catch (e:any) {
      Alert.alert('Load orders failed', String(e?.message||e));
    } finally {
      setLoadingOrders(false);
    }
  }, [venueId]);

  const doAttach = useCallback(async (orderId: string) => {
    if (!attachForId) return;
    try {
      const res = await attachPendingToOrder({ venueId, pendingId: attachForId, orderId });
      if (!res?.ok) throw new Error(res?.error || 'attach failed');
      Alert.alert('Attached', 'Invoice attached and sent for reconciliation.');
      setAttachOpen(false);
      setAttachForId(null);
      // refresh list
      const qy = query(
        collection(db, 'venues', venueId, 'fastReceives'),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
      const snap = await getDocs(qy);
      const out: FastRec[] = [];
      snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
      setRows(out);
    } catch (e:any) {
      Alert.alert('Attach failed', String(e?.message||e));
    }
  }, [attachForId, db, venueId]);

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
            const isPending = (it.status || 'pending') === 'pending';
            return (
              <View key={it.id} style={S.card}>
                <Text style={S.title}>Snapshot {it.id}</Text>
                <Text style={S.sub}>
                  Source: {it.source || '—'} · PO: {it.parsedPo || '—'} · Status: {it.status || 'pending'}
                </Text>
                <Text style={S.sub}>Path: {it.storagePath || '—'}</Text>
                {isPending ? (
                  <TouchableOpacity
                    onPress={()=>openAttach(it.id)}
                    style={S.attachBtn}
                  >
                    <Text style={S.attachBtnText}>Attach to Submitted Order</Text>
                  </TouchableOpacity>
                ) : null}
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

      {/* Attach Modal: choose a Submitted order */}
      <Modal visible={attachOpen} animationType="slide" onRequestClose={()=>setAttachOpen(false)}>
        <View style={{ flex:1, backgroundColor:'#fff' }}>
          <View style={{ padding:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#e5e7eb', flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
            <TouchableOpacity onPress={()=>setAttachOpen(false)}><Text style={{ fontSize:18, color:'#2563EB' }}>‹ Back</Text></TouchableOpacity>
            <Text style={{ fontSize:18, fontWeight:'800' }}>Choose Submitted Order</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={{ flex:1 }}>
            <View style={{ padding:16, gap:10 }}>
              {loadingOrders ? (
                <Text style={{ color:'#6B7280' }}>Loading orders…</Text>
              ) : (orders.length === 0 ? (
                <Text style={{ color:'#94A3B8' }}>No submitted orders found.</Text>
              ) : orders.map(o => {
                const when = o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : '—';
                return (
                  <TouchableOpacity key={o.id} onPress={()=>doAttach(o.id)} style={S.orderRow}>
                    <View style={{ flex:1 }}>
                      <Text style={{ fontWeight:'800' }}>PO {o.poNumber || '—'}</Text>
                      <Text style={{ color:'#6B7280', marginTop:2 }}>{o.supplierName || '—'}</Text>
                      <Text style={{ color:'#9CA3AF', marginTop:2, fontSize:12 }}>{when}</Text>
                    </View>
                    <Text style={{ fontSize:20, color:'#94A3B8' }}>›</Text>
                  </TouchableOpacity>
                );
              }))}
            </View>
          </ScrollView>

          <View style={{ padding:16, borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:'#e5e7eb' }}>
            <TouchableOpacity onPress={()=>setAttachOpen(false)} style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6' }}>
              <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  attachBtn: {
    marginTop:10, paddingVertical:10, paddingHorizontal:14,
    backgroundColor:'#111', borderRadius:10, alignSelf:'flex-start'
  },
  attachBtnText: { color:'#fff', fontWeight:'800' },
  orderRow: {
    padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB',
    backgroundColor:'#F9FAFB', flexDirection:'row', alignItems:'center', gap:10
  },
});
