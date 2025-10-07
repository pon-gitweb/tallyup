// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

export default function AreaSelectionStub() {
  const nav = useNavigation();
  const route = useRoute() as any;
  const { venueId, departmentId } = route.params || {};
  return (
    <View style={{ flex:1, padding:20 }}>
      <Text style={{ fontSize:18, marginBottom:12 }}>AreaSelection (stub)</Text>
      <Text style={{ color:'#555', marginBottom:20 }}>venueId: {venueId} | dept: {departmentId}</Text>
      <TouchableOpacity
        onPress={() => nav.navigate('StockTakeAreaInventory' as never, { venueId, departmentId, areaId: 'FrontBar' } as never)}
        style={{ backgroundColor:'#0984e3', padding:12, borderRadius:10, alignItems:'center' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Open Inventory (FrontBar)</Text>
      </TouchableOpacity>
    </View>
  );
}
