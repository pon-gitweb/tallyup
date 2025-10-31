// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, Alert } from 'react-native';
import { getFirestore, doc, writeBatch } from 'firebase/firestore';
import { getApp } from 'firebase/app';

export default function ManualReceiveScreen({ orderId, venueId, orderLines = [], onDone, embed }) {
  const [qty, setQty] = useState(() =>
    Object.fromEntries(orderLines.map(l => [l.id || l.productId, Number(l.orderedQty || 0)]))
  );
  const totalLines = orderLines.length;

  const updateQty = (id: string, v: string) => {
    const n = Math.max(0, Number(v || 0));
    setQty(prev => ({ ...prev, [id]: n }));
  };

  const submit = async () => {
    try {
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const batch = writeBatch(db);

      // Mark order as received with snapshot of manual quantities
      batch.set(orderRef, {
        status: 'received',
        receivedAt: new Date(),
        receiveMethod: 'manual',
        receiveLines: orderLines.map(l => ({
          id: l.id || l.productId,
          productId: l.productId,
          name: l.name,
          orderedQty: Number(l.orderedQty || 0),
          receivedQty: Number(qty[l.id || l.productId] || 0),
        })),
      }, { merge: true });

      await batch.commit();
      onDone?.();
    } catch (e) {
      Alert.alert('Receive failed', String(e?.message || e));
    }
  };

  return (
    <View style={S.wrap}>
      <Text style={S.h}>Manual receive</Text>
      <FlatList
        data={orderLines}
        keyExtractor={(l) => String(l.id || l.productId)}
        renderItem={({ item }) => (
          <View style={S.row}>
            <Text style={S.name}>{item.name}</Text>
            <TextInput
              style={S.input}
              keyboardType="numeric"
              defaultValue={String(qty[item.id || item.productId] || 0)}
              onChangeText={(v) => updateQty(item.id || item.productId, v)}
            />
          </View>
        )}
      />
      <TouchableOpacity onPress={submit} style={S.btn}><Text style={S.btnTxt}>Confirm receive</Text></TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{gap:12,paddingVertical:8},
  h:{fontSize:16,fontWeight:'700',marginBottom:8},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:8,borderBottomWidth:1,borderColor:'#eee'},
  name:{flex:1,marginRight:12},
  input:{width:80,height:36,borderWidth:1,borderColor:'#ddd',borderRadius:8,paddingHorizontal:8},
  btn:{marginTop:12,backgroundColor:'#0B5FFF',padding:12,borderRadius:10,alignItems:'center'},
  btnTxt:{color:'#fff',fontWeight:'700'}
});
