// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import {
  getFirestore, doc, getDoc, collection, getDocs,
  addDoc, serverTimestamp, updateDoc
} from 'firebase/firestore';

type Params = {
  orderId: string;
  receiveNow?: boolean;
  receiveMode?: 'manual' | 'scan' | 'upload';
};

type Line = {
  id: string;
  productId: string;
  name?: string | null;
  qty: number;        // ordered qty
  unitCost: number;
};

const S = StyleSheet.create({
  wrap:{flex:1,backgroundColor:'#fff'},
  top:{paddingHorizontal:16,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  title:{fontSize:20,fontWeight:'800'},
  meta:{color:'#6B7280',marginTop:4},

  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  left:{flex:1,paddingRight:12},
  nm:{fontSize:16,fontWeight:'700'},
  sub:{color:'#6B7280',marginTop:2},
  qtyBox:{width:90,borderWidth:1,borderColor:'#E5E7EB',borderRadius:10,paddingHorizontal:10,paddingVertical:8,textAlign:'right'},

  bar:{flexDirection:'row',gap:10,padding:16,borderTopWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  btn:{flex:1,backgroundColor:'#111827',paddingVertical:12,borderRadius:10,alignItems:'center'},
  btnText:{color:'#fff',fontWeight:'800'},
  btnAlt:{flex:1,backgroundColor:'#F3F4F6',paddingVertical:12,borderRadius:10,alignItems:'center'},
  btnAltText:{fontWeight:'800',color:'#111827'},
  loading:{flex:1,justifyContent:'center',alignItems:'center'}
});

export default function OrderDetailScreen(){
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const venueId = useVenueId();
  const db = getFirestore();

  const orderId = (route.params as any)?.orderId;
  const receiveMode = (route.params as any)?.receiveMode;
  const [orderMeta, setOrderMeta] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [rx, setRx] = useState<Record<string, number>>({}); // received qty per line id

  const isManualReceive = receiveMode === 'manual';

  useEffect(()=>{
    (async ()=>{
      if (!venueId || !orderId) return;
      try{
        const oref = doc(db,'venues',venueId,'orders',orderId);
        const osnap = await getDoc(oref);
        if (!osnap.exists()) {
          Alert.alert('Not found', 'Order not found'); 
          nav.goBack(); 
          return;
        }
        const ov = osnap.data() || {};
        setOrderMeta({ id: osnap.id, ...ov });

        const lref = collection(db,'venues',venueId,'orders',orderId,'lines');
        const lsnap = await getDocs(lref);
        const L: Line[] = lsnap.docs.map(d=>{
          const v:any = d.data()||{};
          return {
            id: d.id,
            productId: v.productId ?? d.id,
            name: v.name ?? null,
            qty: Number(v.qty ?? 0),
            unitCost: Number(v.unitCost ?? 0),
          };
        });
        setLines(L);

        // default manual receive = ordered qty
        if (isManualReceive) {
          const init: Record<string, number> = {};
          L.forEach(l => { init[l.id] = Number.isFinite(l.qty) ? l.qty : 0; });
          setRx(init);
        }
      }catch(e){
        Alert.alert('Error', String((e as any)?.message||e));
      }finally{
        setLoading(false);
      }
    })();
  },[db,venueId,orderId,isManualReceive,nav]);

  const totalOrdered = useMemo(()=>lines.reduce((s,l)=>s + l.qty * l.unitCost, 0),[lines]);
  const totalReceived = useMemo(()=>{
    if (!isManualReceive) return 0;
    return lines.reduce((s,l)=>s + (Number(rx[l.id]||0) * l.unitCost), 0);
  },[lines,rx,isManualReceive]);

  const updateRx = useCallback((id:string, val:string)=>{
    const n = Math.max(0, Number(val.replace(/[^0-9.]/g,'')) || 0);
    setRx(prev=>({...prev,[id]:n}));
  },[]);

  const renderItem = useCallback(({item}:{item:Line})=>{
    const subBits = [`Ordered ${item.qty}`];
    if (isManualReceive) subBits.push(`@ $${item.unitCost.toFixed(2)}`);
    const sub = subBits.join(' • ');
    return (
      <View style={S.row}>
        <View style={S.left}>
          <Text style={S.nm}>{item.name || item.productId}</Text>
          <Text style={S.sub}>{sub}</Text>
        </View>
        {isManualReceive ? (
          <TextInput
            style={S.qtyBox}
            keyboardType="numeric"
            value={String(rx[item.id] ?? 0)}
            onChangeText={(t)=>updateRx(item.id,t)}
            placeholder="0"
          />
        ) : (
          <Text style={{fontWeight:'800'}}>× {item.qty}</Text>
        )}
      </View>
    );
  },[isManualReceive,rx,updateRx]);

  const confirmReceive = useCallback(async ()=>{
    try{
      if (!venueId || !orderId) return;
      if (!isManualReceive) return;

      // build receipt lines
      const receiptLines = lines.map(l=>({
        productId: l.productId,
        name: l.name ?? null,
        unitCost: Number(l.unitCost)||0,
        orderedQty: Number(l.qty)||0,
        receivedQty: Number(rx[l.id]||0),
      }));

      // write receipt doc under /receipts
      const rref = collection(db,'venues',venueId,'orders',orderId,'receipts');
      await addDoc(rref, {
        createdAt: serverTimestamp(),
        mode: 'manual',
        lines: receiptLines
      });

      // If at least one line received > 0, mark order received
      const anyReceived = receiptLines.some(r=> (r.receivedQty||0) > 0);
      if (anyReceived) {
        const oref = doc(db,'venues',venueId,'orders',orderId);
        await updateDoc(oref, { status:'received', displayStatus:'received', receivedAt: serverTimestamp() });
      }

      Alert.alert('Received', 'Receipt saved.');
      nav.goBack();
    }catch(e){
      Alert.alert('Receive failed', String((e as any)?.message||e));
    }
  },[db,venueId,orderId,lines,rx,isManualReceive,nav]);

  const rejectAll = useCallback(async ()=>{
    try{
      if (!venueId || !orderId) return;
      if (!isManualReceive) return;

      const zeroLines = lines.map(l=>({
        productId: l.productId,
        name: l.name ?? null,
        unitCost: Number(l.unitCost)||0,
        orderedQty: Number(l.qty)||0,
        receivedQty: 0,
      }));

      const rref = collection(db,'venues',venueId,'orders',orderId,'receipts');
      await addDoc(rref, {
        createdAt: serverTimestamp(),
        mode: 'manual',
        lines: zeroLines,
        note: 'Rejected all'
      });

      Alert.alert('Saved', 'All lines set to 0. Order stays submitted.');
      nav.goBack();
    }catch(e){
      Alert.alert('Failed', String((e as any)?.message||e));
    }
  },[db,venueId,orderId,lines,isManualReceive,nav]);

  if (loading) {
    return <View style={S.loading}><ActivityIndicator/></View>;
  }

  const title = orderMeta?.supplierName || 'Order';
  const meta = [
    orderMeta?.status ? `Status: ${orderMeta.status}` : null,
    orderMeta?.poNumber ? `PO: ${orderMeta.poNumber}` : null
  ].filter(Boolean).join(' • ');

  return (
    <View style={S.wrap}>
      <View style={S.top}>
        <Text style={S.title}>{title}</Text>
        <Text style={S.meta}>{meta || '—'}</Text>
      </View>

      <FlatList
        data={lines}
        keyExtractor={(x)=>x.id}
        renderItem={renderItem}
        ListFooterComponent={
          isManualReceive ? (
            <View style={{padding:16, borderTopWidth:StyleSheet.hairlineWidth, borderColor:'#E5E7EB'}}>
              <Text style={{fontWeight:'800'}}>Totals</Text>
              <Text style={{color:'#6B7280', marginTop:4}}>Ordered: ${totalOrdered.toFixed(2)}</Text>
              <Text style={{color:'#6B7280'}}>Received: ${totalReceived.toFixed(2)}</Text>
            </View>
          ) : null
        }
      />

      {isManualReceive ? (
        <View style={S.bar}>
          <TouchableOpacity style={S.btnAlt} onPress={rejectAll}>
            <Text style={S.btnAltText}>Reject All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btn} onPress={confirmReceive}>
            <Text style={S.btnText}>Confirm Receive</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
