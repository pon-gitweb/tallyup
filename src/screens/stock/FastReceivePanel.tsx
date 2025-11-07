// @ts-nocheck
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';
import { uploadFastInvoice } from '../../services/fastReceive/uploadFastInvoice';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
import { persistAfterParse } from '../../services/invoices/reconciliationStore';
import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';

export default function FastReceivePanel({ onClose }:{ onClose: ()=>void }) {
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

      // Upload into fast-receive area (no orderId yet)
      const up = await uploadFastInvoice(
        venueId,
        a.uri,
        a.name || (isCsv ? 'invoice.csv' : 'invoice.pdf'),
        isCsv ? 'text/csv' : 'application/pdf'
      );

      // Process using existing parsers (orderId not required for server-side parse)
      const parsed = isCsv
        ? await processInvoicesCsv({ venueId, orderId: 'UNSET', storagePath: up.fullPath })
        : await processInvoicesPdf({ venueId, orderId: 'UNSET', storagePath: up.fullPath });

      const parsedPo = parsed?.invoice?.poNumber ?? null;

      // Snapshot the parse so history exists even if no order attach happens now
      await persistAfterParse({
        venueId,
        orderId: 'pending-fast-receive',
        source: isCsv ? 'csv' : 'pdf',
        storagePath: up.fullPath,
        payload: parsed,
        orderPo: null,
        parsedPo
      });

      // Try to attach to a submitted order by PO; else save as pending
      const result = await tryAttachToOrderOrSavePending({
        venueId,
        parsed,
        storagePath: up.fullPath
      });

      if (result.attached) {
        Alert.alert('Fast Receive', `Attached to order ${result.orderId} and sent for reconciliation.`);
        onClose();
      } else {
        const nLines = Array.isArray(parsed?.lines) ? parsed.lines.length : 0;
        Alert.alert('Saved for Review', `No submitted PO found. Saved as Pending Fast Receive (${nLines} lines). Managers can attach later.`);
        onClose();
      }
    }catch(e:any){
      Alert.alert('Fast Receive failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  const stubPhoto = useCallback(()=>{
    Alert.alert(
      'Photo/OCR (Coming Soon)',
      'You can use CSV/PDF upload now. Photo/OCR capture will be added here with the same fast-attach flow.'
    );
  }, []);

  const quickTip = useMemo(()=>{
    return 'Tip: If the scan finds ≥5 lines and ≥50 items, we’ll prompt for item check-off. Fewer lines/items can be quick-confirmed.';
  }, []);

  return (
    <View style={{ flex:1, padding:16, backgroundColor:'#fff' }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Fast Receive (Scan / Upload)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>
        Receive deliveries without opening Submitted Orders. We’ll try to match a PO and attach automatically.
      </Text>

      <TouchableOpacity disabled={busy} onPress={stubPhoto} style={{ padding:14, borderRadius:12, backgroundColor:'#0ea5e9', marginBottom:10 }}>
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Working…' : 'Take Photo (OCR) – stub'}</Text>
      </TouchableOpacity>

      <TouchableOpacity disabled={busy} onPress={pickAndProcess} style={{ padding:14, borderRadius:12, backgroundColor:'#111', marginBottom:10 }}>
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Processing…' : 'Upload Invoice (CSV / PDF)'}</Text>
      </TouchableOpacity>

      <Text style={{ color:'#6B7280', marginTop:8 }}>{quickTip}</Text>

      <TouchableOpacity disabled={busy} onPress={onClose} style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6', marginTop:12 }}>
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
