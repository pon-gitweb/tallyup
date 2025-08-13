import React from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';

export default function StockTakeAreaInventoryStub() {
  const route = useRoute() as any;
  const { venueId, departmentId, areaId } = route.params || {};
  return (
    <View style={{ flex:1, padding:20 }}>
      <Text style={{ fontSize:18, marginBottom:12 }}>Inventory (stub)</Text>
      <Text style={{ color:'#555' }}>venueId: {venueId} | dept: {departmentId} | area: {areaId}</Text>
      <Text style={{ marginTop:12 }}>If your real StockTakeAreaInventoryScreen exists, it will be used instead of this stub.</Text>
    </View>
  );
}
