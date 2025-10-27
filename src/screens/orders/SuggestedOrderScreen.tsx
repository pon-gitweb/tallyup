// src/screens/orders/SuggestedOrderScreen.tsx
// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity,
  RefreshControl, Alert, Modal, Platform, ToastAndroid
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  getFirestore, collection, getDocs,
  writeBatch, doc, query, where, serverTimestamp
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { buildSuggestedOrdersInMemory } from '../../services/orders/suggest';
import { runAISuggest } from '../../services/orders/suggestAI';
import { createDraftsFromSuggestions } from '../../services/orders/createFromSuggestions';
import { checkEntitlement } from '../../services/entitlement';
import PaymentSheet from '../../components/paywall/PaymentSheet';

const dlog = (...a:any[]) => console.log('[Suggested]', ...a);
const NO_SUPPLIER_KEYS = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);
const n = (v:any,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d;};
const m1=(v:any)=>{const x=Number(v);return Number.isFinite(x)?Math.max(1,Math.round(x)):1;};

const SUBMITTED_SET = new Set(['submitted','sent','placed','approved','awaiting','processing']);
const RECEIVED_SET  = new Set(['received','complete','closed']);

type BucketRow = { id:string; supplierId:string; supplierName:string; itemsCount:number };

function dedupeByProductId(lines:any[]){
  const seen=new Set<string>(); const out:any[]=[];
  for(const l of Array.isArray(lines)?lines:[]){
    const pid=String(l?.productId||''); if(!pid||seen.has(pid))continue;
    seen.add(pid); out.push(l);
  }
  return out;
}

function buildSuggestionKey(supplierId:string|null, lines:any[]){
  const parts=(Array.isArray(lines)?lines:[])
    .map(l=>`${String(l?.productId||'')}:${m1(l?.qty)}`)
    .filter(Boolean).sort().join(',');
  return `${supplierId ?? 'unassigned'}|${parts}`;
}

