// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Modal, TextInput } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

import { uploadInvoiceCsv, uploadInvoicePdf } from '../../services/invoices/invoiceUpload';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
import { persistAfterParse } from '../../services/invoices/reconciliationStore';
import { finalizeReceiveFromCsv, finalizeReceiveFromPdf, finalizeReceiveFromManual } from '../../services/orders/receive';

type Params = { orderId: string };
type Line = { id: string; name?: string; qty?: number; unitCost?: number };

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

function tierForConfidence(score: number): 'low'|'medium'|'high' {
  if (score >= 0.95) return 'high';
  if (score >= 0.80) return 'medium';
  return 'low';
}

/** Compute confidence using PO match + line overlap ratio (never "high" on 0 overlap) */
function computeConfidence(opts: {
  orderPo?: string|null;
  parsedPo?: string|null;
  orderLines: Array<{ code?:string; name?:string; qty:number; unitCost?:number }>;
  parsedLines: Array<{ code?:string; name?:string; qty:number; unitPrice?:number }>;
}) {
  const poMatch = !!(opts.orderPo && opts.parsedPo && String(opts.orderPo) === String(opts.parsedPo));
  if (!opts.orderLines?.length || !opts.parsedLines?.length) return 0.2;

  const index = new Map<string, { qty:number; unitCost?:number }>();
  for (const l of opts.orderLines) {
    const key = (l?.code || l?.name || '').toLowerCase().trim();
    if (!key) continue;
    index.set(key, { qty: Number(l.qty||0), unitCost: Number(l.unitCost||0) || undefined });
  }

  let matched = 0;
  let strictMatches = 0;
  for (const p of opts.parsedLines) {
    const key = (p?.code || p?.name || '').toLowerCase().trim();
    if (!key || !index.has(key)) continue;
    matched++;
    const ord = index.get(key)!;
    if (Number(ord.qty) === Number(p.qty) && (ord.unitCost ?? 0) === Number(p.unitPrice ?? 0)) strictMatches++;
  }

  const overlap = matched / Math.max(1, opts.parsedLines.length);
  const strict = strictMatches / Math.max(1, opts.parsedLines.length);

  // Base: 0.2; overlap contributes up to +0.5; strict contributes up to +0.2; PO adds +0.1
  const score = 0.2 + 0.5*overlap + 0.2*strict + (poMatch ? 0.1 : 0);
  return clamp01(score);
}

