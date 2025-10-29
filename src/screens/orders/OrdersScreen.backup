// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, FlatList, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  query,
  where,
  getDocs,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { deleteDraft as deleteDraftSvc } from '../../services/orders/deleteDraft';

type OrderRow = {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  status?: string | null;
  displayStatus?: string | null;
  createdAt?: any;
  createdAtClientMs?: number | null;
  submittedAt?: any;
  receivedAt?: any;
  linesCount?: number | null;
  total?: number | null;
  // additive: may exist if upstream set it
  deptScope?: string[] | null;
};

const S = StyleSheet.create({
  wrap:{flex:1,backgroundColor:'#fff'},
  top:{paddingHorizontal:16,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB',flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  title:{fontSize:22,fontWeight:'800'},
  segWrap:{flexDirection:'row',borderWidth:1,borderColor:'#E5E7EB',borderRadius:999,overflow:'hidden'},
  segBtn:{paddingVertical:8,paddingHorizontal:12,backgroundColor:'#fff'},
  segActive:{backgroundColor:'#111827'},
  segText:{fontSize:13,fontWeight:'800',color:'#111827'},
  segTextActive:{color:'#fff'},
  addBtn:{backgroundColor:'#111827',paddingVertical:8,paddingHorizontal:12,borderRadius:10},
  addText:{color:'#fff',fontWeight:'800'},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:12,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  left:{flex:1},
  rowTitle:{fontSize:16,fontWeight:'700'},
  rowSub:{color:'#6B7280',marginTop:2},
  pill:{marginTop:6,alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:3,borderRadius:999,backgroundColor:'#F3F4F6'},
  pillText:{fontSize:11,fontWeight:'700',color:'#374151'},
  smallBtn:{backgroundColor:'#111827',paddingVertical:6,paddingHorizontal:10,borderRadius:8},
  smallBtnText:{color:'#fff',fontSize:12,fontWeight:'700'},
  empty:{padding:24,alignItems:'center'},
  emptyText:{color:'#6B7280'},
});

const STATUS_GROUPS = {
  drafts: (s:string)=>s==='draft',
  submitted: (s:string)=>['submitted','sent','placed','approved','awaiting','processing'].includes(s),
  received: (s:string)=>['received','complete','closed'].includes(s),
};

export default function OrdersScreen(){
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [tab,setTab]=useState<'drafts'|'submitted'|'received'>('drafts');
  const [rowsAll,setRowsAll]=useState<OrderRow[]>([]);
  const [refreshing,setRefreshing]=useState(false);

  // Subscribe to orders (newest first by any available timestamp)
  useEffect(()=>{
    if(!venueId) return;
    const ref = collection(db,'venues',venueId,'orders');
    const unsub = onSnapshot(ref,(snap)=>{
      const out:OrderRow[]=[];
      snap.forEach((docSnap)=>{
        const d:any=docSnap.data()||{};
        const s=String(d.status||d.displayStatus||'draft').toLowerCase();
        out.push({
          id:docSnap.id,
          supplierId:d.supplierId??null,
          supplierName:d.supplierName??'Supplier',
          status:s,
          displayStatus:d.displayStatus??s,
          createdAt:d.createdAt??null,
          createdAtClientMs:d.createdAtClientMs??null,
          submittedAt:d.submittedAt??null,
          receivedAt:d.receivedAt??null,
          linesCount:Number.isFinite(d.linesCount)?Number(d.linesCount):null,
          total:Number.isFinite(d.total)?Number(d.total):null,
          deptScope: Array.isArray(d.deptScope) ? d.deptScope : null, // additive
        });
      });
      const ms=(x:any)=>x?.toMillis?.()??0;
      out.sort((a,b)=>{
        const ta = ms(a.receivedAt)||ms(a.submittedAt)||ms(a.createdAt)||a.createdAtClientMs||0;
        const tb = ms(b.receivedAt)||ms(b.submittedAt)||ms(b.createdAt)||b.createdAtClientMs||0;
        return tb - ta;
      });
      setRowsAll(out);
    },()=>setRowsAll([]));
    return ()=>unsub();
  },[db,venueId]);

  const rows=useMemo(()=>{
    const pick=STATUS_GROUPS[tab];
    return rowsAll.filter(r=>pick(String(r.status||'draft')));
  },[rowsAll,tab]);

  const openRow=useCallback((row:OrderRow)=>{
    const s=String(row.status||'draft');
    if(s==='draft'){
      nav.navigate('OrderEditor',{orderId:row.id,mode:'edit'});
    }else{
      nav.navigate('OrderDetail',{orderId:row.id});
    }
  },[nav]);

  const startReceive=useCallback((row:OrderRow)=>{
    nav.navigate('OrderDetail',{orderId:row.id,receiveNow:true});
  },[nav]);

  // Delete draft via service (cascades lines + clears lock if last)
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
    const pillText=item.displayStatus||item.status||'—';
    const isSubmitted=STATUS_GROUPS.submitted(String(item.status||'draft'));
    const isDraft = String(item.status||'draft')==='draft';
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
          <View style={S.pill}><Text style={S.pillText}>{pillText}</Text></View>
          {/* additive: show dept scope if present */}
          {Array.isArray(item.deptScope) && item.deptScope.length>0 ? (
            <View style={S.pill}><Text style={S.pillText}>{item.deptScope.join(' · ')}</Text></View>
          ) : null}
        </TouchableOpacity>
        {isSubmitted ? (
          <TouchableOpacity style={S.smallBtn} onPress={()=>startReceive(item)}>
            <Text style={S.smallBtnText}>Receive</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  },[openRow,startReceive,confirmDelete]);

  const onRefresh=useCallback(()=>{
    setRefreshing(true);
    setTimeout(()=>setRefreshing(false),200);
  },[]);

  // ---- Auto-clean stale drafts (>=7 days) with index-aware fallback
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
        console.log('[Orders] Auto-clean failed', err);
        try{
          const snapAll = await getDocs(ref);
          const staleAll = snapAll.docs.filter(d=>{
            const v:any = d.data()||{};
            const s = String(v.status||v.displayStatus||'draft').toLowerCase();
            if(s!=='draft') return false;
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

  return(
    <View style={S.wrap}>
      <View style={S.top}>
        <View>
          <Text style={S.title}>Orders</Text>
          <View style={{height:8}}/>
          <View style={S.segWrap}>
            <TouchableOpacity onPress={()=>setTab('drafts')} style={[S.segBtn,tab==='drafts'&&S.segActive]}>
              <Text style={[S.segText,tab==='drafts'&&S.segTextActive]}>Drafts</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setTab('submitted')} style={[S.segBtn,tab==='submitted'&&S.segActive]}>
              <Text style={[S.segText,tab==='submitted'&&S.segTextActive]}>Submitted</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setTab('received')} style={[S.segBtn,tab==='received'&&S.segActive]}>
              <Text style={[S.segText,tab==='received'&&S.segTextActive]}>Received</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity onPress={()=>nav.navigate('NewOrder')} style={S.addBtn}>
          <Text style={S.addText}>New Order</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r)=>r.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<View style={S.empty}><Text style={S.emptyText}>No {tab} orders.</Text></View>}
        contentContainerStyle={{paddingBottom:20}}
      />
    </View>
  );
}
