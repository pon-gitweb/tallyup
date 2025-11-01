// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, FlatList, Alert, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  getFirestore,
  collection,
  onSnapshot,
  deleteDoc,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { deleteDraft as deleteDraftSvc } from '../../services/orders/deleteDraft';

function normalizeDisplayStatus(o:any){
  const s = (o?.status || "draft");
  if (s === "received") return { ...o, displayStatus: "received" };
  if (s === "submitted") return { ...o, displayStatus: "submitted" };
  if (s === "pending_merge") return { ...o, displayStatus: "Pending merge" };
  return { ...o, displayStatus: s };
}

type OrderRow = {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status: string;
  displayStatus?: string | null;
  poNumber?: string | null;
  createdAt?: any;
  createdAtClientMs?: number | null;
  submittedAt?: any;
  receivedAt?: any;
  linesCount?: number | null;
  total?: number | null;
  submitHoldUntil?: number | null;
  cutoffAt?: number | null;
  deptScope?: string[] | string | null;
};

const S = StyleSheet.create({
  wrap:{flex:1,backgroundColor:'#fff'},
  top:{paddingHorizontal:16,paddingTop:12,paddingBottom:8,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  title:{fontSize:22,fontWeight:'800',marginBottom:8},
  segWrap:{flexDirection:'row',borderWidth:1,borderColor:'#E5E7EB',borderRadius:999,overflow:'hidden'},
  segBtn:{paddingVertical:8,paddingHorizontal:12,backgroundColor:'#fff'},
  segActive:{backgroundColor:'#111827'},
  segText:{fontSize:13,fontWeight:'800',color:'#111827'},
  segTextActive:{color:'#fff'},

  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  left:{flex:1},
  rowTitle:{fontSize:16,fontWeight:'700'},
  rowSub:{color:'#6B7280',marginTop:2},
  pillRow:{flexDirection:'row',gap:6,marginTop:6,flexWrap:'wrap'},
  pill:{alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:3,borderRadius:999,backgroundColor:'#F3F4F6'},
  pillText:{fontSize:11,fontWeight:'700',color:'#374151'},
  warnPill:{alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:3,borderRadius:999,backgroundColor:'#FEF3C7'},
  warnPillText:{fontSize:11,fontWeight:'800',color:'#92400E'},
  smallBtn:{backgroundColor:'#111827',paddingVertical:6,paddingHorizontal:10,borderRadius:8},
  smallBtnText:{color:'#fff',fontSize:12,fontWeight:'700'},
  empty:{padding:24,alignItems:'center'},
  emptyText:{color:'#6B7280'},

  // FAB
  fab:{position:'absolute',right:16,bottom:24,backgroundColor:'#111827',paddingVertical:14,paddingHorizontal:18,borderRadius:999,shadowColor:'#000',shadowOpacity:0.2,shadowRadius:6,elevation:4},
  fabText:{color:'#fff',fontWeight:'800'}
});

// canonical map
const CANON = {
  draft: 'draft',
  pending: 'pending',
  'pending_merge': 'pending_merge',
  submitted: 'submitted',
  sent: 'submitted',
  placed: 'submitted',
  approved: 'submitted',
  awaiting: 'submitted',
  processing: 'submitted',
  queued: 'submitted',
  holding: 'submitted',
  onhold: 'submitted',
  consolidating: 'submitted',
  received: 'received',
  'partially_received': 'received',
  complete: 'received',
  closed: 'received',
  canceled: 'cancelled',
  cancelled: 'cancelled',
};

function canonicalizeStatus(statusRaw: any, displayRaw: any): string {
  const s = String(statusRaw ?? '').toLowerCase().trim();
  if (s && CANON[s as keyof typeof CANON]) return CANON[s as keyof typeof CANON];
  const d = String(displayRaw ?? '').toLowerCase().trim();
  if (d && CANON[d as keyof typeof CANON]) return CANON[d as keyof typeof CANON];
  if (__DEV__) console.log('[OrdersScreen] legacy/unknown status → draft', { statusRaw, displayRaw });
  return 'draft';
}

const STATUS_GROUPS = {
  drafts: (r:OrderRow)=>{
    const s = (r.status||'').toLowerCase().trim();
    if (s === 'cancelled') return false;
    return s === 'draft' || s === 'pending' || s === 'pending_merge';
  },
  submitted: (r:OrderRow)=>{
    const s = (r.status||'').toLowerCase().trim();
    const hasSubmittedAt = !!(r.submittedAt && (r.submittedAt.toMillis?.() || Number(r.submittedAt)));
    if (s === 'cancelled') return false;
    if (s === 'received') return false;
    return s === 'submitted' || hasSubmittedAt;
  },
  received: (r:OrderRow)=>{
    const s = (r.status||'').toLowerCase().trim();
    return s === 'received';
  },
};

export default function OrdersScreen(){
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [tab,setTab]=useState<'drafts'|'submitted'|'received'>('drafts');
  const [rowsAll,setRowsAll]=useState<OrderRow[]>([]);
  const [refreshing,setRefreshing]=useState(false);
  const [receiveFor,setReceiveFor] = useState<OrderRow|null>(null);

  useEffect(()=>{
    if(!venueId) return;
    const ref = collection(db,'venues',venueId,'orders');
    const unsub = onSnapshot(ref,(snap)=>{
      const out:OrderRow[]=[];
      snap.forEach((docSnap)=>{
        const d:any=docSnap.data()||{};
        const canon = canonicalizeStatus(d.status, d.displayStatus);

        if (__DEV__) {
          const rawS = String(d.status ?? '').toLowerCase().trim();
          const rawD = String(d.displayStatus ?? '').toLowerCase().trim();
          if ((d.submittedAt && canon !== 'submitted' && canon !== 'received')) {
            console.log('[OrdersScreen] has submittedAt but not canonical submitted', { id: docSnap.id, rawD, rawS });
          }
        }

        out.push({
          id:docSnap.id,
          supplierId:d.supplierId??null,
          supplierName:d.supplierName??'Supplier',
          status:canon,
          displayStatus:d.displayStatus ?? null,
          poNumber: d.poNumber ?? null,
          createdAt:d.createdAt??null,
          createdAtClientMs: Number.isFinite(d.createdAtClientMs) ? Number(d.createdAtClientMs) : (d.createdAtClientMs ? Number(d.createdAtClientMs) : null),
          submittedAt:d.submittedAt??null,
          receivedAt:d.receivedAt??null,
          linesCount:Number.isFinite(d.linesCount)?Number(d.linesCount):null,
          total:Number.isFinite(d.total)?Number(d.total):null,
          submitHoldUntil: typeof d.submitHoldUntil === 'number' ? d.submitHoldUntil : (Number(d.submitHoldUntil)||null),
          cutoffAt: typeof d.cutoffAt === 'number' ? d.cutoffAt : (Number(d.cutoffAt)||null),
          deptScope: Array.isArray(d.deptScope) ? d.deptScope : (d.deptScope ?? null),
        });
      });
      const ms=(x:any)=>x?.toMillis?.()??0;
      out.sort((a,b)=>{
        const ta = ms(a.receivedAt)||ms(a.submittedAt)||ms(a.createdAt)||a.createdAtClientMs||0;
        const tb = ms(b.receivedAt)||ms(b.submittedAt)||ms(b.createdAt)||b.createdAtClientMs||0;
        return tb - ta;
      });
      setRowsAll(out);
    },(err)=>{
      console.warn('[OrdersScreen] onSnapshot error', err);
      setRowsAll([]);
    });
    return ()=>unsub();
  },[db,venueId]);

  const counts = useMemo(()=>{
    let d=0,s=0,r=0;
    rowsAll.forEach(row=>{
      if (STATUS_GROUPS.drafts(row)) d++;
      else if (STATUS_GROUPS.received(row)) r++;
      else if (STATUS_GROUPS.submitted(row)) s++;
    });
    if (__DEV__) console.log('[OrdersScreen] buckets', {drafts:d, submitted:s, received:r});
    return {drafts:d, submitted:s, received:r};
  },[rowsAll]);

  const rows=useMemo(()=>{
    const pick=STATUS_GROUPS[tab];
    const filtered = rowsAll.filter(r=>pick(r));
    if (__DEV__) {
      const sample = filtered.slice(0,3).map(r=>({id:r.id,status:r.status,linesCount:r.linesCount,displayStatus:r.displayStatus}));
      console.log(`[OrdersScreen] sample(${tab})`, sample);
    }
    return filtered;
  },[rowsAll,tab]);

  const openRow=useCallback((row:OrderRow)=>{
    const s=String(row.status||'draft');
    if(s==='draft' || s==='pending' || s==='pending_merge'){
      nav.navigate('OrderEditor',{orderId:row.id,mode:'edit'});
    }else{
      nav.navigate('OrderDetail',{orderId:row.id});
    }
  },[nav]);

  const startReceive=useCallback((row:OrderRow)=>{ setReceiveFor(row); },[]);

  const confirmDelete=useCallback(async (row:OrderRow)=>{
    Alert.alert('Delete draft','This will permanently delete the draft and its lines.',[
      { text:'Cancel', style:'cancel' },
      { text:'Delete', style:'destructive', onPress: async ()=>{
        try{
          if (!venueId) return;
          await deleteDraftSvc(venueId, row.id);
        }catch(e){
          const msg = (e && (e as any).message) ? (e as any).message : 'Could not delete draft.';
          Alert.alert('Delete failed', msg);
        }
      }}
    ]);
  },[venueId]);

  const renderItem=useCallback(({item}:{item:OrderRow})=>{
    const bits:string[]=[];
    if(item.linesCount!=null) bits.push(`${item.linesCount} line${item.linesCount===1?'':'s'}`);
    if(item.total!=null) bits.push(`$${item.total.toFixed(2)}`);
    const subtitle=bits.join(' • ');
    const statusText = (item.status==='received') ? 'received' : (item.displayStatus || item.status || '—');
    const isSubmitted=STATUS_GROUPS.submitted(item);
    const isDraft = STATUS_GROUPS.drafts(item);

    const holdMs = Number(item.submitHoldUntil ?? item.cutoffAt ?? 0);
    const isHeld = isSubmitted && holdMs > Date.now();

    return(
      <View style={S.row}>
        <TouchableOpacity
          style={S.left}
          onPress={()=>openRow(item)}
          onLongPress={()=>{ if(isDraft) confirmDelete(item); }}
          delayLongPress={350}
          activeOpacity={0.8}
        >
          <Text style={S.rowTitle}>{item.supplierName||'Supplier'}</Text>
          <Text style={S.rowSub}>{subtitle||'—'}</Text>

          <View style={S.pillRow}>
            <View style={S.pill}><Text style={S.pillText}>{statusText}</Text></View>
            {isSubmitted && item.poNumber ? (
              <View style={S.pill}><Text style={S.pillText}>PO {item.poNumber}</Text></View>
            ) : null}
            {isHeld ? (
              <View style={S.warnPill}>
                <Text style={S.warnPillText}>
                  Held until {new Date(holdMs).toLocaleTimeString()}
                </Text>
              </View>
            ) : null}
            {Array.isArray(item.deptScope) && item.deptScope.length>0 ? (
              <View style={S.pill}><Text style={S.pillText}>{(item.deptScope as string[]).join(' · ')}</Text></View>
            ) : null}
          </View>
        </TouchableOpacity>

        {null}
      </View>
    );
  },[openRow,startReceive,confirmDelete]);

  const onRefresh=useCallback(()=>{ setRefreshing(true); setTimeout(()=>setRefreshing(false),200); },[]);

  // ---- Auto-clean stale drafts
  const cleanedRef = useRef(false);
  useEffect(()=>{
    if(!venueId || cleanedRef.current) return;
    cleanedRef.current = true;

    (async ()=>{
      const ref = collection(db,'venues',venueId,'orders');
      const sevenDaysMs = 7*24*60*60*1000;
      const cutoffMs = Date.now() - sevenDaysMs;

      try{
        const qy = query(ref, where('status','==','draft'), where('createdAtClientMs','<', cutoffMs));
        const snap = await getDocs(qy);
        const stale = snap.docs;
        console.log('[Orders] Auto-clean stale drafts count =', stale.length);
        await Promise.all(stale.map(d => deleteDoc(d.ref)));
        console.log('[Orders] Auto-clean complete');
      }catch(err:any){
        console.log('[Orders] Auto-clean failed (index likely missing). Falling back to client filter.', err?.message || err);
        try{
          const snapAll = await getDocs(ref);
          const staleAll = snapAll.docs.filter(d=>{
            const v:any = d.data()||{};
            const canon = canonicalizeStatus(v.status, v.displayStatus);
            if(canon!=='draft' && canon!=='pending' && canon!=='pending_merge') return false;
            const clientMs = Number(v.createdAtClientMs||0);
            const serverMs = v.createdAt?.toMillis?.() ?? 0;
            const ts = clientMs || serverMs || 0;
            return ts>0 && ts < cutoffMs;
          });
          console.log('[Orders] Auto-clean (no-index) stale count =', staleAll.length);
          await Promise.all(staleAll.map(d=>deleteDoc(d.ref)));
          console.log('[Orders] Auto-clean complete');
        }catch(e2){
          console.log('[Orders] Auto-clean fallback failed', e2);
        }
      }
    })();
  },[db,venueId]);

  const SegBtn = ({label,active,onPress}:{label:string;active:boolean;onPress:()=>void})=>(
    <TouchableOpacity onPress={onPress} style={[S.segBtn, active && S.segActive]}>
      <Text style={[S.segText, active && S.segTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return(
    <View style={S.wrap}>
      <View style={S.top}>
        <Text style={S.title}>Orders</Text>
        <View style={S.segWrap}>
          <SegBtn label={`Drafts (${counts.drafts})`} active={tab==='drafts'} onPress={()=>setTab('drafts')} />
          <SegBtn label={`Submitted (${counts.submitted})`} active={tab==='submitted'} onPress={()=>setTab('submitted')} />
          <SegBtn label={`Received (${counts.received})`} active={tab==='received'} onPress={()=>setTab('received')} />
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(x)=>x.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<View style={S.empty}><Text style={S.emptyText}>No orders</Text></View>}
      />

      {/* FAB for New Order */}
      <TouchableOpacity style={S.fab} onPress={()=>nav.navigate('NewOrderStart' as never)}>
        <Text style={S.fabText}>New Order</Text>
      </TouchableOpacity>

      {/* Receive Options Modal (baseline) */}
      <Modal visible={!!receiveFor} transparent animationType="fade" onRequestClose={()=>setReceiveFor(null)}>
        <TouchableOpacity activeOpacity={1} style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.3)'}} onPress={()=>setReceiveFor(null)}>
          <View style={{backgroundColor:'#fff',padding:16,borderTopLeftRadius:16,borderTopRightRadius:16}}>
            <Text style={{fontSize:18,fontWeight:'800',marginBottom:8}}>Receive Order</Text>
            <Text style={{color:'#6B7280',marginBottom:12}}>Choose how you want to receive this submitted order.</Text>

            <TouchableOpacity style={{paddingVertical:12}} onPress={()=>{
              const id = receiveFor?.id;
              setReceiveFor(null);
              if(id) nav.navigate('OrderDetail',{orderId:id, receiveNow:true, receiveMode:'manual'});
            }}>
              <Text style={{fontSize:16,fontWeight:'700'}}>Enter manually (edit quantities)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{paddingVertical:12}} onPress={()=>{
              const id = receiveFor?.id;
              setReceiveFor(null);
              if(id) nav.navigate('OrderDetail',{orderId:id, receiveNow:true, receiveMode:'scan'});
            }}>
              <Text style={{fontSize:16,fontWeight:'700'}}>Scan delivery (barcode/camera)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{paddingVertical:12}} onPress={()=>{
              const id = receiveFor?.id;
              setReceiveFor(null);
              if(id) nav.navigate('OrderDetail',{orderId:id, receiveNow:true, receiveMode:'upload'});
            }}>
              <Text style={{fontSize:16,fontWeight:'700'}}>Upload invoice (PDF/photo)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{paddingVertical:12}} onPress={()=>{
              const id = receiveFor?.id;
              setReceiveFor(null);
              if(id) nav.navigate('OrderDetail',{orderId:id});
            }}>
              <Text style={{fontSize:16,fontWeight:'700'}}>Open order (no receive)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{marginTop:8,alignSelf:'flex-end'}} onPress={()=>setReceiveFor(null)}>
              <Text style={{fontWeight:'700'}}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
