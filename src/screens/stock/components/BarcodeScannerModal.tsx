// @ts-nocheck
/**
 * BarcodeScannerModal
 * Full-screen barcode scanner for stock ordering / par management.
 * Lookup flow: venue products → global catalogue → not found
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Alert, Modal, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Vibration,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import { useToast } from '../../../components/common/Toast';

type Props = {
  visible: boolean;
  onClose: () => void;
  venueId: string | null | undefined;
  onFound: (product: {
    id: string;
    name: string;
    unit?: string | null;
    supplierName?: string | null;
    supplierId?: string | null;
    costPrice?: number | null;
    parLevel?: number | null;
  }) => void;
  onNotFound: (barcode: string) => void;
};

export default function BarcodeScannerModal({ visible, onClose, venueId, onFound, onNotFound }: Props) {
  const { showError } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanHintVisible, setScanHintVisible] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const cooldown = useRef(false);
  const scanHintTimer = useRef<any>(null);

  useEffect(() => {
    if (visible) {
      setScanning(true);
      setLastScanned(null);
      setTorchOn(false);
      setScanHintVisible(false);
      setShowManualEntry(false);
      setManualBarcode('');
      cooldown.current = false;
      if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
      scanHintTimer.current = setTimeout(() => setScanHintVisible(true), 8000);
    } else {
      if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
    }
  }, [visible]);

  // Cleanup hint timer on unmount
  useEffect(() => () => { if (scanHintTimer.current) clearTimeout(scanHintTimer.current); }, []);

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (!data || cooldown.current || !scanning) return;
    cooldown.current = true;
    setLastScanned(data);
    setLoading(true);
    setShowManualEntry(false);
    if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
    setScanHintVisible(false);
    Vibration.vibrate(80);

    try {
      // STEP 1 — venue products (both barcode field names, deduplicated)
      const productsRef = collection(db, 'venues', venueId!, 'products');
      const [snap1, snap2] = await Promise.all([
        getDocs(query(productsRef, where('barcode', '==', data))),
        getDocs(query(productsRef, where('barcodeNumber', '==', data))),
      ]);
      const venueMap = new Map();
      [...snap1.docs, ...snap2.docs].forEach(d => venueMap.set(d.id, d));

      if (venueMap.size > 0) {
        const d = [...venueMap.values()][0];
        const p = d.data() as any;
        onFound({
          id: d.id,
          name: p.name || data,
          unit: p.unit || null,
          supplierName: p.supplierName || null,
          supplierId: p.supplierId || null,
          costPrice: p.costPrice ?? p.cost ?? null,
          parLevel: p.parLevel ?? p.par ?? null,
        });
        onClose();
        return;
      }

      // STEP 2 — global catalogue (both barcode field names, deduplicated)
      const [globalSnap1, globalSnap2] = await Promise.all([
        getDocs(query(collection(db, 'global_products'), where('barcode', '==', data))),
        getDocs(query(collection(db, 'global_products'), where('barcodeNumber', '==', data))),
      ]);
      const globalMap = new Map();
      [...globalSnap1.docs, ...globalSnap2.docs].forEach(d => globalMap.set(d.id, d));
      setLoading(false);

      if (globalMap.size > 0) {
        const gd = [...globalMap.values()][0];
        const gp = gd.data() as any;
        const displayName = [gp.name, gp.brand, gp.size].filter(Boolean).join(' ') || data;
        Alert.alert(
          'Found in catalogue',
          `We found this product in our catalogue:\n\n${displayName}\n\nIs this correct?`,
          [
            {
              text: 'Yes, use this',
              onPress: () => {
                // Write to venue products best-effort; never blocks onFound
                (async () => {
                  try {
                    const existingSnap = await getDocs(
                      query(collection(db, 'venues', venueId!, 'products'), where('barcode', '==', data))
                    );
                    if (existingSnap.empty) {
                      await addDoc(collection(db, 'venues', venueId!, 'products'), {
                        name: gp.name,
                        brand: gp.brand ?? null,
                        size: gp.size ?? null,
                        category: gp.category ?? null,
                        unit: gp.unit ?? null,
                        barcode: data,
                        barcodeNumber: data,
                        supplierName: gp.supplierName ?? null,
                        supplierId: gp.supplierId ?? null,
                        costPrice: gp.costPrice ?? null,
                        parLevel: gp.parLevel ?? null,
                        createdAt: serverTimestamp(),
                        inductionSource: 'barcode-scan-global',
                      });
                    }
                  } catch (e: any) {
                    showError('Could not save to your venue: ' + (e?.message || 'Please try again'));
                  }
                  onFound({
                    id: gd.id,
                    name: gp.name || data,
                    unit: gp.unit ?? null,
                    supplierName: gp.supplierName ?? null,
                    supplierId: gp.supplierId ?? null,
                    costPrice: gp.costPrice ?? null,
                    parLevel: gp.parLevel ?? null,
                  });
                  onClose();
                })();
              },
            },
            { text: 'Add as new', onPress: () => { onNotFound(data); onClose(); } },
            {
              text: 'Scan again',
              onPress: () => {
                setLastScanned(null);
                setShowManualEntry(false);
                setScanHintVisible(false);
                cooldown.current = false;
                if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
                scanHintTimer.current = setTimeout(() => setScanHintVisible(true), 8000);
              },
            },
            { text: 'Cancel', style: 'cancel', onPress: onClose },
          ]
        );
      } else {
        Alert.alert(
          'Product not found',
          'Barcode: ' + data + '\n\nNo product with this barcode exists in your venue. Would you like to add it as a new product?',
          [
            { text: 'Add as new', onPress: () => { onNotFound(data); onClose(); } },
            {
              text: 'Scan again',
              onPress: () => {
                setLastScanned(null);
                setShowManualEntry(false);
                setScanHintVisible(false);
                cooldown.current = false;
                if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
                scanHintTimer.current = setTimeout(() => setScanHintVisible(true), 8000);
              },
            },
            { text: 'Cancel', style: 'cancel', onPress: onClose },
          ]
        );
      }
    } catch (e: any) {
      showError(e?.message || 'Could not look up barcode.');
      cooldown.current = false;
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  if (!permission) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 12 }}>Camera permission needed</Text>
          <Text style={{ color: '#6B7280', textAlign: 'center', marginBottom: 24 }}>
            Hosti needs camera access to scan barcodes.
          </Text>
          <TouchableOpacity onPress={requestPermission}
            style={{ backgroundColor: '#0A84FF', padding: 14, borderRadius: 12, marginBottom: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Grant permission</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: '#6B7280' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          enableTorch={torchOn}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
          onBarcodeScanned={scanning && !loading ? onBarcodeScanned : undefined}
        />

        {/* Overlay */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' }}>

          {/* Top bar with torch toggle */}
          <View style={{
            backgroundColor: 'rgba(0,0,0,0.6)', padding: 16, paddingTop: 52,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <View style={{ width: 36 }} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900', textAlign: 'center' }}>
                Scan Barcode
              </Text>
              <Text style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginTop: 4 }}>
                Point camera at product barcode
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setTorchOn(v => !v)}
              style={{ width: 36, alignItems: 'center' }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={{ fontSize: 20 }}>{torchOn ? '🔦' : '💡'}</Text>
            </TouchableOpacity>
          </View>

          {/* Scan frame + hint + manual entry */}
          <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
            <View style={{
              width: 260, height: 160, borderRadius: 16,
              borderWidth: 3, borderColor: loading ? '#F59E0B' : '#0A84FF',
              backgroundColor: 'transparent',
            }}>
              {/* Corner markers */}
              {[
                { top: -2, left: -2 }, { top: -2, right: -2 },
                { bottom: -2, left: -2 }, { bottom: -2, right: -2 },
              ].map((style, i) => (
                <View key={i} style={[{
                  position: 'absolute', width: 20, height: 20,
                  borderColor: '#fff', borderWidth: 3,
                }, style]} />
              ))}
            </View>

            {loading && (
              <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700' }}>Looking up product...</Text>
              </View>
            )}

            {lastScanned && !loading && (
              <Text style={{ color: '#9CA3AF', marginTop: 12, fontSize: 12 }}>
                Last scanned: {lastScanned}
              </Text>
            )}

            {/* 8-second scan difficulty hint */}
            {scanHintVisible && !loading && (
              <Text style={{
                color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'center',
                lineHeight: 18, marginTop: 12,
              }}>
                Having trouble? Try better lighting, hold steady, or tap 💡 for the torch.
              </Text>
            )}

            {/* Manual barcode entry fallback */}
            <View style={{ marginTop: 14, width: '100%', alignItems: 'center' }}>
              {!showManualEntry ? (
                <TouchableOpacity onPress={() => setShowManualEntry(true)}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, textDecorationLine: 'underline' }}>
                    Can't scan it? Enter manually
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                  <TextInput
                    style={{
                      flex: 1, backgroundColor: 'rgba(255,255,255,0.15)',
                      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
                      color: '#fff', fontSize: 14,
                      borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
                    }}
                    value={manualBarcode}
                    onChangeText={setManualBarcode}
                    placeholder="Enter barcode number"
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    keyboardType="number-pad"
                    autoFocus
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      const bc = manualBarcode.trim();
                      if (!bc) return;
                      setShowManualEntry(false);
                      setManualBarcode('');
                      onBarcodeScanned({ data: bc });
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      const bc = manualBarcode.trim();
                      if (!bc) return;
                      setShowManualEntry(false);
                      setManualBarcode('');
                      onBarcodeScanned({ data: bc });
                    }}
                    disabled={!manualBarcode.trim()}
                    style={{
                      backgroundColor: '#0A84FF', borderRadius: 8,
                      paddingHorizontal: 12, paddingVertical: 8,
                      alignItems: 'center', justifyContent: 'center',
                      opacity: manualBarcode.trim() ? 1 : 0.5,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Look up</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Bottom bar */}
          <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 }}>
            <TouchableOpacity onPress={onClose}
              style={{ backgroundColor: '#1F2937', padding: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
