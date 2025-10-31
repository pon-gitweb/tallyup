// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View, Modal } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, onSnapshot, collection, query, orderBy,
  serverTimestamp, writeBatch, getDocs
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

type Params = { orderId?: string; id?: string; receiveNow?: boolean };

export default function OrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const venueId = useVenueId();

  const orderId = (route.params?.orderId || route.params?.id || '').toString();
  const receiveNowParam = !!route.params?.receiveNow;

  const [hdr, setHdr] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [usingAltLines, setUsingAltLines] = useState(false); // fallback to 'orderLines'

  // Memoize db and orderRef to prevent resubscribe churn
  const db = useMemo(() => getFirestore(getApp()), []);
  const orderRef = useMemo(
    () => (venueId && orderId ? doc(db, 'venues', venueId, 'orders', orderId) : null),
    [db, venueId, orderId]
  );

  // One-time guards
  const diagOnceRef = useRef(false);       // run counts() only once
  const openedAutoRef = useRef(false);     // open Receive only once per mount/route

  // Header (order doc)
  useEffect(() => {
    if (!orderRef) return;
    const unsub = onSnapshot(orderRef, (snap) => setHdr(snap.exists() ? snap.data() : null));
    return () => unsub();
  }, [orderRef]);

  // One-time DIAG
  useEffect(() => {
    if (!orderRef || diagOnceRef.current) return;
    diagOnceRef.current = true;
    (async () => {
      try {
        const [s1, s2] = await Promise.all([
          getDocs(collection(orderRef, 'lines')),
          getDocs(collection(orderRef, 'orderLines')),
        ]);
        console.log('[OrderDetail DIAG] counts', { orderId, lines: s1.size, orderLines: s2.size });
      } catch (e) {
        console.log('[OrderDetail DIAG] count error', (e as any)?.message || e);
      }
    })();
  }, [orderRef, orderId]);

  // Lines subscribe. Prefer 'lines'; on first empty emission, fall back once to 'orderLines'
  useEffect(() => {
    if (!orderRef) return;
    let cancelled = false;
    let firstEmission = true;
    const colName = usingAltLines ? 'orderLines' : 'lines';
    console.log('[OrderDetail DIAG] subscribe', { orderId, colName, usingAltLines });

    const colRef = collection(orderRef, colName);
    const qy = query(colRef, orderBy('name'));

    const unsub = onSnapshot(qy, (snap) => {
      if (cancelled) return;
      const next: any[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        const rRaw = v?.receivedQty;
        const receivedMaybe = Number.isFinite(Number(rRaw)) ? Number(rRaw) : undefined; // <-- no coercion to 0
        next.push({
          id: d.id,
          name: v?.name ?? d.id,
          qtyOrdered: Number(v?.qty ?? v?.qtyOrdered ?? 0),
          receivedQty: receivedMaybe, // undefined until actually received
          dept: v?.dept ?? null,
          unitCost: Number(v?.unitCost ?? 0),
        });
      });

      if (firstEmission) {
        firstEmission = false;
        if (!usingAltLines && next.length === 0) {
          console.log('[OrderDetail DIAG] fallback to orderLines', { orderId });
          setUsingAltLines(true);
          return;
        }
      }

      console.log('[OrderDetail DIAG] emission', { orderId, colName, size: next.length });
      setLines(next);
    }, (err) => {
      console.log('[OrderDetail DIAG] onSnapshot error', err?.message || err);
    });

    return () => { cancelled = true; unsub(); };
  }, [orderRef, usingAltLines, orderId]);

  // Auto-open Receive sheet ONLY ONCE if explicitly requested and not already received
  useEffect(() => {
    const statusLower = String(hdr?.status || hdr?.displayStatus || '').toLowerCase();
    if (!openedAutoRef.current && receiveNowParam && statusLower !== 'received') {
      openedAutoRef.current = true;
      setReceiveOpen(true);
      nav.setParams({ receiveNow: false } as any); // don't re-open on state changes
    }
  }, [receiveNowParam, hdr, nav]);

  const confirmReceive = useCallback(async () => {
    try {
      if (!orderRef) throw new Error('No order');
      const batch = writeBatch(db);
      lines.forEach((ln) => {
        const lr = doc(orderRef, 'lines', ln.id);
        const want = Number.isFinite(ln.receivedQty) ? Number(ln.receivedQty) : Number(ln.qtyOrdered || 0);
        batch.update(lr, { receivedQty: Math.max(0, want) });
      });
      batch.update(orderRef, {
        status: 'received',
        displayStatus: 'received',
        receivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      setReceiveOpen(false);
      Alert.alert('Received', 'Order marked as received.');
    } catch (e: any) {
      Alert.alert('Receive', e?.message ?? 'Failed to receive order.');
    }
  }, [db, orderRef, lines]);

  // Totals (don’t count undefined receivedQty)
  const totalOrdered = useMemo(
    () => lines.reduce((a,b)=>a+(Number(b.qtyOrdered)||0),0),
    [lines]
  );
  const totalReceived = useMemo(
    () => lines.reduce((a,b)=>a+(Number.isFinite(b.receivedQty) ? Number(b.receivedQty) : 0),0),
    [lines]
  );
  const statusLower = String(hdr?.status || hdr?.displayStatus || '').toLowerCase();
  const showReceivedSummary = statusLower === 'received' || totalReceived > 0;

  // Per-dept aggregates (ordered only for Submitted view)
  const perDept = useMemo(() => {
    const acc: Record<string, { qty: number; total: number; lines: number }> = {};
    lines.forEach((ln) => {
      const key = String(ln.dept ?? '—');
      const qty = Number(ln.qtyOrdered) || 0;
      const cost = Number(ln.unitCost) || 0;
      if (!acc[key]) acc[key] = { qty: 0, total: 0, lines: 0 };
      acc[key].qty += qty;
      acc[key].total += qty * cost;
      acc[key].lines += 1;
    });
    return acc;
  }, [lines]);

  if (!hdr) {
    return <View style={{ padding: 16 }}><Text>Loading…</Text></View>;
  }

  const deptKeys = Object.keys(perDept);

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <Text style={{ fontWeight: '800' }}>{hdr?.supplierName || 'Supplier'}</Text>
        <Text style={{ color:'#6b7280' }}>{hdr?.displayStatus || hdr?.status || '—'}</Text>

        <Text style={{ marginTop: 6, color:'#6b7280' }}>
          {showReceivedSummary
            ? `Received ${totalReceived} of ${totalOrdered}`
            : `Ordered ${totalOrdered}`}
        </Text>

        {!!deptKeys.length && (
          <View style={{ flexDirection:'row', flexWrap:'wrap', marginTop:8 }}>
            {deptKeys.map((k) => {
              const d = perDept[k];
              return (
                <View key={k} style={{ paddingHorizontal:8, paddingVertical:4, borderRadius:999, backgroundColor:'#F3F4F6', marginRight:6, marginBottom:6 }}>
                  <Text style={{ fontSize:11, fontWeight:'700', color:'#374151' }}>
                    {k}: {d.qty} • ${d.total.toFixed(2)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <FlatList
        data={lines}
        keyExtractor={(l)=>l.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({item})=>{
          const hasReceived = Number.isFinite(item.receivedQty) && (statusLower === 'received' || Number(item.receivedQty) > 0);
          return (
            <View style={{ backgroundColor:'#fff', borderRadius:12, padding:12, marginBottom:10, borderWidth:1, borderColor:'#eee' }}>
              <Text style={{ fontWeight:'700' }}>{item.name ?? item.id}</Text>
              <Text style={{ color:'#6b7280', marginTop:6 }}>
                {hasReceived
                  ? `Received ${Number(item.receivedQty)} of ${Number(item.qtyOrdered)||0}`
                  : `Ordered ${Number(item.qtyOrdered)||0}`}
              </Text>
              {item.dept ? (
                <View style={{ marginTop:6, alignSelf:'flex-start', paddingHorizontal:8, paddingVertical:3, borderRadius:999, backgroundColor:'#F3F4F6' }}>
                  <Text style={{ fontSize:11, fontWeight:'700', color:'#374151' }}>{String(item.dept)}</Text>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      <Modal transparent visible={receiveOpen} onRequestClose={()=>setReceiveOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'center', padding:18 }}>
          <View style={{ backgroundColor:'#fff', borderRadius:12, padding:16, maxHeight:'80%' }}>
            <Text style={{ fontSize:18, fontWeight:'800', marginBottom:10 }}>Receive</Text>
            <Text style={{ color:'#6b7280', marginBottom:12 }}>
              Choose how you want to receive this order.
            </Text>

            <TouchableOpacity
              onPress={confirmReceive}
              style={{ backgroundColor:'#111827', paddingVertical:12, borderRadius:10, alignItems:'center' }}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Manual</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={()=>{ setReceiveOpen(false); Alert.alert('Receive via CSV','CSV import coming soon.'); }}
              style={{ marginTop:10, backgroundColor:'#f3f4f6', paddingVertical:12, borderRadius:10, alignItems:'center' }}
            >
              <Text style={{ color:'#111827', fontWeight:'800' }}>CSV (coming soon)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={()=>{ setReceiveOpen(false); Alert.alert('Receive via PDF','PDF extraction coming soon.'); }}
              style={{ marginTop:10, backgroundColor:'#f3f4f6', paddingVertical:12, borderRadius:10, alignItems:'center' }}
            >
              <Text style={{ color:'#111827', fontWeight:'800' }}>PDF (coming soon)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={()=>{ setReceiveOpen(false); Alert.alert('Receive via OCR','Invoice OCR coming soon.'); }}
              style={{ marginTop:10, backgroundColor:'#f3f4f6', paddingVertical:12, borderRadius:10, alignItems:'center' }}
            >
              <Text style={{ color:'#111827', fontWeight:'800' }}>OCR (coming soon)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={()=> setReceiveOpen(false)}
              style={{ marginTop:10, paddingVertical:10, alignItems:'center' }}
            >
              <Text style={{ color:'#111827', fontWeight:'700' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
