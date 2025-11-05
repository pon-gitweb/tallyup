// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { getFirestore, doc, getDoc, collection, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import * as DocumentPicker from 'expo-document-picker';

// ✅ Correct helpers for invoices (URI-only → server write)
import { uploadInvoiceCsv, uploadInvoicePdf } from '../../services/invoices/invoiceUpload';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
// NEW: reconciliation
import { reconcileInvoiceREST } from '../../services/invoices/reconcile';

import ReceiveOptionsModal from './receive/ReceiveOptionsModal';
import ManualReceiveScreen from './receive/ManualReceiveScreen';
import { finalizeReceiveFromCsv } from '../../services/orders/receive';

type Params = { orderId: string };
type Line = { id: string; productId?: string; name?: string; qty?: number; unitCost?: number };

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
  const [manualOpen, setManualOpen] = useState(false);

  const [csvReview, setCsvReview] = useState<null | {
    storagePath: string;
    confidence?: number;
    warnings?: string[];
    lines: Array<{ productId?: string; code?: string; name: string; qty: number; unitPrice?: number }>;
    invoice: any;
    matchReport?: any;
  }>(null);

  const [pdfReview, setPdfReview] = useState<null | {
    storagePath: string;
    confidence?: number;
    warnings?: string[];
    lines: Array<{ name: string; qty: number; unitPrice?: number; code?: string }>;
    invoice: any;
    matchReport?: any;
  }>(null);

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
        const linesData:Line[] = [];
        linesSnap.forEach((docSnap)=>{
          const d:any = docSnap.data()||{};
          linesData.push({
            id: docSnap.id,
            productId: d.productId,
            name: d.name,
            qty: Number.isFinite(d.qty) ? Number(d.qty) : (d.qty||0),
            unitCost: Number.isFinite(d.unitCost) ? Number(d.unitCost) : (d.unitCost||0),
          });
        });
        setLines(linesData);
      }catch(e){
        console.warn('[OrderDetail] load fail', e);
      }finally{
        if (alive) setLoading(false);
      }
    })();
    return ()=>{ alive=false; };
  },[db,venueId,orderId]);

  /** CSV: pick -> upload URI (no Blob) -> process -> optional PO guard -> stage review */
  const pickCsvAndProcess = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({ type: 'text/csv', multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const uri = a.uri || a.file || '';
      const name = a.name || 'invoice.csv';
      if (!uri) throw new Error('No file uri from DocumentPicker');

      if (__DEV__) console.log('[Receive][CSV] picked', { uri, name });
      const up = await uploadInvoiceCsv(venueId, orderId, uri, name);
      if (__DEV__) console.log('[Receive][CSV] uploaded', up);

      const review = await processInvoicesCsv({ venueId, orderId, storagePath: up.fullPath });
      if (__DEV__) console.log('[Receive][CSV] processed', { lines: review?.lines?.length ?? 0 });

      const orderPo = String(orderMeta?.poNumber ?? '').trim();
      const parsedPo = String(review?.invoice?.poNumber ?? '').trim();
      if (orderPo && parsedPo && orderPo !== parsedPo) {
        Alert.alert('PO mismatch', `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).
Use Manual Receive to proceed.`,
          [{ text:'Cancel', style:'cancel' }, { text:'Manual Receive', onPress:()=>setManualOpen(true) }]);
        return;
      }
      setCsvReview({ ...review, storagePath: up.fullPath });
      setReceiveOpen(false);
    }catch(e){
      console.error('[OrderDetail] csv pick/process fail', e);
      Alert.alert('Upload failed', String(e?.message || e));
    }
  },[venueId,orderId,orderMeta]);

  /** PDF: pick -> upload URI (no Blob) -> process -> optional PO guard -> stage review */
  const pickPdfAndUpload = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const uri = a.uri || a.file || '';
      const name = a.name || 'invoice.pdf';
      if (!uri) throw new Error('No file uri from DocumentPicker');

      if (__DEV__) console.log('[Receive][PDF] picked', { uri, name });
      const up = await uploadInvoicePdf(venueId, orderId, uri, name);
      if (__DEV__) console.log('[Receive][PDF] uploaded', up);

      const parsed = await processInvoicesPdf({ venueId, orderId, storagePath: up.fullPath });
      if (__DEV__) console.log('[Receive][PDF] processed', { lines: parsed?.lines?.length ?? 0 });

      const orderPo = String(orderMeta?.poNumber ?? '').trim();
      const parsedPo = String(parsed?.invoice?.poNumber ?? '').trim();
      if (orderPo && parsedPo && orderPo !== parsedPo) {
        Alert.alert('PO mismatch', `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).
Use Manual Receive to proceed.`,
          [{ text:'Cancel', style:'cancel' }, { text:'Manual Receive', onPress:()=>setManualOpen(true) }]);
        return;
      }
      setPdfReview({ ...parsed, storagePath: up.fullPath });
      setReceiveOpen(false);
    }catch(e){
      console.error('[OrderDetail] pdf upload/parse fail', e);
      Alert.alert('Upload failed', String(e?.message || e));
    }
  },[venueId,orderId,orderMeta]);

  /** Unified file picker routes to PDF/CSV flows */
  const pickFileAndRoute = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf','text/csv','text/comma-separated-values','text/plain'],
        multiple: false, copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const name = (a.name||'').toLowerCase();
      const uri = a.uri || a.file || '';
      if (!uri) throw new Error('No file uri from DocumentPicker');
      const isPdf = name.endsWith('.pdf');
      const isCsv = isPdf ? false : (name.endsWith('.csv') || name.endsWith('.txt'));

      if (__DEV__) console.log('[Receive][FILE] picked', { uri, name, isPdf, isCsv });

      if (isPdf) {
        const up = await uploadInvoicePdf(venueId, orderId, uri, a.name||'invoice.pdf');
        if (__DEV__) console.log('[Receive][FILE][PDF] uploaded', up);
        const parsed = await processInvoicesPdf({ venueId, orderId, storagePath: up.fullPath });
        if (__DEV__) console.log('[Receive][FILE][PDF] processed', { lines: parsed?.lines?.length ?? 0 });

        const orderPo = String(orderMeta?.poNumber ?? '').trim();
        const parsedPo = String(parsed?.invoice?.poNumber ?? '').trim();
        if (orderPo && parsedPo && orderPo !== parsedPo) {
          Alert.alert('PO mismatch', `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).
Use Manual Receive to proceed.`,
            [{ text:'Cancel', style:'cancel' }, { text:'Manual Receive', onPress:()=>setManualOpen(true) }]);
          return;
        }
        setPdfReview({ ...parsed, storagePath: up.fullPath });
        setReceiveOpen(false);
        return;
      }

      if (isCsv) {
        const up = await uploadInvoiceCsv(venueId, orderId, uri, a.name||'invoice.csv');
        if (__DEV__) console.log('[Receive][FILE][CSV] uploaded', up);
        const review = await processInvoicesCsv({ venueId, orderId, storagePath: up.fullPath });
        if (__DEV__) console.log('[Receive][FILE][CSV] processed', { lines: review?.lines?.length ?? 0 });

        const orderPo = String(orderMeta?.poNumber ?? '').trim();
        const parsedPo = String(review?.invoice?.poNumber ?? '').trim();
        if (orderPo && parsedPo && orderPo !== parsedPo) {
          Alert.alert('PO mismatch', `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).
Use Manual Receive to proceed.`,
            [{ text:'Cancel', style:'cancel' }, { text:'Manual Receive', onPress:()=>setManualOpen(true) }]);
          return;
        }
        setCsvReview({ ...review, storagePath: up.fullPath });
        setReceiveOpen(false);
        return;
      }

      Alert.alert('Unsupported file', 'Please choose a PDF or CSV invoice.');
    }catch(e){
      console.error('[OrderDetail] file pick route fail', e);
      Alert.alert('Upload failed', String(e?.message || e));
    }
  },[venueId, orderId, orderMeta]);

  const ConfidenceBanner = ({ kind, score }:{ kind:'csv'|'pdf'; score?:number })=>{
    const t = tierForConfidence(score);
    const msg =
      t==='low'    ? 'Low confidence: results may be inaccurate. Consider Manual Receive.'
    : t==='medium' ? 'Medium confidence: please review carefully before confirming.'
    :                 'High confidence: looks good.';
    const bg = t==='low' ? '#FEF3C7' : t==='medium' ? '#E0E7FF' : '#DCFCE7';
    const fg = t==='low' ? '#92400E' : t==='medium' ? '#1E3A8A' : '#065F46';

    return (
      <View style={{backgroundColor:bg, padding:10, borderRadius:8, marginBottom:10}}>
        <Text style={{color:fg, fontWeight:'700'}}>{msg} {Number.isFinite(score)? `(confidence ${(score!*100).toFixed(0)}%)`:''}</Text>
        {t==='low' ? (
          <TouchableOpacity onPress={()=>setManualOpen(true)} style={{marginTop:8, alignSelf:'flex-start', backgroundColor:'#111', paddingVertical:8, paddingHorizontal:12, borderRadius:8}}>
            <Text style={{color:'#fff', fontWeight:'700'}}>Open Manual Receive</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  // Auto-confirm CSV on very high confidence → now reconciles before posting
  useEffect(()=>{
    if (!csvReview || autoConfirmedRef.current) return;
    const t = tierForConfidence(csvReview.confidence);
    if (t === 'high') {
      autoConfirmedRef.current = true;
      (async ()=>{
        try{
          // 1) Reconcile (server writes reconciliation doc)
          const rec = await reconcileInvoiceREST(venueId, orderId, {
            invoice: { source:'csv', storagePath: csvReview.storagePath, poNumber: csvReview?.invoice?.poNumber ?? null },
            lines: csvReview.lines,
            confidence: csvReview.confidence,
            warnings: csvReview.warnings || [],
          });
          if (!rec?.ok) throw new Error(rec?.error || 'Reconcile failed');

          // 2) Store varianceCard snapshot on order for Reports
          const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
          await updateDoc(orderRef, {
            lastReconciliationId: rec.reconciliationId || null,
            varianceCard: {
              createdAt: serverTimestamp(),
              source: 'csv',
              summary: rec.summary || null,
              confidence: csvReview.confidence ?? null,
              warnings: csvReview.warnings || [],
            }
          });

          // 3) Finalize receive (status → received, etc.)
          await finalizeReceiveFromCsv({
            venueId,
            orderId,
            parsed: {
              invoice: csvReview.invoice,
              lines: csvReview.lines,
              matchReport: csvReview.matchReport,
              confidence: csvReview.confidence,
              warnings: csvReview.warnings
            }
          });

          Alert.alert('Received', 'High-confidence invoice auto-accepted and posted.');
          setReceiveOpen(false);
          setCsvReview(null);
          nav.goBack();
        }catch(e){
          autoConfirmedRef.current = false;
          Alert.alert('Auto-receive failed', String(e?.message || e));
        }
      })();
    }
  },[csvReview, venueId, orderId, nav]);

  const totalOrdered = useMemo(()=>{
    return lines.reduce((sum,line)=>{
      const cost = line.unitCost||0;
      const qty = line.qty||0;
      return sum + (cost * qty);
    },0);
  },[lines]);

  const csvWarnings = useMemo(() => {
    if (!csvReview) return [];
    return (csvReview.warnings || csvReview.matchReport?.warnings || []);
  }, [csvReview]);

  const pdfWarnings = useMemo(() => {
    if (!pdfReview) return [];
    return (pdfReview.warnings || pdfReview.matchReport?.warnings || []);
  }, [pdfReview]);

  if (loading) return <View style={S.loading}><ActivityIndicator/></View>;

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
          <TouchableOpacity style={[S.receiveBtn, { position: 'absolute', right: 16, bottom: 16, zIndex: 10, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4 }]} onPress={()=>setReceiveOpen(true)}>
            <Text style={S.receiveBtnText}>Receive</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {csvReview ? (
        <ScrollView style={{flex:1}}>
          <View style={{padding:16}}>
            <ConfidenceBanner kind="csv" score={csvReview.confidence} />
            <Text style={{fontSize:16,fontWeight:'800',marginBottom:8}}>Review Invoice (CSV)</Text>
            {csvWarnings.length > 0 ? (
              <View style={{marginBottom:8}}>
                {csvWarnings.map((w,idx)=>(<Text key={idx} style={{color:'#92400E'}}>• {w}</Text>))}
              </View>
            ) : null}
            {(csvReview.lines||[]).slice(0,40).map((pl,idx)=>(
              <View key={idx} style={{paddingVertical:6,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'}}>
                <Text style={{fontWeight:'700'}}>{pl.name || pl.code || '(line)'}</Text>
                <Text style={{color:'#6B7280'}}>Qty: {pl.qty} • Unit: ${pl.unitPrice?.toFixed(2)||'0.00'}</Text>
              </View>
            ))}
            {(csvReview.lines||[]).length>40 ? <Text style={{marginTop:8,color:'#6B7280'}}>... and {csvReview.lines.length-40} more lines</Text> : null}

            <View style={{flexDirection:'row',gap:12,marginTop:16}}>
              <TouchableOpacity style={{flex:1,paddingVertical:12,backgroundColor:'#F3F4F6',borderRadius:8}} onPress={()=>setCsvReview(null)}>
                <Text style={{textAlign:'center',fontWeight:'700',color:'#374151'}}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{flex:1,paddingVertical:12,backgroundColor:'#111827',borderRadius:8}} onPress={async ()=>{
                try{
                  // 1) Reconcile (server writes doc, client stores varianceCard)
                  const rec = await reconcileInvoiceREST(venueId, orderId, {
                    invoice: { source:'csv', storagePath: csvReview.storagePath, poNumber: csvReview?.invoice?.poNumber ?? null },
                    lines: csvReview.lines,
                    confidence: csvReview.confidence,
                    warnings: csvReview.warnings || [],
                  });
                  if (!rec?.ok) throw new Error(rec?.error || 'Reconcile failed');

                  const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
                  await updateDoc(orderRef, {
                    lastReconciliationId: rec.reconciliationId || null,
                    varianceCard: {
                      createdAt: serverTimestamp(),
                      source: 'csv',
                      summary: rec.summary || null,
                      confidence: csvReview.confidence ?? null,
                      warnings: csvReview.warnings || [],
                    }
                  });

                  // 2) Finalize receive
                  await finalizeReceiveFromCsv({
                    venueId,
                    orderId,
                    parsed: {
                      invoice: csvReview.invoice,
                      lines: csvReview.lines,
                      matchReport: csvReview.matchReport,
                      confidence: csvReview.confidence,
                      warnings: csvReview.warnings
                    }
                  });

                  Alert.alert('Received', 'Invoice posted and order marked received.');
                  setReceiveOpen(false);
                  setCsvReview(null);
                  nav.goBack();
                }catch(e){
                  Alert.alert('Receive failed', String(e?.message || e));
                }
              }}>
                <Text style={{textAlign:'center',fontWeight:'700',color:'#fff'}}>Confirm & Post</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      ) : pdfReview ? (
        <ScrollView style={{flex:1}}>
          <View style={{padding:16}}>
            <ConfidenceBanner kind="pdf" score={pdfReview.confidence} />
            <Text style={{fontSize:16,fontWeight:'800',marginBottom:8}}>Review Invoice (PDF)</Text>
            {pdfWarnings.length > 0 ? (
              <View style={{marginBottom:8}}>
                {pdfWarnings.map((w,idx)=>(<Text key={idx} style={{color:'#92400E'}}>• {w}</Text>))}
              </View>
            ) : null}
            {(pdfReview.lines||[]).slice(0,40).map((pl,idx)=>(
              <View key={idx} style={{paddingVertical:6,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'}}>
                <Text style={{fontWeight:'700'}}>{pl.name || pl.code || '(line)'}</Text>
                <Text style={{color:'#6B7280'}}>Qty: {pl.qty} • Unit: ${pl.unitPrice?.toFixed(2)||'0.00'}</Text>
              </View>
            ))}
            {(pdfReview.lines||[]).length>40 ? <Text style={{marginTop:8,color:'#6B7280'}}>... and {pdfReview.lines.length-40} more lines</Text> : null}

            <View style={{flexDirection:'row',gap:12,marginTop:16}}>
              <TouchableOpacity style={{flex:1,paddingVertical:12,backgroundColor:'#F3F4F6',borderRadius:8}} onPress={()=>setPdfReview(null)}>
                <Text style={{textAlign:'center',fontWeight:'700',color:'#374151'}}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{flex:1,paddingVertical:12,backgroundColor:'#111827',borderRadius:8}} onPress={()=>{
                Alert.alert('Pending', 'PDF posting not wired to finalize yet.');
              }}>
                <Text style={{textAlign:'center',fontWeight:'700',color:'#fff'}}>Confirm (stub)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={{flex:1}}>
          <FlatList
            data={lines}
            keyExtractor={(it)=>it.id}
            contentContainerStyle={{padding:16}}
            ItemSeparatorComponent={()=> <View style={{height:8}}/>}
            renderItem={({item})=>(
              <View style={S.line}>
                <Text style={{fontWeight:'700'}}>{item.name || item.productId || item.id}</Text>
                <Text style={{color:'#6B7280'}}>Qty: {item.qty ?? 0} • Unit: ${Number(item.unitCost||0).toFixed(2)}</Text>
              </View>
            )}
            ListHeaderComponent={(
              <View style={{paddingBottom:8}}>
                <Text style={{fontSize:16,fontWeight:'800'}}>Order Lines</Text>
                <Text style={{color:'#6B7280'}}>Estimated total: ${totalOrdered.toFixed(2)}</Text>
              </View>
            )}
          />
        </View>
      )}

      <ReceiveOptionsModal
        visible={receiveOpen}
        onClose={()=>setReceiveOpen(false)}
        orderId={orderId}
        orderLines={lines}
        onCsvSelected={pickCsvAndProcess}
        onPdfSelected={pickPdfAndUpload}
        onFileSelected={pickFileAndRoute}
        onManualSelected={()=>setManualOpen(true)}
      />

      <Modal visible={manualOpen} animationType="slide" onRequestClose={()=>setManualOpen(false)}>
        <ManualReceiveScreen orderId={orderId} onClose={()=>setManualOpen(false)} />
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex:1, backgroundColor:'#fff' },
  top: { padding:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#E5E7EB' },
  title: { fontSize:20, fontWeight:'800' },
  meta: { marginTop:4, color:'#6B7280' },
  line: { padding:12, backgroundColor:'#F9FAFB', borderRadius:10 },
  loading: { flex:1, alignItems:'center', justifyContent:'center' },
  receiveBtn: { backgroundColor:'#111', paddingHorizontal:14, paddingVertical:10, borderRadius:10 },
  receiveBtnText: { color:'#fff', fontWeight:'800' },
});
