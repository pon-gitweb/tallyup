// @ts-nocheck
import { useColours } from '../../context/ThemeContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity,
  RefreshControl, Alert, Modal, Platform, ToastAndroid
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  getFirestore, collection, getDocs,
  writeBatch, doc, query, where, serverTimestamp, updateDoc
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { OrdersService } from '../../domain/orders';
import { showToast } from './_toast';

const dlog = __DEV__ ? (...a:any[]) => console.log('[Suggested]', ...a) : (..._a:any[])=>{};
const NO_SUPPLIER_KEYS = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);
const m1=(v:any)=>{const x=Number(v);return Number.isFinite(x)?Math.max(1,Math.round(x)):1;};

type BucketRow = { id:string; supplierId:string; supplierName:string; itemsCount:number };
type Dept = { id:string; name:string };
type SupplierLite = { id:string; name:string };

function sumByProduct(lines:any[]){
  const map:Record<string, any> = {};
  for (const l of (Array.isArray(lines)?lines:[])) {
    const pid = String(l.productId);
    if (!pid) continue;
    if (!map[pid]) map[pid] = {
      productId: pid,
      productName: String(l.productName ?? l.name ?? pid),
      qty: 0,
      unitCost: Number.isFinite(l?.unitCost) ? Number(l.unitCost) : (Number.isFinite(l?.cost)?Number(l.cost):null),
      packSize: Number.isFinite(l?.packSize)?Number(l.packSize):null,
      breakdown: {},
    };
    const addQty = Number.isFinite(l?.qtyDept) ? Number(l.qtyDept) : (Number.isFinite(l?.qty) ? Number(l.qty) : 0);
    map[pid].qty += Math.max(0, Math.round(addQty));
    const dn = String(l?.deptName || l?.deptId || 'Dept');
    map[pid].breakdown[dn] = (map[pid].breakdown[dn] || 0) + Math.max(0, Math.round(addQty));
  }
  return Object.values(map);
}

export function __showSuggestToast(msg:string){
  try{
    require("react-native").ToastAndroid.show(msg,require("react-native").ToastAndroid.SHORT);
  }catch{
    try{require("react-native").Alert.alert("Notice",msg);}catch{}
  }
}

