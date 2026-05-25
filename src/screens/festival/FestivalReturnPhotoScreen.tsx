// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Alert, Image,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { ref, uploadString } from 'firebase/storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth, storage } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

type Condition = 'sealed' | 'partial' | 'damaged';

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalReturnPhotoScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;
  const { productId, productName, remaining = 0 } = route.params || {};

  const [photos,     setPhotos]     = useState<string[]>([]);
  const [condition,  setCondition]  = useState<Condition>('sealed');
  const [notes,      setNotes]      = useState('');
  const [uploading,  setUploading]  = useState(false);
  const [saved,      setSaved]      = useState(false);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>Coming soon — we'll let you know when it's live.</Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  async function pickPhoto(useCamera: boolean) {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Photo library permission is required.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      }
      if (!result.canceled && result.assets?.[0]?.uri) {
        setPhotos(prev => [...prev, result.assets[0].uri]);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not access camera or library.');
    }
  }

  async function saveEvidence() {
    if (!venueId || photos.length === 0 || uploading) return;
    setUploading(true);
    try {
      const storageRefs: string[] = [];
      for (const uri of photos) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const dataUrl = `data:image/jpeg;base64,${base64}`;
        const photoId = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const storagePath = `festival-returns/${venueId}/${productId}/${photoId}.jpg`;
        const storRef = ref(storage, storagePath);
        await uploadString(storRef, dataUrl, 'data_url');
        storageRefs.push(storagePath);
      }

      const photoDocId = `${productId}_${Date.now()}`;
      await setDoc(doc(db, 'venues', venueId, 'returns', 'eventReturn', 'photos', photoDocId), {
        productId,
        productName:  productName || productId,
        storageRefs,
        condition,
        notes:        notes.trim() || null,
        capturedBy:   uid ?? 'unknown',
        capturedAt:   serverTimestamp(),
        photoCount:   storageRefs.length,
      });

      setSaved(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save photos.');
    } finally {
      setUploading(false);
    }
  }

  if (saved) {
    return (
      <View style={S.center}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>✓</Text>
        <Text style={S.csTitle}>{photos.length} photo{photos.length !== 1 ? 's' : ''} captured</Text>
        <Text style={S.csBody}>{productName || productId} — ready for return</Text>
        <TouchableOpacity style={S.primaryBtn} onPress={() => nav.goBack()}>
          <Text style={S.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        <Text style={S.screenTitle}>{productName || productId}</Text>
        {remaining > 0 && (
          <Text style={S.sub}>{remaining} remaining — photograph before returning</Text>
        )}

        {/* Condition */}
        <Text style={S.label}>Condition</Text>
        {(['sealed', 'partial', 'damaged'] as Condition[]).map(c => (
          <TouchableOpacity
            key={c}
            style={[S.conditionRow, condition === c && S.conditionRowOn]}
            onPress={() => setCondition(c)}
          >
            <Text style={[S.conditionDot, condition === c && S.conditionDotOn]}>
              {condition === c ? '●' : '○'}
            </Text>
            <Text style={[S.conditionLabel, condition === c && S.conditionLabelOn]}>
              {c === 'sealed' ? 'Sealed — original packaging intact'
               : c === 'partial' ? 'Partially open case'
               : 'Damaged — describe below'}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Photo capture */}
        <Text style={[S.label, { marginTop: 20 }]}>Photos</Text>
        <View style={S.photoRow}>
          {photos.map((uri, i) => (
            <TouchableOpacity key={i} onLongPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}>
              <Image source={{ uri }} style={S.thumb} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={S.btnRow}>
          <TouchableOpacity style={S.photoBtn} onPress={() => pickPhoto(true)}>
            <Text style={S.photoBtnText}>📷 Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.photoBtn} onPress={() => pickPhoto(false)}>
            <Text style={S.photoBtnText}>🖼️ Choose from library</Text>
          </TouchableOpacity>
        </View>
        {photos.length > 0 && (
          <Text style={S.hint}>Long-press a photo to remove it</Text>
        )}
        {photos.length > 0 && (
          <TouchableOpacity style={S.addMoreBtn} onPress={() => pickPhoto(false)}>
            <Text style={S.addMoreBtnText}>+ Add another photo</Text>
          </TouchableOpacity>
        )}

        {/* Notes */}
        <Text style={[S.label, { marginTop: 20 }]}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. 2 bottles removed from case for tasting"
          placeholderTextColor="#9ca3af"
          style={S.notesInput}
          multiline
          numberOfLines={3}
        />

        {/* Save */}
        <TouchableOpacity
          style={[S.primaryBtn, (photos.length === 0 || uploading) && S.btnDisabled]}
          disabled={photos.length === 0 || uploading}
          onPress={saveEvidence}
        >
          {uploading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={S.primaryBtnText}>Save photo evidence</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={S.secondaryBtn} onPress={() => nav.goBack()}>
          <Text style={S.secondaryBtnText}>Cancel</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  center:     { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 22, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 12 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 16 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  scroll:     { padding: 16, paddingBottom: 40 },
  screenTitle:{ fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub:        { fontSize: 14, color: '#6b7280', marginBottom: 20 },
  label:      { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
  hint:       { fontSize: 12, color: '#9ca3af', marginTop: 4 },

  conditionRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e5e1d8', backgroundColor: '#fff', marginBottom: 6, gap: 10 },
  conditionRowOn: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  conditionDot:   { fontSize: 16, color: '#9ca3af' },
  conditionDotOn: { color: '#1b4f72' },
  conditionLabel: { fontSize: 14, color: '#374151', flex: 1 },
  conditionLabelOn:{ color: '#1b4f72', fontWeight: '600' },

  photoRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  thumb:      { width: 72, height: 72, borderRadius: 8, backgroundColor: '#e5e7eb' },
  btnRow:     { flexDirection: 'row', gap: 10, marginBottom: 8 },
  photoBtn:   { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  photoBtnText:{ fontSize: 13, fontWeight: '600', color: '#0B132B' },
  addMoreBtn: { backgroundColor: '#f3f4f6', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 8 },
  addMoreBtnText:{ fontSize: 13, color: '#1b4f72', fontWeight: '700' },

  notesInput: { backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e5e1d8', fontSize: 14, color: '#0B132B', minHeight: 80, textAlignVertical: 'top', marginBottom: 8 },

  primaryBtn:      { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  primaryBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn:    { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  secondaryBtnText:{ color: '#1b4f72', fontWeight: '700', fontSize: 14 },
  btnDisabled:     { opacity: 0.5 },
});
