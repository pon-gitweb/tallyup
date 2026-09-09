// @ts-nocheck
/**
 * InventoryImportScreen
 * "Upload your existing stocktake sheet"
 * Accepts PDF, Excel, CSV, Word, or a photo.
 * Claude extracts products, infers structure, returns preview.
 * User confirms → products written to Firestore.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, where, limit, doc, updateDoc } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { AI_BASE_URL } from '../../config/ai';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { stocktakeFingerprint, checkProcessed, writeProcessed, confirmDuplicateImport } from '../../services/deduplication';
import { scanInvoicePhoto } from '../../services/fastReceive/scanInvoicePhoto';
import { persistFastReceiveSnapshot } from '../../services/invoices/reconciliationStore';
import { commitInvoiceDecisions } from '../../services/fastReceive/commitInvoiceDecisions';

const EXTRACT_URL = `${AI_BASE_URL}/api/extract-inventory`;

export type ExtractedProduct = {
  name: string;
  unit?: string;
  category?: string;
  area?: string;
  department?: string;
  costPrice?: number | null;
  parLevel?: number | null;
  confidence: 'high' | 'medium' | 'low';
};

export type ExtractionResult = {
  products: ExtractedProduct[];
  inferredAreas: string[];
  inferredDepartments: string[];
  hasPricing: boolean;
  hasStructure: boolean;
  summary: string;
  warnings: string[];
};

function FileTypeButton({ icon, label, sublabel, onPress, themeColours }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={{
      flex: 1, backgroundColor: themeColours.surface, borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: themeColours.border, alignItems: 'center', gap: 6,
    }}>
      <Text style={{ fontSize: 32 }}>{icon}</Text>
      <Text style={{ fontWeight: '800', color: themeColours.text, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: themeColours.textSecondary, fontSize: 11, textAlign: 'center' }}>{sublabel}</Text>
    </TouchableOpacity>
  );
}

const MAX_PAGES = 40;

type CapturedPage = { uri: string };

// Shared type for the cascading dept→area picker (same pattern as EditProductScreen)
type DeptWithAreas = { id: string; name: string; areas: Array<{ id: string; name: string }> };

function dedupProducts(pages: ExtractedProduct[][]): { products: ExtractedProduct[]; dupeCount: number } {
  const seen = new Map<string, ExtractedProduct>();
  let dupeCount = 0;
  for (const batch of pages) {
    for (const p of batch) {
      const key = p.name.toLowerCase().trim();
      if (seen.has(key)) { dupeCount++; } else { seen.set(key, p); }
    }
  }
  return { products: Array.from(seen.values()), dupeCount };
}

function InventoryImportScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const themeColours = useColours();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');

  // Multi-page photo state
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [photoStage, setPhotoStage] = useState<'idle' | 'capturing'>('idle');

  // ── Review modal state (STOCKTAKE_PHOTO_IMPORT path) ──────────────────────
  const [reviewVisible, setReviewVisible] = useState(false);
  const [reviewSnapshotId, setReviewSnapshotId] = useState<string | null>(null);
  const [reviewProposals, setReviewProposals] = useState<any[]>([]);
  const [reviewSupplierCandidate, setReviewSupplierCandidate] = useState<any>(null);

  const readBase64 = async (uri: string): Promise<string> =>
    FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

  const processFile = useCallback(async (fileUri: string, fileName: string, mimeType: string) => {
    setLoading(true);
    setLoadingMsg('Reading your file...');
    try {
      const base64 = await readBase64(fileUri);
      console.log('[extract-inventory] processFile:', { fileName, mimeType, base64Len: base64?.length, preview: base64?.slice(0, 60) });
      setLoadingMsg('Hosti Intelligence is reading your inventory...');
      const token = await getAuth().currentUser?.getIdToken();
      const resp = await fetch(EXTRACT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, fileBase64: base64, fileName, mimeType }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || 'Could not read your file. Please try a different format.');
      }
      const result: ExtractionResult = await resp.json();
      if ((result as any).scannedPdf) {
        setLoading(false);
        showInfo((result as any).message || 'For best results upload a digital PDF or CSV export from your POS or spreadsheet.');
        return;
      }
      // Stocktake deduplication check
      if (venueId && (result.products?.length ?? 0) > 0) {
        const hash = stocktakeFingerprint(result.products);
        const { exists, processedAt } = await checkProcessed(venueId, 'processedStocktakes', hash);
        if (exists) {
          const dateStr = processedAt ? processedAt.toLocaleDateString('en-NZ') : 'previously';
          const proceed = await confirmDuplicateImport(
            'Stocktake already imported',
            `This stocktake sheet appears to have already been imported on ${dateStr}. Import anyway?`,
          );
          if (!proceed) { setLoading(false); return; }
        }
        await writeProcessed(venueId, 'processedStocktakes', hash, { productCount: result.products.length });
      }
      setLoading(false);
      nav.navigate('InventoryImportPreview', { result, venueId });
    } catch (e: any) {
      setLoading(false);
      showError(e?.message || 'Could not read file — please try again or use a different format.');
    }
  }, [venueId, nav]);

  const processMultiplePages = useCallback(async (capturedPages: CapturedPage[]) => {
    setLoading(true);
    const allBatches: ExtractedProduct[][] = [];
    const total = capturedPages.length;
    try {
      // Fetch token once — valid for 1 hour, sufficient for all pages
      const token = await getAuth().currentUser?.getIdToken();
      for (let i = 0; i < total; i++) {
        setLoadingMsg(`Processing page ${i + 1} of ${total}...`);
        const imageBase64 = await readBase64(capturedPages[i].uri);
        console.log(`[extract-inventory] page ${i + 1}/${total}: base64Len=${imageBase64?.length}, ok=${imageBase64?.length > 0}`);
        const resp = await fetch(EXTRACT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ venueId, imageBase64, mimeType: 'image/jpeg', mode: 'stocktake' }),
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error || `Page ${i + 1} failed`); }
        const batchResult: ExtractionResult = await resp.json();
        console.log(`[extract-inventory] page ${i + 1} result: products=${batchResult.products?.length ?? 0}`);
        allBatches.push(batchResult.products || []);
      }
      const { products, dupeCount } = dedupProducts(allBatches);
      const result: ExtractionResult = {
        products,
        inferredAreas: [],
        inferredDepartments: [],
        hasPricing: products.some(p => p.costPrice != null),
        hasStructure: products.some(p => p.area || p.department),
        summary: `Found ${products.length} products across ${total} page${total !== 1 ? 's' : ''}. ${dupeCount} duplicate${dupeCount !== 1 ? 's' : ''} removed.`,
        warnings: dupeCount > 0 ? [`${dupeCount} duplicate product${dupeCount !== 1 ? 's' : ''} removed across pages.`] : [],
      };
      // Stocktake deduplication check (multi-page)
      if (venueId && products.length > 0) {
        const hash = stocktakeFingerprint(products);
        const { exists, processedAt } = await checkProcessed(venueId, 'processedStocktakes', hash);
        if (exists) {
          const dateStr = processedAt ? processedAt.toLocaleDateString('en-NZ') : 'previously';
          const proceed = await confirmDuplicateImport(
            'Stocktake already imported',
            `This stocktake sheet appears to have already been imported on ${dateStr}. Import anyway?`,
          );
          if (!proceed) { setLoading(false); setPages([]); setPhotoStage('idle'); return; }
        }
        await writeProcessed(venueId, 'processedStocktakes', hash, { productCount: products.length });
      }
      setLoading(false);
      setPages([]);
      setPhotoStage('idle');
      nav.navigate('InventoryImportPreview', { result, venueId });
    } catch (e: any) {
      setLoading(false);
      showError(e?.message || 'Processing failed — please try again or use a different format.');
    }
  }, [venueId, nav]);

  // ── Photo processing via ocrInvoicePhoto (STOCKTAKE_PHOTO_IMPORT path) ──────
  // Replaces the old per-page /api/extract-inventory loop. All pages are batched
  // into one scanInvoicePhoto call, the result is persisted as a fastReceives
  // snapshot, and the review modal is opened for the user to accept/skip proposals.
  const processPhotoPages = useCallback(async (capturedPages: CapturedPage[]) => {
    setLoading(true);
    setLoadingMsg('Scanning your stocktake sheet...');
    try {
      const result = await scanInvoicePhoto({
        venueId,
        photoUris: capturedPages.map(p => p.uri),
        filename: `stocktake-import-${Date.now()}.jpg`,
      });

      setLoadingMsg('Saving scan...');
      const snapResult = await persistFastReceiveSnapshot({
        venueId,
        source: 'photo',
        storagePath: result.invoice.storagePath,
        payload: {
          invoice: result.invoice,
          proposals: result.proposals,
          supplierCandidate: result.supplierCandidate ?? null,
          lines: result.lines,
        },
      });
      if (!snapResult.ok || !snapResult.id) {
        throw new Error('Could not save scan — please try again.');
      }

      setLoading(false);
      setPages([]);
      setPhotoStage('idle');
      setReviewSnapshotId(snapResult.id);
      setReviewProposals(result.proposals || []);
      setReviewSupplierCandidate(result.supplierCandidate ?? null);
      setReviewVisible(true);
    } catch (e: any) {
      setLoading(false);
      showError(e?.message || 'Processing failed — please try again or use a different format.');
    }
  }, [venueId]);

  const addPhotoPage = useCallback(async (source: 'camera' | 'library') => {
    try {
      let res;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        // TODO: replace with branded modal — OS Settings deep-link
        if (!perm.granted) { Alert.alert('Camera access required', 'Please allow camera access in Settings.'); return; }
        res = await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: false });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        // TODO: replace with branded modal — OS Settings deep-link
        if (!perm.granted) { Alert.alert('Photo library access required', 'Please allow photo access in Settings.'); return; }
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      }
      if (res.canceled || !res.assets?.[0]) return;
      const uri = res.assets[0].uri;
      setPages(prev => {
        if (prev.length >= MAX_PAGES) { showInfo(`You can add up to ${MAX_PAGES} pages.`); return prev; }
        return [...prev, { uri }];
      });
      setPhotoStage('capturing');
    } catch (e: any) {
      showError(e?.message || 'Could not capture photo — please try again.');
    }
  }, []);

  const onPickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/csv','text/plain','public.comma-separated-values-text','*/*'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await processFile(asset.uri, asset.name, asset.mimeType || 'application/octet-stream');
      }
    } catch { showError('Could not open file picker — please try again.'); }
  }, [processFile]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColours.background, justifyContent: 'center', alignItems: 'center', gap: 20, padding: 40 }}>
        <ActivityIndicator size="large" color={themeColours.primary} />
        <Text style={{ fontSize: 18, fontWeight: '900', color: themeColours.text, textAlign: 'center' }}>{loadingMsg}</Text>
        <Text style={{ color: themeColours.textSecondary, textAlign: 'center', fontSize: 14 }}>
          Hosti Intelligence is reading your inventory and organising it for you. This usually takes 10–30 seconds.
        </Text>
      </View>
    );
  }

  {/* STOCKTAKE_PHOTO_IMPORT — temporarily hidden
      Cost optimisation — PDF/CSV available instead.
      Restore when photo API costs reduce or
      unlimited plan is active. */}
  if (false && photoStage === 'capturing') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: themeColours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={{ backgroundColor: themeColours.primaryLight, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColours.border }}>
          <Text style={{ fontWeight: '900', color: themeColours.deepBlue, fontSize: 16, marginBottom: 4 }}>
            📄 Photographing stocktake sheet
          </Text>
          <Text style={{ color: themeColours.deepBlue, fontSize: 13 }}>
            Place each page flat. Ensure all text is visible. Good lighting, no shadows across the text.
          </Text>
        </View>

        <Text style={{ fontWeight: '800', color: themeColours.text }}>
          {pages.length} page{pages.length !== 1 ? 's' : ''} captured (max {MAX_PAGES})
        </Text>

        {/* Thumbnails */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {pages.map((p, i) => (
            <View key={i} style={{ position: 'relative' }}>
              <Image source={{ uri: p.uri }} style={{ width: 80, height: 100, borderRadius: 8, borderWidth: 1, borderColor: themeColours.border }} resizeMode="cover" />
              <TouchableOpacity
                onPress={() => setPages(prev => prev.filter((_, idx) => idx !== i))}
                style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: themeColours.error, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: themeColours.surface, fontWeight: '900', fontSize: 11 }}>✕</Text>
              </TouchableOpacity>
              <Text style={{ textAlign: 'center', fontSize: 10, color: themeColours.textSecondary, marginTop: 2 }}>Pg {i + 1}</Text>
            </View>
          ))}
        </View>

        {/* Add more */}
        {pages.length < MAX_PAGES && (
          <View style={{ gap: 8 }}>
            <TouchableOpacity onPress={() => addPhotoPage('camera')} style={{ backgroundColor: themeColours.primary, padding: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: themeColours.primaryText, fontWeight: '800' }}>📷 Take another page</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => addPhotoPage('library')} style={{ backgroundColor: themeColours.surface, padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: themeColours.border }}>
              <Text style={{ color: themeColours.text, fontWeight: '800' }}>🖼️ Choose from library</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={() => processPhotoPages(pages)}
          disabled={pages.length === 0}
          style={{ backgroundColor: pages.length > 0 ? themeColours.success : themeColours.border, padding: 16, borderRadius: 12, alignItems: 'center' }}
        >
          <Text style={{ color: themeColours.surface, fontWeight: '900', fontSize: 16 }}>
            Done — process all {pages.length} page{pages.length !== 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { setPages([]); setPhotoStage('idle'); }} style={{ padding: 12, alignItems: 'center' }}>
          <Text style={{ color: themeColours.textSecondary }}>Cancel — start over</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <>
    {reviewVisible && reviewSnapshotId && (
      <InventoryReviewModal
        visible={reviewVisible}
        venueId={venueId}
        snapshotId={reviewSnapshotId}
        proposals={reviewProposals}
        supplierCandidate={reviewSupplierCandidate}
        onClose={() => setReviewVisible(false)}
        onCommitted={(created, changed) => {
          setReviewVisible(false);
          const total = created + changed;
          showSuccess(
            total > 0
              ? `${total} product${total === 1 ? '' : 's'} ${created > 0 ? 'added' : 'updated'} — you're all set!`
              : 'No changes made.'
          );
          nav.navigate('ProductsList');
        }}
      />
    )}
    <ScrollView style={{ flex: 1, backgroundColor: themeColours.background }} contentContainerStyle={{ padding: 16, gap: 20 }}>
      <View style={{ backgroundColor: themeColours.primary, borderRadius: 16, padding: 24, gap: 8 }}>
        <Text style={{ fontSize: 26, fontWeight: '900', color: themeColours.primaryText }}>Import your inventory</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15 }}>
          Upload your existing stocktake sheet and we'll set everything up for you — products, areas, and categories.
        </Text>
      </View>

      <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: themeColours.border }}>
        <Text style={{ fontWeight: '900', color: themeColours.text, marginBottom: 12, fontSize: 16 }}>What to upload</Text>
        {[
          { icon: '📊', label: 'Excel or CSV', desc: 'Your existing stocktake spreadsheet', rec: true },
          { icon: '📄', label: 'PDF', desc: 'A printed stocktake form or report', rec: true },
          { icon: '📝', label: 'Word document', desc: 'A stocktake list in Word format', rec: false },
          /* STOCKTAKE_PHOTO_IMPORT — temporarily hidden
             Cost optimisation — PDF/CSV available instead.
             Restore when photo API costs reduce or
             unlimited plan is active. */
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: i < 2 ? 10 : 0 }}>
            <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontWeight: '700', color: themeColours.text }}>{item.label}</Text>
                {item.rec && (
                  <View style={{ backgroundColor: themeColours.positiveSoft, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: themeColours.success }}>✓ Recommended</Text>
                  </View>
                )}
              </View>
              <Text style={{ color: themeColours.textSecondary, fontSize: 12 }}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={{ fontWeight: '900', color: themeColours.text, fontSize: 16 }}>Choose your file</Text>
      <View style={{ gap: 10 }}>
        <FileTypeButton icon="📁" label="Upload PDF or CSV" sublabel="PDF, Excel, CSV, Word — Recommended" onPress={onPickDocument} themeColours={themeColours} />
        {/* STOCKTAKE_PHOTO_IMPORT — temporarily hidden
            Cost optimisation — PDF/CSV available instead.
            Restore when photo API costs reduce or
            unlimited plan is active. */}
        {false && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <FileTypeButton icon="📷" label="Take photo" sublabel="Camera — multi-page" onPress={() => addPhotoPage('camera')} themeColours={themeColours} />
            <FileTypeButton icon="🖼️" label="Photo library" sublabel="From camera roll" onPress={() => addPhotoPage('library')} themeColours={themeColours} />
          </View>
        )}
        <View style={{ backgroundColor: themeColours.primaryLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: themeColours.border }}>
          <Text style={{ fontWeight: '800', color: themeColours.deepBlue, marginBottom: 6, fontSize: 14 }}>
            📄 For best results upload your stocktake as a PDF or CSV file
          </Text>
          <Text style={{ color: themeColours.deepBlue, fontSize: 13, lineHeight: 18, marginBottom: 12 }}>
            Digital files are processed faster and more accurately than photos.{'\n\n'}
            Tip: Export directly from your POS or spreadsheet for instant import.
          </Text>
        </View>
      </View>

      <View style={{ backgroundColor: themeColours.positiveSoft, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColours.success + '40' }}>
        <Text style={{ fontWeight: '800', color: themeColours.success, marginBottom: 8 }}>What happens next</Text>
        {['Hosti Intelligence reads your file and finds all your products','We group them by area or category','You review and confirm — edit anything before importing','Start your first stocktake straight away'].map((step, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: i < 3 ? 6 : 0 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: themeColours.success, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: themeColours.primaryText, fontSize: 11, fontWeight: '900' }}>{i + 1}</Text>
            </View>
            <Text style={{ color: themeColours.success, fontSize: 13, flex: 1 }}>{step}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity onPress={() => nav.navigate('ProductsCsvImport')} style={{ alignItems: 'center', padding: 12 }}>
        <Text style={{ color: themeColours.textSecondary, fontSize: 13 }}>I'd rather enter products manually →</Text>
      </TouchableOpacity>
      <View style={{ height: 20 }} />
    </ScrollView>
    {modal}
    </>
  );
}

