// @ts-nocheck
/**
 * PhotoCountModal
 * Human-in-the-loop photo counting UI.
 *
 * Shows Claude's estimate with reasoning.
 * User confirms or adjusts — correction recorded for learning.
 */
import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, ScrollView,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { analyzePhotoForCount, recordPhotoCountCorrection } from '../../../services/vision/photoCount';
import { useVenueId } from '../../../context/VenueProvider';
import { useColours } from '../../../context/ThemeContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  productName?: string | null;
  productId?: string | null;
  unit?: string | null;
  onConfirm: (count: number) => void;
};

type Stage = 'camera' | 'analysing' | 'confirm' | 'error';

export default function PhotoCountModal({ visible, onClose, productName, productId, unit, onConfirm }: Props) {
  const venueId = useVenueId();
  const colours = useColours();
  const [stage, setStage] = useState<Stage>('camera');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [userCount, setUserCount] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const reset = useCallback(() => {
    setStage('camera');
    setImageUri(null);
    setResult(null);
    setUserCount('');
    setErrorMsg('');
  }, []);

  const onRequestClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const takePhoto = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Camera permission needed', 'Please allow camera access in settings.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.7,
      });
      if (res.canceled || !res.assets?.length) return;
      const uri = res.assets[0].uri;
      setImageUri(uri);
      setStage('analysing');

      const analysis = await analyzePhotoForCount(uri, productName, unit);
      setResult(analysis);
      setUserCount(String(analysis.estimatedCount || ''));
      setStage('confirm');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Analysis failed');
      setStage('error');
    }
  }, [productName, unit]);

  const onConfirmCount = useCallback(async () => {
    const count = parseFloat(userCount);
    if (!userCount || isNaN(count) || count < 0) {
      Alert.alert('Invalid count', 'Please enter a valid count.');
      return;
    }
    // Record correction for learning
    if (venueId && result) {
      recordPhotoCountCorrection(venueId, {
        venueId,
        productId: productId || null,
        productName: productName || result?.productName || null,
        aiEstimate: result.estimatedCount,
        aiConfidence: result.confidence,
        userCount: count,
        delta: count - result.estimatedCount,
        imageUri: imageUri,
      });
    }
    onConfirm(count);
    reset();
    onClose();
  }, [userCount, result, venueId, productId, productName, imageUri, onConfirm, reset, onClose]);

  const confidenceColor = (c: number) => c >= 0.8 ? colours.success : c >= 0.5 ? '#D97706' : colours.error;
  const confidenceLabel = (c: number) => c >= 0.8 ? 'High confidence' : c >= 0.5 ? 'Medium confidence' : 'Low confidence — please verify';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onRequestClose}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {/* Header */}
        <View style={{ backgroundColor: '#111', padding: 16, paddingTop: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>📷 Photo Count</Text>
            {productName ? <Text style={{ color: '#9CA3AF', fontSize: 13, marginTop: 2 }}>{productName}</Text> : null}
          </View>
          <TouchableOpacity onPress={onRequestClose} style={{ padding: 8 }}>
            <Text style={{ color: '#9CA3AF', fontWeight: '700' }}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>

          {/* Stage: Camera */}
          {stage === 'camera' && (
            <View style={{ gap: 12 }}>
              <View style={{ backgroundColor: '#F9FAFB', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 2, borderColor: '#E5E7EB', borderStyle: 'dashed' }}>
                <Text style={{ fontSize: 48, marginBottom: 12 }}>📸</Text>
                <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 6 }}>Photograph the shelf</Text>
                <Text style={{ color: '#6B7280', textAlign: 'center', fontSize: 13, marginBottom: 16 }}>
                  Point your camera at the products. Claude will count what it sees and ask you to confirm.
                </Text>
                <TouchableOpacity onPress={takePhoto}
                  style={{ backgroundColor: '#111', padding: 16, borderRadius: 12, alignItems: 'center', width: '100%' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Take Photo</Text>
                </TouchableOpacity>
              </View>
              <View style={{ backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12 }}>
                <Text style={{ color: '#1D4ED8', fontWeight: '700', marginBottom: 4 }}>Tips for best results</Text>
                <Text style={{ color: '#1D4ED8', fontSize: 13 }}>• Include the full shelf in frame{'\n'}• Good lighting helps accuracy{'\n'}• One product type per photo works best</Text>
              </View>
            </View>
          )}

          {/* Stage: Analysing */}
          {stage === 'analysing' && (
            <View style={{ alignItems: 'center', gap: 16, paddingTop: 40 }}>
              {imageUri && <Image source={{ uri: imageUri }} style={{ width: '100%', height: 200, borderRadius: 12 }} resizeMode="cover" />}
              <ActivityIndicator size="large" color="#111" />
              <Text style={{ fontWeight: '800', fontSize: 16 }}>Claude is counting...</Text>
              <Text style={{ color: '#6B7280', textAlign: 'center' }}>Analysing your photo for {productName || 'stock items'}</Text>
            </View>
          )}

          {/* Stage: Confirm */}
          {stage === 'confirm' && result && (
            <View style={{ gap: 12 }}>
              {imageUri && <Image source={{ uri: imageUri }} style={{ width: '100%', height: 180, borderRadius: 12 }} resizeMode="cover" />}

              {/* AI Result card */}
              <View style={{ backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontWeight: '900', color: '#166534', fontSize: 16 }}>🤖 AI Estimate</Text>
                  <View style={{ backgroundColor: confidenceColor(result.confidence), paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{confidenceLabel(result.confidence)}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 42, fontWeight: '900', color: '#111', textAlign: 'center', marginVertical: 8 }}>
                  {result.estimatedCount} <Text style={{ fontSize: 18, color: '#6B7280' }}>{unit || 'units'}</Text>
                </Text>
                {result.reasoning && (
                  <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 4, fontStyle: 'italic' }}>
                    "{result.reasoning}"
                  </Text>
                )}
              </View>

              {/* User adjustment */}
              <View style={{ backgroundColor: '#F9FAFB', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E5E7EB' }}>
                <Text style={{ fontWeight: '800', marginBottom: 8 }}>Confirm or adjust count</Text>
                <Text style={{ color: '#6B7280', fontSize: 13, marginBottom: 10 }}>
                  Your confirmation helps the AI improve over time.
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => setUserCount(v => String(Math.max(0, (parseFloat(v) || 0) - 1)))}
                    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 22, fontWeight: '900' }}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={userCount}
                    onChangeText={setUserCount}
                    keyboardType="decimal-pad"
                    style={{ flex: 1, borderWidth: 2, borderColor: '#0A84FF', borderRadius: 12, padding: 12, fontSize: 24, fontWeight: '900', textAlign: 'center' }}
                  />
                  <TouchableOpacity
                    onPress={() => setUserCount(v => String((parseFloat(v) || 0) + 1))}
                    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 22, fontWeight: '900' }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {result.suggestions?.length > 0 && (
                <View style={{ backgroundColor: '#FFF7ED', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#FED7AA' }}>
                  <Text style={{ color: '#92400E', fontWeight: '700', marginBottom: 4 }}>AI Tips</Text>
                  {result.suggestions.map((s: string, i: number) => (
                    <Text key={i} style={{ color: '#92400E', fontSize: 13 }}>• {s}</Text>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <TouchableOpacity onPress={reset}
                  style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700' }}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onConfirmCount}
                  style={{ flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#111', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Confirm {userCount} {unit || 'units'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Stage: Error */}
          {stage === 'error' && (
            <View style={{ alignItems: 'center', gap: 16, paddingTop: 40 }}>
              <Text style={{ fontSize: 48 }}>⚠️</Text>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>Analysis failed</Text>
              <Text style={{ color: '#6B7280', textAlign: 'center' }}>{errorMsg}</Text>
              <TouchableOpacity onPress={reset}
                style={{ backgroundColor: '#111', padding: 14, borderRadius: 12, alignItems: 'center', width: '100%' }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
