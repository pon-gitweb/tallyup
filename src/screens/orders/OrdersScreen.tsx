// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, FlatList, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, collection, onSnapshot, doc, deleteDoc, getDocs } from 'firebase/firestore';
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
  pillWarn:{backgroundColor:'#FEF3C7'},
  pillWarnText:{color:'#92400E'},
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

  // Subscribe to orders
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

  const deleteDraft=useCallback(async(row:OrderRow)=>{
    if(!venueId) return;
    Alert.alert(
      'Delete draft?',
      `Delete draft for ${row.supplierName||'Supplier'} (${row.linesCount||0} lines). This cannot be undone.`,
      [
        { text:'Cancel', style:'cancel' },
        { text:'Delete', style:'destructive', onPress: async ()=>{
            try{
              // delete lines then the order
              const linesCol = collection(db,'venues',venueId,'orders',row.id,'lines');
              const snap = await getDocs(linesCol);
              const promises = snap.docs.map(d=>deleteDoc(doc(db,'venues',venueId,'orders',row.id,'lines',d.id)));
              await Promise.all(promises);
              await deleteDoc(doc(db,'venues',venueId,'orders',row.id));
            }catch(e:any){
              Alert.alert('Could not delete', e?.message||'Please try again.');
            }
          } },
      ]
    );
  },[db,venueId]);

  const isStaleDraft=(r:OrderRow)=>{
    const now=Date.now();
    const ms=(x:any)=>x?.toMillis?.()??0;
    const t = ms(r.createdAt) || r.createdAtClientMs || 0;
    if(!t) return false;
    return now - t > 7*24*60*60*1000;
  };

  const renderItem=useCallback(({item}:{item:OrderRow})=>{
    const bits:string[]=[];
    if(item.linesCount!=null) bits.push(`${item.linesCount} line${item.linesCount===1?'':'s'}`);
    if(item.total!=null) bits.push(`$${item.total.toFixed(2)}`);
    const subtitle=bits.join(' • ');
    const pillText=item.displayStatus||item.status||'—';
    const isSubmitted=STATUS_GROUPS.submitted(String(item.status||'draft'));
    const isDraft=String(item.status)==='draft';
    const stale=isDraft && isStaleDraft(item);

    return(
      <View style={S.row}>
        <TouchableOpacity
          style={S.left}
          onPress={()=>openRow(item)}
          onLongPress={()=>{ if(isDraft) deleteDraft(item); }}
          delayLongPress={400}
          activeOpacity={0.8}
        >
          <Text style={S.rowTitle}>{item.supplierName||'Supplier'}</Text>
          <Text style={S.rowSub}>{subtitle||'—'}</Text>
          <View style={[S.pill, stale && S.pillWarn]}>
            <Text style={[S.pillText, stale && S.pillWarnText]}>
              {stale ? `${pillText} • stale` : pillText}
            </Text>
          </View>
        </TouchableOpacity>
        {isSubmitted ? (
          <TouchableOpacity style={S.smallBtn} onPress={()=>startReceive(item)}>
            <Text style={S.smallBtnText}>Receive</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  },[openRow,startReceive,deleteDraft]);

  const onRefresh=useCallback(()=>{
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
