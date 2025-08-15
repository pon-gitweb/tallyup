import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ensureDevMembership } from '../services/devBootstrap';

export default function ReportsScreen() {
  const nav = useNavigation<any>();

  const openLastCycle = async () => {
    // Reuse dev bootstrap to get the current venue
    const { venueId } = await ensureDevMembership();
    nav.navigate('LastCycleSummary', { venueId });
  };

  return (
    <View style={S.c}>
      <Text style={S.h1}>Reports</Text>

      <TouchableOpacity style={S.card} onPress={openLastCycle}>
        <Text style={S.cardTitle}>Last Completed Cycle Summary</Text>
        <Text style={S.cardDesc}>Per-department completion and CSV export.</Text>
      </TouchableOpacity>

      <View style={S.card}><Text>Variance by Department (stub)</Text></View>
      <View style={S.card}><Text>Item Movement (stub)</Text></View>
    </View>
  );
}

const S = StyleSheet.create({
  c:{ flex:1, padding:16, backgroundColor:'#fff' },
  h1:{ fontSize:22, fontWeight:'700', marginBottom:12 },
  card:{ padding:12, backgroundColor:'#F3F4F6', borderRadius:10, marginBottom:10 },
  cardTitle:{ fontWeight:'700' },
  cardDesc:{ color:'#444', marginTop:2 },
});
