// @ts-nocheck
import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';
import { uploadFastInvoice } from '../../services/fastReceive/uploadFastInvoice';
import { processInvoicesCsv } from '../../services/invoices/processInvoicesCsv';
import { processInvoicesPdf } from '../../services/invoices/processInvoicesPdf';
import { persistFastReceiveSnapshot } from '../../services/invoices/reconciliationStore';
import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';
import { invoiceFingerprint, checkProcessed, writeProcessed, confirmDuplicateImport } from '../../services/deduplication';

export default function FastReceivePanel({ onClose }: { onClose: () => void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  // CAMERA: capture, upload JPEG, create pending snapshot (OCR comes later)
  const takePhoto = useCallback(async () => {
    try {
      if (!venueId) throw new Error('Not ready: no venue selected');

      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (cam.status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required to take a photo.');
        return;
      }

      const photo = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.85,
        base64: false,
      });
      if (photo.canceled || !photo.assets?.[0]?.uri) return;

      setBusy(true);
      const asset = photo.assets[0];
      const filename = `invoice_${Date.now()}.jpg`;

      const up = await uploadFastInvoice(venueId, asset.uri, filename, 'image/jpeg' as any);

      const payload = {
        invoice: { source: 'photo', storagePath: up.fullPath, poNumber: null },
        lines: [],
        confidence: null,
        warnings: ['OCR not yet enabled: review photo and attach to order manually.'],
      };

      const save = await persistFastReceiveSnapshot({
        venueId,
        source: 'photo',
        storagePath: up.fullPath,
        payload,
        parsedPo: null,
      });
      if (!save || save.ok !== true) {
        const msg = (save && save.error) ? String(save.error) : 'unknown error';
        throw new Error(`FastReceive snapshot write denied: ${msg}`);
      }

      Alert.alert(
        'Photo saved',
        'Snapshot created under Fast Receives (Pending). You can attach it to a submitted order from Stock Control.'
      );
      onClose();
    } catch (e: any) {
      Alert.alert('Photo capture failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  // LIBRARY: pick existing photo, upload JPEG, create pending snapshot
  const pickPhotoFromLibrary = useCallback(async () => {
    try {
      if (!venueId) throw new Error('Not ready: no venue selected');

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Photo library access is required to choose a photo.');
        return;
      }

      const photo = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        quality: 0.85,
        base64: false,
      });
      if (photo.canceled || !photo.assets?.[0]?.uri) return;

      setBusy(true);
      const asset = photo.assets[0];
      const filename = `invoice_${Date.now()}.jpg`;

      const up = await uploadFastInvoice(venueId, asset.uri, filename, 'image/jpeg' as any);

      const payload = {
        invoice: { source: 'photo', storagePath: up.fullPath, poNumber: null },
        lines: [],
        confidence: null,
        warnings: ['OCR not yet enabled: review photo and attach to order manually.'],
      };

      const save = await persistFastReceiveSnapshot({
        venueId,
        source: 'photo',
        storagePath: up.fullPath,
        payload,
        parsedPo: null,
      });
      if (!save || save.ok !== true) {
        const msg = (save && save.error) ? String(save.error) : 'unknown error';
        throw new Error(`FastReceive snapshot write denied: ${msg}`);
      }

      Alert.alert(
        'Photo saved',
        'Snapshot created under Fast Receives (Pending). You can attach it to a submitted order from Stock Control.'
      );
      onClose();
    } catch (e: any) {
      Alert.alert('Photo select failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  // CSV/PDF upload
  const pickAndProcess = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'application/pdf'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;

      const a = res.assets[0];
      const isCsv = (a.mimeType || '').includes('csv') || /\.csv$/i.test(a.name || '');

      if (!venueId) throw new Error('Not ready: no venue selected');
      if (!a.uri?.startsWith('file')) {
        throw new Error('Selected file is not a local file. Please save it to this device first, then choose it again.');
      }

      setBusy(true);

      const up = await uploadFastInvoice(
        venueId,
        a.uri,
        a.name || (isCsv ? 'invoice.csv' : 'invoice.pdf'),
        isCsv ? 'text/csv' : 'application/pdf'
      );

      const parsed: any = isCsv
        ? await processInvoicesCsv({ venueId, orderId: 'UNSET', storagePath: up.fullPath })
        : await processInvoicesPdf({ venueId, orderId: 'UNSET', storagePath: up.fullPath });

      if (parsed?.scannedPdf) {
        Alert.alert(
          'Scanned PDF detected',
          parsed.message || 'This PDF appears to be a scanned image. For best results: use a digital PDF or CSV from your supplier.',
          [
            { text: 'OK' },
            { text: 'Upload different file', onPress: pickAndProcess },
          ],
        );
        setBusy(false);
        return;
      }

      // Invoice deduplication check
      const invLines = parsed?.lines || [];
      const invTotal = invLines.reduce((s: number, l: any) => s + (l.qty || 0) * (l.unitPrice || 0), 0);
      const invHash = invoiceFingerprint(
        parsed?.invoice?.supplierName || null,
        invLines,
        parsed?.invoice?.deliveryDate || null,
        invTotal,
      );
      const { exists: invExists, processedAt: invProcessedAt } = await checkProcessed(venueId, 'processedInvoices', invHash);
      if (invExists) {
        const dateStr = invProcessedAt ? invProcessedAt.toLocaleDateString('en-NZ') : 'previously';
        const proceed = await confirmDuplicateImport(
          'Invoice already processed',
          `This invoice appears to have already been processed on ${dateStr}. Import anyway?`,
        );
        if (!proceed) { setBusy(false); return; }
      }

      const parsedPo = parsed?.invoice?.poNumber ?? null;

      const save = await persistFastReceiveSnapshot({
        venueId,
        source: isCsv ? 'csv' : 'pdf',
        storagePath: up.fullPath,
        payload: parsed,
        parsedPo,
      });
      if (!save || save.ok !== true) {
        const path = `venues/${venueId}/fastReceives`;
        const msg = (save && save.error) ? String(save.error) : 'unknown error';
        throw new Error(`FastReceive snapshot write denied at ${path}: ${msg}`);
      }

      const result = await tryAttachToOrderOrSavePending({
        venueId,
        parsed,
        storagePath: up.fullPath,
      });

      // Write deduplication fingerprint after successful save
      await writeProcessed(venueId, 'processedInvoices', invHash, {
        supplierName: parsed?.invoice?.supplierName || null,
        lineCount: invLines.length,
      });

      if (result.attached) {
        Alert.alert('Fast Receive', `Attached to order ${result.orderId} and sent for reconciliation.`);
        onClose();
      } else {
        const nLines = Array.isArray(parsed?.lines) ? parsed.lines.length : 0;
        Alert.alert(
          'Saved for Review',
          `No submitted PO found. Saved as Pending Fast Receive (${nLines} lines). Managers can attach later from Fast Receives (Pending).`
        );
        onClose();
      }
    } catch (e: any) {
      Alert.alert('Fast Receive failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  const quickTip = useMemo(() => {
    return "Tip: If the scan finds ≥5 lines and ≥50 items, we'll prompt for item check-off. Fewer lines/items can be quick-confirmed.";
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 24,
          flexGrow: 1,
          justifyContent: 'flex-start',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Fast Receive (Scan / Upload)</Text>
        <Text style={{ color: '#6B7280', marginBottom: 4 }}>
          Receive deliveries without opening Submitted Orders. We'll try to match a PO and attach automatically.
        </Text>
        <View style={{ backgroundColor: '#F0F9FF', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#BAE6FD' }}>
          <Text style={{ color: '#0369A1', fontWeight: '800', marginBottom: 6, fontSize: 13 }}>📄 Photograph the invoice</Text>
          <Text style={{ color: '#0369A1', fontSize: 12, lineHeight: 18 }}>
            • Place invoice flat on a surface{'\n'}
            • Ensure all text is clearly visible{'\n'}
            • Good lighting — avoid shadows across the text{'\n'}
            • Capture the full invoice in frame
          </Text>
        </View>

        <TouchableOpacity
          disabled={busy}
          onPress={takePhoto}
          style={{
            padding: 14,
            borderRadius: 12,
            backgroundColor: '#0ea5e9',
            marginBottom: 10,
            opacity: busy ? 0.85 : 1,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>
            {busy ? 'Working…' : '📷 Take Photo'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={busy}
          onPress={pickPhotoFromLibrary}
          style={{
            padding: 14,
            borderRadius: 12,
            backgroundColor: '#0369A1',
            marginBottom: 10,
            opacity: busy ? 0.85 : 1,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>
            {busy ? 'Working…' : '🖼️ Choose from Library'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={busy}
          onPress={pickAndProcess}
          style={{
            padding: 14,
            borderRadius: 12,
            backgroundColor: '#111',
            marginBottom: 10,
            opacity: busy ? 0.85 : 1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>
              {busy ? 'Processing…' : '📄 Upload CSV / PDF'}
            </Text>
            {!busy && (
              <View style={{ backgroundColor: '#16a34a', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 10 }}>✓ Recommended</Text>
              </View>
            )}
          </View>
          {!busy && (
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, textAlign: 'center', marginTop: 2 }}>
              Faster and more accurate than photos
            </Text>
          )}
        </TouchableOpacity>

        <Text style={{ color: '#6B7280', marginTop: 8 }}>{quickTip}</Text>
        <Text style={{ color: '#9CA3AF', marginTop: 6, fontSize: 12 }}>
          Where next: Open <Text style={{ fontWeight: '700' }}>Fast Receives (Pending)</Text> from Stock Control to
          review snapshots, run OCR on photos, and attach to specific orders.
        </Text>

        <TouchableOpacity
          disabled={busy}
          onPress={onClose}
          style={{
            padding: 14,
            borderRadius: 12,
            backgroundColor: '#F3F4F6',
            marginTop: 16,
          }}
        >
          <Text style={{ color: '#111', fontWeight: '800', textAlign: 'center' }}>Close</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
