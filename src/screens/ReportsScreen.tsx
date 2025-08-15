import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ReportsScreen() {
  return (
    <View style={S.c}>
      <Text style={S.h1}>Reports</Text>
      <View style={S.card}><Text>• Variance by Department (stub)</Text></View>
      <View style={S.card}><Text>• Last Completed Cycle Summary (stub)</Text></View>
      <View style={S.card}><Text>• Item Movement (stub)</Text></View>
    </View>
  );
}

const S = StyleSheet.create({
  c:{ flex:1, padding:16, backgroundColor:'#fff' },
  h1:{ fontSize:22, fontWeight:'700', marginBottom:12 },
  card:{ padding:12, backgroundColor:'#F3F4F6', borderRadius:10, marginBottom:10 },
});
