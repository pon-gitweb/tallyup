// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, Alert } from 'react-native';
import { getFirestore, doc, writeBatch } from 'firebase/firestore';
import { getApp } from 'firebase/app';

export default function ManualReceiveScreen({ orderId, venueId, orderLines = [], onDone, embed }) {
  // Quantities for existing order lines
  const [qty, setQty] = useState(() =>
    Object.fromEntries((orderLines || []).map(l => [String(l.id || l.productId || ''), Number(l.orderedQty || l.qty || 0)]))
  );

  // Promo additions (items not in the supplier catalogue)
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [extras, setExtras] = useState<Array<{ id: string; name: string; qty: number; unitPrice?: number | null }>>([]);

  const totalLines = (orderLines?.length || 0) + (extras?.length || 0);

  const updateQty = (id: string, v: string) => {
    const n = Math.max(0, Number(v || 0));
    setQty(prev => ({ ...prev, [id]: n }));
  };

  const addExtra = () => {
    const name = String(newName || '').trim();
    const q = Number(newQty || 0);
    const p = newUnitPrice === '' ? null : Number(newUnitPrice);
    if (!name) { Alert.alert('Missing name', 'Enter a product name.'); return; }
    if (!Number.isFinite(q) || q <= 0) { Alert.alert('Invalid qty', 'Enter a quantity > 0.'); return; }
    if (!(p === null || Number.isFinite(p))) { Alert.alert('Invalid price', 'Leave blank or enter a valid number.'); return; }
    const id = `promo_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    setExtras(prev => [{ id, name, qty: q, unitPrice: p }, ...prev]);
    setNewName('');
    setNewQty('');
    setNewUnitPrice('');
  };

  const removeExtra = (id: string) => setExtras(prev => prev.filter(x => x.id !== id));

  const submit = async () => {
    try {
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const batch = writeBatch(db);

      // Build receiveLines snapshot = existing lines + promo extras
      const baseReceive = (orderLines || []).map(l => {
        const id = String(l.id || l.productId || '');
        return {
          id,
          productId: l.productId || null,
          name: l.name || null,
          orderedQty: Number(l.orderedQty || l.qty || 0),
          receivedQty: Number(qty[id] || 0),
          invoiceUnitPrice: Number.isFinite(l.unitCost) ? Number(l.unitCost) : null, // existing unit cost if you want to capture it
          promo: false,
        };
      });

      const extraReceive = (extras || []).map(x => ({
        id: x.id,
        productId: null,
        name: x.name,
        orderedQty: 0,
        receivedQty: Number(x.qty || 0),
        invoiceUnitPrice: (x.unitPrice === null || x.unitPrice === undefined) ? null : Number(x.unitPrice),
        promo: true,
      }));

      batch.set(orderRef, {
        status: 'received',
        displayStatus: 'received',       // <<< ensure pill is consistent going forward
        receivedAt: new Date(),
        receiveMethod: 'manual',
        receiveLines: [...baseReceive, ...extraReceive],
      }, { merge: true });

      await batch.commit();
      onDone?.();
    } catch (e) {
      Alert.alert('Receive failed', String(e?.message || e));
    }
  };

  const ExistingLine = ({ item }) => {
    const id = String(item.id || item.productId || '');
    return (
      <View style={S.row}>
        <Text style={S.name}>{item.name || item.productId || 'Line'}</Text>
        <TextInput
          style={S.input}
          keyboardType="numeric"
          placeholder="0"
          defaultValue={String(qty[id] || 0)}
          onChangeText={(v) => updateQty(id, v)}
        />
      </View>
    );
  };

  const ExtraRow = ({ item }) => {
    return (
      <View style={S.row}>
        <Text style={S.name}>{item.name} <Text style={{color:'#92400E'}}>(promo)</Text></Text>
        <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
          <Text style={S.ghost}>Qty {item.qty}</Text>
          {item.unitPrice != null ? <Text style={S.ghost}>@ ${Number(item.unitPrice).toFixed(2)}</Text> : null}
          <TouchableOpacity onPress={() => removeExtra(item.id)}><Text style={S.remove}>Remove</Text></TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={S.wrap}>
      <Text style={S.h}>Manual receive</Text>

      {/* Existing order lines */}
      <FlatList
        data={orderLines || []}
        keyExtractor={(l) => String(l.id || l.productId || Math.random())}
        renderItem={ExistingLine}
        ListEmptyComponent={<Text style={S.ghost}>No lines on order.</Text>}
      />

      {/* Add promo item */}
      <View style={S.addBox}>
        <Text style={S.addH}>Add promo/new item</Text>
        <TextInput placeholder="Item name" value={newName} onChangeText={setNewName} style={S.inputWide}/>
        <View style={{flexDirection:'row',gap:8}}>
          <TextInput placeholder="Qty" value={newQty} onChangeText={setNewQty} keyboardType="numeric" style={[S.input,{flex:1}]}/>
          <TextInput placeholder="Invoice unit $" value={newUnitPrice} onChangeText={setNewUnitPrice} keyboardType="numeric" style={[S.input,{flex:1}]}/>
        </View>
        <TouchableOpacity onPress={addExtra} style={S.btnAdd}><Text style={S.btnAddTxt}>Add item</Text></TouchableOpacity>
      </View>

      {/* Extra items list */}
      {extras.length > 0 ? (
        <View style={{marginTop:8}}>
          <Text style={S.addH}>Added items</Text>
          <FlatList
            data={extras}
            keyExtractor={(x)=>x.id}
            renderItem={ExtraRow}
          />
        </View>
      ) : null}

      <TouchableOpacity onPress={submit} style={S.btn}><Text style={S.btnTxt}>Confirm receive ({totalLines})</Text></TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{gap:12,paddingVertical:8,paddingHorizontal:12},
  h:{fontSize:16,fontWeight:'700',marginBottom:8},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:8,borderBottomWidth:1,borderColor:'#eee'},
  name:{flex:1,marginRight:12},
  input:{width:100,height:36,borderWidth:1,borderColor:'#ddd',borderRadius:8,paddingHorizontal:8},
  inputWide:{height:36,borderWidth:1,borderColor:'#ddd',borderRadius:8,paddingHorizontal:8,marginBottom:8},
  btn:{marginTop:12,backgroundColor:'#0B5FFF',padding:12,borderRadius:10,alignItems:'center'},
  btnTxt:{color:'#fff',fontWeight:'700'},
  addBox:{marginTop:8,padding:12,borderRadius:10,borderWidth:1,borderColor:'#E5E7EB',backgroundColor:'#FAFAFA'},
  addH:{fontSize:14,fontWeight:'700',marginBottom:8},
  btnAdd:{marginTop:8,backgroundColor:'#111827',paddingVertical:10,borderRadius:8,alignItems:'center'},
  btnAddTxt:{color:'#fff',fontWeight:'700'},
  remove:{color:'#B91C1C',fontWeight:'700'},
  ghost:{color:'#6B7280'},
});
