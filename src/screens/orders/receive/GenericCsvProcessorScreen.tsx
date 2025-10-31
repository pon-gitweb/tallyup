// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';

const UPLOAD_URL = process.env.EXPO_PUBLIC_UPLOAD_CSV_URL;
const PROCESS_URL = process.env.EXPO_PUBLIC_PROCESS_PRODUCTS_CSV_URL;

export default function GenericCsvProcessorScreen({ orderId, venueId, orderLines = [], onDone, embed }) {
  const [busy, setBusy] = useState(false);

  const fakeUploadAndProcess = async () => {
    try {
      setBusy(true);
      // In your real screen, pick a file, upload to UPLOAD_URL, then POST to PROCESS_URL
      // Here we just simulate and mark order as received by CSV.
      await new Promise(r => setTimeout(r, 700));
      Alert.alert('CSV processed', 'Invoice CSV processed (demo). You can wire real tunnel here.');
      onDone?.();
    } catch (e) {
      Alert.alert('CSV failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.wrap}>
      <Text style={S.h}>Invoice CSV</Text>
      {!UPLOAD_URL || !PROCESS_URL ? (
        <Text style={S.warn}>Missing env: EXPO_PUBLIC_UPLOAD_CSV_URL / EXPO_PUBLIC_PROCESS_PRODUCTS_CSV_URL</Text>
      ) : null}
      <TouchableOpacity disabled={busy} onPress={fakeUploadAndProcess} style={[S.btn, busy && S.btnDis]}>
        <Text style={S.btnTxt}>{busy ? 'Processing…' : 'Upload & Process CSV'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  wrap:{gap:12,paddingVertical:8},
  h:{fontSize:16,fontWeight:'700',marginBottom:8},
  warn:{color:'#a15c00',backgroundColor:'#fff6e5',padding:8,borderRadius:8},
  btn:{marginTop:12,backgroundColor:'#0B5FFF',padding:12,borderRadius:10,alignItems:'center'},
  btnDis:{opacity:0.6},
  btnTxt:{color:'#fff',fontWeight:'700'}
});
