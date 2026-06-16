// @ts-nocheck
/**
 * BarcodeScannerModal
 * Full-screen camera barcode scanner for stocktake areas.
 * Lookup flow: venue products → global catalogue → not found
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Text, TextInput, TouchableOpacity,
  View, ActivityIndicator, StyleSheet,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import {
  collection, doc, getDocs, query, serverTimestamp,
  setDoc, where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useToast } from '../common/Toast';

// ─── Types ───────────────────────────────────────────────────────────────────

type VenueProduct = {
  id: string; name: string; brand?: string; size?: string;
  category?: string; unit?: string; costPrice?: number; barcode?: string;
};
type GlobalProduct = {
  id: string; name: string; brand?: string; size?: string;
  category?: string; unit?: string; barcode: string;
};
type Phase =
  | 'scanning'
  | 'loading'
  | 'inArea'          // found & already in this area
  | 'inVenueNotArea'  // found in venue, not yet in this area
  | 'inGlobal'        // found in global catalogue
  | 'notFound';       // unknown barcode

export type Props = {
  visible: boolean;
  onClose: () => void;
  venueId: string | null | undefined;
  departmentId: string;
  areaId: string;
  areaItems: { id: string; name: string; productId?: string }[];
  onProductAddedToArea: () => void;   // tells parent to refresh
  onOpenPhotoModal: (barcode: string) => void;
  // Optional: opens quick-add form with scanned barcode pre-filled
  onManualEntry?: (barcode: string) => void;
  // Optional: parent intercepts add to show counting unit picker
  onBeforeAddToArea?: (product: VenueProduct & { caseSize?: number | null }, write: (extras: { countingUnit: string; caseSize: number | null }) => Promise<void>) => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function BarcodeScannerModal({
  visible, onClose, venueId, departmentId, areaId,
  areaItems, onProductAddedToArea, onOpenPhotoModal, onManualEntry, onBeforeAddToArea,
}: Props) {
  const { showError } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [torchOn, setTorchOn] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [venueProduct, setVenueProduct] = useState<VenueProduct | null>(null);
  const [globalProduct, setGlobalProduct] = useState<GlobalProduct | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [scanHintVisible, setScanHintVisible] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const cooldown = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const toastTimer = useRef<any>(null);
  const scanHintTimer = useRef<any>(null);

  // Pulse animation on targeting frame
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Reset on open/close; manage 8-second scan-difficulty hint timer
  useEffect(() => {
    if (visible) {
      setPhase('scanning');
      setTorchOn(false);
      setScannedBarcode('');
      setVenueProduct(null);
      setGlobalProduct(null);
      setAdding(false);
      setToast(null);
      cooldown.current = false;
      setScanHintVisible(false);
      setShowManualEntry(false);
      setManualBarcode('');
      if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
      scanHintTimer.current = setTimeout(() => setScanHintVisible(true), 8000);
    } else {
      if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
    }
  }, [visible]);

  // Cleanup hint timer on unmount
  useEffect(() => () => { if (scanHintTimer.current) clearTimeout(scanHintTimer.current); }, []);

  function showToast(msg: string, ms = 2500) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  // ── Scan handler ──────────────────────────────────────────────────────────

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (!data || cooldown.current || phase !== 'scanning') return;
    cooldown.current = true;
    setScannedBarcode(data);
    setPhase('loading');
    if (scanHintTimer.current) clearTimeout(scanHintTimer.current);
    setScanHintVisible(false);
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}

    try {
      if (!venueId) throw new Error('No venue');

      // STEP 1 — Check venue products (query both barcode field names, deduplicate)
      const [venueSnap1, venueSnap2] = await Promise.all([
        getDocs(query(collection(db, 'venues', venueId, 'products'), where('barcode', '==', data))),
        getDocs(query(collection(db, 'venues', venueId, 'products'), where('barcodeNumber', '==', data))),
      ]);
      const seenVenueIds = new Set<string>();
      const venueDocs = [...venueSnap1.docs, ...venueSnap2.docs].filter(d => {
        if (seenVenueIds.has(d.id)) return false;
        seenVenueIds.add(d.id);
        return true;
      });
      if (venueDocs.length > 0) {
        const d = venueDocs[0];
        const p = { id: d.id, ...(d.data() as any) } as VenueProduct;
        setVenueProduct(p);
        const inArea = areaItems.some(
          item => item.productId === d.id || item.name?.toLowerCase() === p.name?.toLowerCase()
        );
        setPhase(inArea ? 'inArea' : 'inVenueNotArea');
        return;
      }

      // STEP 2 — Check global catalogue (query both field names, deduplicate)
      const [globalSnap1, globalSnap2] = await Promise.all([
        getDocs(query(collection(db, 'global_products'), where('barcode', '==', data))),
        getDocs(query(collection(db, 'global_products'), where('barcodeNumber', '==', data))),
      ]);
      const seenGlobalIds = new Set<string>();
      const globalDocs = [...globalSnap1.docs, ...globalSnap2.docs].filter(d => {
        if (seenGlobalIds.has(d.id)) return false;
        seenGlobalIds.add(d.id);
        return true;
      });
      if (globalDocs.length > 0) {
        const d = globalDocs[0];
        setGlobalProduct({ id: d.id, ...(d.data() as any), barcode: data } as GlobalProduct);
        setPhase('inGlobal');
        return;
      }

      // STEP 3 — Not found
      setPhase('notFound');
    } catch (e: any) {
      cooldown.current = false;
      setPhase('scanning');
      if (e?.code === 'unavailable' || e?.code === 'failed-precondition') {
        showToast('📵 No connection — add this product manually when back online');
      } else {
        showError(e?.message || 'Could not look up barcode. Try again.');
      }
    }
  };

  // ── Add product from venue to area ────────────────────────────────────────

  async function addVenueProductToArea(p: VenueProduct) {
    if (!venueId) return;
    const doWrite = async (extras: { countingUnit: string; caseSize: number | null }) => {
      const itemRef = doc(
        db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', p.id
      );
      await setDoc(itemRef, {
        name: p.name,
        unit: p.unit ?? null,
        costPrice: p.costPrice ?? null,
        productId: p.id,
        countingUnit: extras.countingUnit,
        caseSize: extras.caseSize ?? null,
        lastCount: null,
        lastCountAt: null,
        inductionStatus: 'pending',
        inductionSource: 'barcode-scan',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      onProductAddedToArea();
      // Best-effort: propagate to global catalogue if this venue product isn't there yet
      const bc = (p.barcode || (p as any).barcodeNumber || '').trim();
      if (bc) {
        try {
          const [g1, g2] = await Promise.all([
            getDocs(query(collection(db, 'global_products'), where('barcode', '==', bc))),
            getDocs(query(collection(db, 'global_products'), where('barcodeNumber', '==', bc))),
          ]);
          if (g1.empty && g2.empty) {
            await writeToGlobalCatalogue({
              name: p.name,
              brand: p.brand || '',
              size: p.size || '',
              category: p.category || '',
              barcode: bc,
              unit: p.unit,
            });
          }
        } catch (e: any) {
          console.warn('[BarcodeScannerModal] global catalogue sync failed:', e?.message);
        }
      }
      showToast(`✓ ${p.name} added — update the count below`);
      setTimeout(onClose, 1800);
    };

    if (onBeforeAddToArea) {
      onBeforeAddToArea(p, doWrite);
      return;
    }

    setAdding(true);
    try {
      await doWrite({ countingUnit: 'unit', caseSize: null });
    } catch (e: any) {
      showError(e?.message || 'Could not add product. Please try again.');
      setAdding(false);
    }
  }

  // ── Add product from global catalogue to venue + area ────────────────────

  async function addGlobalProductToVenueAndArea(g: GlobalProduct) {
    if (!venueId) return;
    setAdding(true);
    try {
      // Write to venue products
      const prodRef = doc(collection(db, 'venues', venueId, 'products'));
      await setDoc(prodRef, {
        name: g.name,
        brand: g.brand ?? null,
        size: g.size ?? null,
        category: g.category ?? null,
        unit: g.unit ?? null,
        barcode: g.barcode,
        barcodeNumber: g.barcode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // Write to area items
      const itemRef = doc(
        db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', prodRef.id
      );
      await setDoc(itemRef, {
        name: g.name,
        unit: g.unit ?? null,
        productId: prodRef.id,
        inductionStatus: 'pending',
        inductionSource: 'barcode-scan',
        countingUnit: 'unit',
        caseSize: null,
        lastCount: null,
        lastCountAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onProductAddedToArea();
      showToast(`✓ ${g.name} added to your venue — update the count below`);
      setTimeout(onClose, 2000);
    } catch (e: any) {
      showError(e?.message || 'Could not add product. Please try again.');
      setAdding(false);
    }
  }

  // ── Contribute to global catalogue ────────────────────────────────────────

  async function writeToGlobalCatalogue(fields: {
    name: string; brand: string; size: string; category: string;
    barcode: string; unit?: string;
  }) {
    try {
      if (!venueId || !fields.barcode.trim()) return;
      const ref = doc(db, 'global_products', fields.barcode.trim());
      await setDoc(ref, {
        barcode: fields.barcode,
        barcodeNumber: fields.barcode,
        name: fields.name,
        brand: fields.brand || null,
        size: fields.size || null,
        category: fields.category || null,
        unit: fields.unit || null,
        addedAt: serverTimestamp(),
        addedByVenue: venueId,
        source: 'barcode-scan',
      }, { merge: true });
    } catch (e: any) {
      console.warn('[BarcodeScannerModal] global catalogue write failed:', e?.message);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  if (!visible) return null;

  if (!permission) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={S.centred}><ActivityIndicator /></View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={S.centred}>
          <Text style={S.permTitle}>Camera access needed</Text>
          <Text style={S.permBody}>Hosti needs camera access to scan barcodes.</Text>
          <TouchableOpacity style={S.permBtn} onPress={requestPermission}>
            <Text style={S.permBtnText}>Grant permission</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 12 }}>
            <Text style={{ color: '#6b7280' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  // ── Result panels ─────────────────────────────────────────────────────────

  const renderResult = () => {
    if (phase === 'loading') {
      return (
        <View style={S.resultCard}>
          <ActivityIndicator color="#1b4f72" size="large" />
          <Text style={S.resultBody}>Found it! Checking…</Text>
        </View>
      );
    }

    if (phase === 'inArea' && venueProduct) {
      return (
        <View style={S.resultCard}>
          <Text style={S.resultTag}>✓ Already in this area</Text>
          <Text style={S.resultName}>{venueProduct.name}</Text>
          <Text style={S.resultSub}>{[venueProduct.brand, venueProduct.size].filter(Boolean).join(' · ')}</Text>
          <Text style={[S.resultBody, { color: '#6b7280', marginTop: 8 }]}>
            Use the stepper or input in the list below to update your count.
          </Text>
          <TouchableOpacity style={S.btnPrimary} onPress={onClose}>
            <Text style={S.btnPrimaryText}>Got it</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (phase === 'inVenueNotArea' && venueProduct) {
      return (
        <View style={S.resultCard}>
          <Text style={S.resultTag}>✓ Found in your inventory</Text>
          <Text style={S.resultName}>{venueProduct.name}</Text>
          <Text style={S.resultSub}>{[venueProduct.brand, venueProduct.size, venueProduct.category].filter(Boolean).join(' · ')}</Text>
          <Text style={S.resultQuestion}>Add to this area?</Text>
          {adding
            ? <ActivityIndicator color="#1b4f72" style={{ marginTop: 16 }} />
            : (
              <>
                <TouchableOpacity style={S.btnPrimary} onPress={() => addVenueProductToArea(venueProduct)}>
                  <Text style={S.btnPrimaryText}>Add to area + count</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.btnSecondary} onPress={onClose}>
                  <Text style={S.btnSecondaryText}>Skip</Text>
                </TouchableOpacity>
              </>
            )}
        </View>
      );
    }

    if (phase === 'inGlobal' && globalProduct) {
      return (
        <View style={S.resultCard}>
          <Text style={S.resultTag}>✓ Found in Hosti catalogue</Text>
          <Text style={S.resultName}>{globalProduct.name}</Text>
          <Text style={S.resultSub}>{[globalProduct.brand, globalProduct.size, globalProduct.category].filter(Boolean).join(' · ')}</Text>
          <Text style={S.resultQuestion}>Add this product to your venue?</Text>
          {adding
            ? <ActivityIndicator color="#1b4f72" style={{ marginTop: 16 }} />
            : (
              <>
                <TouchableOpacity style={S.btnPrimary} onPress={() => addGlobalProductToVenueAndArea(globalProduct)}>
                  <Text style={S.btnPrimaryText}>Add to venue + count</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.btnSecondary} onPress={onClose}>
                  <Text style={S.btnSecondaryText}>Skip</Text>
                </TouchableOpacity>
              </>
            )}
        </View>
      );
    }

    if (phase === 'notFound') {
      return (
        <View style={S.resultCard}>
          <Text style={S.notFoundEmoji}>🌱</Text>
          <Text style={S.notFoundTitle}>We're still learning this one!</Text>
          <Text style={S.notFoundBody}>
            This barcode isn't in our catalogue yet — but that's okay.
            Every product you add helps Hosti get smarter for every venue.{'\n\n'}
            Once you photograph it we'll remember it for next time — guaranteed.
          </Text>
          <TouchableOpacity
            style={S.btnPrimary}
            onPress={() => {
              onClose();
              setTimeout(() => onOpenPhotoModal(scannedBarcode), 300);
            }}
          >
            <Text style={S.btnPrimaryText}>📸 Photograph front + back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btnSecondary} onPress={() => {
            onClose();
            setTimeout(() => onManualEntry?.(scannedBarcode), 300);
          }}>
            <Text style={S.btnSecondaryText}>✏️ Enter details manually</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 8 }}>
            <Text style={[S.btnSecondaryText, { color: '#9ca3af' }]}>Skip for now</Text>
          </TouchableOpacity>
          <Text style={S.catalogueNote}>
            Takes about 30 seconds. Your contribution helps build the NZ hospitality product catalogue.
          </Text>
        </View>
      );
    }

    return null;
  };

  const showingResult = phase !== 'scanning';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>

        {/* Camera — always mounted so it starts quickly */}
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torchOn}
          barcodeScannerSettings={{
            barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
          }}
          onBarcodeScanned={phase === 'scanning' ? onBarcodeScanned : undefined}
        />

        {/* Top bar */}
        <View style={S.topBar}>
          <TouchableOpacity onPress={onClose} style={S.topBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={S.topBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={S.topTitle}>Scan Barcode</Text>
          <TouchableOpacity onPress={() => setTorchOn(v => !v)} style={S.topBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={S.topBtnText}>{torchOn ? '🔦' : '💡'}</Text>
          </TouchableOpacity>
        </View>

        {/* Targeting frame + hint + manual entry (only while scanning) */}
        {!showingResult && (
          <>
            <View style={S.frameWrap} pointerEvents="none">
              <View style={S.frame}>
                {/* Corner brackets */}
                <View style={[S.corner, S.cornerTL]} />
                <View style={[S.corner, S.cornerTR]} />
                <View style={[S.corner, S.cornerBL]} />
                <View style={[S.corner, S.cornerBR]} />
                {/* Pulse overlay */}
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: pulseAnim, backgroundColor: 'rgba(27,79,114,0.08)', borderRadius: 12 }]} />
              </View>
              <Text style={S.frameLabel}>Point at the barcode on the bottle</Text>
            </View>

            {/* 8-second scan difficulty hint */}
            {scanHintVisible && (
              <View style={S.scanHint} pointerEvents="none">
                <Text style={S.scanHintText}>
                  Having trouble? Try better lighting, hold steady, or tap 💡 for the torch.
                </Text>
              </View>
            )}

            {/* Manual barcode entry fallback */}
            <View style={S.manualEntryWrap}>
              {!showManualEntry ? (
                <TouchableOpacity onPress={() => setShowManualEntry(true)}>
                  <Text style={S.manualEntryLink}>Can't scan it? Enter manually</Text>
                </TouchableOpacity>
              ) : (
                <View style={S.manualEntryRow}>
                  <TextInput
                    style={S.manualEntryInput}
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
                    style={[S.manualEntryBtn, !manualBarcode.trim() && { opacity: 0.5 }]}
                    disabled={!manualBarcode.trim()}
                    onPress={() => {
                      const bc = manualBarcode.trim();
                      if (!bc) return;
                      setShowManualEntry(false);
                      setManualBarcode('');
                      onBarcodeScanned({ data: bc });
                    }}
                  >
                    <Text style={S.manualEntryBtnText}>Look up</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        )}

        {/* Result panel slides up from bottom */}
        {showingResult && (
          <View style={S.resultWrap}>
            <View style={{ flex: 1 }} />
            {renderResult()}
          </View>
        )}

        {/* Toast */}
        {toast ? (
          <View style={S.toast} pointerEvents="none">
            <Text style={S.toastText}>{toast}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TEAL = '#1b4f72';
const CORNER_SIZE = 22;
const CORNER_WIDTH = 3;

const S = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, color: '#0f172a', textAlign: 'center' },
  permBody: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 20 },
  permBtn: { backgroundColor: TEAL, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  permBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 52, paddingBottom: 16, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  topBtn: { width: 36, alignItems: 'center' },
  topBtnText: { fontSize: 20, color: '#fff' },
  topTitle: { color: '#fff', fontWeight: '800', fontSize: 17 },

  frameWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  frame: {
    width: 280, height: 170, borderRadius: 12,
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE,
    borderColor: TEAL, borderWidth: CORNER_WIDTH,
  },
  cornerTL: { top: -1, left: -1, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: -1, right: -1, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: -1, left: -1, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: -1, right: -1, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 6 },
  frameLabel: {
    color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 20,
    textAlign: 'center', fontWeight: '500',
  },

  resultWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  resultCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36,
  },
  resultTag: { fontSize: 12, fontWeight: '800', color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  resultName: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  resultSub: { fontSize: 14, color: '#64748b' },
  resultBody: { fontSize: 14, color: '#374151', lineHeight: 20 },
  resultQuestion: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 14, marginBottom: 4 },

  notFoundEmoji: { fontSize: 36, textAlign: 'center', marginBottom: 8 },
  notFoundTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', textAlign: 'center', marginBottom: 8 },
  notFoundBody: { fontSize: 14, color: '#374151', lineHeight: 21, textAlign: 'center', marginBottom: 16 },
  catalogueNote: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 10, lineHeight: 16 },

  btnPrimary: {
    backgroundColor: TEAL, borderRadius: 999,
    paddingVertical: 13, alignItems: 'center', marginTop: 14,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    backgroundColor: '#f1f5f9', borderRadius: 999,
    paddingVertical: 12, alignItems: 'center', marginTop: 10,
  },
  btnSecondaryText: { color: '#374151', fontWeight: '600', fontSize: 14 },

  toast: {
    position: 'absolute', bottom: 40, left: 20, right: 20,
    backgroundColor: 'rgba(22,163,74,0.92)', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center',
  },
  toastText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  scanHint: {
    position: 'absolute', bottom: 190, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 10,
    padding: 10, alignItems: 'center',
  },
  scanHintText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, textAlign: 'center', lineHeight: 18 },

  manualEntryWrap: {
    position: 'absolute', bottom: 100, left: 20, right: 20,
    alignItems: 'center',
  },
  manualEntryLink: {
    color: 'rgba(255,255,255,0.65)', fontSize: 13, textDecorationLine: 'underline',
  },
  manualEntryRow: { flexDirection: 'row', gap: 8, width: '100%' },
  manualEntryInput: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: '#fff', fontSize: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  manualEntryBtn: {
    backgroundColor: TEAL, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  manualEntryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
