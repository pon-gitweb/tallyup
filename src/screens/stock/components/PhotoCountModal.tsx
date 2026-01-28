// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export default function PhotoCountModal(props: {
  visible: boolean;
  onClose: () => void;

  item: any | null;
  areaName: string | null;
  defaultCount: number | null;

  onCaptured: (params: { fileUri: string; count: number; note: string | null }) => Promise<void>;
}) {
  const { visible, onClose, item, areaName, defaultCount, onCaptured } = props;

  const [busy, setBusy] = useState(false);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [countStr, setCountStr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible) return;
    setBusy(false);
    setFileUri(null);
    setCountStr(defaultCount != null ? String(defaultCount) : '');
    setNote('');
  }, [visible, defaultCount]);

  const canSave = useMemo(() => {
    if (!fileUri) return false;
    const t = (countStr || '').trim();
    if (!t) return false;
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return false;
    return true;
  }, [fileUri, countStr]);

  const takePhoto = useCallback(async () => {
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (cam.status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required to take a photo.');
        return;
      }
      const photo = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.85,
      });
      if (photo.canceled || !photo.assets?.[0]?.uri) return;
      setFileUri(photo.assets[0].uri);
    } catch (e: any) {
      Alert.alert('Camera failed', e?.message || String(e));
    }
  }, []);

  const save = useCallback(async () => {
    if (!canSave || !fileUri) return;
    const t = (countStr || '').trim();
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) {
      Alert.alert('Invalid', 'Enter a numeric quantity');
      return;
    }
    const count = parseFloat(t);
    const n = (note || '').trim() ? (note || '').trim() : null;

    setBusy(true);
    try {
      await onCaptured({ fileUri, count, note: n });
      onClose();
    } catch (e: any) {
      Alert.alert('Photo count failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [canSave, fileUri, countStr, note, onCaptured, onClose]);

  const itemName = item?.name || item?.productName || 'Item';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: '900' }}>Photo Count</Text>

          <Text style={{ marginTop: 6, color: '#6B7280' }}>
            {`Item: ${itemName}`}{areaName ? `  ·  ${areaName}` : ''}
          </Text>

          <View style={{ marginTop: 14, gap: 10 }}>
            <TouchableOpacity
              onPress={takePhoto}
              disabled={busy}
              style={{ backgroundColor: '#111827', paddingVertical: 12, borderRadius: 12 }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', textAlign: 'center' }}>
                {fileUri ? 'Retake photo' : 'Take photo'}
              </Text>
            </TouchableOpacity>

            <View>
              <Text style={{ fontWeight: '800', marginBottom: 6 }}>Count</Text>
              <TextInput
                value={countStr}
                onChangeText={setCountStr}
                placeholder="e.g. 12"
                keyboardType="decimal-pad"
                inputMode="decimal"
                editable={!busy}
                style={{ paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12 }}
              />
            </View>

            <View>
              <Text style={{ fontWeight: '800', marginBottom: 6 }}>Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="e.g. damaged, short delivery, moved…"
                editable={!busy}
                style={{ paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12 }}
              />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <TouchableOpacity
              onPress={onClose}
              disabled={busy}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#F3F4F6' }}
            >
              <Text style={{ textAlign: 'center', fontWeight: '900' }}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={save}
              disabled={!canSave || busy}
              style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: (!canSave || busy) ? '#9CA3AF' : '#16A34A' }}
            >
              {busy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <ActivityIndicator />
                  <Text style={{ color: '#fff', fontWeight: '900' }}>Saving…</Text>
                </View>
              ) : (
                <Text style={{ color: '#fff', fontWeight: '900', textAlign: 'center' }}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={{ marginTop: 10, color: '#9CA3AF', fontSize: 12 }}>
            Saves a photo as evidence and records a count for this item.
          </Text>
        </View>
      </View>
    </Modal>
  );
}
