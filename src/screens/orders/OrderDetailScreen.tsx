// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import * as DocumentPicker from 'expo-document-picker';

// ✅ Correct helpers for invoices (URI-only → server write)
import { uploadInvoiceCsv, uploadInvoicePdf } from '../../services/invoices/invoiceUpload';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';

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

// ---------- Parsed invoice sanity checks ----------

type ParsedInvoiceLine = { qty?: number; unitPrice?: number };

/** Aggregate quick stats from parsed lines (CSV/PDF). */
function analyseParsedInvoice(lines: Array<ParsedInvoiceLine|any>) {
  const safe = Array.isArray(lines) ? lines : [];
  let total = 0;
  let pricedCount = 0;

  for (const l of safe) {
    const qty = Number((l as any)?.qty);
    const unitPrice = Number((l as any)?.unitPrice);
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(unitPrice) && unitPrice >= 0) {
      total += qty * unitPrice;
      pricedCount += 1;
    }
  }

  const lineCount = safe.length;
  const missingPriceRatio = lineCount ? (lineCount - pricedCount) / lineCount : 1;

  return { total, missingPriceRatio, lineCount };
}

/**
 * Returns a short human message if the invoice looks "weird" enough that
 * we should pause before posting.
 */
function parsedInvoiceWeirdMessage(stats: { total: number; missingPriceRatio: number; lineCount: number }): string | null {
  const issues: string[] = [];

  if (stats.lineCount <= 2) {
    issues.push('only a couple of lines were detected');
  }
  if (stats.total === 0) {
    issues.push('the invoice total appears to be $0');
  }
  if (stats.missingPriceRatio > 0.6) {
    issues.push('most lines are missing unit prices');
  }

  if (!issues.length) return null;
  return `This invoice looks unusual — ${issues.join(', ')}.`;
}

// ---------- Step 5: friendlier error messages ----------