export default function OrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const venueId = useVenueId();
  const orderId = (route.params as any)?.orderId as string;

  // --- core state
  const [orderMeta, setOrderMeta] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  // --- modal state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [csvReview, setCsvReview] = useState<any>(null);
  const [pdfReview, setPdfReview] = useState<any>(null);

  // manual modal state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInvoiceNo, setManualInvoiceNo] = useState<string>('');
  const [manualLines, setManualLines] = useState<Array<{ code?:string; name:string; qty:number; unitPrice?:number }>>([]);

  const autoConfirmedRef = useRef(false);
  const db = getFirestore();

  // Load order + order lines
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
          arr.push({ id: d.id, name: v.name, qty: Number(v.qty||0), unitCost: Number(v.unitCost||0) });
        });
        setLines(arr);

        // prepopulate manual lines
        const man = arr.map(l => ({
          code: undefined,
          name: l.name || l.id,
          qty: Number(l.qty||0),
          unitPrice: Number(l.unitCost||0) || undefined
        }));
        setManualLines(man);
      } finally { if (alive) setLoading(false); }
    })();
    return ()=>{ alive=false; };
  },[db,venueId,orderId]);

  // Combined picker (CSV or PDF)
  const pickInvoiceAndProcess = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv','application/pdf'],
        multiple: false,
        copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const isCsv = (a.mimeType||'').includes('csv') || /\.csv$/i.test(a.name||'');

      if (isCsv) {
        const up = await uploadInvoiceCsv(venueId, orderId, a.uri, a.name || 'invoice.csv');
        const parsed = await processInvoicesCsv({ venueId, orderId, storagePath: up.fullPath });
        const confidence = computeConfidence({
          orderPo: orderMeta?.poNumber ?? null,
          parsedPo: parsed?.invoice?.poNumber ?? null,
          orderLines: lines,
          parsedLines: parsed?.lines || []
        });
        await persistAfterParse({
          venueId, orderId, source:'csv', storagePath: up.fullPath,
          payload: { ...parsed, confidence },
          orderPo: orderMeta?.poNumber ?? null,
          parsedPo: parsed?.invoice?.poNumber ?? null
        });
        setCsvReview({ ...parsed, storagePath: up.fullPath, confidence });
        setReceiveOpen(false);
      } else {
        try {
          const up = await uploadInvoicePdf(venueId, orderId, a.uri, a.name || 'invoice.pdf');
          const parsed = await processInvoicesPdf({ venueId, orderId, storagePath: up.fullPath });
          const confidence = computeConfidence({
            orderPo: orderMeta?.poNumber ?? null,
            parsedPo: parsed?.invoice?.poNumber ?? null,
            orderLines: lines,
            parsedLines: parsed?.lines || []
          });
          await persistAfterParse({
            venueId, orderId, source:'pdf', storagePath: up.fullPath,
            payload: { ...parsed, confidence },
            orderPo: orderMeta?.poNumber ?? null,
            parsedPo: parsed?.invoice?.poNumber ?? null
          });
          setPdfReview({ ...parsed, storagePath: up.fullPath, confidence });
          setReceiveOpen(false);
        } catch(e:any) {
          Alert.alert(
            'PDF upload failed',
            'The PDF looks corrupted (bad XRef). Please try a different export or use Manual Receive.'
          );
        }
      }
    }catch(e){ Alert.alert('Upload failed', String((e as any)?.message||e)); }
  }, [venueId, orderId, orderMeta, lines]);

  const totalOrdered = useMemo(()=> lines.reduce((s,l)=> s + (Number(l.qty||0)*Number(l.unitCost||0)), 0), [lines]);

  const ConfidenceBanner = ({ score }:{ score?:number })=>{
    const s = Number(score||0);
    const t = tierForConfidence(s);
    const msg = t==='low' ? 'Low confidence — review carefully'
      : t==='medium' ? 'Medium confidence — check lines'
      : 'High confidence — all lines matched';
    const bg = t==='low' ? '#FEF3C7' : t==='medium' ? '#E0E7FF' : '#DCFCE7';
    const fg = t==='low' ? '#92400E' : t==='medium' ? '#1E3A8A' : '#065F46';
    return <View style={{backgroundColor:bg, padding:10, borderRadius:8, marginBottom:10}}>
      <Text style={{color:fg, fontWeight:'700'}}>{msg}</Text>
    </View>;
  };

  // Auto-accept: only when csvReview exists, PO matches, and confidence implies strict match.
  useEffect(()=>{
    (async ()=>{
      if (!csvReview || autoConfirmedRef.current) return;

      const poMatch = !!(orderMeta?.poNumber && csvReview?.invoice?.poNumber && String(orderMeta.poNumber) === String(csvReview.invoice.poNumber));
      const high = tierForConfidence(Number(csvReview?.confidence||0)) === 'high';
      if (!poMatch || !high) return;

      autoConfirmedRef.current = true;
      try{
        const done = await finalizeReceiveFromCsv({ venueId, orderId, parsed: csvReview });
        if (!done?.ok) throw new Error(done?.error || 'Auto-receive failed');
        Alert.alert('Received', 'High-confidence CSV auto-accepted.');
        setCsvReview(null);
        nav.goBack();
      }catch(e:any){
        autoConfirmedRef.current = false;
        Alert.alert('Auto-receive failed', String(e?.message||e));
      }
    })();
  }, [csvReview, venueId, orderId, nav, orderMeta?.poNumber]);

  if (loading) return <View style={S.loading}><ActivityIndicator/></View>;

  // --- Manual invoice editor helpers
  const updateManualLine = (idx:number, patch: Partial<{name:string; qty:number; unitPrice?:number}>)=>{
    setManualLines(prev=>{
      const next = prev.slice();
      const cur = { ...next[idx], ...patch };
      cur.qty = Number.isFinite(Number(cur.qty)) ? Number(cur.qty) : 0;
      cur.unitPrice = Number.isFinite(Number(cur.unitPrice)) ? Number(cur.unitPrice) : undefined;
      next[idx] = cur;
      return next;
    });
  };
  const addManualLine = ()=>{
    setManualLines(prev=>[...prev, { name:'New item', qty:1, unitPrice:0 }]);
  };
  const removeManualLine = (idx:number)=>{
    setManualLines(prev => prev.filter((_,i)=> i!==idx));
  };
  const manualTotal = manualLines.reduce((s,l)=> s + (Number(l.qty||0) * Number(l.unitPrice||0)), 0);

  // --- NEW: auto-open receive UI when navigated with receiveNow
  const openedRef = useRef(false);
  const navParams: any = route?.params || {};
  useEffect(() => {
    if (openedRef.current) return;
    if (navParams?.receiveNow) {
      openedRef.current = true;
      if (navParams?.receiveMode === 'manual') {
        setManualOpen(true);
      } else {
        // 'upload' | 'scan' (we surface the combined chooser; scan is stubbed)
        setReceiveOpen(true);
      }
    }
  }, [navParams?.receiveNow, navParams?.receiveMode]);

  return (
    <View style={S.wrap}>
      <View style={S.top}>
        <View>
          <Text style={S.title}>{orderMeta?.supplierName || 'Order'}</Text>
          <Text style={S.meta}>
            {orderMeta?.status ? `Status: ${orderMeta.status}` : ''}{orderMeta?.poNumber ? ` • PO: ${orderMeta.poNumber}` : ''}
          </Text>
        </View>
      </View>

      <ScrollView style={{flex:1}} contentContainerStyle={{padding:16}}>
        <Text style={{fontWeight:'800', marginBottom:6}}>Lines</Text>
        <View style={{borderWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB',borderRadius:8}}>
          {lines.length===0 ? (
            <View style={{padding:12}}><Text style={{color:'#6B7280'}}>No lines.</Text></View>
          ) : lines.map(l=>(
            <View key={l.id} style={{flexDirection:'row',justifyContent:'space-between',padding:12,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'}}>
              <Text style={{flex:1,marginRight:8}}>{l.name || l.id}</Text>
              <Text style={{width:60,textAlign:'right'}}>{Number(l.qty||0)}</Text>
              <Text style={{width:80,textAlign:'right'}}>${Number(l.unitCost||0).toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <View style={{marginTop:12,alignItems:'flex-end'}}>
          <Text style={{fontWeight:'800'}}>Ordered total: ${totalOrdered.toFixed(2)}</Text>
        </View>
      </ScrollView>

      {/* Floating Receive button */}
      <TouchableOpacity style={S.receiveBtn} onPress={()=>setReceiveOpen(true)}>
        <Text style={{color:'#fff',fontWeight:'800'}}>Receive</Text>
      </TouchableOpacity>

      {/* Receive mode chooser (Upload / Scan / Manual route) */}
      <Modal visible={receiveOpen} transparent animationType="fade" onRequestClose={()=>setReceiveOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.3)'}} onPress={()=>setReceiveOpen(false)}>
          <View style={{backgroundColor:'#fff',padding:16,borderTopLeftRadius:16,borderTopRightRadius:16}}>
            <Text style={{fontSize:18,fontWeight:'800',marginBottom:8}}>Receive Options</Text>
            <Text style={{color:'#6B7280',marginBottom:12}}>Choose how you want to receive this order.</Text>

            <TouchableOpacity style={S.rowBtn} onPress={pickInvoiceAndProcess}>
              <Text style={S.rowBtnTxt}>Upload invoice (CSV/PDF)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[S.rowBtn,{opacity:0.6}]} onPress={()=>Alert.alert('Scan', 'Scan/OCR stub for now.')}>
              <Text style={S.rowBtnTxt}>Scan delivery (stub)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={S.rowBtn} onPress={()=>{ setReceiveOpen(false); setManualOpen(true); }}>
              <Text style={S.rowBtnTxt}>Enter manually</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[S.rowBtn,{backgroundColor:'#F3F4F6'}]} onPress={()=>setReceiveOpen(false)}>
              <Text style={[S.rowBtnTxt,{color:'#111827'}]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Manual invoice modal */}
      <Modal visible={manualOpen} transparent animationType="slide" onRequestClose={()=>setManualOpen(false)}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'}}>
          <View style={{backgroundColor:'#fff',padding:16,borderTopLeftRadius:16,borderTopRightRadius:16,maxHeight:'85%'}}>
            <Text style={{fontSize:18,fontWeight:'800',marginBottom:8}}>Manual Invoice</Text>

            <Text style={{fontWeight:'700',marginBottom:6}}>Invoice number</Text>
            <TextInput value={manualInvoiceNo} onChangeText={setManualInvoiceNo} placeholder="e.g., SF-12345" style={{borderWidth:1,borderColor:'#E5E7EB',borderRadius:8,paddingHorizontal:12,paddingVertical:8,marginBottom:12}} />

            <Text style={{fontWeight:'700',marginBottom:6}}>Lines</Text>
            <ScrollView style={{maxHeight:300,borderWidth:1,borderColor:'#E5E7EB',borderRadius:8}}>
              {manualLines.map((row,idx)=>(
                <View key={idx} style={{flexDirection:'row',alignItems:'center',gap:8,padding:8,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'}}>
                  <TextInput value={row.name} onChangeText={(v)=>updateManualLine(idx,{name:v})} style={{flex:1,borderWidth:1,borderColor:'#E5E7EB',borderRadius:6,paddingHorizontal:8,paddingVertical:6}} />
                  <TextInput value={String(row.qty)} onChangeText={(v)=>updateManualLine(idx,{qty:Number(v)||0})} keyboardType="numeric" style={{width:70,borderWidth:1,borderColor:'#E5E7EB',borderRadius:6,paddingHorizontal:8,paddingVertical:6,textAlign:'right'}} />
                  <TextInput value={row.unitPrice!=null?String(row.unitPrice):''} onChangeText={(v)=>updateManualLine(idx,{unitPrice:Number(v)||0})} keyboardType="numeric" style={{width:90,borderWidth:1,borderColor:'#E5E7EB',borderRadius:6,paddingHorizontal:8,paddingVertical:6,textAlign:'right'}} />
                  <TouchableOpacity onPress={()=>removeManualLine(idx)}><Text style={{fontWeight:'800'}}>✕</Text></TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
              <TouchableOpacity onPress={addManualLine} style={{paddingVertical:8,paddingHorizontal:12,backgroundColor:'#111827',borderRadius:8}}>
                <Text style={{color:'#fff',fontWeight:'800'}}>Add line</Text>
              </TouchableOpacity>
              <Text style={{fontWeight:'800'}}>Manual total: ${manualTotal.toFixed(2)}</Text>
            </View>

            <View style={{flexDirection:'row',gap:10,marginTop:12}}>
              <TouchableOpacity style={[S.btn,{flex:1,backgroundColor:'#111827'}]} onPress={async ()=>{
                try{
                  const done = await finalizeReceiveFromManual({
                    venueId, orderId,
                    invoiceNo: manualInvoiceNo || null,
                    lines: manualLines,
                  });
                  if (!done?.ok) throw new Error(done?.error || 'Manual receive failed');
                  Alert.alert('Received','Manual receive saved.');
                  setManualOpen(false);
                  nav.goBack();
                }catch(e:any){
                  Alert.alert('Manual receive failed', String(e?.message||e));
                }
              }}>
                <Text style={S.btnTxt}>Confirm receive ({manualLines.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.btn,{flex:1,backgroundColor:'#F3F4F6'}]} onPress={()=>setManualOpen(false)}>
                <Text style={[S.btnTxt,{color:'#111827'}]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{flex:1,backgroundColor:'#fff'},
  top:{paddingHorizontal:16,paddingTop:12,paddingBottom:8,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  title:{fontSize:22,fontWeight:'800'},
  meta:{color:'#6B7280',marginTop:4},

  loading:{flex:1,alignItems:'center',justifyContent:'center'},

  receiveBtn:{position:'absolute',right:16,bottom:24,backgroundColor:'#111827',paddingVertical:14,paddingHorizontal:18,borderRadius:999,shadowColor:'#000',shadowOpacity:0.2,shadowRadius:6,elevation:4},

  rowBtn:{paddingVertical:12,backgroundColor:'#111827',borderRadius:8,marginBottom:10,alignItems:'center'},
  rowBtnTxt:{color:'#fff',fontWeight:'800'},

  btn:{paddingVertical:12,borderRadius:8,alignItems:'center'},
  btnTxt:{color:'#fff',fontWeight:'800'},
});
