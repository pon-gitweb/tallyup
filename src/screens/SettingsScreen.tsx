import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { signOutAll } from '../services/auth';
import { DEV_VENUE_ID, DEV_EMAIL } from '../config/dev';

export default function SettingsScreen() {
  const onSignOut = async () => {
    try {
      await signOutAll(); // auth observer will route to AuthEntry
    } catch (e: any) {
      Alert.alert('Sign out failed', e?.message ?? 'Unknown error');
    }
  };

  return (
    <View style={S.c}>
      <Text style={S.h1}>Settings</Text>

      <View style={S.card}>
        <Text style={S.cardTitle}>About this build</Text>
        <Text style={S.p}>Dev account: {DEV_EMAIL}</Text>
        <Text style={S.p}>Pinned venue: {DEV_VENUE_ID}</Text>
      </View>

      <TouchableOpacity style={S.btn} onPress={onSignOut}>
        <Text style={S.btnText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  c:{ flex:1, padding:16, backgroundColor:'#fff' },
  h1:{ fontSize:22, fontWeight:'700', marginBottom:12 },
  card:{ padding:12, backgroundColor:'#F3F4F6', borderRadius:10, marginBottom:12 },
  cardTitle:{ fontWeight:'700', marginBottom:6 },
  p:{ color:'#333' },
  btn:{ backgroundColor:'#EF4444', padding:14, borderRadius:10, alignItems:'center', marginTop:16 },
  btnText:{ color:'#fff', fontWeight:'700' },
});
