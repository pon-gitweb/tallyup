// @ts-nocheck
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';

// Reuse your existing sales services (these files already exist in your repo)
import { processSalesCsv } from '../../services/sales/processSalesCsv';
import { processSalesPdf } from '../../services/sales/processSalesPdf';
import { storeSalesReport } from '../../services/sales/storeSalesReport';

export default function SalesReportUploadPanel({ onClose }: { onClose: () => void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  const upload = useCallback(async ()=>{
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv','application/pdf'],
        multiple: false,
        copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets?.[0]) return;

      setBusy(true);
      const a = res.assets[0];
      const isCsv = (a.mimeType||'').includes('csv') || /\.csv$/i.test(a.name||'');

      // Server-side parsing (uses your existing endpoints)
      const parsed = isCsv
        ? await processSalesCsv({ venueId })
        : await processSalesPdf({ venueId });

      // Persist report + trigger matching (non-throwing inside)
      const saved = await storeSalesReport({
        venueId,
        report: parsed?.report || parsed, // tolerate different shapes from server
        source: isCsv ? 'csv' : 'pdf'
      });

      if (!saved?.ok) throw new Error(saved?.error || 'storeSalesReport failed');
      Alert.alert('Sales Report', 'Saved. Analytics will use this as a fallback when POS API is unavailable.');
      onClose();
    } catch (e:any) {
      Alert.alert('Sales import failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  return (
    <View style={{ flex:1, backgroundColor:'#fff', padding:16 }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Sales Reports (Import)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>
        Import a POS sales report as CSV or PDF. We’ll normalize and store it for analytics.
      </Text>

      <TouchableOpacity disabled={busy} onPress={upload} style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}>
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Processing…' : 'Upload Sales Report (CSV / PDF)'}</Text>
      </TouchableOpacity>

      <TouchableOpacity disabled={busy} onPress={onClose} style={{ marginTop:12, padding:14, borderRadius:12, backgroundColor:'#F3F4F6' }}>
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
