/* @ts-nocheck */
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';

import { processSalesCsv } from '../../services/sales/processSalesCsv';
import { storeSalesReport } from '../../services/sales/storeSalesReport';

export default function SalesReportUploadPanel({ onClose }: { onClose: () => void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  const upload = useCallback(async ()=>{
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv'], // Beta: CSV only – PDF later
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

      // Parse → normalize (CSV only for now)
      const parsed = await processSalesCsv({
        venueId,
        fileUri: a.uri,
        filename: a.name || 'sales.csv',
      });

      // Persist normalized report + attempt matching (non-throwing inside)
      const saved = await storeSalesReport({
        venueId,
        report: parsed?.report || parsed, // tolerate server/local shapes
        source: 'csv',
      });

      if (!saved?.ok) throw new Error(saved?.error || 'storeSalesReport failed');
      Alert.alert(
        'Sales Report',
        'CSV saved. Analytics will use this when a POS API is unavailable.'
      );
      onClose();
    } catch (e:any) {
      Alert.alert('Sales import failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  return (
    <View style={{ flex:1, backgroundColor:'#fff', padding:16 }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Sales Reports (CSV Import)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>
        Import a POS sales report as CSV. PDF imports will be added after the BETA, but CSV gives you full analytics today.
      </Text>

      <TouchableOpacity
        disabled={busy}
        onPress={upload}
        style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}
      >
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>
          {busy ? 'Processing…' : 'Upload Sales Report (CSV)'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        disabled={busy}
        onPress={onClose}
        style={{ marginTop:12, padding:14, borderRadius:12, backgroundColor:'#F3F4F6' }}
      >
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
