// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import {
  getFirestore, doc, getDoc, collection, getDocs
} from 'firebase/firestore';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

import ReceiveOptionsModal from '../../components/orders/ReceiveOptionsModal';
import { uploadCsvTextToStorage } from '../../services/uploads/uploadCsvTextToStorage';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { finalizeReceiveFromCsv } from '../../services/orders/receive';

type Params = { orderId: string };
type Line = { id: string; productId?: string; name?: string; qty?: number; unitCost?: number };

export default function OrderDetailScreen(){
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const venueId = useVenueId();
  const orderId = (route.params as any)?.orderId as string;

  const [orderMeta, setOrderMeta] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  // Receive modal state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [csvReview, setCsvReview] = useState<null | {
    storagePath: string;
    confidence?: number;
    warnings?: string[];
    lines: Array<{ productId?: string; code?: string; name: string; qty: number; unitPrice?: number }>;
    invoice: any;
    matchReport?: any;
  }>(null);

  const db = getFirestore();

  useEffect(()=>{
    let alive = true;
    (async ()=>{
      try{
        if (!venueId || !orderId) return;
        // order
        const oSnap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
        const oVal:any = oSnap.exists() ? oSnap.data() : {};
        if (!alive) return;
        setOrderMeta({ id: oSnap.id, ...oVal });

        // lines
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

  const pickCsvAndProcess = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({ type: 'text/csv' });
      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      console.log('[OrderDetail] picked csv', asset);

      const contents = await FileSystem.readAsStringAsync(asset.uri);
      console.log('[OrderDetail] csv length', contents.length);

      const storagePath = await uploadCsvTextToStorage(venueId, contents, 'invoice-import');

      const review = await processInvoicesCsv(venueId, orderId, contents, storagePath);
      console.log('[OrderDetail] processInvoicesCsv result', review);

      setCsvReview(review);
    }catch(e:any){
      console.error('[OrderDetail] csv pick/process fail', e);
      Alert.alert('Upload failed', String(e?.message || e));
    }
  },[venueId,orderId]);

  const confirmCsvReceive = useCallback(async ()=>{
    try{
      if (!venueId || !orderId || !csvReview) return;
      await finalizeReceiveFromCsv(venueId, orderId, csvReview, {
        supplierId: orderMeta?.supplierId ?? null,
        supplierName: orderMeta?.supplierName ?? null,
        poNumber: orderMeta?.poNumber ?? null,
        poDate: orderMeta?.poDate ?? null
      });
      console.log('[OrderDetail] receive: finalize ok');
      Alert.alert('Received', 'Invoice posted and order marked received.');
      setReceiveOpen(false);
      setCsvReview(null);
      nav.goBack();
    }catch(e:any){
      Alert.alert('Receive failed', String(e?.message || e));
    }
  },[venueId,orderId,csvReview,nav,orderMeta]);

  const totalOrdered = useMemo(()=>{
    return lines.reduce((sum,line)=>{
      const cost = line.unitCost||0;
      const qty = line.qty||0;
      return sum + (cost * qty);
    },0);
  },[lines]);

  // Safe warning extraction to avoid hook order issues
  const warnings = useMemo(() => {
    if (!csvReview) return [];
    return (csvReview.warnings || csvReview.matchReport?.warnings || []);
  }, [csvReview]);

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
            <Text style={{fontSize:16,fontWeight:'800',marginBottom:8}}>Review Invoice (CSV)</Text>
            {warnings.length > 0 ? (
              <View style={{marginBottom:8}}>
                {warnings.map((w,idx)=>(<Text key={idx} style={{color:'#92400E'}}>• {w}</Text>))}
              </View>
            ) : null}
            <Text style={{color:'#6B7280',marginBottom:12}}>
              Confidence: {csvReview.confidence != null ? Math.round(csvReview.confidence*100) : '—'}%
            </Text>
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
              <TouchableOpacity style={{flex:1,paddingVertical:12,backgroundColor:'#111827',borderRadius:8}} onPress={confirmCsvReceive}>
                <Text style={{textAlign:'center',fontWeight:'700',color:'#fff'}}>Confirm Receive</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      ) : (
        lines.length>0 && (
          <FlatList
            data={lines}
            keyExtractor={(x)=>x.id}
            renderItem={({item})=>(
              <View style={{paddingHorizontal:16,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'}}>
                <Text style={{fontWeight:'700'}}>{item.name||item.productId||'Line'}</Text>
                <Text style={{color:'#6B7280',marginTop:4}}>
                  Qty: {item.qty||0} • Unit: ${(item.unitCost||0).toFixed(2)} • Line: ${((item.unitCost||0)*(item.qty||0)).toFixed(2)}
                </Text>
              </View>
            )}
            ListFooterComponent={
              <View style={{padding:16,borderTopWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'}}>
                <Text style={{fontWeight:'800'}}>Totals</Text>
                <Text style={{color:'#6B7280',marginTop:4}}>Ordered: ${totalOrdered.toFixed(2)}</Text>
              </View>
            }
          />
        )
      )}

      <ReceiveOptionsModal
        visible={receiveOpen}
        onClose={()=>setReceiveOpen(false)}
        onCsvSelected={pickCsvAndProcess}
        orderId={orderId}
        orderLines={lines}
      />
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{flex:1,backgroundColor:'#fff'},
  top:{padding:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  title:{fontSize:18,fontWeight:'800'},
  meta:{color:'#6B7280',marginTop:2},
  receiveBtn:{backgroundColor:'#111827',paddingVertical:10,paddingHorizontal:16,borderRadius:8},
  receiveBtnText:{color:'#fff',fontWeight:'800'},
  loading:{flex:1,justifyContent:'center',alignItems:'center'},
});
