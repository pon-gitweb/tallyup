// @ts-nocheck
/**
 * BarcodeScannerModal
 * Full-screen barcode scanner for stocktake area.
 * Scans a barcode → looks up product in venue → auto-adds to area.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Alert, Modal, Text, TouchableOpacity, View, ActivityIndicator, Vibration,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../services/firebase';

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
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const cooldown = useRef(false);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setScanning(true);
      setLastScanned(null);
      cooldown.current = false;
    }
  }, [visible]);

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (!data || cooldown.current || !scanning) return;
    cooldown.current = true;
    setLastScanned(data);
    setLoading(true);
    Vibration.vibrate(80);

    try {
      // Look up product by barcode in venue products
      const productsRef = collection(db, 'venues', venueId!, 'products');
      const snap = await getDocs(query(productsRef, where('barcode', '==', data)));

      if (!snap.empty) {
        const d = snap.docs[0];
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
      } else {
        // Not found — offer to add as new
        setLoading(false);
        Alert.alert(
          'Product not found',
          'Barcode: ' + data + '\n\nNo product with this barcode exists in your venue. Would you like to add it as a new product?',
          [
            {
              text: 'Add as new',
              onPress: () => { onNotFound(data); onClose(); },
            },
            {
              text: 'Scan again',
              onPress: () => {
                setLastScanned(null);
                cooldown.current = false;
              },
            },
            { text: 'Cancel', style: 'cancel', onPress: onClose },
          ]
        );
      }
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Scan error', e?.message || 'Could not look up barcode.');
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
            Hosti-Stock needs camera access to scan barcodes.
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
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
          onBarcodeScanned={scanning && !loading ? onBarcodeScanned : undefined}
        />

        {/* Overlay */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' }}>
          {/* Top bar */}
          <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', padding: 16, paddingTop: 52 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900', textAlign: 'center' }}>
              Scan Barcode
            </Text>
            <Text style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginTop: 4 }}>
              Point camera at product barcode
            </Text>
          </View>

          {/* Scan frame */}
          <View style={{ alignItems: 'center' }}>
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
