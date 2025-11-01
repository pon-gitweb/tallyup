// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, FlatList, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';

import { uploadPdfToStorage } from '../../services/uploads/uploadPdfToStorage';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
import { mapParsedToInvoiceLines } from '../../services/invoices/mapParsedToInvoice';
import { upsertInvoiceFromOrder, fetchOrderWithLines, type InvoiceLineInput } from '../../services/invoices';

export default function OrderDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = useVenueId();
  const orderId: string = route.params?.orderId;
  const receiveMode: 'manual'|'scan'|'upload'|undefined = route.params?.receiveMode;

  const db = getFirestore();

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [orderLines, setOrderLines] = useState<any[]>([]);
  const [error, setError] = useState<string|null>(null);

  // Phase-1 Review modal state
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewInvoiceNo, setReviewInvoiceNo] = useState<string>('');
  const [reviewInvoiceDateISO, setReviewInvoiceDateISO] = useState<string>('');
  const [reviewLines, setReviewLines] = useState<InvoiceLineInput[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!venueId || !orderId) throw new Error('Missing venue or order');
        const { order, lines } = await fetchOrderWithLines(venueId, orderId);
        if (!mounted) return;
        setOrder(order);
        setOrderLines(lines);
        setError(null);
      } catch (e: any) {
        setError(e?.message || 'Load failed');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [venueId, orderId]);

  // When launched from Orders modal with receiveMode 'upload', auto-start the PDF import once
  useEffect(() => {
    if (receiveMode === 'upload') {
      (async () => {
        try {
          // 1) Pick a PDF
          const pick = await DocumentPicker.getDocumentAsync({
            multiple: false,
            type: 'application/pdf',
            copyToCacheDirectory: true,
          });
          if (pick.canceled || !pick.assets?.[0]) {
            console.log('[OrderDetail] PDF import cancelled');
            return;
          }
          const file = pick.assets[0];

          // 2) Read as base64 (Expo DocumentPicker returns uri; fetch and convert)
          const resp = await fetch(file.uri);
          const blob = await resp.blob();
          const arrBuf = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrBuf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = typeof btoa !== 'undefined'
            ? btoa(binary)
            : globalThis.Buffer?.from(binary, 'binary')?.toString('base64');

          if (!base64) throw new Error('Base64 encode failed');

          // 3) Upload to Storage (phase-1 path)
          const { storagePath } = await uploadPdfToStorage(venueId, orderId, base64);

          // 4) Call parser
          const parsed = await processInvoicesPdf({ venueId, orderId, storagePath });

          // 5) Pre-fill review buffer
          const invNo = (parsed.invoice?.poNumber ?? '').toString();
          const invDate = (parsed.invoice?.poDate ?? new Date().toISOString().slice(0,10)).toString();
          const mappedLines = mapParsedToInvoiceLines(parsed.lines || []);

          if (!mappedLines.length) {
            Alert.alert('PDF Imported', 'No lines matched. (Phase-1 skips unmatched lines.)');
          }

          setReviewInvoiceNo(invNo);
          setReviewInvoiceDateISO(invDate);
          setReviewLines(mappedLines);
          setReviewOpen(true);
        } catch (e: any) {
          console.log('[OrderDetail] PDF import error', e?.message || e);
          Alert.alert('Import failed', e?.message || 'Could not import PDF.');
        }
      })();
    }
  }, [receiveMode, venueId, orderId]);

  const subtotal = useMemo(
    () => reviewLines.reduce((s, l) => s + (Number(l.qty)||0)*(Number(l.cost)||0), 0),
    [reviewLines]
  );

  async function postReviewedInvoice() {
    try {
      if (!venueId) throw new Error('No venue');
      if (!orderId) throw new Error('No order');
      if (!reviewLines.length) {
        Alert.alert('Invoice', 'There are no matched lines to post.');
        return;
      }
      await upsertInvoiceFromOrder(venueId, 'system', {
        orderId,
        invoiceNumber: reviewInvoiceNo || 'INV-UNKNOWN',
        invoiceDateISO: reviewInvoiceDateISO || new Date().toISOString().slice(0,10),
        lines: reviewLines,
      });
      setReviewOpen(false);
      Alert.alert('Invoice', 'Invoice posted. (Order not auto-received in Phase-1.)');
    } catch (e: any) {
      Alert.alert('Invoice', e?.message || 'Failed to post invoice.');
    }
  }

  if (loading) return (<View style={S.center}><ActivityIndicator /><Text>Loading…</Text></View>);
  if (error) return (<View style={S.center}><Text style={{color:'#B00020'}}>{error}</Text></View>);

  return (
    <View style={S.wrap}>
      <Text style={S.title}>Order</Text>
      <Text style={S.sub}>ID: {orderId}</Text>
      <Text style={S.sub}>Supplier: {order?.supplierName || order?.supplierId || '—'}</Text>

      <FlatList
        data={orderLines}
        keyExtractor={(l:any)=>l.id}
        contentContainerStyle={{paddingVertical:8}}
        ItemSeparatorComponent={()=> <View style={{height:8}}/>}
        renderItem={({item})=>(
          <View style={S.line}>
            <View style={{flex:1}}>
              <Text style={S.lineName}>{item.productName || item.productId}</Text>
              <Text style={S.mute}>qty {item.qty ?? 0} @ {item.cost != null ? Number(item.cost).toFixed(2) : '—'}</Text>
            </View>
          </View>
        )}
      />

      {/* Phase-1 Review & Post modal */}
      <Modal visible={reviewOpen} transparent animationType="slide" onRequestClose={()=>setReviewOpen(false)}>
        <View style={S.modalWrap}>
          <View style={S.sheet}>
            <Text style={S.sheetTitle}>Review invoice (PDF)</Text>
            <Text style={S.mute}>Inv #: {reviewInvoiceNo || '—'}</Text>
            <Text style={S.mute}>Date: {reviewInvoiceDateISO || '—'}</Text>

            <View style={{height:8}}/>
            <View style={S.card}>
              <Text style={{fontWeight:'800', marginBottom:6}}>Matched lines ({reviewLines.length})</Text>
              <ScrollView style={{maxHeight:240}}>
                {reviewLines.map((l, i)=>(
                  <View key={i} style={{flexDirection:'row', justifyContent:'space-between', marginVertical:4}}>
                    <Text style={{flex:1, marginRight:8}} numberOfLines={1}>
                      {l.productName || l.productId}
                    </Text>
                    <Text style={{width:64, textAlign:'right'}}>{Number(l.qty||0)}</Text>
                    <Text style={{width:96, textAlign:'right'}}>{Number(l.cost||0).toFixed(2)}</Text>
                  </View>
                ))}
              </ScrollView>
              <View style={{flexDirection:'row', justifyContent:'space-between', marginTop:8}}>
                <Text style={{fontWeight:'900'}}>Subtotal</Text>
                <Text style={{fontWeight:'900'}}>{subtotal.toFixed(2)}</Text>
              </View>
            </View>

            <View style={{flexDirection:'row', gap:10, marginTop:8}}>
              <TouchableOpacity style={[S.btn, S.btnGhost]} onPress={()=>setReviewOpen(false)}>
                <Text style={S.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.btn, S.btnPrimary]} onPress={postReviewedInvoice}>
                <Text style={S.btnPrimaryText}>Post Invoice</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{flex:1,padding:16},
  center:{flex:1,alignItems:'center',justifyContent:'center',gap:8},
  title:{fontSize:22,fontWeight:'800'},
  sub:{opacity:0.7},
  line:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#F3F4F6',padding:10,borderRadius:12},
  mute:{opacity:0.6},
  // modal sheet
  modalWrap:{flex:1,backgroundColor:'rgba(0,0,0,0.35)',justifyContent:'flex-end'},
  sheet:{backgroundColor:'#fff',padding:16,borderTopLeftRadius:16,borderTopRightRadius:16},
  sheetTitle:{fontSize:18,fontWeight:'800',marginBottom:6},
  card:{backgroundColor:'#F9FAFB',padding:12,borderRadius:12},
  btn:{flex:1,alignItems:'center',paddingVertical:12,borderRadius:10},
  btnPrimary:{backgroundColor:'#111827'},
  btnPrimaryText:{color:'#fff',fontWeight:'800'},
  btnGhost:{borderWidth:1,borderColor:'#D1D5DB'},
  btnGhostText:{fontWeight:'800',color:'#111827'},
});