export default function SuggestedOrderScreen(){
  const nav=useNavigation<any>();
  const venueId=useVenueId();
  const db=getFirestore();
  const uid=getAuth()?.currentUser?.uid||'dev';

  const [refreshing,setRefreshing]=useState(false);
  const [rows,setRows]=useState<BucketRow[]>([]);
  const [snapshot,setSnapshot]=useState<any>(null);

  const [existingKeys,setExistingKeys]=useState<Set<string>>(new Set());
  const [supplierPreview,setSupplierPreview]=useState<any>(null);
  const [supplierOpen,setSupplierOpen]=useState(false);

  const [entitled,setEntitled]=useState(false);
  const [payOpen,setPayOpen]=useState(false);
  const [mode,setMode]=useState<'math'|'ai'>('math');
  const [aiMeter,setAiMeter]=useState<{aiRemaining?:number;retryAfterSeconds?:number}|null>(null);

  const didInitRef=useRef(false);

  const normalizeCompat=useCallback((compat:any)=>{
    const raw:Record<string,{lines:any[];supplierName?:string}>=
      (compat&&compat.buckets&&typeof compat.buckets==='object')?compat.buckets:(compat||{});
    const unStart:any[]=Array.isArray(compat?.unassigned?.lines)?compat.unassigned.lines:[];
    const unPool:any[]=[...unStart];
    const real:Record<string,{lines:any[];supplierName?:string}>={};
    Object.entries(raw).forEach(([key,b]:any)=>{
      const lines=Array.isArray(b?.lines)?b.lines:[];
      if(NO_SUPPLIER_KEYS.has(String(key))){ if(lines.length)unPool.push(...lines);return;}
      if(lines.length>0)real[key]={lines:dedupeByProductId(lines),supplierName:b?.supplierName};
    });
    const unassigned={lines:dedupeByProductId(unPool)};
    return {buckets:real,unassigned};
  },[]);

  const computeRowsFromSnapshot=useCallback(async(snapCompat:any)=>{
    let { buckets,unassigned }=snapCompat;
    const supMap:Record<string,string>={};
    const supSnap=await getDocs(collection(db,'venues',venueId,'suppliers'));
    supSnap.forEach(d=>{ supMap[d.id]=String((d.data() as any)?.name || 'Supplier'); });
    const tmp:BucketRow[]=[];
    if(Array.isArray(unassigned?.lines)&&unassigned.lines.length>0){
      tmp.push({ id:'unassigned',supplierId:'unassigned',supplierName:'Unassigned',itemsCount:unassigned.lines.length });
    }
    Object.entries(buckets||{}).forEach(([sid,b]:any)=>{
      const c=Array.isArray(b?.lines)?b.lines.length:0;
      if(c<=0)return;
      const label=b?.supplierName||supMap[sid]||`#${String(sid).slice(-4)}`;
      tmp.push({ id:sid,supplierId:sid,supplierName:label,itemsCount:c });
    });
    const uIdx=tmp.findIndex(r=>r.id==='unassigned');
    const sorted=tmp.filter(r=>r.id!=='unassigned').sort((a,b)=>(b.itemsCount||0)-(a.itemsCount||0));
    setRows(uIdx>=0?[tmp[uIdx],...sorted]:sorted);
    setSnapshot({buckets,unassigned});
  },[db,venueId]);

  // Venue-wide dedupe: draft + submitted + received
  const loadExistingSuggestionKeys=useCallback(async()=>{
    if(!venueId){setExistingKeys(new Set());return;}
    const ref=collection(db,'venues',venueId,'orders');
    const snap=await getDocs(ref);
    const keys=new Set<string>();
    snap.forEach(d=>{
      const data:any=d.data()||{};
      const status=String(data.displayStatus||data.status||'draft').toLowerCase();
      const isDraft = status==='draft';
      const isSubmitted = SUBMITTED_SET.has(status);
      const isReceived  = RECEIVED_SET.has(status);
      if((isDraft || isSubmitted || isReceived) && data?.source==='suggestions' && typeof data?.suggestionKey==='string'){
        keys.add(data.suggestionKey);
      }
    });
    setExistingKeys(keys);
    dlog('existingKeys', keys.size, 'sample', keys.size ? Array.from(keys)[0] : '(none)');
  },[db,venueId]);

  const doRefreshRaw=useCallback(async()=>{
    if(!venueId){setRows([]);setSnapshot(null);setExistingKeys(new Set());return;}
    await loadExistingSuggestionKeys();
    const compat:any=await buildSuggestedOrdersInMemory(venueId,{ roundToPack:true, defaultParIfMissing:6 });
    const graduated=normalizeCompat(compat);
    await computeRowsFromSnapshot(graduated);
  },[venueId,loadExistingSuggestionKeys,computeRowsFromSnapshot,normalizeCompat]);

  const doRefresh=useCallback(async()=>{
    setRefreshing(true);
    try{ await doRefreshRaw(); } finally{ setRefreshing(false); }
  },[doRefreshRaw]);

  useEffect(()=>{
    if(!venueId||didInitRef.current)return;
    didInitRef.current=true;
    (async()=>{
      setRefreshing(true);
      try{
        try{ const ent=await checkEntitlement(venueId); setEntitled(!!ent.entitled); }catch{}
        await doRefreshRaw();
      } finally { setRefreshing(false); }
    })();
  },[venueId,doRefreshRaw]);

  // Also refresh on focus (handles relaunch/login switch)
  useFocusEffect(useCallback(()=>{
    let cancelled=false;
    (async()=>{
      try{
        setRefreshing(true);
        await doRefreshRaw();
      } finally {
        if(!cancelled) setRefreshing(false);
      }
    })();
    return ()=>{ cancelled=true; };
  },[doRefreshRaw]));

  const openSupplierPreview=useCallback((supplierId:string,supplierName:string)=>{
    if(!snapshot)return;
    const bucket=snapshot.buckets?.[supplierId];
    const lines=Array.isArray(bucket?.lines)?bucket.lines:[];
    const previewLines=lines.map((l:any)=>({
      productId:String(l.productId),
      productName:String(l.productName??l.name??l.productId??''),
      qty:m1(l.qty),
      cost:n(l.unitCost??l.cost??0,0),
      packSize:Number.isFinite(l?.packSize)?Number(l?.packSize):null,
      dept: l?.dept ?? null,
    }));
    const suggestionKey=buildSuggestionKey(supplierId==='unassigned'?null:supplierId,previewLines);
    const alreadyDrafted=existingKeys.has(suggestionKey);
    dlog('preview key', suggestionKey, 'alreadyDrafted?', alreadyDrafted);
    setSupplierPreview({ supplierId,supplierName,lines:previewLines,suggestionKey,alreadyDrafted });
    setSupplierOpen(true);
  },[snapshot,existingKeys]);

  // Find first existing draft for supplier (null/unassigned queries all drafts)
  const findExistingDraftForSupplier = useCallback(async(supplierId:string|null)=>{
    if(!venueId) return null;
    const ref = collection(db, 'venues', venueId, 'orders');
    let qRef = query(ref, where('status','==','draft'));
    if(supplierId && supplierId !== 'unassigned'){
      qRef = query(ref, where('status','==','draft'), where('supplierId','==',supplierId));
    }
    const snap = await getDocs(qRef);
    let firstId:string|null = null;
    snap.forEach(d=>{ if(!firstId) firstId = d.id; });
    return firstId;
  },[db,venueId]);

  // Merge the given lines into an existing draft (set/merge per productId)
  const mergeIntoExistingDraft = useCallback(async(orderId:string, lines:any[])=>{
    const batch = writeBatch(db);
    const orderRef = doc(db, 'venues', venueId!, 'orders', orderId);
    const safeQty=(q:any)=>Math.max(1,Math.round(Number(q)||1));
    for(const l of (Array.isArray(lines)?lines:[])){
      const unitCost = Number.isFinite(l?.cost)?Number(l.cost):0;
      const lr = doc(orderRef, 'lines', String(l.productId));
      batch.set(lr, {
        productId:String(l.productId),
        name:String(l.productName??l.name??l.productId??''),
        qty:safeQty(l.qty),
        unitCost,
        packSize:Number.isFinite(l?.packSize)?Number(l.packSize):null,
        reason:l?.reason??null,
        needsPar:!!l?.needsPar,
        needsSupplier:!!l?.needsSupplier,
        dept: l?.dept ?? null,
      }, { merge:true });
    }
    batch.update(orderRef,{ updatedAt:serverTimestamp(), displayStatus:'draft', status:'draft' });
    await batch.commit();
  },[db,venueId]);

  // Merge-aware draft creation
  const createDraftForPreview=useCallback(async()=>{
    if(!venueId||!supplierPreview)return;
    try{
      const key = supplierPreview.supplierId || 'unassigned';
      const existingId = await findExistingDraftForSupplier(key==='unassigned'?null:key);

      const doCreateSeparate = async()=>{
        const legacyMap = {
          [key]: { supplierName: supplierPreview.supplierName ?? null, lines: supplierPreview.lines || [] },
        };
        const res = await createDraftsFromSuggestions(venueId, legacyMap, { createdBy: uid });
        if (Array.isArray(res?.created) && res.created.length > 0) {
          setExistingKeys(prev=>{ const next=new Set(prev); next.add(supplierPreview.suggestionKey); return next; });
        }
        setSupplierOpen(false);
        Alert.alert('Draft saved',`Draft saved — find it in Orders. (${supplierPreview.supplierName||'supplier'}, ${supplierPreview.lines.length} line${supplierPreview.lines.length===1?'':'s'})`);
        if (Platform.OS==='android') ToastAndroid.show('Draft saved in Orders', ToastAndroid.SHORT);
      };

      if(existingId){
        Alert.alert(
          'Draft exists for this supplier',
          'Would you like to MERGE these lines into the existing draft, or create a SEPARATE draft?',
          [
            { text:'Cancel', style:'cancel' },
            { text:'Separate', onPress: doCreateSeparate },
            { text:'Merge', style:'default', onPress: async()=>{
                await mergeIntoExistingDraft(existingId, supplierPreview.lines||[]);
                setSupplierOpen(false);
                Alert.alert('Merged', 'Lines merged into the existing draft.');
                if (Platform.OS==='android') ToastAndroid.show('Merged into existing draft', ToastAndroid.SHORT);
              }
            },
          ]
        );
        return;
      }

      await doCreateSeparate();
    }catch(e:any){
      Alert.alert('Could not create draft',e?.message||'Please try again.');
    }
  },[venueId,supplierPreview,uid,findExistingDraftForSupplier,mergeIntoExistingDraft]);

  const onToggleMode=useCallback(async(nextMode:'math'|'ai')=>{
    if(nextMode==='ai'&&!entitled){ setPayOpen(true); return; }
    setMode(nextMode);
    setAiMeter(null);
    setRefreshing(true);
    try{
      if(nextMode==='math'){
        await doRefreshRaw();
      } else {
        const res=await runAISuggest(venueId,{historyDays:28,k:3,max:400},'ai');
        const graduated=normalizeCompat(res);
        await computeRowsFromSnapshot(graduated);
        if(res?.meter)setAiMeter(res.meter);
      }
    }catch(e:any){
      Alert.alert(nextMode==='ai'?'AI unavailable':'Refresh failed',e?.message||'Please try again later.');
    }finally{
      setRefreshing(false);
    }
  },[venueId,entitled,doRefreshRaw,computeRowsFromSnapshot,normalizeCompat]);

  const keyExtractor=useCallback((r:BucketRow)=>String(r.id),[]);
  const renderRow=useCallback(({item:row}:{item:BucketRow})=>(
    <TouchableOpacity style={[S.row,row.supplierId==='unassigned'?S.rowUnassigned:null]} onPress={()=>openSupplierPreview(row.supplierId,row.supplierName)}>
      <View style={{flex:1}}>
        <Text style={S.rowTitle}>{row.supplierName}</Text>
        <Text style={S.rowSub}>{row.itemsCount} item{row.itemsCount===1?'':'s'}</Text>
      </View>
      <Text style={S.chev}>›</Text>
    </TouchableOpacity>
  ),[openSupplierPreview]);

  const HeaderRight=useMemo(()=>(
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
      <View style={[S.badge,entitled?S.badgeOk:S.badgeLock]}>
        <Text style={[S.badgeText,entitled?S.badgeTextOk:S.badgeTextLock]}>{entitled?'AI enabled':'AI locked'}</Text>
      </View>
      <View style={S.segmentWrap}>
        <TouchableOpacity onPress={()=>onToggleMode('math')} style={[S.segmentBtn,mode==='math'&&S.segmentActive]}>
          <Text style={[S.segmentText,mode==='math'&&S.segmentTextActive]}>Math</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={()=>onToggleMode('ai')} style={[S.segmentBtn,mode==='ai'&&S.segmentActive]}>
          <Text style={[S.segmentText,mode==='ai'&&S.segmentTextActive]}>AI (beta)</Text>
        </TouchableOpacity>
      </View>
      {mode==='ai'&&!!aiMeter?.aiRemaining&&(
        <View style={S.meterPill}><Text style={S.meterText}>AI calls left: {aiMeter.aiRemaining}</Text></View>
      )}
    </View>
  ),[entitled,mode,aiMeter,onToggleMode]);

  const listHeader=useMemo(()=>(
    <View style={S.header}>
      <View style={{flex:1}}>
        <Text style={S.title}>Suggested Orders</Text>
        <Text style={S.rowSub}>Math first. Use AI when you want.</Text>
      </View>
      <IdentityBadge/>
    </View>
  ),[]);

  return (
    <View style={S.wrap}>
      <View style={S.topBar}>{HeaderRight}</View>
      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        ListHeaderComponent={listHeader}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh}/>}
        ListEmptyComponent={!refreshing?(
          <View style={S.empty}>
            <Text style={S.emptyTitle}>All items are at or above PAR</Text>
            <Text style={S.emptyText}>Based on your most recent stock take and PARs, there’s nothing to top up right now.</Text>
          </View>
        ):null}
      />

      {/* Supplier Preview */}
      <Modal
        visible={supplierOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSupplierOpen(false)}
      >
        <View style={S.modalBack}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>
              {supplierPreview?.supplierName || 'Supplier'} · {supplierPreview?.lines?.length || 0} item
              {(supplierPreview?.lines?.length || 0) === 1 ? '' : 's'}
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled">
              {(supplierPreview?.lines || []).map((l: any) => (
                <View key={l.productId} style={S.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.lineName}>{l.productName || l.productId}</Text>
                    <Text style={S.rowSub}>
                      Qty {l.qty}
                      {Number.isFinite(l?.packSize) && l.packSize ? ` · Pack ${l.packSize}` : ''}
                      {Number.isFinite(l?.cost) && l.cost ? ` · $${Number(l.cost).toFixed(2)}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
              {(supplierPreview?.lines?.length || 0) === 0 && (
                <Text style={S.rowSub}>No lines to show.</Text>
              )}
            </ScrollView>

            {/* Actions */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => setSupplierOpen(false)}
                style={[S.smallBtn, { backgroundColor: '#e5e7eb' }]}
              >
                <Text style={[S.smallBtnText, { color: '#111827' }]}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={createDraftForPreview}
                disabled={!!supplierPreview?.alreadyDrafted}
                style={[
                  S.smallBtn,
                  supplierPreview?.alreadyDrafted && { opacity: 0.5 },
                ]}
              >
                <Text style={S.smallBtnText}>
                  {supplierPreview?.alreadyDrafted ? 'Already drafted' : 'Create draft'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Paywall (AI gating) */}
      <PaymentSheet
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        venueId={venueId || 'unknown'}
        uid={uid}
        onEntitled={() => {
          setEntitled(true);
          setPayOpen(false);
          setMode('ai');
          onToggleMode('ai');
        }}
      />
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  topBar: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee'
  },
  header: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  title: { fontSize: 22, fontWeight: '800' },

  badge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  badgeOk: { backgroundColor: '#ecfdf5', borderColor: '#10b981' },
  badgeLock: { backgroundColor: '#fef2f2', borderColor: '#ef4444' },
  badgeText: { fontSize: 11, fontWeight: '800' },
  badgeTextOk: { color: '#065f46' },
  badgeTextLock: { color: '#7f1d1d' },

  segmentWrap: { flexDirection: 'row', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 999, overflow: 'hidden' },
  segmentBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  segmentActive: { backgroundColor: '#111827' },
  segmentText: { fontSize: 12, fontWeight: '800', color: '#111827' },
  segmentTextActive: { color: '#fff' },

  meterPill: { backgroundColor: '#eef2ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  meterText: { color: '#3730a3', fontSize: 11, fontWeight: '700' },

  row: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb',
    flexDirection: 'row', alignItems: 'center'
  },
  rowUnassigned: { backgroundColor: '#f9fafb' },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  chev: { fontSize: 24, color: '#9ca3af', marginLeft: 8 },

  empty: { paddingTop: 48, paddingHorizontal: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyText: { fontSize: 13, color: '#6b7280' },

  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee' },
  lineName: { fontSize: 14, fontWeight: '600' },

  smallBtn: { backgroundColor: '#111827', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '75%' },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
});
