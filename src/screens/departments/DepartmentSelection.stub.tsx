// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

export default function DepartmentSelectionStub() {
  const nav = useNavigation();
  const route = useRoute() as any;
  const { venueId } = route.params || {};
  return (
    <View style={{ flex:1, padding:20 }}>
      <Text style={{ fontSize:18, marginBottom:12 }}>DepartmentSelection (stub)</Text>
      <Text style={{ color:'#555', marginBottom:20 }}>venueId: {venueId || '(none)'}</Text>
      <TouchableOpacity
        onPress={() => nav.navigate('AreaSelection' as never, { venueId, departmentId: 'Bar' } as never)}
        style={{ backgroundColor:'#2ecc71', padding:12, borderRadius:10, alignItems:'center' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Go to Areas (Bar)</Text>
      </TouchableOpacity>
    </View>
  );
}
