// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Alert, Modal, Pressable, TextInput, KeyboardAvoidingView, Platform, ToastAndroid,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, addDoc,
  serverTimestamp, query as fsQuery, where, documentId, orderBy,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { buildSuggestedOrdersInMemory } from '../../services/orders/suggest';

// NEW: AI client-fed suggester + paywall helpers
import { runAISuggest } from '../../services/orders/suggestAI';
import PaymentSheet from '../../components/paywall/PaymentSheet';
import { checkEntitlement } from '../../services/entitlement';

// DEBUG hooks (kept)
import { logSuggestShape, logProductDoc } from '../../dev/soDebug';
const DEBUG_SO = true;

// Keys that mean "no supplier" in suggester output → merge into Unassigned
const NO_SUPPLIER_KEYS = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);

// small helpers
const n = (v: any, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const m1 = (v: any) => { const x = Number(v); return Number.isFinite(x) ? Math.max(1, Math.round(x)) : 1; };
const s = (v: any, d = '') => (typeof v === 'string' ? v : d);

type BucketRow = { id: string; supplierId: string; supplierName: string; itemsCount: number };

function dedupeByProductId(lines: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const pid = String(l?.productId ?? '');
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push(l);
  }
  return out;
}

// Deterministic fingerprint for a supplier bucket suggestion
function buildSuggestionKey(supplierId: string, lines: any[]) {
  const parts = (Array.isArray(lines) ? lines : [])
    .map(l => `${String(l?.productId||'')}:${m1(l?.qty)}`)
    .filter(Boolean)
    .sort()
    .join(',');
  return `${supplierId}|${parts}`;
}

// Create draft (header + lines) — includes linesCount and suggestionKey
async function createDraft(db:any, venueId:string, supplierId:string, supplierName:string|null, suggestions:any[], suggestionKey:string) {
  const now = serverTimestamp();
  const orderRef = await addDoc(collection(db,'venues',venueId,'orders'), {
    status:'draft',
    displayStatus:'Draft',
    source:'suggestions',
    supplierId, supplierName: supplierName||null,
    createdAt: now, updatedAt: now,
    linesCount: Array.isArray(suggestions) ? suggestions.length : 0,
    suggestionKey,
  });
  for (const raw of suggestions) {
    const productId = String(raw?.productId||'').trim();
    if (!productId) continue;
    const name = String(raw?.productName || raw?.name || productId);
    const qty = Math.max(1, Math.round(Number(raw?.qty ?? 0)));
    const unitCost = Number(raw?.cost ?? raw?.unitCost ?? 0);
    const packSize = Number.isFinite(raw?.packSize) ? Number(raw?.packSize) : null;
    const line:any = { productId, name, qty, unitCost, updatedAt: now };
    if (packSize != null) line.packSize = packSize;
    await setDoc(doc(db,'venues',venueId,'orders',orderRef.id,'lines',productId), line, { merge:true });
  }
  return { id: orderRef.id };
}

// Assign supplier on PRODUCT (Option B)
async function assignSupplierSmart(db:any, venueId:string, productId:string, s:{id:string;name:string}) {
  const now = serverTimestamp();
  const pref = doc(db,'venues',venueId,'products',productId);
  const prefSnap = await getDoc(pref);
  if (prefSnap.exists()) {
    await setDoc(pref, {
      supplierId: s.id, supplierName: s.name, supplier: { id: s.id, name: s.name }, updatedAt: now,
    }, { merge: true });
  }
}

// Set PAR on PRODUCT (Option B)
async function setParSmart(db:any, venueId:string, productId:string, par:number) {
  const now = serverTimestamp();
  const pref = doc(db,'venues',venueId,'products',productId);
  const prefSnap = await getDoc(pref);
  if (prefSnap.exists()) {
    await setDoc(pref, { par: Math.round(par), updatedAt: now }, { merge: true });
  }
}

