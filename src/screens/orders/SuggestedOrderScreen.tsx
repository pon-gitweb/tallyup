// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Alert, Modal, Pressable, TextInput, KeyboardAvoidingView, Platform, ToastAndroid,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc,
  serverTimestamp, query as fsQuery, where, documentId, orderBy,
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { buildSuggestedOrdersInMemory } from '../../services/orders/suggest';
import { fetchAISuggestions } from '../../services/orders/suggestAI';
import { getEntitlement, validatePromo } from '../../services/entitlement';
import { logSuggestShape, logProductDoc } from '../../dev/soDebug';

const DEBUG_SO = true;
const NO_SUPPLIER_KEYS = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);
const n = (v:any,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d;};
const m1 = (v:any)=>{const x=Number(v);return Number.isFinite(x)?Math.max(1,Math.round(x)):1;};
const s = (v:any,d='')=> typeof v==='string'? v:d;

type BucketRow = { id:string; supplierId:string; supplierName:string; itemsCount:number };

function dedupeByProductId(lines:any[]){ const seen=new Set<string>(); const out:any[]=[];
  for (const l of Array.isArray(lines)?lines:[]){ const pid=String(l?.productId??''); if(!pid||seen.has(pid)) continue; seen.add(pid); out.push(l); }
  return out;
}
function buildSuggestionKey(supplierId:string, lines:any[]){ const parts=(Array.isArray(lines)?lines:[])
  .map(l=>`${String(l?.productId||'')}:${m1(l?.qty)}`).filter(Boolean).sort().join(','); return `${supplierId}|${parts}`; }

async function createDraft(db:any, venueId:string, supplierId:string, supplierName:string|null, suggestions:any[], suggestionKey:string){
  const now = serverTimestamp();
  const orderRef = await addDoc(collection(db,'venues',venueId,'orders'), {
    status:'draft', displayStatus:'Draft', source:'suggestions',
    supplierId, supplierName: supplierName||null,
    createdAt: now, updatedAt: now,
    linesCount: Array.isArray(suggestions)? suggestions.length:0,
    suggestionKey,
  });
  for (const raw of suggestions){
    const productId=String(raw?.productId||'').trim(); if(!productId) continue;
    const name=String(raw?.productName||raw?.name||productId);
    const qty=Math.max(1,Math.round(Number(raw?.qty??0)));
    const unitCost=Number(raw?.cost??raw?.unitCost??0);
    const packSize=Number.isFinite(raw?.packSize)? Number(raw?.packSize):null;
    const line:any={ productId,name,qty,unitCost,updatedAt:now }; if(packSize!=null) line.packSize=packSize;
    await setDoc(doc(db,'venues',venueId,'orders',orderRef.id,'lines',productId), line, { merge:true });
  }
  return { id: orderRef.id };
}

async function assignSupplierSmart(db:any, venueId:string, productId:string, s:{id:string;name:string}){
  const now=serverTimestamp(); const pref=doc(db,'venues',venueId,'products',productId);
  const snap=await getDoc(pref); if (snap.exists()){
    await setDoc(pref,{ supplierId:s.id, supplierName:s.name, supplier:{id:s.id,name:s.name}, updatedAt:now },{merge:true});
  }
}
async function setParSmart(db:any, venueId:string, productId:string, par:number){
  const now=serverTimestamp(); const pref=doc(db,'venues',venueId,'products',productId);
  const snap=await getDoc(pref); if (snap.exists()){
    await setDoc(pref,{ par:Math.round(par), updatedAt:now },{merge:true});
  }
}
async function getLastStockTakeCompletedAt(db:any, venueId:string){
  let latest:any=null;
  const deps=await getDocs(collection(db,'venues',venueId,'departments'));
  for (const dep of deps.docs){
    const areas=await getDocs(collection(db,'venues',venueId,'departments',dep.id,'areas'));
    areas.forEach(a=>{
      const d:any=a.data()||{}; const c=d?.completedAt;
      if (c && typeof c.toMillis==='function'){ const ms=c.toMillis(); if(latest==null||ms>latest) latest=ms; }
    });
  }
  return latest;
}

