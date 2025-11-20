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
            {(csvReview.lines||[]).slice(0,80).map((pl:any,idx:number)=>(
              <View key={idx} style={S.line}>
                <Text style={{fontWeight:'700'}}>{pl.name || pl.code || '(line)'}</Text>
                <Text style={{color:'#6B7280'}}>Qty: {pl.qty} • Unit: ${Number(pl.unitPrice||0).toFixed(2)}</Text>
              </View>
            ))}
            <View style={{flexDirection:'row',gap:12,marginTop:16}}>
              <TouchableOpacity style={S.btnGhost} onPress={()=>setCsvReview(null)}><Text style={S.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={S.btnSolid} onPress={async ()=>{
                try{
                  const done = await finalizeReceiveFromCsv({ venueId, orderId, parsed: csvReview });
                  if (!done?.ok) throw new Error(done?.error || 'Receive failed');
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
            {(pdfReview.lines||[]).slice(0,80).map((pl:any,idx:number)=>(
              <View key={idx} style={S.line}>
                <Text style={{fontWeight:'700'}}>{pl.name || pl.code || '(line)'}</Text>
                <Text style={{color:'#6B7280'}}>Qty: {pl.qty} • Unit: ${Number(pl.unitPrice||0).toFixed(2)}</Text>
              </View>
            ))}
            <View style={{flexDirection:'row',gap:12,marginTop:16}}>
              <TouchableOpacity style={S.btnGhost} onPress={()=>setPdfReview(null)}><Text style={S.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={S.btnSolid} onPress={async ()=>{
                try{
                  const done = await finalizeReceiveFromPdf({ venueId, orderId, parsed: pdfReview });
                  if (!done?.ok) throw new Error(done?.error || 'Receive failed');
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
          ListHeaderComponent={
            <View style={{paddingBottom:8}}>
              <Text style={{fontSize:16,fontWeight:'800'}}>Order Lines</Text>
              <Text style={{color:'#6B7280'}}>Estimated total: ${totalOrdered.toFixed(2)}</Text>
            </View>
          }
          renderItem={({item})=>(
            <View style={S.line}>
              <Text style={{fontWeight:'700'}}>{item.name || item.id}</Text>
              <Text style={{color:'#6B7280'}}>Qty: {item.qty ?? 0} • Unit: ${Number(item.unitCost||0).toFixed(2)}</Text>
            </View>
          )}
        />
      )}

      {/* Receive chooser (balanced layout) */}
      <Modal visible={receiveOpen} animationType="slide" onRequestClose={()=>setReceiveOpen(false)}>
        <View style={{flex:1, padding:16, backgroundColor:'#fff'}}>
          <Text style={{fontSize:18, fontWeight:'900', marginBottom:12}}>Receive options</Text>

          <TouchableOpacity style={S.rowBtn} onPress={()=>{ setReceiveOpen(false); setManualOpen(true); }}>
            <Text style={S.rowBtnTitle}>Manual Receive</Text>
            <Text style={S.rowBtnSub}>Enter invoice number, adjust qty & prices, add/remove items</Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.rowBtn} onPress={pickInvoiceAndProcess}>
            <Text style={S.rowBtnTitle}>Upload Invoice (CSV / PDF)</Text>
            <Text style={S.rowBtnSub}>Detect and reconcile automatically (soft-fail if needed)</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[S.rowBtn,{backgroundColor:'#F3F4F6'}]} onPress={()=>setReceiveOpen(false)}>
            <Text style={[S.rowBtnTitle,{color:'#111'}]}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Manual Receive editor */}
      <Modal visible={manualOpen} animationType="slide" onRequestClose={()=>setManualOpen(false)}>
        <View style={{flex:1, backgroundColor:'#fff'}}>
          <View style={{padding:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#e5e7eb'}}>
            <Text style={{fontSize:18, fontWeight:'900'}}>Manual Invoice</Text>
            <View style={{marginTop:10, flexDirection:'row', alignItems:'center', gap:10}}>
              <Text style={{fontWeight:'600'}}>Invoice #</Text>
              <TextInput
                value={manualInvoiceNo}
                onChangeText={setManualInvoiceNo}
                placeholder="e.g., INV-12345"
                style={{flex:1, borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingHorizontal:10, height:40}}
              />
            </View>
          </View>

          <ScrollView style={{flex:1}}>
            <View style={{padding:16}}>
              {manualLines.map((l, idx)=>(
                <View key={idx} style={[S.line,{gap:10}]}>
                  <TextInput
                    value={l.name}
                    onChangeText={(t)=>updateManualLine(idx,{name:t})}
                    style={{flex:1, borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingHorizontal:10, height:40}}
                  />
                  <TextInput
                    value={String(l.qty)}
                    keyboardType="numeric"
                    onChangeText={(t)=>updateManualLine(idx,{qty: Number(t) })}
                    style={{width:70, textAlign:'center', borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingHorizontal:8, height:40}}
                  />
                  <TextInput
                    value={l.unitPrice==null ? '' : String(l.unitPrice)}
                    keyboardType="numeric"
                    onChangeText={(t)=>updateManualLine(idx,{unitPrice: t==='' ? undefined : Number(t) })}
                    placeholder="$"
                    style={{width:90, textAlign:'center', borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingHorizontal:8, height:40}}
                  />
                  <TouchableOpacity onPress={()=>removeManualLine(idx)} style={{paddingHorizontal:8, paddingVertical:6}}>
                    <Text style={{color:'#b91c1c', fontWeight:'800'}}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={addManualLine} style={[S.btnGhost,{marginTop:8}]}>
                <Text style={S.btnGhostText}>+ Add Item</Text>
              </TouchableOpacity>
              <Text style={{marginTop:12, color:'#6b7280'}}>Manual total (items only): ${manualTotal.toFixed(2)}</Text>
            </View>
          </ScrollView>

          <View style={{padding:16, borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:'#e5e7eb', flexDirection:'row', gap:12}}>
            <TouchableOpacity style={S.btnGhost} onPress={()=>setManualOpen(false)}>
              <Text style={S.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.btnSolid} onPress={async ()=>{
              try{
                const parsed = {
                  invoice: { source:'manual', storagePath:'', poNumber: manualInvoiceNo || null },
                  lines: manualLines
                };
                // snapshot the manual as a "parsed" invoice for history
                await persistAfterParse({
                  venueId, orderId, source:'manual', storagePath: '',
                  payload: parsed,
                  orderPo: orderMeta?.poNumber ?? null,
                  parsedPo: manualInvoiceNo || null
                });
                const done = await finalizeReceiveFromManual({ venueId, orderId, parsed });
                if (!done?.ok) throw new Error(done?.error || 'Manual receive failed');
                Alert.alert('Received', 'Manual invoice posted and order marked received.');
                setManualOpen(false); nav.goBack();
              }catch(e){ Alert.alert('Manual receive failed', String((e as any)?.message||e)); }
            }}>
              <Text style={S.btnSolidText}>Confirm & Post</Text>
            </TouchableOpacity>
          </View>
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

  rowBtn: { padding:14, borderRadius:12, backgroundColor:'#111', marginBottom:12 },
  rowBtnTitle: { color:'#fff', fontWeight:'800', textAlign:'center' },
  rowBtnSub: { color:'#e5e7eb', textAlign:'center', marginTop:4 },

  btnGhost: { flex:1, paddingVertical:12, backgroundColor:'#F3F4F6', borderRadius:8 },
  btnGhostText: { textAlign:'center', fontWeight:'700', color:'#374151' },
  btnSolid: { flex:1, paddingVertical:12, backgroundColor:'#111827', borderRadius:8 },
  btnSolidText: { textAlign:'center', fontWeight:'700', color:'#fff' },
});
