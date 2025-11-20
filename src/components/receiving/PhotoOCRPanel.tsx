// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVenueId } from '../../context/VenueProvider';
import { runPhotoOcrJob } from '../../services/ocr/photoOcr';

type Props = {
  // Caller will receive normalized lines to pipe into your existing mapping UI
  onParsed: (payload: {
    supplierName?: string;
    invoiceNumber?: string;
    deliveryDate?: string;
    lines: Array<{ name: string; qty: number; unit?: string; unitPrice?: number }>;
    raw?: any;
  }) => void;
};

export default function PhotoOCRPanel({ onParsed }: Props) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  async function takePhoto() {
    try {
      console.log('[PhotoOCRPanel] takePhoto tapped', { venueId });

      if (!venueId) {
        Alert.alert('No Venue', 'Attach a venue first.');
        console.log('[PhotoOCRPanel] abort: no venueId');
        return;
      }

      const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
      console.log('[PhotoOCRPanel] camera permission result', cameraPerm);

      if (cameraPerm.status !== 'granted') {
        Alert.alert('Camera permission', 'Camera access is required.');
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: Platform.OS === 'ios' ? 0.7 : 0.5,
      });

      console.log('[PhotoOCRPanel] launchCameraAsync result', {
        canceled: res.canceled,
        assetCount: res.assets?.length ?? 0,
      });

      if (res.canceled || !res.assets?.length) return;

      setBusy(true);
      const asset = res.assets[0];

      console.log('[PhotoOCRPanel] calling runPhotoOcrJob', {
        venueId,
        uri: asset.uri,
      });

      const parsed = await runPhotoOcrJob({
        venueId,
        localUri: asset.uri,
      });

      console.log('[PhotoOCRPanel] runPhotoOcrJob result summary', {
        supplierName: parsed?.supplierName || null,
        invoiceNumber: parsed?.invoiceNumber || null,
        deliveryDate: parsed?.deliveryDate || null,
        lineCount: parsed?.lines?.length ?? 0,
      });

      setBusy(false);

      if (!parsed?.lines?.length) {
        Alert.alert('No lines found', 'The OCR ran but did not detect line items.');
        return;
      }

      onParsed(parsed);
    } catch (e: any) {
      setBusy(false);
      console.log('[PhotoOCRPanel] error during scan', e);
      Alert.alert('OCR failed', e?.message || 'Unknown error');
    }
  }

  return (
    <View
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 12,
        backgroundColor: 'white',
        gap: 8,
      }}
    >
      <Text style={{ fontWeight: '700' }}>Scan invoice (Photo OCR)</Text>
      <Text style={{ opacity: 0.7 }}>
        Take a photo of the invoice. We’ll extract items and send them to your mapping step.
      </Text>
      {busy ? (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <ActivityIndicator />
          <Text>Running OCR…</Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={takePhoto}
          style={{
            backgroundColor: '#0A84FF',
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Take photo</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
