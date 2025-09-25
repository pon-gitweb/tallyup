import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TextInput, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { getOrderWithLines, calcTotal, markOrderReceived } from '../../services/orders';

export default function ReceiveOrderScreen() {
  const venueId = useVenueId();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const orderId: string = route.params?.orderId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(''); // YYYY-MM-DD
  const [notes, setNotes] = useState<string>('');

  async function load() {
    if (!venueId || !orderId) { setError('Missing venue or order'); setLoading(false); return; }
    try {
      setLoading(true);
      const data = await getOrderWithLines(venueId, orderId);
      setOrder(data.order);
      // default receivedQty to ordered qty
      setLines((data.lines || []).map((l: any) => ({ ...l, receivedQty: Number(l.qty || 0) })));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId, orderId]);

  const total = useMemo(() => calcTotal(lines), [lines]);

  async function onConfirm() {
    try {
      if (!venueId || !orderId) throw new Error('Missing ids');
      await markOrderReceived(venueId, orderId, {
        invoiceNumber: invoiceNumber?.trim() || null,
        invoiceDate: invoiceDate?.trim() || null,
        notes: notes?.trim() || null,
        lines: lines.map(l => ({ lineId: l.id, receivedQty: Number(l.receivedQty || 0) })),
      });
      Alert.alert('Order Received', 'Order marked as received.');
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Receive Failed', e?.message || 'Unknown error');
    }
  }

  if (loading) return (<View style={s.center}><ActivityIndicator/><Text>Loading…</Text></View>);
  if (error) return (<View style={s.center}><Text style={{color:'#B00020'}}>{error}</Text></View>);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Receive Order</Text>
      <Text style={s.sub}>Order: {orderId}</Text>
      <Text style={s.sub}>Supplier: {order?.supplierName || order?.supplierId}</Text>

      <View style={s.row}>
        <View style={[s.card, {flex:1}]}>
          <Text style={s.label}>Invoice #</Text>
          <TextInput style={s.input} value={invoiceNumber} onChangeText={setInvoiceNumber} placeholder="INV-12345" />
        </View>
        <View style={[s.card, {flex:1}]}>
          <Text style={s.label}>Invoice date</Text>
          <TextInput style={s.input} value={invoiceDate} onChangeText={setInvoiceDate} placeholder="YYYY-MM-DD" />
        </View>
      </View>

      <FlatList
        style={{marginTop:8}}
        data={lines}
        keyExtractor={(l:any) => l.id}
        ItemSeparatorComponent={() => <View style={{height:8}}/>}
        renderItem={({item, index}) => (
          <View style={s.line}>
            <View style={{flex:1}}>
              <Text style={s.lineName}>{item.name || item.productId}</Text>
              <Text style={s.sub}>{item.packSize ? `pack ${item.packSize}` : 'each'} · @{item.unitCost != null ? Number(item.unitCost).toFixed(2) : '—'}</Text>
            </View>
            <View style={{alignItems:'flex-end'}}>
              <Text style={s.mute}>Received</Text>
              <TextInput
                style={s.qty}
                keyboardType="numeric"
                value={String(item.receivedQty ?? 0)}
                onChangeText={(v) => {
                  const n = Number(v.replace(/[^0-9.]/g,'')) || 0;
                  setLines(prev => prev.map((p, i) => i === index ? {...p, receivedQty:n} : p));
                }}
              />
            </View>
          </View>
        )}
      />

      <View style={[s.card,{marginTop:8}]}>
        <Text style={s.label}>Notes</Text>
        <TextInput
          style={[s.input,{height:80,textAlignVertical:'top'}]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional: delivery notes, discrepancies…"
          multiline
        />
      </View>

      <View style={{flexDirection:'row', gap:10}}>
        <View style={[s.card,{flex:1, alignItems:'center'}]}>
          <Text style={s.mute}>Total (@ ordered price)</Text>
          <Text style={{fontWeight:'800'}}>{total.toFixed(2)}</Text>
        </View>
        <TouchableOpacity style={[s.primary,{flex:1}]} onPress={onConfirm}>
          <Text style={s.primaryText}>Mark Received</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:{flex:1,padding:16,gap:8},
  center:{flex:1,alignItems:'center',justifyContent:'center',gap:8},
  title:{fontSize:22,fontWeight:'800'},
  sub:{opacity:0.7},
  row:{flexDirection:'row',gap:10},
  card:{backgroundColor:'#F2F2F7',padding:10,borderRadius:12,gap:6},
  label:{fontWeight:'700'},
  input:{borderWidth:1,borderColor:'#D0D3D7',borderRadius:10,paddingHorizontal:10,paddingVertical:8},
  line:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#EFEFF4',padding:10,borderRadius:12},
  lineName:{fontWeight:'700'},
  mute:{opacity:0.6},
  qty:{borderWidth:1,borderColor:'#D0D3D7',borderRadius:10,paddingHorizontal:10,paddingVertical:6,minWidth:64,textAlign:'right'},
  primary:{backgroundColor:'#0A84FF',paddingVertical:14,borderRadius:12,alignItems:'center'},
  primaryText:{color:'#fff',fontWeight:'800'},
});
