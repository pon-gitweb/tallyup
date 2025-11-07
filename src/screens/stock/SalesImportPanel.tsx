// @ts-nocheck
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';
import { processSalesCsv } from '../../services/sales/processSalesCsv';
import { processSalesPdf } from '../../services/sales/processSalesPdf';
import { storeSalesReport } from '../../services/sales/storeSalesReport';

export default function SalesImportPanel({ onClose }:{ onClose: ()=>void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  const pickAndProcess = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv','application/pdf'],
        multiple: false,
        copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets?.[0]) return;
      setBusy(true);
      const a = res.assets[0];
      const isCsv = (a.mimeType||'').includes('csv') || /\.csv$/i.test(a.name||'');

      const parsed = isCsv
        ? await processSalesCsv({ venueId, fileUri: a.uri, filename: a.name || 'sales.csv' })
        : await processSalesPdf({ venueId, fileUri: a.uri, filename: a.name || 'sales.pdf' });

      const saved = await storeSalesReport({ venueId, report: parsed, source: isCsv ? 'csv' : 'pdf' });
      if (!saved?.ok) throw new Error(saved?.error || 'Could not save sales report');

      Alert.alert('Sales Report Saved', 'Report imported and stored. Analytics will use this as fallback when POS API is unavailable.');
      onClose();
    }catch(e:any){
      Alert.alert('Sales Import failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  return (
    <View style={{ flex:1, padding:16, backgroundColor:'#fff' }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Sales Report Import (CSV / PDF)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>
        Use this when a POS API isn’t connected. We’ll parse totals and item-level sales where possible.
      </Text>

      <TouchableOpacity disabled={busy} onPress={pickAndProcess} style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}>
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Processing…' : 'Upload Sales Report (CSV / PDF)'}</Text>
      </TouchableOpacity>

      <TouchableOpacity disabled={busy} onPress={onClose} style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6', marginTop:12 }}>
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