const looksLikeLine=(v:any)=> v && typeof v==='object' && ('productId'in v || 'qty'in v || 'productName'in v || 'name'in v);
function extractLines(block:any):any[]{
  if(!block||typeof block!=='object') return [];
  const out:any[]=[];
  if (Array.isArray(block.lines)){
    for (const el of block.lines){ if (Array.isArray(el)) out.push(...el.filter(looksLikeLine)); else if (looksLikeLine(el)) out.push(el); }
  }
  if (block.items && typeof block.items==='object'){
    for (const v of Object.values(block.items)){ if (Array.isArray(v)) out.push(...v.filter(looksLikeLine)); else if (looksLikeLine(v)) out.push(v); }
  }
  for (const [k,v] of Object.entries(block)){ if (k==='lines'||k==='items'||k==='supplierName') continue; if (looksLikeLine(v)) out.push(v); }
  const seen=new Set<string>(); const dedup:any[]=[];
  for (const ln of out){ const pid=String(ln?.productId??''); const key=pid||JSON.stringify(ln); if (seen.has(key)) continue; seen.add(key); dedup.push(ln); }
  return dedup;
}

export default function SuggestedOrderScreen(){
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [refreshing,setRefreshing]=useState(false);
  const [rows,setRows]=useState<BucketRow[]>([]);
  const [snapshot,setSnapshot]=useState<any>(null);
  const [existingKeys,setExistingKeys]=useState<Set<string>>(new Set());

  const [unassignedOpen,setUnassignedOpen]=useState(false);
  const [supplierOpen,setSupplierOpen]=useState(false);
  const [supplierPreview,setSupplierPreview]=useState<any>(null);

  const [pickerOpen,setPickerOpen]=useState(false);
  const [pickerSuppliers,setPickerSuppliers]=useState<{id:string;name:string}[]>([]);
  const [pickerForProductId,setPickerForProductId]=useState<string|null>(null);

  const [parOpen,setParOpen]=useState(false);
  const [parValue,setParValue]=useState('');
  const [parProductId,setParProductId]=useState<string|null>(null);

  const [entitled,setEntitled]=useState(false);
  const [entitlementChecked,setEntitlementChecked]=useState(false);
  const [promoOpen,setPromoOpen]=useState(false);
  const [promoCode,setPromoCode]=useState('');
  const [aiStamp,setAiStamp]=useState<number|null>(null);

  function normalizeCompat(compat:any){
    const unStart:any[] = Array.isArray(compat?.unassigned?.lines)
      ? compat.unassigned.lines
      : Array.isArray(compat?.unassigned)
      ? compat.unassigned
      : [];
    const unPool:any[]=[...unStart];

    const rawBucketsObj:Record<string,any> =
      (compat && compat.buckets && typeof compat.buckets==='object') ? compat.buckets
      : (compat && typeof compat==='object') ? compat
      : {};

    const real:Record<string,{lines:any[]; supplierName?:string}> = {};
    Object.entries(rawBucketsObj).forEach(([key,b]:any)=>{
      if (key==='unassigned' && (b?.lines || Array.isArray(b))){
        const extra = Array.isArray(b?.lines)? b.lines : Array.isArray(b)? b : [];
        if (extra.length) unPool.push(...extra);
        return;
      }
      const lines = extractLines(b);
      if (!lines.length) return;
      if (NO_SUPPLIER_KEYS.has(String(key))){ unPool.push(...lines); return; }
      real[key] = { lines: dedupeByProductId(lines), supplierName: b?.supplierName || b?.name || undefined };
    });

    return { buckets: real, unassigned: { lines: dedupeByProductId(unPool) } };
  }

  async function graduateUnassignedUsingProducts(venueId:string, buckets:Record<string,{lines:any[];supplierName?:string}>, unassigned:{lines:any[]}){
    const lines = Array.isArray(unassigned?.lines)? unassigned.lines : [];
    if (!lines.length) return { buckets, unassigned };
    const productIds = Array.from(new Set(lines.map((l:any)=>String(l?.productId||'')).filter(Boolean)));
    const prodsMap:Record<string,{supplierId?:string;supplierName?:string;par?:number}> = {};
    for (let i=0;i<productIds.length;i+=10){
      const chunk=productIds.slice(i,i+10);
      const q=fsQuery(collection(db,'venues',venueId,'products'), where(documentId(),'in',chunk));
      const snap=await getDocs(q);
      snap.forEach(d=>{
        const data:any=d.data()||{};
        prodsMap[d.id]={ supplierId:data?.supplierId||data?.supplier?.id||undefined, supplierName:data?.supplierName||data?.supplier?.name||undefined, par:Number.isFinite(data?.par)?Number(data.par):undefined };
      });
    }
    const kept:any[]=[]; const out={...buckets};
    for (const l of lines){
      const pid=String(l?.productId||''); if(!pid) continue;
      const p=prodsMap[pid]; const hasSupplier=!!p?.supplierId;
      if (hasSupplier){
        const sid=String(p!.supplierId); const sname=p?.supplierName || out[sid]?.supplierName || undefined;
        if (!out[sid]) out[sid] = { lines:[], supplierName:sname };
        const existing=new Set((out[sid].lines||[]).map((x:any)=>String(x?.productId||'')));
        if (!existing.has(pid)) out[sid].lines.push(l);
      } else kept.push(l);
    }
    Object.keys(out).forEach(k=>{ out[k].lines = dedupeByProductId(out[k].lines||[]); });
    return { buckets: out, unassigned:{ lines: kept } };
  }

  const loadExistingSuggestionKeys = useCallback(async ()=>{
    if (!venueId){ setExistingKeys(new Set()); return; }
    const lastCompletedMs = await getLastStockTakeCompletedAt(db, venueId);
    const sevenDaysAgo = Date.now()-7*24*60*60*1000;
    const cutoffMs = lastCompletedMs ?? sevenDaysAgo;

    const ref=collection(db,'venues',venueId,'orders');
    const snap=await getDocs(fsQuery(ref, orderBy('createdAt','desc')));
    const keys=new Set<string>();
    snap.forEach(d=>{
      const data:any=d.data()||{};
      const status=(data.displayStatus||data.status||'draft').toLowerCase();
      const ts=data?.createdAt; const ms=ts?.toMillis? ts.toMillis():0;
      if (status==='draft' && ms>=cutoffMs && data?.source==='suggestions' && typeof data?.suggestionKey==='string') keys.add(data.suggestionKey);
    });
    setExistingKeys(keys);
  },[db,venueId]);

  const doRefresh = useCallback(async ()=>{
    if (!venueId){ setRows([]); setSnapshot(null); return; }
    setRefreshing(true);
    try{
      await loadExistingSuggestionKeys();
      const compat:any = await buildSuggestedOrdersInMemory(venueId, { roundToPack:true, defaultParIfMissing:6 });
      if (DEBUG_SO) logSuggestShape('compat', compat);

      let { buckets, unassigned } = normalizeCompat(compat);

      if (DEBUG_SO){
        const firstUn = unassigned?.lines?.[0] || null;
        const bks = Object.keys(buckets||{});
        const firstBk = bks[0];
        const firstBkLine = firstBk ? (buckets[firstBk]?.lines?.[0]||null) : null;
        const pid = String(firstUn?.productId || firstBkLine?.productId || '');
        if (pid) { logProductDoc(venueId, pid); }
      }

      const graduated = await graduateUnassignedUsingProducts(venueId, buckets, unassigned);
      buckets = graduated.buckets; unassigned = graduated.unassigned;

      const supMap:Record<string,string>={};
      const supSnap=await getDocs(collection(db,'venues',venueId,'suppliers'));
      supSnap.forEach(d=>{ supMap[d.id]=String((d.data() as any)?.name||'Supplier'); });

      const tmp:BucketRow[]=[];
      if (Array.isArray(unassigned?.lines)&&unassigned.lines.length>0){
        tmp.push({ id:'unassigned', supplierId:'unassigned', supplierName:'Unassigned', itemsCount:unassigned.lines.length });
      }
      Object.entries(buckets).forEach(([sid,b]:any)=>{
        const c=Array.isArray(b?.lines)? b.lines.length:0; if (c<=0) return;
        const label=b?.supplierName||supMap[sid]||`#${String(sid).slice(-4)}`;
        tmp.push({ id:sid, supplierId:sid, supplierName:label, itemsCount:c });
      });
      const uIdx=tmp.findIndex(r=>r.id==='unassigned');
      const sorted=tmp.filter(r=>r.id!=='unassigned').sort((a,b)=>(b.itemsCount||0)-(a.itemsCount||0));
      setRows(uIdx>=0?[tmp[uIdx],...sorted]:sorted);
      setSnapshot({ buckets, unassigned });
    } finally { setRefreshing(false); }
  },[venueId,db,loadExistingSuggestionKeys]);

  useEffect(()=>{ if(venueId) doRefresh(); },[venueId]);

  useEffect(()=>{ (async ()=>{
    const e=await getEntitlement();
    setEntitled(!!e?.entitled);
    setEntitlementChecked(true);
  })(); },[]);

  const openSupplierPreview = useCallback((supplierId:string, supplierName:string)=>{
    if (!snapshot) return;
    const bucket=snapshot.buckets?.[supplierId];
    const lines=Array.isArray(bucket?.lines)? bucket.lines: [];
    const previewLines = lines.map((l:any)=>({
      productId:String(l.productId),
      productName:String(l.productName ?? l.name ?? l.productId ?? ''),
      qty:m1(l.qty),
      cost:n(l.unitCost ?? l.cost ?? 0, 0),
      packSize:Number.isFinite(l?.packSize)? Number(l.packSize):null,
    }));
    const suggestionKey=buildSuggestionKey(supplierId, previewLines);
    const alreadyDrafted=existingKeys.has(suggestionKey);
    setSupplierPreview({ supplierId, supplierName, lines:previewLines, suggestionKey, alreadyDrafted });
    setSupplierOpen(true);
  },[snapshot,existingKeys]);

  const createDraftForPreview = useCallback(async ()=>{
    if (!venueId || !supplierPreview) return;
    if (supplierPreview.alreadyDrafted){
      Alert.alert('Already drafted','A draft for this supplier’s current suggestion has already been created. Find it in Orders.',[{text:'OK'}]);
      return;
    }
    try{
      const suggestions=supplierPreview.lines.map((l:any)=>({
        productId:String(l.productId),
        productName:String(l.productName||l.name||l.productId),
        qty:Math.max(1,Math.round(Number(l.qty||0))),
        cost:Number(l.cost||0),
        packSize:Number.isFinite(l.packSize)? Number(l.packSize):null,
      }));
      const res=await createDraft(db, venueId, supplierPreview.supplierId, supplierPreview.supplierName, suggestions, supplierPreview.suggestionKey);
      const orderId=res?.id; if (!orderId) throw new Error('No order id');
      setSupplierOpen(false);
      const msg=`Draft saved — find it in Orders. (${supplierPreview.supplierName || 'supplier'}, ${suggestions.length} line${suggestions.length===1?'':'s'})`;
      Alert.alert('Draft saved', msg, [{ text:'OK', onPress:()=>{ if(Platform.OS==='android') ToastAndroid.show('Draft saved in Orders', ToastAndroid.SHORT); } }]);
      setExistingKeys(prev=>{ const next=new Set(prev); next.add(supplierPreview.suggestionKey); return next; });
    }catch(e:any){ Alert.alert('Could not create draft', e?.message||'Please try again.'); }
  },[venueId,supplierPreview,db]);

  const openSupplierPicker = useCallback(async (candidateId:string)=>{
    if (!venueId) return;
    const snap=await getDocs(collection(db,'venues',venueId,'suppliers'));
    const list:{id:string;name:string}[]=[];
    snap.forEach(d=> list.push({ id:d.id, name:String((d.data() as any)?.name||'Supplier') }));
    setPickerSuppliers(list.filter(s=> s.name.toLowerCase()!=='unassigned'));
    setPickerForProductId(candidateId);
    setPickerOpen(true);
  },[db,venueId]);

  const pickSupplier = useCallback( async (s:{id:string;name:string})=>{
    if (!venueId || !pickerForProductId) return;
    try{
      await assignSupplierSmart(db, venueId, pickerForProductId, s);
      setPickerOpen(false); setPickerForProductId(null);
      Alert.alert('Saved','Supplier assigned.');
      await doRefresh();
    }catch(e:any){ Alert.alert('Could not save', e?.message||'Please try again.'); }
  },[venueId,pickerForProductId,db,doRefresh]);

  const setParInline = useCallback((candidateId:string)=>{ setParProductId(candidateId); setParValue(''); setParOpen(true); },[]);

  const savePar = useCallback(async ()=>{
    if (!venueId || !parProductId) return;
    const val=Number(parValue);
    if (!Number.isFinite(val) || val<=0){ Alert.alert('Invalid','Enter a positive number'); return; }
    try{
      await setParSmart(db, venueId, parProductId, Math.round(val));
      setParOpen(false); setParProductId(null); setParValue('');
      Alert.alert('Saved','PAR updated.');
      await doRefresh();
    }catch(e:any){ Alert.alert('Could not save', e?.message||'Please try again.'); }
  },[venueId,parProductId,parValue,db,doRefresh]);

  const runAI = useCallback(async ()=>{
    if (!venueId) return;
    if (!entitlementChecked){ Alert.alert('Please wait','Checking your AI access…'); return; }
    if (!entitled){ setPromoOpen(true); return; }

    setRefreshing(true);
    try{
      await loadExistingSuggestionKeys();
      const ai:any = await fetchAISuggestions(venueId, { historyDays:28 });
      if (DEBUG_SO) logSuggestShape('ai', ai);

      let { buckets, unassigned } = normalizeCompat(ai);
      const graduated=await graduateUnassignedUsingProducts(venueId, buckets, unassigned);
      buckets=graduated.buckets; unassigned=graduated.unassigned;

      const supMap:Record<string,string>={};
      const supSnap=await getDocs(collection(db,'venues',venueId,'suppliers'));
      supSnap.forEach(d=>{ supMap[d.id]=String((d.data() as any)?.name||'Supplier'); });

      const tmp:BucketRow[]=[];
      if (Array.isArray(unassigned?.lines)&&unassigned.lines.length>0){
        tmp.push({ id:'unassigned', supplierId:'unassigned', supplierName:'Unassigned', itemsCount:unassigned.lines.length });
      }
      Object.entries(buckets).forEach(([sid,b]:any)=>{
        const c=Array.isArray(b?.lines)? b.lines.length:0; if (c<=0) return;
        const label=b?.supplierName||supMap[sid]||`#${String(sid).slice(-4)}`;
        tmp.push({ id:sid, supplierId:sid, supplierName:label, itemsCount:c });
      });
      const uIdx=tmp.findIndex(r=>r.id==='unassigned');
      const sorted=tmp.filter(r=>r.id!=='unassigned').sort((a,b)=>(b.itemsCount||0)-(a.itemsCount||0));
      setRows(uIdx>=0?[tmp[uIdx],...sorted]:sorted);
      setSnapshot({ buckets, unassigned });

      setAiStamp(Date.now());
      if (Platform.OS==='android') ToastAndroid.show('AI suggestions loaded', ToastAndroid.SHORT);
    }catch(e:any){ Alert.alert('AI unavailable', e?.message||'Please try again.'); }
    finally{ setRefreshing(false); }
  },[venueId,entitled,entitlementChecked,loadExistingSuggestionKeys]);

  const applyPromo = useCallback(async ()=>{
    if (!promoCode.trim()){ Alert.alert('Enter code','Please enter your promo code.'); return; }
    try{
      const res=await validatePromo(promoCode.trim());
      if (!res.ok) throw new Error('Invalid code');
      setEntitled(!!res.entitled || true);
      setPromoOpen(false); setPromoCode('');
      Alert.alert('Unlocked','AI suggestions are now enabled.');
    }catch(e:any){ Alert.alert('Could not apply code', e?.message||'Please try another code.'); }
  },[promoCode]);

  const keyExtractor=useCallback((r:BucketRow)=>String(r.id),[]);
  const openUnassigned=useCallback(()=>{ if (snapshot?.unassigned?.lines?.length) setUnassignedOpen(true); },[snapshot]);

  const renderRow=useCallback(({item:row}:{item:BucketRow})=>(
    <TouchableOpacity style={[S.row, row.supplierId==='unassigned'?S.rowUnassigned:null]}
      onPress={()=> row.supplierId==='unassigned'? setUnassignedOpen(true): openSupplierPreview(row.supplierId,row.supplierName)}>
      <View style={{flex:1}}>
        <Text style={S.rowTitle}>{row.supplierName}</Text>
        <Text style={S.rowSub}>{row.itemsCount} item{row.itemsCount===1?'':'s'}{row.supplierId==='unassigned'?' — Tap to assign supplier or set PAR':''}</Text>
      </View>
      <Text style={S.chev}>›</Text>
    </TouchableOpacity>
  ),[openSupplierPreview]);

  const listHeader=useMemo(()=>(
    <View style={S.header}>
      <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
        <Text style={S.title}>Suggested Orders</Text>
        {aiStamp ? <Text style={S.badge}>AI (dev)</Text> : null}
      </View>
      <View style={{flexDirection:'row', gap:8}}>
        <TouchableOpacity style={[S.smallBtn,S.btnLight]} onPress={doRefresh}>
          <Text style={[S.smallBtnText,S.btnLightText]}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.smallBtn} onPress={runAI}>
          <Text style={S.smallBtnText}>Use AI (beta)</Text>
        </TouchableOpacity>
      </View>
    </View>
  ),[runAI,doRefresh,aiStamp]);

  return (
    <View style={S.wrap}>
      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        ListHeaderComponent={listHeader}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh}/>}
        ListEmptyComponent={!refreshing?(
          <View style={S.empty}><Text style={S.emptyTitle}>No suggestions</Text><Text style={S.emptyText}>Pull to refresh after your next stock take.</Text></View>
        ):null}
      />

      {/* Unassigned */}
      <Modal visible={unassignedOpen} transparent animationType="fade" onRequestClose={()=>setUnassignedOpen(false)}>
        <Pressable style={S.modalBack} onPress={()=>setUnassignedOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
            <View style={S.modalCard}>
              <Text style={S.modalTitle}>Unassigned</Text>
              <FlatList
                data={snapshot?.unassigned?.lines ?? []}
                keyExtractor={(l)=>String(l?.productId)}
                renderItem={({item:l})=>(
                  <View style={S.lineRow}>
                    <View style={{flex:1}}>
                      <Text style={S.lineName}>{s(l?.productName || l?.name || l?.productId,'Item')}</Text>
                      <Text style={S.rowSub}>Qty {m1(l?.qty)} · ${n(l?.unitCost ?? l?.cost ?? 0,0).toFixed(2)}</Text>
                    </View>
                    <View style={{flexDirection:'row', gap:8}}>
                      <TouchableOpacity style={S.smallBtn} onPress={()=>openSupplierPicker(String(l?.productId))}>
                        <Text style={S.smallBtnText}>Assign Supplier</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={S.smallBtn} onPress={()=>setParInline(String(l?.productId))}>
                        <Text style={S.smallBtnText}>Set PAR</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
              <TouchableOpacity style={[S.smallBtn,{alignSelf:'flex-end', marginTop:8}]} onPress={()=>setUnassignedOpen(false)}>
                <Text style={S.smallBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Supplier Preview */}
      <Modal visible={supplierOpen} transparent animationType="fade" onRequestClose={()=>setSupplierOpen(false)}>
        <Pressable style={S.modalBack} onPress={()=>setSupplierOpen(false)}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>{supplierPreview?.supplierName || 'Order'}</Text>
            <FlatList
              data={supplierPreview?.lines || []}
              keyExtractor={(l)=>String(l?.productId)}
              renderItem={({item:l})=>(
                <View style={S.lineRow}>
                  <View style={{flex:1}}>
                    <Text style={S.lineName}>{s(l?.productName || l?.name || l?.productId,'Item')}</Text>
                    <Text style={S.rowSub}>Qty {m1(l?.qty)} · ${n(l?.cost,0).toFixed(2)}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={<Text style={S.rowSub}>No lines</Text>}
            />
            <View style={{flexDirection:'row', justifyContent:'space-between', marginTop:8}}>
              <TouchableOpacity style={S.smallBtn} onPress={()=>setSupplierOpen(false)}>
                <Text style={S.smallBtnText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.smallBtn, supplierPreview?.alreadyDrafted ? { backgroundColor:'#9CA3AF' } : null]}
                disabled={!!supplierPreview?.alreadyDrafted}
                onPress={createDraftForPreview}
              >
                <Text style={S.smallBtnText}>{supplierPreview?.alreadyDrafted ? 'Already Drafted' : 'Create Draft'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Supplier Picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={()=>setPickerOpen(false)}>
        <Pressable style={S.modalBack} onPress={()=>setPickerOpen(false)}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Choose Supplier</Text>
            <FlatList
              data={pickerSuppliers}
              keyExtractor={(s)=>String(s.id)}
              renderItem={({item:s})=>(
                <TouchableOpacity style={S.modalRow} onPress={()=>pickSupplier(s)}>
                  <Text style={S.modalRowText}>{s.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={S.rowSub}>No suppliers</Text>}
            />
            <TouchableOpacity style={[S.smallBtn,{alignSelf:'flex-end', marginTop:8}]} onPress={()=>setPickerOpen(false)}>
              <Text style={S.smallBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* PAR Modal */}
      <Modal visible={parOpen} transparent animationType="fade" onRequestClose={()=>setParOpen(false)}>
        <Pressable style={S.modalBack} onPress={()=>setParOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
            <View style={S.modalCard}>
              <Text style={S.modalTitle}>Set PAR</Text>
              <TextInput value={parValue} onChangeText={setParValue} placeholder="Enter PAR" keyboardType="numeric" style={S.input}/>
              <View style={{flexDirection:'row', justifyContent:'space-between', marginTop:8}}>
                <TouchableOpacity style={S.smallBtn} onPress={()=>setParOpen(false)}>
                  <Text style={S.smallBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.smallBtn} onPress={savePar}>
                  <Text style={S.smallBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Paywall / Promo */}
      <Modal visible={promoOpen} transparent animationType="fade" onRequestClose={()=>setPromoOpen(false)}>
        <Pressable style={S.modalBack} onPress={()=>setPromoOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
            <View style={S.modalCard}>
              <Text style={S.modalTitle}>AI Suggestions</Text>
              <Text style={S.rowSub}>This feature requires an active plan. Enter a promo code to unlock.</Text>
              <TextInput value={promoCode} onChangeText={setPromoCode} placeholder="Promo code" autoCapitalize="characters" style={[S.input,{marginTop:8}]}/>
              <View style={{flexDirection:'row', justifyContent:'space-between', marginTop:8}}>
                <TouchableOpacity style={S.smallBtn} onPress={()=>setPromoOpen(false)}><Text style={S.smallBtnText}>Close</Text></TouchableOpacity>
                <TouchableOpacity style={S.smallBtn} onPress={applyPromo}><Text style={S.smallBtnText}>Apply</Text></TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{ flex:1, backgroundColor:'#fff' },
  header:{ paddingHorizontal:16, paddingTop:12, paddingBottom:6, flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  title:{ fontSize:22, fontWeight:'800' },
  badge:{ fontSize:11, fontWeight:'700', color:'#111827', backgroundColor:'#E5E7EB', paddingHorizontal:6, paddingVertical:2, borderRadius:6 },
  row:{ paddingHorizontal:16, paddingVertical:12, borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#e5e7eb', flexDirection:'row', alignItems:'center' },
  rowUnassigned:{ backgroundColor:'#f9fafb' },
  rowTitle:{ fontSize:15, fontWeight:'700' },
  rowSub:{ fontSize:13, color:'#6b7280', marginTop:2 },
  chev:{ fontSize:24, color:'#9ca3af', marginLeft:8 },
  empty:{ paddingTop:48, paddingHorizontal:8 },
  emptyTitle:{ fontSize:16, fontWeight:'600', marginBottom:8 },
  emptyText:{ fontSize:13, color:'#6b7280' },
  lineRow:{ flexDirection:'row', alignItems:'center', paddingVertical:10, borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#eee' },
  lineName:{ fontSize:14, fontWeight:'600' },
  smallBtn:{ backgroundColor:'#111827', paddingVertical:6, paddingHorizontal:10, borderRadius:8 },
  smallBtnText:{ color:'#fff', fontSize:12, fontWeight:'600' },
  btnLight:{ backgroundColor:'#F3F4F6' },
  btnLightText:{ color:'#111827' },
  modalBack:{ flex:1, backgroundColor:'rgba(0,0,0,0.3)', justifyContent:'center', padding:24 },
  modalCard:{ backgroundColor:'#fff', borderRadius:12, padding:16, maxHeight:'75%' },
  modalTitle:{ fontSize:18, fontWeight:'700', marginBottom:8 },
  modalRow:{ paddingVertical:12, borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#eee' },
  modalRowText:{ fontSize:16 },
  input:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, padding:10, fontSize:16 },
});