function humanizeInvoiceError(err: any) {
  const raw = String(err?.message || err || '') || '';

  // Common AI / PDF parse shapes
  const lower = raw.toLowerCase();
  if (lower.includes('pdf parse failed')) {
    return 'We could not reliably read this PDF invoice. Try a clearer copy or use Manual Receive for this order.';
  }
  if (lower.includes('bad xref')) {
    return 'This PDF is in a format our reader struggles with. You can still receive the order manually.';
  }
  if (lower.includes('process-invoices-pdf failed')) {
    return 'Our invoice reader had trouble reading this PDF. Please try again later or receive this order manually.';
  }
  if (lower.includes('process-invoices-csv')) {
    return 'We had trouble reading that CSV. Please check the file format or use Manual Receive instead.';
  }
  if (lower.includes('http 500') || lower.includes('status 500')) {
    return 'The invoice reader had a temporary problem. Please try again, or receive manually if it keeps happening.';
  }

  // Fallback to the raw message if it’s reasonably short; otherwise generic
  if (raw && raw.length <= 140) return raw;
  return 'Something went wrong while reading the invoice. Please try again or use Manual Receive.';
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

      // 🚦 Guard: no lines parsed → explain and bail
      if (!Array.isArray(review?.lines) || review.lines.length === 0) {
        Alert.alert(
          'No invoice lines found',
          'We uploaded the file but could not detect any invoice lines. Please check the file or use Manual Receive instead.'
        );
        return;
      }

      const orderPo = String(orderMeta?.poNumber ?? '').trim();
      const parsedPo = String(review?.invoice?.poNumber ?? '').trim();

      // If both exist and differ → hard block
      if (orderPo && parsedPo && orderPo !== parsedPo) {
        Alert.alert(
          'PO mismatch',
          `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).\nUse Manual Receive to proceed.`,
          [
            { text:'Cancel', style:'cancel' },
            { text:'Manual Receive', onPress:()=>setManualOpen(true) },
          ]
        );
        return;
      }

      // Build effective confidence with penalties
      const warnings = [...(review?.warnings || [] )];
      let effectiveConfidence = Number(review?.confidence ?? 0.4);

      // Order has PO but parsed invoice lacks one → clamp to low confidence
      if (orderPo && !parsedPo) {
        warnings.push('Invoice has no PO while order has a PO — confidence reduced.');
        effectiveConfidence = Math.min(effectiveConfidence, 0.30);
      }

      // Down-weight when CSV ↔ order lines diverge (count & rough name overlap)
      try {
        const orderCount = Array.isArray(lines) ? lines.length : 0;
        const csvCount = Array.isArray(review?.lines) ? review.lines.length : 0;
        if (orderCount && csvCount) {
          const countRatio = Math.min(orderCount, csvCount) / Math.max(orderCount, csvCount);
          const namesA = new Set((review.lines || []).map(l => String(l?.name || '').toLowerCase()).filter(Boolean));
          const namesB = new Set((lines || []).map(l => String(l?.name || '').toLowerCase()).filter(Boolean));
          let intersect = 0; namesA.forEach(n => { if (namesB.has(n)) intersect++; });
          const nameMatch = Math.min(intersect / Math.max(1, namesA.size, namesB.size), 1);
          const penalty =
            (countRatio < 0.5 ? 0.35 : countRatio < 0.75 ? 0.2 : 0.1) +
            (nameMatch < 0.25 ? 0.35 : nameMatch < 0.5 ? 0.2 : 0.05);
          effectiveConfidence = Math.max(0.1, Math.min(0.95, effectiveConfidence - penalty));
        }
      } catch {}

      // Invoice-level sanity note into warnings
      try {
        const stats = analyseParsedInvoice(review.lines || []);
        const weirdMsg = parsedInvoiceWeirdMessage(stats);
        if (weirdMsg) warnings.push(weirdMsg);
      } catch {}

      setCsvReview({
        ...review,
        storagePath: up.fullPath,
        confidence: effectiveConfidence,
        warnings,
      });
      setReceiveOpen(false);
    }catch(e){
      console.error('[OrderDetail] csv pick/process fail', e);
      const msg = humanizeInvoiceError(e);
      Alert.alert(
        'Invoice reader issue',
        msg,
        [
          { text:'OK', style:'cancel' },
          { text:'Manual Receive', onPress: ()=>setManualOpen(true) },
        ]
      );
    }
  },[venueId,orderId,orderMeta,lines]);

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

      // 🚦 Guard: no lines parsed → explain and bail
      if (!Array.isArray(parsed?.lines) || parsed.lines.length === 0) {
        Alert.alert(
          'No invoice lines found',
          'We uploaded the PDF but could not detect any invoice lines. Please check the file or use Manual Receive instead.'
        );
        return;
      }

      const orderPo = String(orderMeta?.poNumber ?? '').trim();
      const parsedPo = String(parsed?.invoice?.poNumber ?? '').trim();
      if (orderPo && parsedPo && orderPo !== parsedPo) {
        Alert.alert(
          'PO mismatch',
          `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).\nUse Manual Receive to proceed.`,
          [
            { text:'Cancel', style:'cancel' },
            { text:'Manual Receive', onPress:()=>setManualOpen(true) },
          ]
        );
        return;
      }

      // Add "weird" invoice info into PDF warnings as well
      let warnings = parsed?.warnings || [];
      try {
        const stats = analyseParsedInvoice(parsed.lines || []);
        const weirdMsg = parsedInvoiceWeirdMessage(stats);
        if (weirdMsg) {
          warnings = [...warnings, weirdMsg];
        }
      } catch {}

      setPdfReview({ ...parsed, storagePath: up.fullPath, warnings });
      setReceiveOpen(false);
    }catch(e){
      console.error('[OrderDetail] pdf upload/parse fail', e);
      const msg = humanizeInvoiceError(e);
      Alert.alert(
        'Invoice reader issue',
        msg,
        [
          { text:'OK', style:'cancel' },
          { text:'Manual Receive', onPress: ()=>setManualOpen(true) },
        ]
      );
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

        // 🚦 Guard: no lines parsed → explain and bail
        if (!Array.isArray(parsed?.lines) || parsed.lines.length === 0) {
          Alert.alert(
            'No invoice lines found',
            'We uploaded the PDF but could not detect any invoice lines. Please check the file or use Manual Receive instead.'
          );
          return;
        }

        const orderPo = String(orderMeta?.poNumber ?? '').trim();
        const parsedPo = String(parsed?.invoice?.poNumber ?? '').trim();
        if (orderPo && parsedPo && orderPo !== parsedPo) {
          Alert.alert(
            'PO mismatch',
            `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).\nUse Manual Receive to proceed.`,
            [
              { text:'Cancel', style:'cancel' },
              { text:'Manual Receive', onPress:()=>setManualOpen(true) },
            ]
          );
          return;
        }

        // PDF weirdness into warnings
        let warnings = parsed?.warnings || [];
        try {
          const stats = analyseParsedInvoice(parsed.lines || []);
          const weirdMsg = parsedInvoiceWeirdMessage(stats);
          if (weirdMsg) {
            warnings = [...warnings, weirdMsg];
          }
        } catch {}

        setPdfReview({ ...parsed, storagePath: up.fullPath, warnings });
        setReceiveOpen(false);
        return;
      }

      if (isCsv) {
        const up = await uploadInvoiceCsv(venueId, orderId, uri, a.name||'invoice.csv');
        if (__DEV__) console.log('[Receive][FILE][CSV] uploaded', up);
        const review = await processInvoicesCsv({ venueId, orderId, storagePath: up.fullPath });
        if (__DEV__) console.log('[Receive][FILE][CSV] processed', { lines: review?.lines?.length ?? 0 });

        // 🚦 Guard: no lines parsed → explain and bail
        if (!Array.isArray(review?.lines) || review.lines.length === 0) {
          Alert.alert(
            'No invoice lines found',
            'We uploaded the file but could not detect any invoice lines. Please check the file or use Manual Receive instead.'
          );
          return;
        }

        const orderPo = String(orderMeta?.poNumber ?? '').trim();
        const parsedPo = String(review?.invoice?.poNumber ?? '').trim();

        if (orderPo && parsedPo && orderPo !== parsedPo) {
          Alert.alert(
            'PO mismatch',
            `Invoice PO (${parsedPo || '—'}) does not match order PO (${orderPo}).\nUse Manual Receive to proceed.`,
            [
              { text:'Cancel', style:'cancel' },
              { text:'Manual Receive', onPress:()=>setManualOpen(true) },
            ]
          );
          return;
        }

        // Apply same CSV confidence penalties in the unified path
        const warnings = [...(review?.warnings || [] )];
        let effectiveConfidence = Number(review?.confidence ?? 0.4);
        if (orderPo && !parsedPo) {
          warnings.push('Invoice has no PO while order has a PO — confidence reduced.');
          effectiveConfidence = Math.min(effectiveConfidence, 0.30);
        }
        try {
          const orderCount = Array.isArray(lines) ? lines.length : 0;
          const csvCount = Array.isArray(review?.lines) ? review.lines.length : 0;
          if (orderCount && csvCount) {
            const countRatio = Math.min(orderCount, csvCount) / Math.max(orderCount, csvCount);
            const namesA = new Set((review.lines || []).map(l => String(l?.name || '').toLowerCase()).filter(Boolean));
            const namesB = new Set((lines || []).map(l => String(l?.name || '').toLowerCase()).filter(Boolean));
            let intersect = 0; namesA.forEach(n => { if (namesB.has(n)) intersect++; });
            const nameMatch = Math.min(intersect / Math.max(1, namesA.size, namesB.size), 1);
            const penalty =
              (countRatio < 0.5 ? 0.35 : countRatio < 0.75 ? 0.2 : 0.1) +
              (nameMatch < 0.25 ? 0.35 : nameMatch < 0.5 ? 0.2 : 0.05);
            effectiveConfidence = Math.max(0.1, Math.min(0.95, effectiveConfidence - penalty));
          }
        } catch {}

        // Invoice-level sanity note into warnings
        try {
          const stats = analyseParsedInvoice(review.lines || []);
          const weirdMsg = parsedInvoiceWeirdMessage(stats);
          if (weirdMsg) warnings.push(weirdMsg);
        } catch {}

        setCsvReview({ ...review, storagePath: up.fullPath, confidence: effectiveConfidence, warnings });
        setReceiveOpen(false);
        return;
      }

      Alert.alert('Unsupported file', 'Please choose a PDF or CSV invoice.');
    }catch(e){
      console.error('[OrderDetail] file pick route fail', e);
      const msg = humanizeInvoiceError(e);
      Alert.alert(
        'Invoice reader issue',
        msg,
        [
          { text:'OK', style:'cancel' },
          { text:'Manual Receive', onPress: ()=>setManualOpen(true) },
        ]
      );
    }
  },[venueId, orderId, orderMeta, lines]);

  const ConfidenceBanner = ({ kind, score }:{ kind:'csv'|'pdf'; score?:number })=>{
    const t = tierForConfidence(score);
    const msg =
      t==='low'    ? 'Low confidence: results may be inaccurate. Consider Manual Receive.'
    : t==='medium' ? 'Medium confidence: please review carefully before confirming.'
    :                 'High confidence: looks good.';

    const bg = t==='low' ? '#FEF3C7' : t==='medium' ? '#E0E7FF' : '#DCFCE7';
    const fg = t==='low' ? '#92400E' : t==='medium' ? '#1E3A8A' : '#065F46';
    const pct = typeof score === 'number' && isFinite(score) ? Math.round(score * 100) : null;

    return (
      <View style={{backgroundColor:bg, padding:10, borderRadius:8, marginBottom:10}}>
        <Text style={{color:fg, fontWeight:'700'}}>
          {msg} {pct !== null ? `(confidence ${pct}%)` : ''}
        </Text>
        {t==='low' ? (
          <TouchableOpacity
            onPress={()=>setManualOpen(true)}
            style={{marginTop:8, alignSelf:'flex-start', backgroundColor:'#111', paddingVertical:8, paddingHorizontal:12, borderRadius:8}}
          >
            <Text style={{color:'#fff', fontWeight:'700'}}>Open Manual Receive</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

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

  // helper to post a CSV review (used by auto-confirm + button)
  const postCsvReview = useCallback(async () => {
    if (!csvReview) return;
    autoConfirmedRef.current = true;
    try{
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
    }catch(e:any){
      autoConfirmedRef.current = false;
      const msg = humanizeInvoiceError(e);
      Alert.alert(
        'Receive failed',
        msg,
        [
          { text:'OK', style:'cancel' },
          { text:'Manual Receive', onPress: ()=>setManualOpen(true) },
        ]
      );
    }
  }, [csvReview, venueId, orderId, nav]);

  // Auto-confirm CSV on very high confidence, *unless* invoice looks weird
  useEffect(()=>{
    if (!csvReview || autoConfirmedRef.current) return;
    const t = tierForConfidence(csvReview.confidence);
    if (t !== 'high') return;

    try {
      const stats = analyseParsedInvoice(csvReview.lines || []);
      const weirdMsg = parsedInvoiceWeirdMessage(stats);
      if (weirdMsg) {
        Alert.alert(
          'Please review invoice',
          `${weirdMsg}\n\nWe’ve saved the parsed invoice, but automatic posting was disabled so you can double-check first.`
        );
        autoConfirmedRef.current = true;
        return;
      }
    } catch {
      // If analysis fails, just fall back to existing behaviour
    }

    postCsvReview().catch(()=>{});
  },[csvReview, postCsvReview]);

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
          <TouchableOpacity
            style={[S.receiveBtn, { position: 'absolute', right: 16, bottom: 16, zIndex: 10, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4 }]}
            onPress={()=>setReceiveOpen(true)}
          >
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
              <TouchableOpacity
                style={{flex:1,paddingVertical:12,backgroundColor:'#F3F4F6',borderRadius:8}}
                onPress={()=>setCsvReview(null)}
              >
                <Text style={{textAlign:'center',fontWeight:'700',color:'#374151'}}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{flex:1,paddingVertical:12,backgroundColor:'#111827',borderRadius:8}}
                onPress={()=>{
                  const stats = analyseParsedInvoice(csvReview.lines || []);
                  const weirdMsg = parsedInvoiceWeirdMessage(stats);
                  if (weirdMsg) {
                    Alert.alert(
                      'Check before posting',
                      `${weirdMsg}\n\nYou can go back to Manual Receive if this doesn’t look right.`,
                      [
                        { text:'Cancel', style:'cancel' },
                        { text:'Manual Receive', onPress:()=>setManualOpen(true) },
                        { text:'Post anyway', style:'destructive', onPress: ()=>{ postCsvReview(); } }
                      ]
                    );
                    return;
                  }
                  postCsvReview();
                }}
              >
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
              <TouchableOpacity
                style={{flex:1,paddingVertical:12,backgroundColor:'#F3F4F6',borderRadius:8}}
                onPress={()=>setPdfReview(null)}
              >
                <Text style={{textAlign:'center',fontWeight:'700',color:'#374151'}}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{flex:1,paddingVertical:12,backgroundColor:'#111827',borderRadius:8}}
                onPress={()=>{
                  Alert.alert('Pending', 'PDF posting not wired to finalize yet.');
                }}
              >
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

      <Modal
        visible={manualOpen}
        animationType="slide"
        onRequestClose={()=>setManualOpen(false)}
      >
        <ManualReceiveScreen
          orderId={orderId}
          venueId={venueId}
          orderLines={lines}
          onDone={()=>{ setManualOpen(false); nav.goBack(); }}
        />
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