// Utility: get the most recent stock-take completion time across all areas
async function getLastStockTakeCompletedAt(db:any, venueId:string){
  let latest: any = null;
  const deps = await getDocs(collection(db,'venues',venueId,'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(collection(db,'venues',venueId,'departments',dep.id,'areas'));
    areas.forEach(a=>{
      const data:any = a.data()||{};
      const c = data?.completedAt;
      if (c && typeof c.toMillis === 'function') {
        const ms = c.toMillis();
        if (latest == null || ms > latest) latest = ms;
      }
    });
  }
  return latest; // number (ms) or null
}

// ---------- Screen ----------
export default function SuggestedOrderScreen(){
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();
  const auth = getAuth();
  const uid = auth?.currentUser?.uid || 'dev';

  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<BucketRow[]>([]);
  const [snapshot, setSnapshot] = useState<any>(null);

  // existing drafts’ suggestionKeys (to block duplicate Create Draft)
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());

  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierPreview, setSupplierPreview] = useState<any>(null); // { supplierId, supplierName, lines, suggestionKey, alreadyDrafted }

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSuppliers, setPickerSuppliers] = useState<{id:string;name:string}[]>([]);
  const [pickerForProductId, setPickerForProductId] = useState<string|null>(null);

  const [parOpen, setParOpen] = useState(false);
  const [parValue, setParValue] = useState('');
  const [parProductId, setParProductId] = useState<string|null>(null);

  // NEW: entitlement state + paywall sheet
  const [entitled, setEntitled] = useState<boolean>(false);
  const [payOpen, setPayOpen] = useState<boolean>(false);

  // ---- one-time init + debounce guards ------------------------------------
  const didInitRef = useRef(false);
  const inFlightRef = useRef<null | NodeJS.Timeout>(null);

  // Accept both shapes from suggester, normalize and de-dupe
  function normalizeCompat(compat:any){
    const raw: Record<string,{lines:any[]; supplierName?:string}> =
      (compat && compat.buckets && typeof compat.buckets==='object') ? compat.buckets : (compat||{});
    const unStart:any[] = Array.isArray(compat?.unassigned?.lines) ? compat.unassigned.lines : [];
    const unPool:any[] = [...unStart];
    const real: Record<string,{lines:any[]; supplierName?:string}> = {};
    Object.entries(raw).forEach(([key,b]:any)=>{
      const lines = Array.isArray(b?.lines) ? b.lines : [];
      if (NO_SUPPLIER_KEYS.has(String(key))) { if (lines.length) unPool.push(...lines); return; }
      if (lines.length>0) real[key] = { lines: dedupeByProductId(lines), supplierName: b?.supplierName };
    });
    const unassigned = { lines: dedupeByProductId(unPool) };
    return { buckets: real, unassigned };
  }

  // Option B graduation shim:
  async function graduateUnassignedUsingProducts(
    venueId:string,
    buckets: Record<string,{lines:any[]; supplierName?:string}>,
    unassigned: { lines:any[] }
  ){
    const lines = Array.isArray(unassigned?.lines) ? unassigned.lines : [];
    if (lines.length === 0) return { buckets, unassigned };

    // 1) Fetch products in chunks of 10 (Firestore 'in' limit)
    const productIds = Array.from(new Set(lines.map((l:any)=> String(l?.productId||'')).filter(Boolean)));
    const prodsMap: Record<string,{ supplierId?:string; supplierName?:string; par?:number }> = {};
    for (let i=0;i<productIds.length;i+=10) {
      const chunk = productIds.slice(i, i+10);
      const q = fsQuery(collection(db,'venues',venueId,'products'), where(documentId(), 'in', chunk));
      const snap = await getDocs(q);
      snap.forEach(d=>{
        const data:any = d.data()||{};
        prodsMap[d.id] = {
          supplierId: data?.supplierId || data?.supplier?.id || undefined,
          supplierName: data?.supplierName || data?.supplier?.name || undefined,
          par: Number.isFinite(data?.par) ? Number(data.par) : undefined,
        };
      });
    }

    // 2) Graduate lines that have a product supplier
    const keptUnassigned: any[] = [];
    const bucketsOut: typeof buckets = { ...buckets };
    for (const l of lines) {
      const pid = String(l?.productId||'');
      if (!pid) continue;
      const p = prodsMap[pid];
      const hasSupplier = !!p?.supplierId;
      if (hasSupplier) {
        const sid = String(p!.supplierId);
        const sname = p?.supplierName || bucketsOut[sid]?.supplierName || undefined;
        if (!bucketsOut[sid]) bucketsOut[sid] = { lines: [], supplierName: sname };
        const existing = new Set((bucketsOut[sid].lines||[]).map((x:any)=> String(x?.productId||'')));
        if (!existing.has(pid)) bucketsOut[sid].lines.push(l);
      } else {
        keptUnassigned.push(l);
      }
    }

    Object.keys(bucketsOut).forEach(k=>{
      bucketsOut[k].lines = dedupeByProductId(bucketsOut[k].lines||[]);
    });

    return { buckets: bucketsOut, unassigned: { lines: keptUnassigned } };
  }

  // Load existing suggestion draft keys (last stock-take or last 7 days)
  const loadExistingSuggestionKeys = useCallback(async ()=>{
    if (!venueId) { setExistingKeys(new Set()); return; }
    const lastCompletedMs = await getLastStockTakeCompletedAt(db, venueId);
    const sevenDaysAgo = Date.now() - 7*24*60*60*1000;
    const cutoffMs = lastCompletedMs ?? sevenDaysAgo;

    const ref = collection(db,'venues',venueId,'orders');
    const snap = await getDocs(fsQuery(ref, orderBy('createdAt','desc')));
    const keys = new Set<string>();
    snap.forEach(d=>{
      const data:any = d.data()||{};
      const status = (data.displayStatus || data.status || 'draft').toLowerCase();
      const ts = data?.createdAt; const ms = ts?.toMillis ? ts.toMillis() : 0;
      if (status === 'draft' && ms >= cutoffMs && data?.source === 'suggestions' && typeof data?.suggestionKey === 'string') {
        keys.add(data.suggestionKey);
      }
    });
    setExistingKeys(keys);
  },[db, venueId]);

  const computeRowsFromSnapshot = useCallback(async (snapCompat:any)=>{
    let { buckets, unassigned } = snapCompat;

    // Supplier name map (for rows)
    const supMap: Record<string,string> = {};
    const supSnap = await getDocs(collection(db,'venues',venueId,'suppliers'));
    supSnap.forEach(d => { supMap[d.id] = String((d.data() as any)?.name || 'Supplier'); });

    // Build rows: Unassigned first (only if count>0), then suppliers sorted by count
    const tmp:BucketRow[]=[];
    if (Array.isArray(unassigned?.lines) && unassigned.lines.length>0){
      tmp.push({ id:'unassigned', supplierId:'unassigned', supplierName:'Unassigned', itemsCount: unassigned.lines.length });
    }
    Object.entries(buckets || {}).forEach(([sid,b]:any)=>{
      const c = Array.isArray(b?.lines)? b.lines.length : 0;
      if (c<=0) return;
      const label = b?.supplierName || supMap[sid] || `#${String(sid).slice(-4)}`;
      tmp.push({ id:sid, supplierId:sid, supplierName: label, itemsCount: c });
    });
    const uIdx = tmp.findIndex(r=>r.id==='unassigned');
    const sorted = tmp.filter(r=>r.id!=='unassigned').sort((a,b)=> (b.itemsCount||0)-(a.itemsCount||0));
    setRows(uIdx>=0 ? [tmp[uIdx], ...sorted] : sorted);
    setSnapshot({ buckets, unassigned });
  },[db, venueId]);

  const doRefreshRaw = useCallback(async ()=>{
    if (!venueId){ setRows([]); setSnapshot(null); return; }

    // Load existing suggestion draft keys first (so preview can block duplicates)
    await loadExistingSuggestionKeys();

    const compat:any = await buildSuggestedOrdersInMemory(venueId, { roundToPack:true, defaultParIfMissing:6 });
    if (DEBUG_SO) logSuggestShape('compat', compat);

    let { buckets, unassigned } = (() => {
      const normalized = (() => {
        const raw: Record<string,{lines:any[]; supplierName?:string}> =
          (compat && compat.buckets && typeof compat.buckets==='object') ? compat.buckets : (compat||{});
        const unStart:any[] = Array.isArray(compat?.unassigned?.lines) ? compat.unassigned.lines : [];
        const unPool:any[] = [...unStart];
        const real: Record<string,{lines:any[]; supplierName?:string}> = {};
        Object.entries(raw).forEach(([key,b]:any)=>{
          const lines = Array.isArray(b?.lines) ? b.lines : [];
          if (NO_SUPPLIER_KEYS.has(String(key))) { if (lines.length) unPool.push(...lines); return; }
          if (lines.length>0) real[key] = { lines: dedupeByProductId(lines), supplierName: b?.supplierName };
        });
        const unassigned = { lines: dedupeByProductId(unPool) };
        return { buckets: real, unassigned };
      })();
      return normalized;
    })();

    if (DEBUG_SO) {
      const firstUn = unassigned?.lines?.[0] || null;
      const bks = Object.keys(buckets || {});
      const firstBk = bks[0];
      const firstBkLine = firstBk ? (buckets[firstBk]?.lines?.[0] || null) : null;
      const pid = String(firstUn?.productId || firstBkLine?.productId || '');
      if (pid) { logProductDoc(venueId, pid); }
    }

    // Graduate Unassigned using current Products
    const graduated = await graduateUnassignedUsingProducts(venueId, buckets, unassigned);
    await computeRowsFromSnapshot(graduated);
  },[venueId, loadExistingSuggestionKeys, computeRowsFromSnapshot]);

  // Debounced wrapper to avoid duplicate kicks
  const doRefresh = useCallback(()=>{
    if (inFlightRef.current) return; // simple throttle
    inFlightRef.current = setTimeout(async ()=>{
      try { await doRefreshRaw(); } finally {
        clearTimeout(inFlightRef.current as any);
        inFlightRef.current = null;
      }
    }, 50); // tiny debounce for React double-effect
  },[doRefreshRaw]);

  // Initial mount: check entitlement once & refresh once
  useEffect(()=>{
    if (!venueId) return;
    if (didInitRef.current) return;
    didInitRef.current = true;

    (async ()=>{
      setRefreshing(true);
      try{
        // entitlement check (non-blocking)
        try{
          const ent = await checkEntitlement(venueId, uid);
          setEntitled(!!ent.entitled);
        }catch{}

        doRefresh();
      } finally {
        setRefreshing(false);
      }
    })();
  },[venueId, uid, doRefresh]);

  const openUnassigned = useCallback(()=>{ if (snapshot?.unassigned?.lines?.length) setUnassignedOpen(true); },[snapshot]);

  const openSupplierPreview = useCallback((supplierId:string, supplierName:string)=>{
    if (!snapshot) return;
    const bucket = snapshot.buckets?.[supplierId];
    const lines = Array.isArray(bucket?.lines) ? bucket.lines : [];
    const previewLines = lines.map((l:any)=>({
      productId: String(l.productId),
      productName: String(l.productName ?? l.name ?? l.productId ?? ''),
      qty: m1(l.qty),
      cost: n(l.unitCost ?? l.cost ?? 0, 0),
      packSize: Number.isFinite(l?.packSize) ? Number(l.packSize) : null,
    }));
    const suggestionKey = buildSuggestionKey(supplierId, previewLines);
    const alreadyDrafted = existingKeys.has(suggestionKey);
    setSupplierPreview({ supplierId, supplierName, lines: previewLines, suggestionKey, alreadyDrafted });
    setSupplierOpen(true);
  },[snapshot, existingKeys]);

  const createDraftForPreview = useCallback(async () => {
    if (!venueId || !supplierPreview) return;

    if (supplierPreview.alreadyDrafted) {
      Alert.alert(
        'Already drafted',
        'A draft for this supplier’s current suggestion has already been created. Find it in Orders.',
        [{ text: 'OK', onPress: () => {} }]
      );
      return;
    }

    try {
      const suggestions = supplierPreview.lines.map((l:any)=>({
        productId: String(l.productId),
        productName: String(l.productName || l.name || l.productId),
        qty: Math.max(1, Math.round(Number(l.qty||0))),
        cost: Number(l.cost||0),
        packSize: Number.isFinite(l.packSize)? Number(l.packSize) : null,
      }));
      const res = await createDraft(db, venueId, supplierPreview.supplierId, supplierPreview.supplierName, suggestions, supplierPreview.suggestionKey);
      const orderId = res?.id;
      if (!orderId) throw new Error('No order id');
      setSupplierOpen(false);

      // Confirmation only (no "View now")
      const msg = `Draft saved — find it in Orders. (${supplierPreview.supplierName || 'supplier'}, ${suggestions.length} line${suggestions.length===1?'':'s'})`;
      Alert.alert('Draft saved', msg, [
        { text: 'OK', onPress: () => { if (Platform.OS==='android') ToastAndroid.show('Draft saved in Orders', ToastAndroid.SHORT); } }
      ]);

      // Update local block list so button disables immediately without a full refresh
      setExistingKeys(prev => {
        const next = new Set(prev);
        next.add(supplierPreview.suggestionKey);
        return next;
      });
    } catch (e:any) {
      Alert.alert('Could not create draft', e?.message || 'Please try again.');
    }
  }, [venueId, supplierPreview, db]);

  const openSupplierPicker = useCallback(async (candidateId:string)=>{
    if (!venueId) return;
    const snap = await getDocs(collection(db,'venues',venueId,'suppliers'));
    const list:{id:string;name:string}[]=[];
    snap.forEach(d=> list.push({ id:d.id, name:String((d.data() as any)?.name || 'Supplier') }));
    setPickerSuppliers(list.filter(s=> s.name.toLowerCase()!=='unassigned'));
    setPickerForProductId(candidateId);
    setPickerOpen(true);
  },[db, venueId]);

  const pickSupplier = useCallback(async (s:{id:string;name:string})=>{
    if (!venueId || !pickerForProductId) return;
    try{
      await assignSupplierSmart(db, venueId, pickerForProductId, s);
      setPickerOpen(false);
      setPickerForProductId(null);
      Alert.alert('Saved','Supplier assigned.');
      doRefresh();
    }catch(e:any){
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
  },[venueId, pickerForProductId, db, doRefresh]);

  const setParInline = useCallback((candidateId:string)=>{
    setParProductId(candidateId);
    setParValue('');
    setParOpen(true);
  },[]);

  const savePar = useCallback(async ()=>{
    if (!venueId || !parProductId) return;
    const val = Number(parValue);
    if (!Number.isFinite(val) || val <=0){ Alert.alert('Invalid','Enter a positive number'); return; }
    try{
      await setParSmart(db, venueId, parProductId, Math.round(val));
      setParOpen(false); setParProductId(null); setParValue('');
      Alert.alert('Saved','PAR updated.');
      doRefresh();
    }catch(e:any){
      Alert.alert('Could not save', e?.message || 'Please try again.');
    }
  },[venueId, parProductId, parValue, db, doRefresh]);

  // ---- AI button handler with paywall --------------------------------------
  const onPressAI = useCallback(async ()=>{
    if (!venueId) return;
    // gate
    if (!entitled) { setPayOpen(true); return; }

    try{
      setRefreshing(true);
      const normalized = await runAISuggest(venueId, { historyDays: 28, k: 3, max: 400 });
      // After AI result, apply same graduation and row builder
      const graduated = await graduateUnassignedUsingProducts(venueId, normalized.buckets, normalized.unassigned);
      await computeRowsFromSnapshot(graduated);
    } catch (e:any) {
      Alert.alert('AI unavailable', e?.message || 'Please try again later.');
    } finally {
      setRefreshing(false);
    }
  },[venueId, entitled, computeRowsFromSnapshot]);

  const keyExtractor = useCallback((r:BucketRow)=>String(r.id),[]);
  const renderRow = useCallback(({item:row}:{item:BucketRow})=>(
    <TouchableOpacity style={[S.row, row.supplierId==='unassigned'? S.rowUnassigned:null]}
      onPress={()=> row.supplierId==='unassigned'? setUnassignedOpen(true): openSupplierPreview(row.supplierId, row.supplierName)}>
      <View style={{flex:1}}>
        <Text style={S.rowTitle}>{row.supplierName}</Text>
        <Text style={S.rowSub}>{row.itemsCount} item{row.itemsCount===1?'':'s'}{row.supplierId==='unassigned'?' — Tap to assign supplier or set PAR':''}</Text>
      </View>
      <Text style={S.chev}>›</Text>
    </TouchableOpacity>
  ),[openSupplierPreview]);

  const HeaderRight = useMemo(()=>(
    <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
      {/* Entitlement badge */}
      <View style={[S.badge, entitled ? S.badgeOk : S.badgeLock]}>
        <Text style={[S.badgeText, entitled ? S.badgeTextOk : S.badgeTextLock]}>
          {entitled ? 'AI enabled' : 'AI locked'}
        </Text>
      </View>
      {/* AI button */}
      <TouchableOpacity onPress={onPressAI} style={S.aiBtn}>
        <Text style={S.aiBtnText}>Use AI (beta)</Text>
      </TouchableOpacity>
    </View>
  ),[entitled, onPressAI]);

  const listHeader = useMemo(()=>(
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
      {/* Top action bar */}
      <View style={S.topBar}>
        {HeaderRight}
      </View>

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

      {/* Unassigned Modal */}
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

              {/* Create Draft: disabled if already drafted */}
              <TouchableOpacity
                style={[S.smallBtn, supplierPreview?.alreadyDrafted ? { backgroundColor:'#9CA3AF' } : null]}
                disabled={!!supplierPreview?.alreadyDrafted}
                onPress={createDraftForPreview}
              >
                <Text style={S.smallBtnText}>
                  {supplierPreview?.alreadyDrafted ? 'Already Drafted' : 'Create Draft'}
                </Text>
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
                <TouchableOpacity style={S.smallBtn} onPress={()=>setParOpen(false)}><Text style={S.smallBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={S.smallBtn} onPress={savePar}><Text style={S.smallBtnText}>Save</Text></TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Paywall Sheet (re-usable) */}
      <PaymentSheet
        visible={payOpen}
        onClose={()=>setPayOpen(false)}
        venueId={venueId || 'unknown'}
        uid={uid}
        onEntitled={(st)=>{ setEntitled(true); setPayOpen(false); }}
      />
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{ flex:1, backgroundColor:'#fff' },

  topBar:{ paddingHorizontal:16, paddingTop:12, paddingBottom:6, flexDirection:'row', alignItems:'center', justifyContent:'flex-end', borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#eee' },

  header:{ paddingHorizontal:16, paddingTop:12, paddingBottom:6, flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  title:{ fontSize:22, fontWeight:'800' },

  // AI badge + button
  badge:{ paddingVertical:4, paddingHorizontal:8, borderRadius:999, borderWidth:1 },
  badgeOk:{ backgroundColor:'#ecfdf5', borderColor:'#10b981' },
  badgeLock:{ backgroundColor:'#fef2f2', borderColor:'#ef4444' },
  badgeText:{ fontSize:11, fontWeight:'800' },
  badgeTextOk:{ color:'#065f46' },
  badgeTextLock:{ color:'#7f1d1d' },

  aiBtn:{ backgroundColor:'#111827', paddingVertical:8, paddingHorizontal:12, borderRadius:10 },
  aiBtnText:{ color:'#fff', fontWeight:'800', fontSize:12 },

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
  modalBack:{ flex:1, backgroundColor:'rgba(0,0,0,0.3)', justifyContent:'center', padding:24 },
  modalCard:{ backgroundColor:'#fff', borderRadius:12, padding:16, maxHeight:'75%' },
  modalTitle:{ fontSize:18, fontWeight:'700', marginBottom:8 },
  modalRow:{ paddingVertical:12, borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#eee' },
  modalRowText:{ fontSize:16 },
  input:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, padding:10, fontSize:16 },
});
