// @ts-nocheck
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useVenueId } from '../../context/VenueProvider';
import { uploadFastInvoice } from '../../services/fastReceive/uploadFastInvoice';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
import { persistFastReceiveSnapshot } from '../../services/invoices/reconciliationStore';
import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';

export default function FastReceivePanel({ onClose }:{ onClose: ()=>void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  // Camera capture -> upload -> pending snapshot (no OCR yet)
  const takePhoto = useCallback(async ()=>{
    try{
      if (!venueId) throw new Error('Not ready: no venue selected');

      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera denied', 'Enable camera permissions to capture a photo.');
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        exif: false,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;

      setBusy(true);
      const a = res.assets[0];
      const filename = a.fileName || `fast-receive-${Date.now()}.jpg`;

      const up = await uploadFastInvoice(venueId, a.uri, filename, 'image/jpeg');

      // Save a pending snapshot; OCR will later update this doc
      const save = await persistFastReceiveSnapshot({
        venueId,
        source: 'photo',
        storagePath: up.fullPath,
        parsedPo: null,
        payload: {
          invoice: { source: 'photo', storagePath: up.fullPath, poNumber: null },
          lines: [],
          confidence: null,
          warnings: ['ocr_pending: no text extraction performed yet'],
        },
      });
      if (!save || save.ok !== true) {
        const path = `venues/${venueId}/fastReceives`;
        const msg = (save && save.error) ? String(save.error) : 'unknown error';
        throw new Error(`FastReceive snapshot write denied at ${path}: ${msg}`);
      }

      Alert.alert('Photo Saved', 'Captured image saved as a Pending Fast Receive.');
      onClose();
    } catch(e:any){
      Alert.alert('Photo capture failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  // CSV/PDF flow (unchanged)
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

      if (!venueId) throw new Error('Not ready: no venue selected');

      const up = await uploadFastInvoice(
        venueId,
        a.uri,
        a.name || (isCsv ? 'invoice.csv' : 'invoice.pdf'),
        isCsv ? 'text/csv' : 'application/pdf'
      );

      const parsed = isCsv
        ? await processInvoicesCsv({ venueId, orderId: 'UNSET', storagePath: up.fullPath })
        : await processInvoicesPdf({ venueId, orderId: 'UNSET', storagePath: up.fullPath });

      const parsedPo = parsed?.invoice?.poNumber ?? null;

      const save = await persistFastReceiveSnapshot({
        venueId,
        source: isCsv ? 'csv' : 'pdf',
        storagePath: up.fullPath,
        payload: parsed,
        parsedPo
      });
      if (!save || save.ok !== true) {
        const path = `venues/${venueId}/fastReceives`;
        const msg = (save && save.error) ? String(save.error) : 'unknown error';
        throw new Error(`FastReceive snapshot write denied at ${path}: ${msg}`);
      }

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
        Alert.alert('Saved for Review', `No submitted PO found. Saved as Pending Fast Receive (${nLines} lines).`);
        onClose();
      }
    }catch(e:any){
      Alert.alert('Fast Receive failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  const quickTip = useMemo(()=>(
    'Tip: CSV/PDF auto-parse now; Photo saves a pending snapshot. OCR will update the same snapshot later.'
  ), []);

  return (
    <View style={{ flex:1, padding:16, backgroundColor:'#fff' }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Fast Receive (Scan / Upload)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>
        Receive deliveries without opening Submitted Orders. CSV/PDF tries to auto-attach by PO.
      </Text>

      <TouchableOpacity disabled={busy} onPress={takePhoto} style={{ padding:14, borderRadius:12, backgroundColor:'#0ea5e9', marginBottom:10 }}>
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Working…' : 'Take Photo (Save Pending)'}</Text>
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
