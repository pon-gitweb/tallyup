// @ts-nocheck
import React, { useCallback, useState } from 'react';
import { Image, Modal, Text, TouchableOpacity, View } from 'react-native';
import { useToast } from '../../../components/common/Toast';
import * as ImagePicker from 'expo-image-picker';

export default function ShelfPhotoModal({ visible, onClose, onCapture }: any) {
  const [busy, setBusy] = useState(false);
  const { showError, showInfo } = useToast();

  const capture = useCallback(async (source: 'camera' | 'library') => {
    try {
      setBusy(true);
      let res;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showInfo('Please allow camera access in Settings to use this feature.');
          return;
        }
        res = await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: false });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          showInfo('Please allow photo library access in Settings.');
          return;
        }
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      }
      if (res.canceled || !res.assets?.[0]) return;
      onCapture?.(res.assets[0].uri);
    } catch (e: any) {
      showError(e?.message || 'Could not capture photo. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [onCapture]);

  return (
    <Modal visible={!!visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff', padding: 24, paddingTop: 60 }}>
        {/* Guidance */}
        <View style={{ backgroundColor: '#EFF6FF', borderRadius: 14, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#BFDBFE' }}>
          <Text style={{ fontWeight: '900', color: '#1E40AF', fontSize: 16, marginBottom: 8 }}>
            📷 Photograph shelf section
          </Text>
          <Text style={{ color: '#1E40AF', fontSize: 14, lineHeight: 22 }}>
            Capture 8–12 bottles maximum per photo.{'\n'}
            Stand 1–2 metres back, labels facing you.{'\n'}
            Take multiple photos for a long shelf.
          </Text>
        </View>

        <TouchableOpacity
          disabled={busy}
          onPress={() => capture('camera')}
          style={{ backgroundColor: '#111', padding: 16, borderRadius: 14, alignItems: 'center', marginBottom: 12 }}
        >
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>📷 Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={busy}
          onPress={() => capture('library')}
          style={{ backgroundColor: '#F3F4F6', padding: 16, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 12 }}
        >
          <Text style={{ color: '#111', fontWeight: '800', fontSize: 16 }}>🖼️ Choose from Library</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onClose} style={{ padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 8 }}>
          <Text style={{ color: '#6B7280', fontWeight: '700' }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
