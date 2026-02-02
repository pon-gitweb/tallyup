// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';

let ImagePicker:any = null;
try { ImagePicker = require('expo-image-picker'); } catch {}

export default function ShelfPhotoModal({
  visible,
  onClose,
  onCaptured,
}:{
  visible:boolean;
  onClose:()=>void;
  onCaptured:({fileUri}:{fileUri:string})=>Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const takePhoto = async () => {
    if (!ImagePicker) return Alert.alert('Missing dependency', 'expo-image-picker not available');
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm?.granted) return Alert.alert('No camera access', 'Camera permission is required.');

      const res = await ImagePicker.launchCameraAsync({
        quality: 0.75,
        allowsEditing: false,
      });

      if (res?.canceled) return;
      const uri = res?.assets?.[0]?.uri;
      if (!uri) return Alert.alert('Capture failed', 'No photo URI returned.');

      setBusy(true);
      await onCaptured({ fileUri: uri });
    } catch (e:any) {
      Alert.alert('Camera failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (visible) setBusy(false);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' }}>
        <View style={{ backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:16 }}>
          <Text style={{ fontSize:18, fontWeight:'900' }}>Take shelf photo</Text>
          <Text style={{ color:'#6B7280', marginTop:6 }}>
            Point at a shelf section. We’ll detect items and propose counts.
          </Text>

          <View style={{ flexDirection:'row', gap:10, marginTop:14 }}>
            <TouchableOpacity onPress={onClose} disabled={busy} style={{ padding:12, borderRadius:10, backgroundColor:'#E5E7EB', flex:1, opacity: busy ? 0.6 : 1 }}>
              <Text style={{ textAlign:'center', fontWeight:'900' }}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={takePhoto} disabled={busy} style={{ padding:12, borderRadius:10, backgroundColor:'#0A84FF', flex:1, opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator /> : <Text style={{ textAlign:'center', color:'#fff', fontWeight:'900' }}>Open Camera</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