export default function SuggestedOrderScreen(){
  const nav=useNavigation<any>();
  const venueId=useVenueId();
  const db=getFirestore();
  const uid=getAuth()?.currentUser?.uid||'dev';

  const [refreshing,setRefreshing]=useState(false);
  const [loadError,setLoadError]=useState(false);
  const [rows,setRows]=useState<BucketRow[]>([]);
  const [snapshot,setSnapshot]=useState<any>(null);

  const [existingKeys,setExistingKeys]=useState<Set<string>>(new Set());
  const [supplierPreview,setSupplierPreview]=useState<any>(null);
  const [supplierOpen,setSupplierOpen]=useState(false);
  const [lineQtyOverrides,setLineQtyOverrides]=useState<Record<string,number>>({});

  const colours = useColours();

  const [depts,setDepts]=useState<Dept[]>([]);
  const [selectedDeptId,setSelectedDeptId]=useState<string>('ALL');

  // Quick-assign supplier UI state (permanent — updates product doc)
  const [assignForProductId,setAssignForProductId]=useState<string|null>(null);
  const [suppliers,setSuppliers]=useState<SupplierLite[]>([]);
  const [assignOpen,setAssignOpen]=useState(false);

  // Temp supplier reassignment for this order only (does not update product doc)
  const [reassignForLine,setReassignForLine]=useState<any|null>(null);
  const [reassignOpen,setReassignOpen]=useState(false);

  const didInitRef=useRef(false);

  const loadSuppliers = useCallback(async()=>{
    if(!venueId){ setSuppliers([]); return; }
    const snap = await getDocs(collection(db,'venues',venueId,'suppliers'));
    const arr:SupplierLite[]=[];
    snap.forEach(d=> arr.push({ id:d.id, name: String((d.data() as any)?.name || 'Supplier') }));
    setSuppliers(arr);
  },[db,venueId]);

  const loadDepartments = useCallback(async()=>{
    if(!venueId){ setDepts([]); return; }
    const snap = await getDocs(collection(db,'venues',venueId,'departments'));
    const arr:Dept[] = [];
    snap.forEach(d=> arr.push({ id:d.id, name: String((d.data() as any)?.name || 'Department') }));
    setDepts(arr);
  },[db,venueId]);

  const normalizeCompat=useCallback((compat:any)=>{
    const raw:Record<string,{lines:any[];supplierName?:string}>=
      (compat&&compat.buckets&&typeof compat.buckets==='object')?compat.buckets:(compat||{});
    const unStart:any[]=Array.isArray(compat?.unassigned?.lines)?compat.unassigned.lines:[];
    const unPool:any[]=[...unStart];
    const real:Record<string,{lines:any[];supplierName?:string}>={};
    Object.entries(raw).forEach(([sid,b]:any)=>{
      const lines=Array.isArray(b?.lines)?b.lines:[];
      if(NO_SUPPLIER_KEYS.has(String(sid))){ if(lines.length)unPool.push(...lines);return;}
      if(lines.length>0)real[sid]={lines, supplierName:b?.supplierName};
    });
    const unassigned={lines:unPool};
    const meta = compat && compat._meta ? compat._meta : null;
    return {buckets:real,unassigned,_meta:meta};
  },[]);

  // Real per-cycle dedupe: read suggestionKey set from Firestore, scoped by stockCycleKey when available.
  const loadExistingSuggestionKeys = useCallback(async (cycleKey?: string | null) => {
    if (!venueId) {
      setExistingKeys(new Set());
      return;
    }

    try {
      const baseRef = collection(db, 'venues', venueId, 'orders');

      let qRef;
      if (cycleKey && String(cycleKey).trim().length > 0) {
        // Scoped to current stock cycle
        qRef = query(
          baseRef,
          where('status', '==', 'draft'),
          where('source', '==', 'suggestions'),
          where('stockCycleKey', '==', String(cycleKey).trim())
        );
      } else {
        // Fallback: no cycle key yet → just look at all suggestions drafts
        qRef = query(
          baseRef,
          where('status', '==', 'draft'),
          where('source', '==', 'suggestions')
        );
      }

      const snap = await getDocs(qRef);
      const set = new Set<string>();
      snap.forEach(d => {
        const v: any = d.data() || {};
        const sk = typeof v.suggestionKey === 'string' ? v.suggestionKey.trim() : '';
        if (sk) set.add(sk);
      });

      const sample = Array.from(set).slice(0, 3);
      dlog(
        'existingKeys',
        set.size,
        'sample',
        sample.length ? sample : '(none)',
        'cycleKey',
        cycleKey || '(none)'
      );
      setExistingKeys(set);
    } catch (err:any) {
      console.warn('[Suggested] loadExistingSuggestionKeys failed, falling back without cycle filter', err?.message || err);

      // Fallback: ignore stockCycleKey filter if index is missing or query fails
      try {
        const baseRef = collection(db, 'venues', venueId, 'orders');
        const qRef = query(
          baseRef,
          where('status', '==', 'draft'),
          where('source', '==', 'suggestions')
        );
        const snap = await getDocs(qRef);
        const set = new Set<string>();
        snap.forEach(d => {
          const v: any = d.data() || {};
          const sk = typeof v.suggestionKey === 'string' ? v.suggestionKey.trim() : '';
          if (sk) set.add(sk);
        });
        const sample = Array.from(set).slice(0, 3);
        dlog(
          'existingKeys (fallback)',
          set.size,
          'sample',
          sample.length ? sample : '(none)'
        );
        setExistingKeys(set);
      } catch (err2:any) {
        console.warn('[Suggested] loadExistingSuggestionKeys fallback also failed', err2?.message || err2);
        setExistingKeys(new Set());
      }
    }
  }, [db, venueId]);

  const computeRowsFromSnapshot=useCallback(async(snapCompat:any)=>{
    let { buckets,unassigned,_meta }=snapCompat || {};

    // supplier name lookup
    const supMap:Record<string,string>={};
    if(venueId){
      const supSnap=await getDocs(collection(db,'venues',venueId,'suppliers'));
      supSnap.forEach(d=>{ supMap[d.id]=String((d.data() as any)?.name || 'Supplier'); });
    }

    const projectLines = (lines:any[])=>{
      if(selectedDeptId==='ALL') return sumByProduct(lines);
      return (lines||[]).filter(l => String(l?.deptId||'')===selectedDeptId)
        .map(l => ({
          productId:String(l.productId),
          productName:String(l.productName??l.name??l.productId??''),
          qty:m1(Number.isFinite(l?.qtyDept)?l.qtyDept:l?.qty),
          unitCost:Number.isFinite(l?.unitCost)?Number(l.unitCost):(Number.isFinite(l?.cost)?Number(l.cost):null),
          packSize:Number.isFinite(l?.packSize)?Number(l.packSize):null,
          dept:l?.deptName ?? null,
        }));
    };

    const tmp:BucketRow[]=[];
    const unLines = projectLines(Array.isArray(unassigned?.lines)?unassigned.lines:[]);
    if(unLines.length>0){
      tmp.push({ id:'unassigned',supplierId:'unassigned',supplierName:'Unassigned',itemsCount:unLines.length });
    }

    Object.entries(buckets||{}).forEach(([sid,b]:any)=>{
      const baseLines = Array.isArray(b?.lines)?b.lines:[];
      const lines = projectLines(baseLines);
      if(lines.length<=0)return;
      const label=b?.supplierName||supMap[sid]||`#${String(sid).slice(-4)}`;
      tmp.push({ id:sid,supplierId:sid,supplierName:label,itemsCount:lines.length });
    });

    const uIdx=tmp.findIndex(r=>r.id==='unassigned');
    const sorted=tmp.filter(r=>r.id!=='unassigned').sort((a,b)=>(b.itemsCount||0)-(a.itemsCount||0));
    setRows(uIdx>=0?[tmp[uIdx],...sorted]:sorted);
    setSnapshot({buckets,unassigned,_meta});
  },[db,venueId,selectedDeptId]);

  const doRefreshRaw=useCallback(async()=>{
    setLoadError(false);
    if(!venueId){
      setRows([]);
      setSnapshot(null);
      setExistingKeys(new Set());
      return;
    }
    try {
      const compat:any=await OrdersService.buildSuggestedOrdersInMemory(venueId,{ roundToPack:true, defaultParIfMissing:6 });
      const graduated=normalizeCompat(compat);
      await computeRowsFromSnapshot(graduated);
      const cycleKey = graduated?._meta?.stockCycleKey || null;
      await loadExistingSuggestionKeys(cycleKey);
    } catch(e:any) {
      dlog('doRefreshRaw error', e?.message);
      setLoadError(true);
    }
  },[venueId,computeRowsFromSnapshot,normalizeCompat,loadExistingSuggestionKeys]);

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
        await loadSuppliers();
        await loadDepartments();
        setEntitled(true); // BETA: bypass entitlement check
        await doRefreshRaw();
      } finally { setRefreshing(false); }
    })();
  },[venueId,doRefreshRaw,loadDepartments,loadSuppliers]);

  useFocusEffect(useCallback(()=>{
    let cancelled=false;
    (async()=>{
      try{
        setRefreshing(true);
        await loadSuppliers();
        await loadDepartments();
        await doRefreshRaw();
      } finally{
        if(!cancelled) setRefreshing(false);
      }
    })();
    return ()=>{ cancelled=true; };
  },[doRefreshRaw,loadDepartments,loadSuppliers]));

  const openSupplierPreview=useCallback((supplierId:string,supplierName:string)=>{
    if(!snapshot)return;

    const baseLines=(supplierId==='unassigned'
      ? (snapshot.unassigned?.lines||[])
      : (snapshot.buckets?.[supplierId]?.lines||[]));

    let previewLines:any[] = [];
    if(selectedDeptId==='ALL'){
      previewLines = sumByProduct(baseLines).map(l=>({
        productId:String(l.productId),
        productName:String(l.productName??l.name??l.productId??''),
        qty:m1(l.qty),
        cost:Number.isFinite(l?.unitCost)?Number(l.unitCost):(Number.isFinite(l?.cost)?Number(l.cost):null),
        packSize:Number.isFinite(l?.packSize)?Number(l.packSize):null,
        dept:null,
      }));
    } else {
      previewLines = (baseLines||[])
        .filter((l:any)=>String(l?.deptId||'')===selectedDeptId)
        .map((l:any)=>({
          productId:String(l.productId),
          productName:String(l.productName??l.name??l.productId??''),
          qty:m1(Number.isFinite(l?.qtyDept)?l.qtyDept:l?.qty),
          cost:Number.isFinite(l?.unitCost)?Number(l.unitCost):(Number.isFinite(l?.cost)?Number(l.cost):null),
          packSize:Number.isFinite(l?.packSize)?Number(l.packSize):null,
          dept: l?.deptName ?? null,
        }));
    }

    const suggestionKey=OrdersService.computeSuggestionKey(
      supplierId==='unassigned'?null:supplierId,
      previewLines
    );
    const alreadyDrafted=existingKeys.has(suggestionKey);
    dlog('preview key', suggestionKey, 'alreadyDrafted?', alreadyDrafted, 'cycleKey', snapshot?._meta?.stockCycleKey || null);
    setSupplierPreview({ supplierId,supplierName,lines:previewLines,suggestionKey,alreadyDrafted });
    setLineQtyOverrides({});
    setSupplierOpen(true);
  },[snapshot,existingKeys,selectedDeptId]);

  const previewRunningTotal = useMemo(() => {
    if (!supplierPreview?.lines) return 0;
    return (supplierPreview.lines as any[]).reduce((sum: number, l: any) => {
      const effectiveQty = lineQtyOverrides[l.productId] !== undefined ? lineQtyOverrides[l.productId] : (Number.isFinite(l?.qty) ? Math.max(0, Math.round(l.qty)) : 1);
      const perUnit = l.estimatedCost != null && (l.qty ?? 1) > 0 ? l.estimatedCost / (l.qty ?? 1) : (Number.isFinite(l?.cost) ? Number(l.cost) : 0);
      return sum + (Number.isFinite(perUnit) ? perUnit * effectiveQty : 0);
    }, 0);
  }, [supplierPreview, lineQtyOverrides]);

  const findExistingDraftForSupplier = useCallback(async(supplierId:string|null)=>{
    if(!venueId) return null;
    const ref = collection(db, 'venues', venueId, 'orders');
    let qRef = query(ref, where('status','==','draft'));
    if(supplierId && supplierId !== 'unassigned'){
      qRef = query(ref, where('status','==','draft'), where('supplierId','==',''+supplierId));
    }
    const snap = await getDocs(qRef);
    let firstId:string|null = null;
    snap.forEach(d=>{ if(!firstId) firstId = d.id; });
    return firstId;
  },[db,venueId]);

  const mergeIntoExistingDraft = useCallback(async(orderId:string, lines:any[])=>{
    const batch = writeBatch(db);
    const orderRef = doc(db, 'venues', venueId!, 'orders', orderId);
    const safeQty=(q:any)=>Math.max(1,Math.round(Number(q)||1));
    for(const l of (Array.isArray(lines)?lines:[])){
      const unitCost = Number.isFinite(l?.cost)?Number(l.cost):null;
      const lr = doc(orderRef, 'lines', String(l.productId));
      batch.set(lr, {
        productId:String(l.productId),
        name:String(l.productName??l.name??l.productId??''),
        qty:safeQty(l.qty),
        ...(unitCost!=null?{unitCost}:{}),
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

  // ===== Robust preflight lock checker (scoped to stockCycleKey) =====
  async function __probeSupplierLocks(
    venueId: string,
    supplierId: string | null,
    wantAll: boolean,
    cycleKey: string | null
  ): Promise<'ALL_EXISTS' | 'DEPT_EXISTS' | null> {
    const colRef = collection(db, 'venues', venueId, 'orders');
    const qRef = supplierId != null
      ? query(colRef, where('status','==','draft'), where('supplierId','==', String(supplierId)))
      : query(colRef, where('status','==','draft'), where('supplierId','==', null));

    const snap = await getDocs(qRef);
    const allDocs:any[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    const docs = cycleKey
      ? allDocs.filter(d => d.stockCycleKey === cycleKey)
      : allDocs;

    const readScope = (d:any) => d?.deptScope ?? d?.deptScopeField ?? d?.dept ?? d?.department ?? null;

    const anyALL = docs.some(d => {
      const s = readScope(d);
      if (s === 'ALL') return true;
      return false;
    });

    const anyDept = docs.some(d => {
      const s = readScope(d);
      if (s === 'ALL' || s == null) return false;
      if (Array.isArray(s)) return s.length >= 1;
      return typeof s === 'string' && s.trim().length > 0;
    });

    console.log('[OrdersLockProbe]', {
      supplierId, wantAll, docs: docs.length, anyALL, anyDept,
      cycleKey,
      sample: docs.slice(0,3).map(d => ({ id: d.id, scope: readScope(d), status: d.status }))
    });

    // NEW: correct logic
    if (wantAll) {
      // Creating an ALL-scope draft: block if ANY ALL-scope draft already exists,
      // or optionally if dept-specific drafts already exist.
      if (anyALL) return 'ALL_EXISTS';
      if (anyDept) return 'DEPT_EXISTS';
      return null;
    }

    // Creating a dept-specific draft: block if an ALL-scope draft exists.
    return anyALL ? 'ALL_EXISTS' : null;
  }

  const createDraftForPreview=useCallback(async()=>{
    if(!venueId||!supplierPreview||!snapshot)return;

    // HARD GUARD: if this suggestionKey is already present for this cycle, do nothing.
    const sKey = supplierPreview.suggestionKey;
    if (sKey && existingKeys.has(sKey)) {
      showToast('Draft already exists for this supplier for this stocktake cycle.');
      return;
    }

    try{
      const key = supplierPreview.supplierId || 'unassigned';
      const supplierIdOrNull = key==='unassigned' ? null : key;
      const cycleKey = snapshot?._meta?.stockCycleKey || null;

      // ---- Preflight lock (blocks double-handling *within this cycle* only) ----
      const wantAll = selectedDeptId === 'ALL';
      const lock = await __probeSupplierLocks(venueId, supplierIdOrNull, wantAll, cycleKey);
      if (lock === 'ALL_EXISTS') { showToast('Blocked: ALL order already exists for this supplier for this cycle.'); return; }
      if (lock === 'DEPT_EXISTS') { showToast('Blocked: Department draft(s) already exist for this supplier for this cycle.'); return; }

      const existingId = await findExistingDraftForSupplier(key==='unassigned'?null:key);

      const doCreateSeparate = async()=>{
        const rawLines = supplierPreview.lines || [];
        const effectiveLines = rawLines
          .map((l: any) => lineQtyOverrides[l.productId] !== undefined
            ? { ...l, qty: lineQtyOverrides[l.productId], qtyDept: lineQtyOverrides[l.productId] }
            : l)
          .filter((l: any) => (lineQtyOverrides[l.productId] !== undefined ? lineQtyOverrides[l.productId] : (l.qty ?? 1)) > 0);
        const legacyMap = {
          [key]: { supplierName: supplierPreview.supplierName ?? null, lines: effectiveLines },
        };
        const res = await OrdersService.createDraftsFromSuggestions(venueId, legacyMap, {
          createdBy: uid,
          stockCycleKey: cycleKey || null,
        });
        if (!res || !Array.isArray(res.created)) { showToast('Could not create draft.'); return; }
        if ((res as any).blockedReason) {
          const why = (res as any).blockedReason;
          if (why === 'ALL_EXISTS') showToast('Blocked: ALL order already exists for this supplier for this cycle.');
          if (why === 'DEPT_EXISTS') showToast('Blocked: Department draft(s) already exist for this supplier for this cycle.');
          if (why === 'NEED_MANAGER') showToast('Only managers can create an ALL-scope draft.');
          return;
        }
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
          'MERGE these lines into existing draft, or create a SEPARATE draft?',
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
  },[venueId,supplierPreview,uid,findExistingDraftForSupplier,mergeIntoExistingDraft,snapshot,selectedDeptId,existingKeys]);

  // Quick-assign supplier for a product (from Unassigned preview)
  const openAssignForProduct = useCallback(async(productId:string)=>{
    await loadSuppliers();
    setAssignForProductId(productId);
    setAssignOpen(true);
  },[loadSuppliers]);

  const assignSupplierToProduct = useCallback(async(supplierId:string)=>{
    if(!venueId || !assignForProductId){ setAssignOpen(false); return; }
    try{
      // Lookup supplier name
      const sdoc = await getDocs(collection(db,'venues',venueId,'suppliers'));
      let supplierName:string|undefined;
      sdoc.forEach(d=>{ if(d.id===supplierId) supplierName = (d.data() as any)?.name; });
      const pRef = doc(db,'venues',venueId,'products',assignForProductId);
      await updateDoc(pRef,{
        supplierId,
        supplierName: supplierName || null,
        updatedAt: serverTimestamp(),
      });
      setAssignOpen(false);
      setAssignForProductId(null);
      // Refresh suggestions so this product moves from Unassigned to that supplier
      await doRefreshRaw();
    }catch(e:any){
      Alert.alert('Assign failed', e?.message || 'Could not assign supplier');
    }
  },[db,venueId,assignForProductId,doRefreshRaw]);

  // Temp reassign: move a line from current supplier bucket to another in local snapshot state
  const tempReassignLine = useCallback((line:any, newSupplierId:string, newSupplierName:string)=>{
    if(!snapshot) return;
    setSnapshot((prev:any) => {
      if (!prev) return prev;
      const next = { buckets: { ...prev.buckets }, unassigned: { lines: [...(prev.unassigned?.lines||[])] }, _meta: prev._meta };

      // Remove from current supplier bucket or unassigned
      const currentSid = supplierPreview?.supplierId;
      if (currentSid === 'unassigned') {
        next.unassigned = { lines: next.unassigned.lines.filter((l:any) => l.productId !== line.productId) };
      } else if (currentSid && next.buckets[currentSid]) {
        next.buckets[currentSid] = { ...next.buckets[currentSid], lines: next.buckets[currentSid].lines.filter((l:any) => l.productId !== line.productId) };
      }

      // Add to new supplier bucket
      const updatedLine = { ...line, needsSupplier: false };
      if (newSupplierId === 'unassigned') {
        next.unassigned = { lines: [...next.unassigned.lines, updatedLine] };
      } else {
        if (!next.buckets[newSupplierId]) next.buckets[newSupplierId] = { supplierName: newSupplierName, lines: [] };
        next.buckets[newSupplierId] = { ...next.buckets[newSupplierId], lines: [...next.buckets[newSupplierId].lines, updatedLine] };
      }
      return next;
    });
    setReassignOpen(false);
    setReassignForLine(null);
    // Update the preview too
    setSupplierPreview((prev:any) => prev ? { ...prev, lines: (prev.lines||[]).filter((l:any) => l.productId !== line.productId) } : prev);
    // Recompute rows
    setTimeout(() => computeRowsFromSnapshot(snapshot), 50);
  },[snapshot, supplierPreview, computeRowsFromSnapshot]);

  const keyExtractor=useCallback((r:BucketRow)=>String(r.id),[]);
  const renderRow=useCallback(({item:row}:{item:BucketRow})=>(
    <TouchableOpacity
      style={[S.row,row.supplierId==='unassigned'?S.rowUnassigned:null]}
      onPress={()=>openSupplierPreview(row.supplierId,row.supplierName)}
    >
      <View style={{flex:1}}>
        <Text style={S.rowTitle}>{row.supplierName}</Text>
        <Text style={S.rowSub}>{row.itemsCount} item{row.itemsCount===1?'':'s'}</Text>
      </View>
      <Text style={S.chev}>›</Text>
    </TouchableOpacity>
  ),[openSupplierPreview]);

  const DeptChips=useMemo(()=>(
    <View style={S.chipsBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={S.chipsRow}
      >
        <TouchableOpacity
          onPress={()=>{ setSelectedDeptId('ALL'); doRefreshRaw(); }}
          style={[S.chip, selectedDeptId==='ALL' && S.chipActive]}
        >
          <Text style={[S.chipText, selectedDeptId==='ALL' && S.chipTextActive]}>All</Text>
        </TouchableOpacity>
        {depts.map(d=>(
          <TouchableOpacity
            key={d.id}
            onPress={()=>{ setSelectedDeptId(d.id); doRefreshRaw(); }}
            style={[S.chip, selectedDeptId===d.id && S.chipActive]}
          >
            <Text style={[S.chipText, selectedDeptId===d.id && S.chipTextActive]}>{d.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  ),[depts,selectedDeptId,doRefreshRaw]);

  const listHeader=useMemo(()=>{
    const meta = snapshot && snapshot._meta ? snapshot._meta : null;

    let scopeLabel = 'Combined across departments';
    if (selectedDeptId !== 'ALL') {
      const dept = depts.find(d => d.id === selectedDeptId);
      scopeLabel = dept ? `Department: ${dept.name}` : 'Department-specific';
    }

    let generatedLabel: string | null = null;
    if (meta && meta.generatedAt) {
      try {
        const d = new Date(meta.generatedAt);
        generatedLabel = `Snapshot at ${d.toLocaleString()}`;
      } catch {
        generatedLabel = null;
      }
    }

    const cycleLabel = meta?.stockCycleKey
      ? `Stocktake cycle: ${meta.stockCycleKey}`
      : null;

    return (
      <View>
        <View style={S.header}>
          <View style={{flex:1}}>
            <Text style={S.title}>Suggested Orders</Text>
            <Text style={S.rowSub}>{scopeLabel}</Text>
          </View>
          <IdentityBadge/>
        </View>
        {meta && (
          <View style={S.metaCard}>
            <Text style={S.metaTitle}>
              {'Math snapshot context'}
            </Text>
            <Text style={S.metaText}>
              Engine: velocity-driven math
              {meta.snapshotsUsed > 0 ? ` · ${meta.snapshotsUsed} stocktake cycle${meta.snapshotsUsed===1?'':'s'} analysed` : ' · No stocktake data yet'}
            </Text>
            <Text style={S.metaText}>
              {meta.velocityDriven > 0
                ? `${meta.velocityDriven} velocity-driven · ${(meta.totalLines||0) - (meta.velocityDriven||0)} PAR-based`
                : 'PAR-based (complete stocktakes for velocity data)'}
            </Text>
            {generatedLabel && (
              <Text style={S.metaText}>{generatedLabel}</Text>
            )}
            {cycleLabel && (
              <Text style={S.metaText}>{cycleLabel}</Text>
            )}
          </View>
        )}
      </View>
    );
  },[snapshot,selectedDeptId,depts]);

  return (
    <View style={S.wrap}>
      {DeptChips}
      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        ListHeaderComponent={listHeader}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh}/>}
        ListEmptyComponent={!refreshing?(
          <View style={S.empty}>
            {loadError ? (
              <>
                <Text style={S.emptyTitle}>Couldn’t load suggestions</Text>
                <Text style={S.emptyText}>Check your connection and pull down to try again.</Text>
              </>
            ) : (
              <>
                <Text style={S.emptyTitle}>All items are at or above PAR</Text>
                <Text style={S.emptyText}>
                  Based on your most recent stock takes and per-dept PARs, there’s nothing to top up right now.
                </Text>
              </>
            )}
          </View>
        ):null}
      />

      {/* Supplier Preview */}
      <Modal visible={supplierOpen} transparent animationType="fade" onRequestClose={()=>setSupplierOpen(false)}>
        <View style={S.modalBack}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>
              {supplierPreview?.supplierName || 'Supplier'} · {supplierPreview?.lines?.length || 0} item
              {(supplierPreview?.lines?.length || 0) === 1 ? '' : 's'}
              {previewRunningTotal > 0 ? ` · Est. $${previewRunningTotal.toFixed(0)}` : ''}
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled">
              {(supplierPreview?.lines || []).map((l: any) => (
                <TouchableOpacity
                  key={l.productId}
                  style={S.lineRow}
                  onLongPress={() => { setReassignForLine(l); setReassignOpen(true); }}
                  delayLongPress={400}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    {/* Flag banner */}
                    {l.flag && (
                      <Text style={S.flagText}>⚠️ {l.flagMessage}</Text>
                    )}
                    <Text style={S.lineName}>{l.productName || l.productId}</Text>
                    {/* Velocity reason line */}
                    {l.reason === 'velocity-driven' && l.velocityPerWeek != null ? (
                      <Text style={S.rowSub}>
                        Order {l.qty} · {l.velocityPerWeek}/week velocity · {l.confidence} confidence
                        {l.trendNote ? ` · ${l.trendNote}` : ''}
                        {l.currentStock != null ? ` · Stock: ${l.currentStock}` : ''}
                      </Text>
                    ) : l.reason === 'par-based' ? (
                      <Text style={S.rowSub}>
                        Order {l.qty} · Below PAR · No velocity data yet
                        {l.currentStock != null ? ` · Stock: ${l.currentStock}` : ''}
                      </Text>
                    ) : (
                      <Text style={S.rowSub}>
                        Qty {l.qty}
                        {Number.isFinite(l?.packSize) && l.packSize ? ` · Pack ${l.packSize}` : ''}
                        {Number.isFinite(l?.cost) && l.cost ? ` · $${Number(l.cost).toFixed(2)}` : ''}
                      </Text>
                    )}
                    {l.estimatedCost != null && l.estimatedCost > 0 && (
                      <Text style={[S.rowSub,{color:'#374151'}]}>Est. ${l.estimatedCost.toFixed(2)}</Text>
                    )}
                  </View>

                  {/* Inline quantity stepper */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 }}>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginRight: 2 }}>Qty:</Text>
                    <TouchableOpacity
                      onPress={() => setLineQtyOverrides(prev => ({ ...prev, [l.productId]: Math.max(0, (prev[l.productId] !== undefined ? prev[l.productId] : Math.max(0, Math.round(l.qty ?? 1))) - 1) }))}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e5e7eb' }}
                    >
                      <Text style={{ fontSize: 16, color: '#374151', fontWeight: '700' }}>−</Text>
                    </TouchableOpacity>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827', minWidth: 28, textAlign: 'center' }}>
                      {lineQtyOverrides[l.productId] !== undefined ? lineQtyOverrides[l.productId] : Math.max(0, Math.round(l.qty ?? 1))}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setLineQtyOverrides(prev => ({ ...prev, [l.productId]: Math.min(999, (prev[l.productId] !== undefined ? prev[l.productId] : Math.max(0, Math.round(l.qty ?? 1))) + 1) }))}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e5e7eb' }}
                    >
                      <Text style={{ fontSize: 16, color: '#374151', fontWeight: '700' }}>+</Text>
                    </TouchableOpacity>
                    {lineQtyOverrides[l.productId] !== undefined && lineQtyOverrides[l.productId] !== Math.round(l.qty ?? 1) && (
                      <Text style={{ fontSize: 11, color: '#9ca3af', marginLeft: 2 }}>
                        (was {Math.max(0, Math.round(l.qty ?? 1))})
                      </Text>
                    )}
                  </View>

                  {/* Quick-assign button appears only in Unassigned preview (permanent) */}
                  {supplierPreview?.supplierId === 'unassigned' && (
                    <TouchableOpacity style={S.assignBtn} onPress={()=>openAssignForProduct(l.productId)}>
                      <Text style={S.assignBtnText}>Assign</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              ))}
              {(supplierPreview?.lines?.length || 0) === 0 && (
                <Text style={S.rowSub}>No lines to show.</Text>
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={()=>setSupplierOpen(false)} style={[S.smallBtn,{backgroundColor:'#e5e7eb'}]}>
                <Text style={[S.smallBtnText,{color:'#111827'}]}>Close</Text>
              </TouchableOpacity>

              {/* guarded create: per-cycle suggestionKey + lock probe */}
              <TouchableOpacity
                onPress={createDraftForPreview}
                style={S.smallBtn}
              >
                <Text style={S.smallBtnText}>Create draft</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Assign Supplier Sheet */}
      <Modal visible={assignOpen} transparent animationType="slide" onRequestClose={()=>setAssignOpen(false)}>
        <View style={S.modalBack}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Assign supplier</Text>
            <ScrollView>
              {suppliers.map(s=>(
                <TouchableOpacity key={s.id} style={S.row} onPress={()=>assignSupplierToProduct(s.id)}>
                  <Text style={S.rowTitle}>{s.name}</Text>
                </TouchableOpacity>
              ))}
              {suppliers.length===0 && <Text style={S.rowSub}>No suppliers yet.</Text>}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={()=>setAssignOpen(false)} style={[S.smallBtn,{backgroundColor:'#e5e7eb'}]}>
                <Text style={[S.smallBtnText,{color:'#111827'}]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Temp Supplier Reassignment (this order only) */}
      <Modal visible={reassignOpen} transparent animationType="slide" onRequestClose={()=>{ setReassignOpen(false); setReassignForLine(null); }}>
        <View style={S.modalBack}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Move to supplier</Text>
            <Text style={S.rowSub}>For this order only — won't change product settings</Text>
            <ScrollView style={{ marginTop:8 }}>
              {suppliers.map(sup=>(
                <TouchableOpacity key={sup.id} style={S.row} onPress={()=>tempReassignLine(reassignForLine, sup.id, sup.name)}>
                  <Text style={S.rowTitle}>{sup.name}</Text>
                </TouchableOpacity>
              ))}
              {suppliers.length===0 && <Text style={S.rowSub}>No suppliers yet.</Text>}
            </ScrollView>
            <View style={{ flexDirection:'row', justifyContent:'flex-end', gap:10, marginTop:12 }}>
              <TouchableOpacity onPress={()=>{ setReassignOpen(false); setReassignForLine(null); }} style={[S.smallBtn,{backgroundColor:'#e5e7eb'}]}>
                <Text style={[S.smallBtnText,{color:'#111827'}]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  title: { fontSize: 22, fontWeight: '800' },

  chipsBar: { paddingTop: 8, paddingBottom: 6 },
  chipsRow: { paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  chip: {
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 999, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor:'#fff'
  },
  chipActive: { backgroundColor: '#111827', borderColor: '#111827' },
  chipText: { fontSize: 12, fontWeight: '800', color:'#111827' },
  chipTextActive: { color: '#fff' },

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

  lineRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee'
  },
  lineName: { fontSize: 14, fontWeight: '600' },
  flagText: { fontSize: 11, color: '#92400E', backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginBottom: 3, alignSelf: 'flex-start' },

  smallBtn: { backgroundColor: '#111827', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  assignBtn: { backgroundColor: '#0A84FF', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginLeft: 10 },
  assignBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '75%' },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },

  metaCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  metaTitle: { fontSize: 12, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  metaText: { fontSize: 11, color: '#64748b' },
});
