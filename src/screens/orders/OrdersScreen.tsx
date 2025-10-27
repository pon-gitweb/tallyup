// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, collection, onSnapshot } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';

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

  // grouping headers
  headerRow:{backgroundColor:'#F9FAFB',paddingVertical:8,paddingHorizontal:16,borderTopWidth:StyleSheet.hairlineWidth,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  headerText:{fontSize:12,fontWeight:'800',color:'#6B7280',textTransform:'uppercase'},
});

const STATUS_GROUPS = {
  drafts: (s:string)=>s==='draft',
  submitted: (s:string)=>['submitted','sent','placed','approved','awaiting','processing'].includes(s),
  received: (s:string)=>['received','complete','closed'].includes(s),
};

// ===== helpers for grouping =====
const ms = (x:any)=>x?.toMillis?.() ?? 0;
function toStartOfDay(ts:number){
  const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime();
}
function formatDay(ts:number){
  const d=new Date(ts);
  const dow = d.toLocaleDateString(undefined,{weekday:'short'});
  const day = d.toLocaleDateString(undefined,{day:'2-digit',month:'short'});
  return `${dow} ${day}`;
}
function startOfWeek(ts:number){ // Mon-based weeks
  const d=new Date(ts); const day=(d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day); return d.getTime();
}
function endOfWeek(ts:number){
  const s = startOfWeek(ts); const d=new Date(s); d.setDate(d.getDate()+6); return toStartOfDay(d.getTime());
}
function formatWeekRange(ts:number){
  const s = startOfWeek(ts), e = endOfWeek(ts);
  const sd = new Date(s), ed = new Date(e);
  const month = sd.toLocaleDateString(undefined,{month:'short'});
  const pad = (n:number)=>String(n).padStart(2,'0');
  return `${month} ${pad(sd.getDate())}–${pad(ed.getDate())}`;
}

type RowNode = { kind:'row'; data:OrderRow };
type HeaderNode = { kind:'header'; id:string; label:string };
type Node = RowNode|HeaderNode;

export default function OrdersScreen(){
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [tab,setTab]=useState<'drafts'|'submitted'|'received'>('drafts');
  const [rowsAll,setRowsAll]=useState<OrderRow[]>([]);
  const [refreshing,setRefreshing]=useState(false);

  // Subscribe to orders
  useEffect(()=>{
    if(!venueId) return;
    const ref = collection(db,'venues',venueId,'orders');
    const unsub = onSnapshot(ref,(snap)=>{
      const out:OrderRow[]=[];
      snap.forEach((doc)=>{
        const d:any=doc.data()||{};
        const s=String(d.status||d.displayStatus||'draft').toLowerCase();
        out.push({
          id:doc.id,
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
        });
      });
      // newest first by any available timestamp
      out.sort((a,b)=>{
        const ta = ms(a.receivedAt)||ms(a.submittedAt)||ms(a.createdAt)||a.createdAtClientMs||0;
        const tb = ms(b.receivedAt)||ms(b.submittedAt)||ms(b.createdAt)||b.createdAtClientMs||0;
        return tb - ta;
      });
      setRowsAll(out);
    },()=>setRowsAll([]));
    return ()=>unsub();
  },[db,venueId]);

  const baseRows=useMemo(()=>{
    const pick=STATUS_GROUPS[tab];
    return rowsAll.filter(r=>pick(String(r.status||'draft')));
  },[rowsAll,tab]);

  // Build grouped list only for Received tab; others are flat
  const data:Node[] = useMemo(()=>{
    if(tab!=='received') return baseRows.map(r=>({kind:'row',data:r}) as Node);

    const now = Date.now();
    const DAY_MS = 24*60*60*1000;
    const sevenDaysAgo = toStartOfDay(now - 7*DAY_MS);

    const buckets = new Map<string,{label:string; items:OrderRow[]}>();

    for(const r of baseRows){
      const t = ms(r.receivedAt)||ms(r.submittedAt)||ms(r.createdAt)||r.createdAtClientMs||0;
      if(!t){ continue; }
      if(t >= sevenDaysAgo){
        const dayKey = String(toStartOfDay(t));
        if(!buckets.has(dayKey)){
          buckets.set(dayKey,{label:formatDay(t),items:[]});
        }
        buckets.get(dayKey)!.items.push(r);
      }else{
        const wkKey = `W:${startOfWeek(t)}`;
        if(!buckets.has(wkKey)){
          buckets.set(wkKey,{label:formatWeekRange(t),items:[]});
        }
        buckets.get(wkKey)!.items.push(r);
      }
    }

    // Sort headers by most recent
    const entries = Array.from(buckets.entries()).sort((a,b)=>{
      const aKey = a[0].startsWith('W:') ? Number(a[0].slice(2)) : Number(a[0]);
      const bKey = b[0].startsWith('W:') ? Number(b[0].slice(2)) : Number(b[0]);
      return bKey - aKey;
    });

    const nodes:Node[]=[];
    entries.forEach(([key,grp])=>{
      nodes.push({kind:'header',id:key,label:grp.label});
      // keep rows inside each group already sorted newest-first by outer sort
      nodes.push(...grp.items.map(it=>({kind:'row',data:it} as Node)));
    });
    return nodes;
  },[baseRows,tab]);

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

  const renderNode=useCallback(({item}:{item:Node})=>{
    if(item.kind==='header'){
      return (
        <View style={S.headerRow}>
          <Text style={S.headerText}>{item.label}</Text>
        </View>
      );
    }
    const r=item.data;
    const bits:string[]=[];
    if(r.linesCount!=null) bits.push(`${r.linesCount} line${r.linesCount===1?'':'s'}`);
    if(r.total!=null) bits.push(`$${r.total.toFixed(2)}`);
    const subtitle=bits.join(' • ');
    const pillText=r.displayStatus||r.status||'—';
    const isSubmitted=STATUS_GROUPS.submitted(String(r.status||'draft'));
    return(
      <View style={S.row}>
        <TouchableOpacity style={S.left} onPress={()=>openRow(r)} activeOpacity={0.8}>
          <Text style={S.rowTitle}>{r.supplierName||'Supplier'}</Text>
          <Text style={S.rowSub}>{subtitle||'—'}</Text>
          <View style={S.pill}><Text style={S.pillText}>{pillText}</Text></View>
        </TouchableOpacity>
        {isSubmitted ? (
          <TouchableOpacity style={S.smallBtn} onPress={()=>startReceive(r)}>
            <Text style={S.smallBtnText}>Receive</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  },[openRow,startReceive]);

  const onRefresh=useCallback(()=>{
    // snapshot listener keeps rows fresh; just do a cosmetic spinner
    setRefreshing(true);
    setTimeout(()=>setRefreshing(false),200);
  },[]);

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
        data={data}
        keyExtractor={(n)=> n.kind==='header' ? `h:${n.id}` : n.data.id}
        renderItem={renderNode}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<View style={S.empty}><Text style={S.emptyText}>No {tab} orders.</Text></View>}
        contentContainerStyle={{paddingBottom:20}}
      />
    </View>
  );
}
