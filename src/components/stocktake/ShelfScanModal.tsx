// @ts-nocheck
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getAuth } from 'firebase/auth';
import { AI_BASE_URL } from '../../config/ai';

type ShelfProduct = { key: string; name: string; brand: string; size: string; category: string };
type Step = 'camera' | 'processing' | 'review' | 'failed';

type Props = {
  visible: boolean;
  onClose: () => void;
  venueId: string | null | undefined;
  areaName?: string;
  onConfirm: (products: Omit<ShelfProduct, 'key'>[]) => Promise<void>;
};

export default function ShelfScanModal({ visible, onClose, venueId, areaName, onConfirm }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [step, setStep] = useState<Step>('camera');
  const [products, setProducts] = useState<ShelfProduct[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [failMsg, setFailMsg] = useState('');

  const reset = () => {
    setStep('camera');
    setProducts([]);
    setConfirming(false);
    setFailMsg('');
  };

  const handleClose = () => { reset(); onClose(); };

  const capture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true });
      if (!photo?.base64) throw new Error('No image data');
      setStep('processing');
      await runScan(photo.base64);
    } catch {
      setFailMsg('Camera error. Please try again.');
      setStep('failed');
    }
  };

  const runScan = async (imageBase64: string) => {
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const resp = await fetch(`${AI_BASE_URL}/api/extract-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg', venueId, mode: 'shelf-scan' }),
      });
      const json = await resp.json().catch(() => ({}));
      const raw: any[] = json?.products || [];
      if (raw.length === 0) {
        setFailMsg("We couldn't identify any products. Try better lighting or a closer shot.");
        setStep('failed');
        return;
      }
      setProducts(raw.map((p, i) => ({
        key: String(i),
        name: p.name || '',
        brand: p.brand || '',
        size: p.size || '',
        category: p.category || 'other',
      })));
      setStep('review');
    } catch {
      setFailMsg("We couldn't read the shelf clearly. Try better lighting or a closer shot.");
      setStep('failed');
    }
  };

  const updateProduct = (key: string, field: string, val: string) =>
    setProducts(prev => prev.map(p => p.key === key ? { ...p, [field]: val } : p));

  const removeProduct = (key: string) =>
    setProducts(prev => prev.filter(p => p.key !== key));

  const addBlank = () =>
    setProducts(prev => [...prev, { key: String(Date.now()), name: '', brand: '', size: '', category: 'other' }]);

  const handleConfirm = async () => {
    const valid = products.filter(p => p.name.trim());
    if (!valid.length) {
      Alert.alert('No products', 'Add at least one product name before confirming.');
      return;
    }
    setConfirming(true);
    try {
      await onConfirm(valid.map(({ key, ...rest }) => rest));
      handleClose();
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not save products.');
    } finally {
      setConfirming(false);
    }
  };

  if (!visible) return null;

  // Permissions
  if (!permission) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
        <View style={S.center}><ActivityIndicator /></View>
      </Modal>
    );
  }
  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
        <View style={S.center}>
          <Text style={S.permTitle}>Camera access needed</Text>
          <Text style={S.permBody}>Allow camera access to photograph your shelves.</Text>
          <TouchableOpacity style={S.btn} onPress={requestPermission}>
            <Text style={S.btnText}>Allow Camera</Text>
          </TouchableOpacity>
          {Platform.OS !== 'web' && (
            <TouchableOpacity style={[S.btn, S.btnSecondary, { marginTop: 10 }]} onPress={() => Linking.openSettings()}>
              <Text style={S.btnTextDark}>Open Settings</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleClose} style={{ marginTop: 16 }}>
            <Text style={{ color: '#64748b' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>

      {/* ── CAMERA ── */}
      {step === 'camera' && (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back">
            <TouchableOpacity
              onPress={handleClose}
              style={{ position: 'absolute', top: 16, left: 16, padding: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>

            <View style={{ position: 'absolute', top: '28%', left: 20, right: 20 }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 12, padding: 14 }}>
                <Text style={{ color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '700' }}>
                  Photograph the shelf
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontSize: 13, marginTop: 4 }}>
                  Get as much of the shelf in frame as possible
                </Text>
              </View>
            </View>

            <View style={{ position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' }}>
              <TouchableOpacity onPress={capture} style={S.captureBtn} activeOpacity={0.8}>
                <View style={S.captureBtnInner} />
              </TouchableOpacity>
            </View>
          </CameraView>
        </SafeAreaView>
      )}

      {/* ── PROCESSING ── */}
      {step === 'processing' && (
        <View style={S.center}>
          <ActivityIndicator size="large" color="#1b4f72" />
          <Text style={{ marginTop: 16, fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
            Reading shelf contents…
          </Text>
          <Text style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>This usually takes 5–10 seconds</Text>
        </View>
      )}

      {/* ── FAILED ── */}
      {step === 'failed' && (
        <View style={S.center}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a', textAlign: 'center', marginBottom: 20, lineHeight: 24 }}>
            {failMsg}
          </Text>
          <TouchableOpacity style={S.btn} onPress={() => { reset(); }}>
            <Text style={S.btnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.btn, S.btnSecondary, { marginTop: 10 }]} onPress={handleClose}>
            <Text style={S.btnTextDark}>Add manually</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── REVIEW ── */}
      {step === 'review' && (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={S.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>Shelf scan results</Text>
              <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Confirm the products we found — edit or remove any
              </Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
              <Text style={{ fontSize: 18, color: '#64748b', fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={products}
            keyExtractor={p => p.key}
            contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <View style={S.productRow}>
                <View style={{ flex: 1, gap: 6 }}>
                  <TextInput
                    value={item.name}
                    onChangeText={v => updateProduct(item.key, 'name', v)}
                    placeholder="Product name"
                    style={S.reviewInput}
                    placeholderTextColor="#94a3b8"
                  />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TextInput
                      value={item.brand}
                      onChangeText={v => updateProduct(item.key, 'brand', v)}
                      placeholder="Brand"
                      style={[S.reviewInput, { flex: 1 }]}
                      placeholderTextColor="#94a3b8"
                    />
                    <TextInput
                      value={item.size}
                      onChangeText={v => updateProduct(item.key, 'size', v)}
                      placeholder="Size"
                      style={[S.reviewInput, { flex: 1 }]}
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                  <TextInput
                    value={item.category}
                    onChangeText={v => updateProduct(item.key, 'category', v)}
                    placeholder="Category"
                    style={S.reviewInput}
                    placeholderTextColor="#94a3b8"
                  />
                </View>
                <TouchableOpacity onPress={() => removeProduct(item.key)} style={{ paddingHorizontal: 8, paddingTop: 4 }}>
                  <Text style={{ color: '#ef4444', fontWeight: '800', fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
            ListFooterComponent={
              <TouchableOpacity onPress={addBlank} style={S.addMoreBtn}>
                <Text style={{ color: '#1b4f72', fontWeight: '700', fontSize: 14 }}>
                  + Add missing product manually
                </Text>
              </TouchableOpacity>
            }
          />

          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
            <TouchableOpacity
              style={[S.btn, confirming && { opacity: 0.6 }]}
              onPress={handleConfirm}
              disabled={confirming}
              activeOpacity={0.8}
            >
              {confirming
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={S.btnText}>
                    Add {products.filter(p => p.name.trim()).length} products to {areaName || 'area'}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}
    </Modal>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  permTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  permBody: { color: '#64748b', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  btn: { backgroundColor: '#1b4f72', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', minWidth: 200 },
  btnSecondary: { backgroundColor: '#f1f5f9' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnTextDark: { color: '#374151', fontWeight: '700', fontSize: 15 },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  captureBtnInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff', borderWidth: 2.5, borderColor: '#d1d5db' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  productRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#f9fafb', borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9',
  },
  reviewInput: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#0f172a',
  },
  addMoreBtn: {
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, borderStyle: 'dashed',
    marginTop: 4,
  },
});
