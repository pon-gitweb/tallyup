// @ts-nocheck
/**
 * InventoryImportScreen
 * "Upload your existing stocktake sheet"
 * Accepts PDF, Excel, CSV, Word, or a photo.
 * Claude extracts products, infers structure, returns preview.
 * User confirms → products written to Firestore.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { AI_BASE_URL } from '../../config/ai';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { stocktakeFingerprint, checkProcessed, writeProcessed, confirmDuplicateImport } from '../../services/deduplication';

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
          onPress={() => processMultiplePages(pages)}
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

export default withErrorBoundary(InventoryImportScreen, 'InventoryImport');
