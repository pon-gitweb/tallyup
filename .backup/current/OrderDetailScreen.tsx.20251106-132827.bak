// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

import { uploadInvoiceCsv, uploadInvoicePdf } from '../../services/invoices/invoiceUpload';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
import { persistAfterParse } from '../../services/invoices/reconciliationStore';
import { finalizeReceiveFromCsv, finalizeReceiveFromPdf } from '../../services/orders/receive';

type Params = { orderId: string };
type Line = { id: string; name?: string; qty?: number; unitCost?: number };

function tierForConfidence(c?: number): 'low'|'medium'|'high' {
  const x = Number.isFinite(c as any) ? Number(c) : -1;
  if (x >= 0.95) return 'high';
  if (x >= 0.80) return 'medium';
  return 'low';
}

export default function OrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const venueId = useVenueId();
  const orderId = (route.params as any)?.orderId as string;

  const [orderMeta, setOrderMeta] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [csvReview, setCsvReview] = useState<any>(null);
  const [pdfReview, setPdfReview] = useState<any>(null);
  const autoConfirmedRef = useRef(false);

  const db = getFirestore();

  useEffect(()=>{
    let alive = true;
    (async ()=>{
      try{
        if (!venueId || !orderId) return;
        const oSnap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
        const oVal:any = oSnap.exists() ? oSnap.data() : {};
        if (!alive) return;
        setOrderMeta({ id: oSnap.id, ...oVal });

        const linesSnap = await getDocs(collection(db, 'venues', venueId, 'orders', orderId, 'lines'));
        const arr:Line[] = [];
        linesSnap.forEach((d)=>{
          const v:any = d.data()||{};
          arr.push({
            id: d.id, name: v.name, qty: Number(v.qty||0), unitCost: Number(v.unitCost||0)
          });
        });
        setLines(arr);
      } finally { if (alive) setLoading(false); }
    })();
    return ()=>{ alive=false; };
  },[db,venueId,orderId]);

  const reconcileAndPersist = useCallback(async (source:'csv'|'pdf', storagePath:string, payload:any)=>{
    const orderPo = String(orderMeta?.poNumber ?? '').trim() || null;
    await persistAfterParse({
      venueId, orderId, source, storagePath,
      payload,
      orderPo,
      parsedPo: payload?.invoice?.poNumber ?? null
    });
  }, [venueId, orderId, orderMeta?.poNumber]);

  const pickCsvAndProcess = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({ type: 'text/csv', multiple:false, copyToCacheDirectory:true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const up = await uploadInvoiceCsv(venueId, orderId, a.uri, a.name || 'invoice.csv');
      const review = await processInvoicesCsv({ venueId, orderId, storagePath: up.fullPath });
      await reconcileAndPersist('csv', up.fullPath, { ...review, invoice: { ...(review?.invoice||{}), source:'csv', storagePath: up.fullPath } });

      if (String(orderMeta?.poNumber||'') && String(review?.invoice?.poNumber||'') && String(orderMeta.poNumber) !== String(review.invoice.poNumber)) {
        Alert.alert('PO mismatch', 'Snapshot saved. Use manual flow or confirm carefully.');
        return;
      }
      setCsvReview({ ...review, storagePath: up.fullPath });
      setReceiveOpen(false);
    }catch(e){ Alert.alert('CSV failed', String((e as any)?.message||e)); }
  }, [venueId, orderId, orderMeta, reconcileAndPersist]);

  const pickPdfAndUpload = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple:false, copyToCacheDirectory:true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const up = await uploadInvoicePdf(venueId, orderId, a.uri, a.name || 'invoice.pdf');
      const parsed = await processInvoicesPdf({ venueId, orderId, storagePath: up.fullPath });
      await reconcileAndPersist('pdf', up.fullPath, { ...parsed, invoice: { ...(parsed?.invoice||{}), source:'pdf', storagePath: up.fullPath } });

      if (String(orderMeta?.poNumber||'') && String(parsed?.invoice?.poNumber||'') && String(orderMeta.poNumber) !== String(parsed.invoice.poNumber)) {
        Alert.alert('PO mismatch', 'Snapshot saved. Use manual flow or confirm carefully.');
        return;
      }
      setPdfReview({ ...parsed, storagePath: up.fullPath });
      setReceiveOpen(false);
    }catch(e){ Alert.alert('PDF failed', String((e as any)?.message||e)); }
  }, [venueId, orderId, orderMeta, reconcileAndPersist]);

  const totalOrdered = useMemo(()=> lines.reduce((s,l)=> s + (Number(l.qty||0)*Number(l.unitCost||0)), 0), [lines]);

  if (loading) return <View style={S.loading}><ActivityIndicator/></View>;

  const ConfidenceBanner = ({ score }:{ score?:number })=>{
    const t = tierForConfidence(score);
    const msg = t==='low' ? 'Low confidence — review carefully' : t==='medium' ? 'Medium confidence — check lines' : 'High confidence';
    const bg = t==='low' ? '#FEF3C7' : t==='medium' ? '#E0E7FF' : '#DCFCE7';
    const fg = t==='low' ? '#92400E' : t==='medium' ? '#1E3A8A' : '#065F46';
    return <View style={{backgroundColor:bg, padding:10, borderRadius:8, marginBottom:10}}><Text style={{color:fg, fontWeight:'700'}}>{msg}</Text></View>;
  };

  // Auto-accept high-confidence CSV
  useEffect(()=>{
    if (!csvReview || autoConfirmedRef.current) return;
    if (tierForConfidence(csvReview.confidence) === 'high') {
      autoConfirmedRef.current = true;
      (async ()=>{
        try{
          await finalizeReceiveFromCsv({ venueId, orderId, parsed: csvReview });
          Alert.alert('Received', 'High-confidence CSV auto-accepted.');
          setCsvReview(null);
          nav.goBack();
        }catch(e){ autoConfirmedRef.current = false; Alert.alert('Auto-receive failed', String((e as any)?.message||e)); }
      })();
    }
  }, [csvReview, venueId, orderId, nav]);

  return (
    <View style={S.wrap}>
      <View style={S.top}>
        <View>
          <Text style={S.title}>{orderMeta?.supplierName || 'Order'}</Text>
          <Text style={S.meta}>
            {orderMeta?.status ? `Status: ${orderMeta.status}` : ''}{orderMeta?.poNumber ? ` • PO: ${orderMeta.poNumber}` : ''}
          </Text>
        </View>
        {String(orderMeta?.status).toLowerCase()==='submitted' ? (
          <TouchableOpacity style={S.receiveBtn} onPress={()=>setReceiveOpen(true)}>
            <Text style={S.receiveBtnText}>Receive</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {csvReview ? (
        <ScrollView style={{flex:1}}>
          <View style={{padding:16}}>
            <ConfidenceBanner score={csvReview.confidence} />
            <Text style={{fontSize:16,fontWeight:'800',marginBottom:8}}>Review Invoice (CSV)</Text>
            {(csvReview.lines||[]).slice(0,40).map((pl:any,idx:number)=>(
              <View key={idx} style={S.line}><Text style={{fontWeight:'700'}}>{pl.name || pl.code || '(line)'}</Text><Text style={{color:'#6B7280'}}>Qty: {pl.qty} • Unit: ${pl.unitPrice?.toFixed(2)||'0.00'}</Text></View>
            ))}
            <View style={{flexDirection:'row',gap:12,marginTop:16}}>
              <TouchableOpacity style={S.btnGhost} onPress={()=>setCsvReview(null)}><Text style={S.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={S.btnSolid} onPress={async ()=>{
                try{
                  await finalizeReceiveFromCsv({ venueId, orderId, parsed: csvReview });
                  Alert.alert('Received', 'Invoice posted and order marked received.');
                  setCsvReview(null); nav.goBack();
                }catch(e){ Alert.alert('Receive failed', String((e as any)?.message||e)); }
              }}><Text style={S.btnSolidText}>Confirm & Post</Text></TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      ) : pdfReview ? (
        <ScrollView style={{flex:1}}>
          <View style={{padding:16}}>
            <ConfidenceBanner score={pdfReview.confidence} />
            <Text style={{fontSize:16,fontWeight:'800',marginBottom:8}}>Review Invoice (PDF)</Text>
            {(pdfReview.lines||[]).slice(0,40).map((pl:any,idx:number)=>(
              <View key={idx} style={S.line}><Text style={{fontWeight:'700'}}>{pl.name || pl.code || '(line)'}</Text><Text style={{color:'#6B7280'}}>Qty: {pl.qty} • Unit: ${pl.unitPrice?.toFixed(2)||'0.00'}</Text></View>
            ))}
            <View style={{flexDirection:'row',gap:12,marginTop:16}}>
              <TouchableOpacity style={S.btnGhost} onPress={()=>setPdfReview(null)}><Text style={S.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={S.btnSolid} onPress={async ()=>{
                try{
                  await finalizeReceiveFromPdf({ venueId, orderId, parsed: pdfReview });
                  Alert.alert('Received', 'Invoice posted and order marked received.');
                  setPdfReview(null); nav.goBack();
                }catch(e){ Alert.alert('Receive failed', String((e as any)?.message||e)); }
              }}><Text style={S.btnSolidText}>Confirm & Post</Text></TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={lines}
          keyExtractor={(it)=>it.id}
          contentContainerStyle={{padding:16}}
          ItemSeparatorComponent={()=> <View style={{height:8}}/>}
          ListHeaderComponent={<View style={{paddingBottom:8}}><Text style={{fontSize:16,fontWeight:'800'}}>Order Lines</Text><Text style={{color:'#6B7280'}}>Estimated total: ${totalOrdered.toFixed(2)}</Text></View>}
          renderItem={({item})=>(
            <View style={S.line}><Text style={{fontWeight:'700'}}>{item.name || item.id}</Text><Text style={{color:'#6B7280'}}>Qty: {item.qty ?? 0} • Unit: ${Number(item.unitCost||0).toFixed(2)}</Text></View>
          )}
        />
      )}

      {/* Simple inline receive chooser (CSV/PDF) */}
      <Modal visible={receiveOpen} animationType="slide" onRequestClose={()=>setReceiveOpen(false)}>
        <View style={{flex:1, padding:16, backgroundColor:'#fff'}}>
          <Text style={{fontSize:18, fontWeight:'900', marginBottom:12}}>Receive options</Text>
          <TouchableOpacity style={S.rowBtn} onPress={pickCsvAndProcess}><Text style={S.rowBtnText}>Upload CSV</Text></TouchableOpacity>
          <TouchableOpacity style={S.rowBtn} onPress={pickPdfAndUpload}><Text style={S.rowBtnText}>Upload PDF</Text></TouchableOpacity>
          <TouchableOpacity style={[S.rowBtn,{backgroundColor:'#F3F4F6'}]} onPress={()=>setReceiveOpen(false)}><Text style={[S.rowBtnText,{color:'#111'}]}>Close</Text></TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex:1, backgroundColor:'#fff' },
  top: { padding:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#E5E7EB' },
  title: { fontSize:20, fontWeight:'800' },
  meta: { marginTop:4, color:'#6B7280' },
  line: { padding:12, backgroundColor:'#F9FAFB', borderRadius:10, borderWidth:1, borderColor:'#EEF2F7', marginBottom:8 },
  loading: { flex:1, alignItems:'center', justifyContent:'center' },
  receiveBtn: { backgroundColor:'#111', paddingHorizontal:14, paddingVertical:10, borderRadius:10, position:'absolute', right:16, bottom:16 },
  receiveBtnText: { color:'#fff', fontWeight:'800' },
  rowBtn: { padding:14, borderRadius:10, backgroundColor:'#111', marginBottom:10 },
  rowBtnText: { color:'#fff', fontWeight:'800', textAlign:'center' },
  btnGhost: { flex:1, paddingVertical:12, backgroundColor:'#F3F4F6', borderRadius:8 },
  btnGhostText: { textAlign:'center', fontWeight:'700', color:'#374151' },
  btnSolid: { flex:1, paddingVertical:12, backgroundColor:'#111827', borderRadius:8 },
  btnSolidText: { textAlign:'center', fontWeight:'700', color:'#fff' },
});
