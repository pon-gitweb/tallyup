// @ts-nocheck
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useVenueId } from '../../context/VenueProvider';
import { uploadFastInvoice } from '../../services/fastReceive/uploadFastInvoice';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';
import { processInvoicePhoto } from '../../services/invoices/processInvoicePhoto';
import { useToast } from '../../components/common/Toast';

export default function FastReceivePanel({ onClose }:{ onClose: ()=>void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const { showSuccess, showError, showInfo } = useToast();

  const uploadPhoto = useCallback(async (uri: string) => {
    if (!venueId) throw new Error('Not ready: no venue selected');
    setBusy(true);
    try {
      const filename = `fast-receive-${Date.now()}.jpg`;
      const up = await uploadFastInvoice(venueId, uri, filename, 'image/jpeg');

      let parsed: any = null;
      try {
        parsed = await processInvoicePhoto({ venueId, storagePath: up.fullPath });
      } catch (ocrErr: any) {
        console.log('[uploadPhoto] OCR failed, saving without lines:', ocrErr?.message);
      }

      const hasLines = Array.isArray(parsed?.lines) && parsed.lines.length > 0;

      const result = await tryAttachToOrderOrSavePending({
        venueId,
        parsed: parsed ?? {
          invoice: { source: 'photo', storagePath: up.fullPath, poNumber: null },
          lines: [],
          confidence: null,
          warnings: ['ocr_failed: no lines extracted'],
        },
        storagePath: up.fullPath
      });

      if (result.attached) {
        showSuccess(`Invoice photo matched to order ${result.orderId} — ${(parsed?.lines || []).length} lines reconciled.`);
      } else if (hasLines) {
        showInfo(`Photo processed — ${parsed.lines.length} product lines found. Review in Invoices → Fast Receives Pending.`);
      } else {
        showInfo('Photo saved. No lines could be extracted — review manually in Invoices → Fast Receives Pending.');
      }
      onClose();
    } catch (e: any) {
      showError(e?.message || 'Photo upload failed.');
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  const takePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showInfo('Camera permission is required. Please allow access in Settings.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, exif: false, allowsEditing: false });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      await uploadPhoto(res.assets[0].uri);
    } catch(e:any) {
      showError(e?.message || 'Photo capture failed.');
    }
  }, [uploadPhoto]);

  const pickFromLibrary = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showInfo('Photo library permission is required. Please allow access in Settings.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      await uploadPhoto(res.assets[0].uri);
    } catch(e:any) {
      showError(e?.message || 'Photo upload failed.');
    }
  }, [uploadPhoto]);

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

      const result = await tryAttachToOrderOrSavePending({
        venueId,
        parsed,
        storagePath: up.fullPath
      });

      if (result.attached) {
        showSuccess(`Attached to order ${result.orderId} and sent for reconciliation.`);
        onClose();
      } else {
        const nLines = Array.isArray(parsed?.lines) ? parsed.lines.length : 0;
        showInfo(`No submitted PO found. Saved as Pending Fast Receive (${nLines} lines).`);
        onClose();
      }
    }catch(e:any){
      showError(e?.message || 'Fast Receive failed.');
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  const quickTip = useMemo(()=>(
    'CSV and PDF invoices are parsed automatically. Photos are processed with AI to extract product lines.'
  ), []);

  return (
    <View style={{ flex:1, padding:16, backgroundColor:'#fff' }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:4 }}>Fast Receive (Scan / Upload)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12, fontSize:13 }}>
        Receive deliveries without opening Submitted Orders. CSV/PDF tries to auto-attach by PO.
      </Text>

      {/* Invoice photo guidance */}
      <View style={{ backgroundColor:'#EFF6FF', borderRadius:12, padding:12, marginBottom:14, borderWidth:1, borderColor:'#BFDBFE' }}>
        <Text style={{ fontWeight:'800', color:'#1E40AF', marginBottom:4 }}>📄 Photograph the invoice</Text>
        <Text style={{ color:'#1E40AF', fontSize:12, lineHeight:18 }}>
          Place the invoice flat. Ensure all text is visible.{'\n'}Good lighting, no shadows across the text.
        </Text>
      </View>

      <TouchableOpacity disabled={busy} onPress={takePhoto} style={{ padding:14, borderRadius:12, backgroundColor:'#0ea5e9', marginBottom:8 }}>
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Working…' : '📷 Take Photo'}</Text>
      </TouchableOpacity>

      <TouchableOpacity disabled={busy} onPress={pickFromLibrary} style={{ padding:14, borderRadius:12, backgroundColor:'#E0F2FE', marginBottom:10, borderWidth:1, borderColor:'#BAE6FD' }}>
        <Text style={{ color:'#0369A1', fontWeight:'800', textAlign:'center' }}>{busy ? 'Working…' : '🖼️ Choose from Library'}</Text>
      </TouchableOpacity>

      <TouchableOpacity disabled={busy} onPress={pickAndProcess} style={{ padding:14, borderRadius:12, backgroundColor:'#111', marginBottom:10 }}>
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Processing…' : 'Upload Invoice (CSV / PDF)'}</Text>
      </TouchableOpacity>

      <Text style={{ color:'#6B7280', marginTop:4, fontSize:12 }}>{quickTip}</Text>

      <TouchableOpacity disabled={busy} onPress={onClose} style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6', marginTop:12 }}>
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