// ── InventoryReviewModal ───────────────────────────────────────────────────────
// Proposal-review UI for the photo import path. Reuses the same ProposalCard
// pattern as FastReceiveDetailModal. Shows new-product proposals with a
// cascading dept→area picker so users can assign a home area at import time.
// Must not affect the existing FastReceive flow in any way.

type ReviewModalProps = {
  visible: boolean;
  venueId: string;
  snapshotId: string;
  proposals: any[];
  supplierCandidate: any | null;
  onClose: () => void;
  onCommitted: (created: number, changed: number) => void;
};

function InventoryReviewModal({
  visible, venueId, snapshotId, proposals, supplierCandidate, onClose, onCommitted,
}: ReviewModalProps) {
  const { showError } = useToast();
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'skip'>>({});
  const [supplierDecision, setSupplierDecision] = useState<'accept' | 'skip' | null>(null);
  const [homeAreas, setHomeAreas] = useState<Record<string, { deptId: string; areaId: string } | null>>({});
  const [committing, setCommitting] = useState(false);

  // Cascading dept→area picker
  const [depts, setDepts] = useState<DeptWithAreas[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [homeAreaPickerFor, setHomeAreaPickerFor] = useState<string | null>(null); // proposalId
  const [homeAreaPickerDept, setHomeAreaPickerDept] = useState<string | null>(null);

  // Reset decisions when modal opens with new data
  useEffect(() => {
    if (visible) {
      setDecisions({});
      setSupplierDecision(null);
      setHomeAreas({});
      setHomeAreaPickerFor(null);
      setHomeAreaPickerDept(null);
    }
  }, [visible, snapshotId]);

  // Lazy-load departments once on first open (same pattern as EditProductScreen)
  useEffect(() => {
    if (!visible || !venueId || depts.length > 0 || loadingDepts) return;
    setLoadingDepts(true);
    (async () => {
      try {
        const db = getFirestore(getApp());
        const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        const loaded: DeptWithAreas[] = [];
        for (const deptDoc of deptsSnap.docs) {
          const areasSnap = await getDocs(
            collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas')
          );
          const areas = areasSnap.docs
            .map(a => ({ id: a.id, name: (a.data() as any)?.name ?? a.id }))
            .sort((a, b) => a.name.localeCompare(b.name));
          if (areas.length > 0) {
            loaded.push({ id: deptDoc.id, name: (deptDoc.data() as any)?.name ?? deptDoc.id, areas });
          }
        }
        loaded.sort((a, b) => a.name.localeCompare(b.name));
        setDepts(loaded);
      } catch (_) { } finally { setLoadingDepts(false); }
    })();
  }, [visible, venueId]);

  const resolvedSupplierId = supplierCandidate ? null : null; // new product import has no pre-resolved supplier
  const needsSupplierDecision = !!supplierCandidate;
  const hasItems = proposals.length > 0 || !!supplierCandidate;

  const allDecided = React.useMemo(() => {
    if (!hasItems) return true;
    if (needsSupplierDecision && supplierDecision === null) return false;
    return proposals.every(p => p.id in decisions);
  }, [hasItems, needsSupplierDecision, supplierDecision, proposals, decisions]);

  const decide = useCallback((proposalId: string, dec: 'accept' | 'skip') => {
    setDecisions(prev => ({ ...prev, [proposalId]: dec }));
  }, []);

  const acceptAll = useCallback(() => {
    const next: Record<string, 'accept' | 'skip'> = {};
    for (const p of proposals) next[p.id] = 'accept';
    setDecisions(next);
  }, [proposals]);

  // Apply home-area assignments to newly created products (best-effort post-commit)
  const applyHomeAreas = async (acceptedProposals: any[]) => {
    try {
      const db = getFirestore(getApp());
      for (const p of acceptedProposals) {
        if (p.type !== 'newProduct') continue;
        const ha = homeAreas[p.id];
        if (!ha) continue;
        const snap = await getDocs(
          query(
            collection(db, 'venues', venueId, 'products'),
            where('name', '==', p.lineName),
            limit(1),
          )
        );
        if (!snap.empty) {
          await updateDoc(
            doc(db, 'venues', venueId, 'products', snap.docs[0].id),
            { homeDepartmentId: ha.deptId, homeAreaId: ha.areaId }
          );
        }
      }
    } catch (_) { /* non-fatal */ }
  };

  const handleCommit = useCallback(async () => {
    try {
      setCommitting(true);
      const acceptedIds = proposals.filter(p => decisions[p.id] === 'accept').map(p => p.id);
      const result = await commitInvoiceDecisions({
        venueId,
        snapshotId,
        acceptedProposalIds: acceptedIds,
        acceptSupplierCandidate: supplierDecision === 'accept',
      });
      const acceptedProposals = proposals.filter(p => decisions[p.id] === 'accept');
      await applyHomeAreas(acceptedProposals);
      onCommitted(result.created ?? 0, result.changed ?? 0);
    } catch (e: any) {
      showError(e?.message || 'Could not save changes — please try again.');
    } finally {
      setCommitting(false);
    }
  }, [venueId, snapshotId, proposals, decisions, supplierDecision, homeAreas, onCommitted]);

  const selectedDept = homeAreaPickerFor
    ? depts.find(d => d.id === homeAreaPickerDept) ?? null
    : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                       padding: 16, borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ fontSize: 18, color: '#2563EB' }}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '800' }}>Review Import</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>

          {/* Intro */}
          {!hasItems && (
            <View style={{ backgroundColor: '#f0fdf4', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#86efac' }}>
              <Text style={{ fontWeight: '800', color: '#166534', marginBottom: 4 }}>All products matched</Text>
              <Text style={{ color: '#166534', fontSize: 13 }}>
                Every product on this sheet is already in your catalog. Nothing new to add.
              </Text>
            </View>
          )}

          {/* Supplier candidate */}
          {!!supplierCandidate && (
            <View style={{ backgroundColor: '#fffbeb', borderRadius: 10, borderWidth: 1, borderColor: '#fcd34d', padding: 12 }}>
              <Text style={{ fontWeight: '800', color: '#92400e', marginBottom: 4 }}>New supplier detected</Text>
              <Text style={{ color: '#92400e', fontWeight: '700', marginBottom: 4 }}>{supplierCandidate.name}</Text>
              {!!supplierCandidate.phone && (
                <Text style={{ color: '#92400e', fontSize: 12 }}>Phone: {supplierCandidate.phone}</Text>
              )}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {supplierDecision === null ? (
                  <>
                    <TouchableOpacity
                      onPress={() => setSupplierDecision('accept')}
                      style={{ backgroundColor: '#16a34a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Add supplier</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setSupplierDecision('skip')}
                      style={{ backgroundColor: '#6B7280', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Skip</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={{ color: supplierDecision === 'accept' ? '#16a34a' : '#6B7280', fontWeight: '700', flex: 1, fontSize: 13 }}>
                      {supplierDecision === 'accept' ? '✓ Will be added' : '— Skipped'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setSupplierDecision(null)}
                      style={{ backgroundColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
                    >
                      <Text style={{ color: '#374151', fontWeight: '700', fontSize: 13 }}>Change</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          )}

          {/* Proposals */}
          {proposals.length > 0 && (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '900', fontSize: 15 }}>
                  {proposals.length} item{proposals.length !== 1 ? 's' : ''} to review
                </Text>
                {proposals.some(p => !(p.id in decisions)) && (
                  <TouchableOpacity onPress={acceptAll}>
                    <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 13 }}>Accept all</Text>
                  </TouchableOpacity>
                )}
              </View>
              {proposals.map(proposal => (
                <ReviewProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  decision={decisions[proposal.id] ?? null}
                  homeArea={homeAreas[proposal.id] ?? null}
                  onDecide={decide}
                  onPickHomeArea={() => {
                    setHomeAreaPickerFor(proposal.id);
                    setHomeAreaPickerDept(null);
                  }}
                  onClearHomeArea={() => setHomeAreas(prev => ({ ...prev, [proposal.id]: null }))}
                />
              ))}
            </View>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>

        {/* Footer */}
        <View style={{ padding: 16, borderTopWidth: 1, borderColor: '#E5E7EB', gap: 8 }}>
          {!allDecided && (
            <Text style={{ textAlign: 'center', color: '#6B7280', fontSize: 12, marginBottom: 4 }}>
              Review all items above before confirming
            </Text>
          )}
          <TouchableOpacity
            onPress={allDecided ? handleCommit : undefined}
            style={{
              backgroundColor: allDecided ? '#16a34a' : '#D1FAE5',
              borderRadius: 12, padding: 16, alignItems: 'center',
            }}
          >
            {committing
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: allDecided ? '#fff' : '#6B7280', fontWeight: '900', fontSize: 16 }}>
                  {allDecided ? 'Confirm import' : 'Review all items first'}
                </Text>
            }
          </TouchableOpacity>
        </View>

        {/* Cascading dept→area picker Modal */}
        <Modal
          visible={homeAreaPickerFor !== null}
          animationType="slide"
          transparent
          onRequestClose={() => setHomeAreaPickerFor(null)}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                             padding: 16, borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
                <Text style={{ fontWeight: '900', fontSize: 16 }}>Choose home area</Text>
                <TouchableOpacity onPress={() => setHomeAreaPickerFor(null)}>
                  <Text style={{ color: '#6B7280' }}>Done</Text>
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                {/* Skip for now — always first */}
                <TouchableOpacity
                  onPress={() => {
                    setHomeAreas(prev => ({ ...prev, [homeAreaPickerFor!]: null }));
                    setHomeAreaPickerFor(null);
                  }}
                  style={{
                    borderRadius: 10, padding: 14, borderWidth: 2,
                    borderColor: homeAreas[homeAreaPickerFor!] === null ? '#2563EB' : '#E5E7EB',
                    backgroundColor: homeAreas[homeAreaPickerFor!] === null ? '#EFF6FF' : '#fff',
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ fontWeight: '700', color: '#374151' }}>Skip for now</Text>
                  {homeAreas[homeAreaPickerFor!] === null && (
                    <Text style={{ color: '#2563EB', fontWeight: '800' }}>✓</Text>
                  )}
                </TouchableOpacity>

                {loadingDepts && (
                  <ActivityIndicator style={{ marginTop: 16 }} />
                )}

                {/* Dept step — shown first when no dept selected */}
                {!selectedDept && !loadingDepts && depts.map(dept => (
                  <TouchableOpacity
                    key={dept.id}
                    onPress={() => setHomeAreaPickerDept(dept.id)}
                    style={{ borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#E5E7EB',
                             backgroundColor: '#F9FAFB', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Text style={{ fontWeight: '700', color: '#374151' }}>{dept.name}</Text>
                    <Text style={{ color: '#6B7280' }}>›</Text>
                  </TouchableOpacity>
                ))}

                {/* Area step — shown after dept selected */}
                {selectedDept && (
                  <>
                    <TouchableOpacity onPress={() => setHomeAreaPickerDept(null)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
                      <Text style={{ color: '#2563EB', fontSize: 15 }}>‹</Text>
                      <Text style={{ color: '#2563EB', fontWeight: '700' }}>{selectedDept.name}</Text>
                    </TouchableOpacity>
                    {selectedDept.areas.map(area => (
                      <TouchableOpacity
                        key={area.id}
                        onPress={() => {
                          setHomeAreas(prev => ({
                            ...prev,
                            [homeAreaPickerFor!]: { deptId: selectedDept.id, areaId: area.id },
                          }));
                          setHomeAreaPickerFor(null);
                          setHomeAreaPickerDept(null);
                        }}
                        style={{ borderRadius: 10, padding: 14, borderWidth: 1,
                                 borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' }}
                      >
                        <Text style={{ color: '#374151' }}>{area.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

// ── ReviewProposalCard ─────────────────────────────────────────────────────────
// Extends ProposalCard (from FastReceiveDetailModal) with an optional
// dept→area picker row for newProduct proposals.

function ReviewProposalCard({ proposal, decision, homeArea, onDecide, onPickHomeArea, onClearHomeArea }: {
  proposal: any;
  decision: 'accept' | 'skip' | null;
  homeArea: { deptId: string; areaId: string } | null;
  onDecide: (id: string, dec: 'accept' | 'skip') => void;
  onPickHomeArea: () => void;
  onClearHomeArea: () => void;
}) {
  let heading = '';
  let detail = '';

  if (proposal.type === 'priceChange') {
    heading = `${proposal.productName}: $${proposal.oldPrice.toFixed(2)} → $${proposal.newPrice.toFixed(2)}`;
    detail = `${proposal.direction === 'increase' ? '↑' : '↓'} ${Math.abs(proposal.changePercent).toFixed(1)}%`;
  } else if (proposal.type === 'nearDuplicateMatch') {
    heading = `'${proposal.lineName}' looks like '${proposal.candidateProductName}'`;
    detail = proposal.existingPrice != null
      ? `Price: $${proposal.existingPrice.toFixed(2)} → $${proposal.newPrice.toFixed(2)}`
      : `First time — $${proposal.newPrice.toFixed(2)}`;
  } else if (proposal.type === 'newProduct') {
    heading = `${proposal.lineName} — add as new product?`;
    detail = proposal.unitPrice == null
      ? 'No price detected — can be added later'
      : proposal.caseSize
        ? `$${proposal.unitPrice.toFixed(2)} / $${(proposal.unitPrice / proposal.caseSize).toFixed(2)} per unit`
        : `$${proposal.unitPrice.toFixed(2)}`;
  } else if (proposal.type === 'supplierLink') {
    heading = `Link supplier to ${proposal.productName}`;
    detail = `$${proposal.unitCost.toFixed(2)}/unit`;
  }

  const decided = decision !== null && decision !== undefined;
  const isNewProduct = proposal.type === 'newProduct';

  return (
    <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 8, padding: 10, marginTop: 4 }}>
      <Text style={{ color: '#92400e', fontWeight: '700', fontSize: 13, marginBottom: 2 }}>{heading}</Text>
      {!!detail && <Text style={{ color: '#92400e', fontSize: 12, marginBottom: 6 }}>{detail}</Text>}

      {/* Home area picker — only for newProduct proposals, once accepted */}
      {isNewProduct && decision === 'accept' && (
        <View style={{ marginBottom: 8 }}>
          {homeArea ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#374151', fontSize: 12 }}>📍 Area assigned</Text>
              <TouchableOpacity onPress={onPickHomeArea}>
                <Text style={{ color: '#2563EB', fontSize: 12, fontWeight: '700' }}>Change</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClearHomeArea}>
                <Text style={{ color: '#6B7280', fontSize: 12 }}>✕ Clear</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={onPickHomeArea}
              style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6,
                       backgroundColor: '#fff', alignSelf: 'flex-start' }}
            >
              <Text style={{ color: '#374151', fontSize: 12 }}>📍 Assign home area (optional)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
        {!decided ? (
          <>
            <TouchableOpacity
              style={{ backgroundColor: '#16a34a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
              onPress={() => onDecide(proposal.id, 'accept')}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#6B7280', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
              onPress={() => onDecide(proposal.id, 'skip')}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Skip</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={{ color: decision === 'accept' ? '#16a34a' : '#6B7280', fontWeight: '700', flex: 1, fontSize: 13 }}>
              {decision === 'accept' ? '✓ Accepted' : '— Skipped'}
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}
              onPress={() => onDecide(proposal.id, decision === 'accept' ? 'skip' : 'accept')}
            >
              <Text style={{ color: '#374151', fontWeight: '700', fontSize: 13 }}>Change</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

export default withErrorBoundary(InventoryImportScreen, 'InventoryImport');
