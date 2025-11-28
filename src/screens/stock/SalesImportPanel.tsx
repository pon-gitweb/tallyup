// @ts-nocheck
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';
import { processSalesCsv } from '../../services/sales/processSalesCsv';
import { storeSalesReport } from '../../services/sales/storeSalesReport';

export default function SalesImportPanel({ onClose }:{ onClose: ()=>void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  const pickAndProcess = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv'], // Beta: CSV only – PDF coming later
        multiple: false,
        copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets?.[0]) return;

      setBusy(true);
      const a = res.assets[0];
      const isCsv =
        (a.mimeType || '').includes('csv') ||
        /\.csv$/i.test(a.name || '');

      if (!isCsv) {
        Alert.alert(
          'Sales import',
          'Sales PDF imports are not enabled yet on this project. Please export a CSV from your POS and upload that instead.'
        );
        return;
      }

      if (!venueId) throw new Error('Not ready: no venue selected');
      if (!a.uri?.startsWith('file')) throw new Error('Expected a local file URI');

      const parsed = await processSalesCsv({
        venueId,
        fileUri: a.uri,
        filename: a.name || 'sales.csv',
      });

      const saved = await storeSalesReport({
        venueId,
        report: parsed?.report || parsed,
        source: 'csv',
      });
      if (!saved?.ok) throw new Error(saved?.error || 'Could not save sales report');

      Alert.alert(
        'Sales report saved',
        'CSV imported and stored. Analytics will use this when a POS API is not connected.'
      );
      onClose();
    }catch(e:any){
      Alert.alert('Sales import failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  return (
    <View style={{ flex:1, padding:16, backgroundColor:'#fff' }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Sales Report Import (CSV)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>
        Export a CSV sales report from your POS and upload it here. PDF sales imports are coming after the BETA run.
      </Text>

      <TouchableOpacity
        disabled={busy}
        onPress={pickAndProcess}
        style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}
      >
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>
          {busy ? 'Processing…' : 'Upload Sales Report (CSV)'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        disabled={busy}
        onPress={onClose}
        style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6', marginTop:12 }}
      >
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
