// @ts-nocheck
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { AI_BASE_URL } from '../../config/ai';

type ProductDetails = {
  name: string;
  brand: string;
  size: string;
  category: string;
  barcode: string;
  unit: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  venueId: string | null | undefined;
  areaName?: string;
  onConfirm: (product: ProductDetails, count: number) => Promise<void>;
};

type Step = 'front-prompt' | 'back-prompt' | 'processing' | 'review' | 'count' | 'failed';

const BLANK: ProductDetails = { name: '', brand: '', size: '', category: '', barcode: '', unit: 'bottle' };

export default function ProductPhotoModal({ visible, onClose, venueId, areaName, onConfirm }: Props) {
  const [step, setStep] = useState<Step>('front-prompt');
  const [frontB64, setFrontB64] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductDetails>(BLANK);
  const [count, setCount] = useState('1');
  const [confirming, setConfirming] = useState(false);
  const [failMsg, setFailMsg] = useState('');

  const reset = () => {
    setStep('front-prompt');
    setFrontB64(null);
    setProduct(BLANK);
    setCount('1');
    setConfirming(false);
    setFailMsg('');
  };

  const handleClose = () => { reset(); onClose(); };

  const ensureCamera = async (): Promise<boolean> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status === 'granted') return true;
    Alert.alert('Camera access needed', 'Allow camera access to photograph products.', [
      { text: 'Cancel', style: 'cancel' },
      ...(Platform.OS !== 'web' ? [{ text: 'Open Settings', onPress: () => Linking.openSettings() }] : []),
    ]);
    return false;
  };

  const takeFrontPhoto = async () => {
    if (!await ensureCamera()) return;
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const b64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    setFrontB64(b64);
    setStep('back-prompt');
  };

  const takeBackPhoto = async () => {
    if (!await ensureCamera()) return;
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const b64 = await FileSystem.readAsStringAsync(result.assets[0].uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await runScan(frontB64!, b64);
  };

  const skipBack = async () => { await runScan(frontB64!, null); };

  const runScan = async (front: string, back: string | null) => {
    setStep('processing');
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const body: any = { imageBase64: front, mimeType: 'image/jpeg', venueId, mode: 'product-photo' };
      if (back) body.imageBase64Back = back;
      const resp = await fetch(`${AI_BASE_URL}/api/extract-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => ({}));
      const ext = json?.product || {};
      if (!ext.name) {
        setFailMsg("We couldn't identify the product. Try a clearer, closer photo.");
        setStep('failed');
        return;
      }
      setProduct({
        name: ext.name || '',
        brand: ext.brand || '',
        size: ext.size || '',
        category: ext.category || '',
        barcode: ext.barcode || '',
        unit: ext.unit || 'bottle',
      });
      setStep('review');
    } catch {
      setFailMsg("We couldn't read the product details. Try better lighting or a closer shot.");
      setStep('failed');
    }
  };

  const handleSaveCount = async () => {
    const countNum = parseFloat(count);
    if (isNaN(countNum) || countNum < 0) {
      Alert.alert('Invalid count', 'Enter a valid count.');
      return;
    }
    setConfirming(true);
    try {
      await onConfirm(product, countNum);
      // Best-effort: add to global barcode catalogue
      if (product.barcode.trim()) {
        try {
          const db = getFirestore();
          const snap = await getDocs(query(
            collection(db, 'global_products'),
            where('barcode', '==', product.barcode.trim())
          ));
          if (snap.empty) {
            await addDoc(collection(db, 'global_products'), {
              name: product.name, brand: product.brand, size: product.size,
              category: product.category, barcode: product.barcode, unit: product.unit,
              createdAt: serverTimestamp(),
            });
          }
        } catch {}
      }
      handleClose();
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not save product.');
    } finally {
      setConfirming(false);
    }
  };

  const adjustCount = (delta: number) =>
    setCount(prev => String(Math.max(0, parseFloat(prev || '0') + delta)));

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        {/* Header */}
        <View style={S.header}>
          <Text style={S.headerTitle}>
            {step === 'front-prompt' ? 'Photograph product' :
             step === 'back-prompt' ? 'Barcode photo (optional)' :
             step === 'processing' ? 'Reading product…' :
             step === 'review' ? 'Confirm details' :
             step === 'count' ? 'Enter count' : 'Try again'}
          </Text>
          <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
            <Text style={{ fontSize: 18, color: '#64748b', fontWeight: '600' }}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── FRONT PROMPT ── */}
        {step === 'front-prompt' && (
          <View style={S.centered}>
            <Text style={S.bigIcon}>📸</Text>
            <Text style={S.stepTitle}>Photograph the front of the bottle</Text>
            <Text style={S.stepSub}>Show the label clearly in frame</Text>
            <TouchableOpacity style={[S.btn, { marginTop: 28 }]} onPress={takeFrontPhoto} activeOpacity={0.8}>
              <Text style={S.btnText}>Open Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClose} style={{ marginTop: 16 }}>
              <Text style={{ color: '#64748b', fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── BACK PROMPT ── */}
        {step === 'back-prompt' && (
          <View style={S.centered}>
            <Text style={S.bigIcon}>🔍</Text>
            <Text style={S.stepTitle}>Now photograph the back</Text>
            <Text style={S.stepSub}>Capture the barcode and size details</Text>
            <TouchableOpacity style={[S.btn, { marginTop: 28 }]} onPress={takeBackPhoto} activeOpacity={0.8}>
              <Text style={S.btnText}>Open Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.btn, S.btnSecondary, { marginTop: 10 }]} onPress={skipBack} activeOpacity={0.8}>
              <Text style={S.btnTextDark}>Skip back photo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── PROCESSING ── */}
        {step === 'processing' && (
          <View style={S.centered}>
            <ActivityIndicator size="large" color="#1b4f72" />
            <Text style={{ marginTop: 16, fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
              Reading product details…
            </Text>
            <Text style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>This usually takes a few seconds</Text>
          </View>
        )}

        {/* ── FAILED ── */}
        {step === 'failed' && (
          <View style={S.centered}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a', textAlign: 'center', marginBottom: 20, lineHeight: 22 }}>
              {failMsg}
            </Text>
            <TouchableOpacity style={S.btn} onPress={() => { setFrontB64(null); setStep('front-prompt'); }}>
              <Text style={S.btnText}>Retake photos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.btn, S.btnSecondary, { marginTop: 10 }]} onPress={handleClose}>
              <Text style={S.btnTextDark}>Add manually</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── REVIEW ── */}
        {step === 'review' && (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {([
              { label: 'Name *', field: 'name', placeholder: 'e.g. Hendricks Gin' },
              { label: 'Brand', field: 'brand', placeholder: 'e.g. Hendricks' },
              { label: 'Size', field: 'size', placeholder: 'e.g. 700ml' },
              { label: 'Category', field: 'category', placeholder: 'e.g. spirits' },
              { label: 'Barcode', field: 'barcode', placeholder: 'e.g. 5010327601007' },
              { label: 'Unit', field: 'unit', placeholder: 'e.g. bottle, can, kg' },
            ] as const).map(f => (
              <View key={f.field} style={{ marginBottom: 12 }}>
                <Text style={S.label}>{f.label}</Text>
                <TextInput
                  value={(product as any)[f.field]}
                  onChangeText={v => setProduct(p => ({ ...p, [f.field]: v }))}
                  placeholder={f.placeholder}
                  placeholderTextColor="#94a3b8"
                  style={S.input}
                />
              </View>
            ))}
            <TouchableOpacity
              style={[S.btn, { marginTop: 8 }]}
              onPress={() => {
                if (!product.name.trim()) { Alert.alert('Name required', 'Enter a product name.'); return; }
                setStep('count');
              }}
            >
              <Text style={S.btnText}>Looks good →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.btn, S.btnSecondary, { marginTop: 10 }]}
              onPress={() => { setFrontB64(null); setStep('front-prompt'); }}
            >
              <Text style={S.btnTextDark}>Retake photos</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ── COUNT ── */}
        {step === 'count' && (
          <View style={S.centered}>
            <Text style={S.stepTitle}>How many {product.name || 'items'} do you have?</Text>
            <Text style={S.stepSub}>{areaName ? `In ${areaName}` : ''}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 28, marginBottom: 32 }}>
              <TouchableOpacity onPress={() => adjustCount(-1)} style={S.stepper}>
                <Text style={{ fontWeight: '900', fontSize: 24 }}>−</Text>
              </TouchableOpacity>
              <TextInput
                value={count}
                onChangeText={setCount}
                keyboardType="decimal-pad"
                style={S.countInput}
                selectTextOnFocus
              />
              <TouchableOpacity onPress={() => adjustCount(1)} style={S.stepper}>
                <Text style={{ fontWeight: '900', fontSize: 24 }}>＋</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[S.btn, confirming && { opacity: 0.6 }]}
              onPress={handleSaveCount}
              disabled={confirming}
              activeOpacity={0.8}
            >
              {confirming
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={S.btnText}>Save count</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const S = StyleSheet.create({
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  bigIcon: { fontSize: 52, marginBottom: 16 },
  stepTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', textAlign: 'center', marginBottom: 8 },
  stepSub: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },
  btn: { backgroundColor: '#1b4f72', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', width: '100%' },
  btnSecondary: { backgroundColor: '#f1f5f9' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnTextDark: { color: '#374151', fontWeight: '700', fontSize: 15 },
  label: { fontWeight: '700', color: '#374151', marginBottom: 4, fontSize: 13 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0f172a',
  },
  stepper: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  countInput: {
    width: 88, height: 64, borderWidth: 2.5, borderColor: '#1b4f72',
    borderRadius: 14, textAlign: 'center', fontSize: 30, fontWeight: '800', color: '#0f172a',
  },
});
