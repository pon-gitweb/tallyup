// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, TextInput, FlatList, Alert, ActivityIndicator } from 'react-native';
import { searchProductsBySupplierPrefixPage, listProductsBySupplierPage } from '../../../services/products';

type Line = {
  id?: string | null;
  productId?: string | null;
  name: string;
  orderedQty?: number | null;
  receivedQty?: number | null;
  invoiceUnitPrice?: number | null;
  promo?: boolean | null;
};

export default function ReceiveApproveScreen({
  visible,
  onClose,
  mode,              // 'manual' | 'csv'
  poNumber,
  payload,           // { storagePath?, invoice?, matchReport?, confidence? }
  linesIn = [],      // initial lines: for manual this should be the submitted order lines
  onConfirm,         // async ({linesOut, payload?}) => void
  venueId,
  supplierId,
}: {
  visible: boolean;
  onClose: () => void;
  mode: 'manual' | 'csv';
  poNumber?: string | null;
  payload?: any;
  linesIn: Line[];
  onConfirm: (args: { linesOut: Line[], payload?: any }) => Promise<void>|void;
  venueId?: string | null;
  supplierId?: string | null;
}) {
  // Pre-populate: manual is seeded from submitted order; csv from parsed invoice
  const [lines, setLines] = useState<Line[]>(
    (linesIn || []).map(l => ({
      id: l.id ?? null,
      productId: l.productId ?? null,
      name: l.name ?? '',
      orderedQty: Number.isFinite(l.orderedQty) ? Number(l.orderedQty) : (Number(l.receivedQty) || 0),
      receivedQty: Number.isFinite(l.receivedQty) ? Number(l.receivedQty) : (Number(l.orderedQty) || 0),
      invoiceUnitPrice: Number.isFinite(l.invoiceUnitPrice) ? Number(l.invoiceUnitPrice) : null,
      promo: !!l.promo,
    }))
  );

  useEffect(()=>{ // keep in sync if parent re-opens with different seed
    setLines((linesIn || []).map(l => ({
      id: l.id ?? null,
      productId: l.productId ?? null,
      name: l.name ?? '',
      orderedQty: Number.isFinite(l.orderedQty) ? Number(l.orderedQty) : (Number(l.receivedQty) || 0),
      receivedQty: Number.isFinite(l.receivedQty) ? Number(l.receivedQty) : (Number(l.orderedQty) || 0),
      invoiceUnitPrice: Number.isFinite(l.invoiceUnitPrice) ? Number(l.invoiceUnitPrice) : null,
      promo: !!l.promo,
    })));
  }, [visible, linesIn]);

  const addPromo = () => {
    setLines(prev => ([
      ...prev,
      { id: null, productId: null, name: '', orderedQty: 0, receivedQty: 0, invoiceUnitPrice: null, promo: true }
    ]));
  };

  const addConcrete = (prod: { id: string; name?: string | null; cost?: number | null; packSize?: number | null; }) => {
    setLines(prev => ([
      ...prev,
      {
        id: prod.id,
        productId: prod.id,
        name: prod.name || String(prod.id),
        orderedQty: 0,
        receivedQty: 1,
        invoiceUnitPrice: Number.isFinite(prod?.cost) ? Number(prod.cost) : null,
        promo: false
      }
    ]));
  };

  const update = (idx: number, patch: Partial<Line>) => {
    setLines(prev => prev.map((l,i)=> i===idx ? ({...l, ...patch}) : l));
  };
  const remove = (idx: number) => setLines(prev => prev.filter((_,i)=> i!==idx));

  const err = useMemo(()=> {
    if (!lines.length) return 'Add at least one line.';
    if (lines.some(l => (l.receivedQty ?? 0) < 0)) return 'Quantities cannot be negative.';
    return null;
  }, [lines]);

  const confirm = async () => {
    try {
      if (err) { Alert.alert('Fix issues', err); return; }
      await onConfirm?.({ linesOut: lines, payload });
      onClose?.();
    } catch(e:any) {
      Alert.alert('Receive failed', String(e?.message || e));
    }
  };

  // ------- Supplier product mini-picker (optional) -------
  const [q,setQ] = useState('');
  const [loading,setLoading] = useState(false);
  const [options,setOptions] = useState<Array<{id:string; name?:string|null; cost?:number|null; packSize?:number|null}>>([]);
  const [cursor,setCursor] = useState<string|null>(null);
  const canSearch = !!venueId && !!supplierId;

  const runSearch = useCallback(async (term:string)=>{
    if (!canSearch) return;
    const t = term.trim();
    try{
      setLoading(true);
      if (t.length >= 2) {
        const { items, nextCursor } = await searchProductsBySupplierPrefixPage(venueId!, supplierId!, t, 20, null);
        setOptions(items as any);
        setCursor(nextCursor);
      } else {
        const { items, nextCursor } = await listProductsBySupplierPage(venueId!, supplierId!, 20, true, null);
        setOptions(items as any);
        setCursor(nextCursor);
      }
    } finally { setLoading(false); }
  },[venueId, supplierId, canSearch]);

  useEffect(()=>{
    // initial list
    if (visible && canSearch) runSearch('');
  },[visible, canSearch, runSearch]);

  useEffect(()=>{
    const id = setTimeout(()=>{ runSearch(q); }, 220);
    return ()=>clearTimeout(id);
  },[q, runSearch]);

  const loadMore = useCallback(async ()=>{
    if (!canSearch || !cursor) return;
    try{
      setLoading(true);
      let page, next;
      if (q.trim().length >= 2) {
        const res = await searchProductsBySupplierPrefixPage(venueId!, supplierId!, q.trim(), 20, cursor);
        page = res.items; next = res.nextCursor;
      } else {
        const res = await listProductsBySupplierPage(venueId!, supplierId!, 20, true, cursor);
        page = res.items; next = res.nextCursor;
      }
      setOptions(prev => [...prev, ...(page as any)]);
      setCursor(next ?? null);
    } finally { setLoading(false); }
  },[canSearch, cursor, q, venueId, supplierId]);

  const Row = ({item, index}:{item:Line; index:number}) => (
    <View style={S.row}>
      <View style={{flex:1}}>
        <TextInput
          style={[S.name, item.promo && S.promoName]}
          placeholder={item.promo ? 'Promo/free line name' : 'Product name'}
          value={item.name}
          onChangeText={(t)=>update(index,{name:t})}
        />
        {/* ordered vs received hint */}
        <Text style={S.hint}>
          {Number.isFinite(item.orderedQty) ? `Ordered: ${Number(item.orderedQty||0)}  ` : ''}
        </Text>
      </View>
      <TextInput
        style={S.qty}
        keyboardType="numeric"
        placeholder="Qty"
        value={String(item.receivedQty ?? 0)}
        onChangeText={(v)=>update(index,{receivedQty: Math.max(0, Number(v||0))})}
      />
      <TextInput
        style={S.price}
        keyboardType="numeric"
        placeholder="$"
        value={item.invoiceUnitPrice==null?'':String(item.invoiceUnitPrice)}
        onChangeText={(v)=>update(index,{invoiceUnitPrice: v===''?null:Number(v)})}
      />
      <TouchableOpacity onPress={()=>remove(index)} style={S.del}><Text style={S.delTxt}>✕</Text></TouchableOpacity>
    </View>
  );

  const ProductOpt = ({it}:{it:any})=>(
    <TouchableOpacity style={S.optRow} onPress={()=>addConcrete(it)}>
      <Text style={S.optName}>{it?.name ?? 'Product'}</Text>
      <Text style={S.optMeta}>
        {(Number.isFinite(it?.cost) ? `@ ${Number(it.cost).toFixed(2)}` : '@ —')}
        {Number.isFinite(it?.packSize) ? ` · pack ${Number(it.packSize)}` : ''}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.sheet}>
          <Text style={S.h}>Approve receipt {poNumber ? `(PO ${poNumber})` : ''}</Text>
          <Text style={S.sub}>{mode === 'csv' ? 'From uploaded invoice' : 'Manual review (prefilled from order)'}</Text>

          {/* Supplier product quick add */}
          <View style={S.addCard}>
            <Text style={S.addLabel}>Add products</Text>
            {!canSearch ? (
              <Text style={S.muted}>Link a supplier to this order to browse its catalog.</Text>
            ) : (
              <>
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search supplier’s products (min 2 letters)"
                  style={S.addInput}
                />
                {loading ? <ActivityIndicator style={{marginVertical:6}}/> : null}
                <FlatList
                  data={options}
                  keyExtractor={(o)=>String(o.id)}
                  renderItem={({item})=><ProductOpt it={item} />}
                  onEndReached={loadMore}
                  onEndReachedThreshold={0.7}
                  ListEmptyComponent={!loading ? <Text style={S.muted}>No products yet.</Text> : null}
                  style={{maxHeight:160, marginTop:6}}
                />
              </>
            )}
            <TouchableOpacity onPress={addPromo} style={S.addPromo}>
              <Text style={S.addPromoTxt}>+ Add promo/free line</Text>
            </TouchableOpacity>
          </View>

          {/* Lines */}
          <FlatList
            data={lines}
            keyExtractor={(_,i)=>String(i)}
            renderItem={Row}
            ListEmptyComponent={<Text style={S.empty}>No lines yet</Text>}
            style={{marginTop:8}}
          />

          <View style={S.btnRow}>
            <TouchableOpacity onPress={onClose} style={S.cancel}><Text style={S.cancelTxt}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={confirm} style={S.primary}><Text style={S.primaryTxt}>Confirm receive</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop:{flex:1,backgroundColor:'rgba(0,0,0,0.45)',justifyContent:'flex-end'},
  sheet:{backgroundColor:'#fff',borderTopLeftRadius:16,borderTopRightRadius:16,padding:16,maxHeight:'92%'},
  h:{fontSize:18,fontWeight:'800'},
  sub:{color:'#6B7280',marginBottom:10},
  empty:{color:'#6B7280',paddingVertical:8},

  // add area
  addCard:{backgroundColor:'#F9FAFB',borderRadius:12,padding:10,marginBottom:8},
  addLabel:{fontWeight:'800',marginBottom:6},
  addInput:{borderWidth:1,borderColor:'#E5E7EB',borderRadius:8,paddingHorizontal:8,height:38,backgroundColor:'#fff'},
  muted:{color:'#6B7280'},
  optRow:{paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:'#E5E7EB'},
  optName:{fontWeight:'700'},
  optMeta:{color:'#6B7280',marginTop:2},
  addPromo:{marginTop:8,paddingVertical:8,paddingHorizontal:10,backgroundColor:'#F3F4F6',borderRadius:8,alignSelf:'flex-start'},
  addPromoTxt:{fontWeight:'700',color:'#374151'},

  row:{flexDirection:'row',alignItems:'flex-start',gap:8,marginBottom:8},
  name:{flex:1,borderWidth:1,borderColor:'#E5E7EB',borderRadius:8,paddingHorizontal:8,height:38,backgroundColor:'#fff'},
  promoName:{backgroundColor:'#FFFBEB'},
  hint:{color:'#6B7280',fontSize:12,marginTop:4},

  qty:{width:80,borderWidth:1,borderColor:'#E5E7EB',borderRadius:8,paddingHorizontal:8,height:38,textAlign:'right',backgroundColor:'#fff'},
  price:{width:90,borderWidth:1,borderColor:'#E5E7EB',borderRadius:8,paddingHorizontal:8,height:38,textAlign:'right',backgroundColor:'#fff'},
  del:{paddingHorizontal:8,paddingVertical:6},
  delTxt:{color:'#9CA3AF',fontSize:16},

  btnRow:{flexDirection:'row',gap:12,marginTop:8},
  cancel:{flex:1,backgroundColor:'#F3F4F6',borderRadius:10,padding:12,alignItems:'center'},
  cancelTxt:{fontWeight:'800',color:'#374151'},
  primary:{flex:1,backgroundColor:'#111827',borderRadius:10,padding:12,alignItems:'center'},
  primaryTxt:{fontWeight:'800',color:'#fff'},
});
