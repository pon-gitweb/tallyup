// @ts-nocheck
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView,
  ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  doc, updateDoc, serverTimestamp, collection, addDoc,
  writeBatch, getFirestore,
} from 'firebase/firestore';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { getAuth } from 'firebase/auth';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { parseCsv, toObjects } from '../../services/imports/csv';
import { runPhotoOcrJob } from '../../services/ocr/photoOcr';
import { processSalesCsv } from '../../services/sales/processSalesCsv';
import { storeSalesReport } from '../../services/sales/storeSalesReport';

const API_BASE = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

type Step = 'intro' | 'products' | 'invoices' | 'sales' | 'confirm';
type InvoiceType = 'csv' | 'pdf' | 'photo' | null;
type ProductsMode = 'csv' | 'pdf' | 'photo' | null;

function slugId(s: string) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || ('p_' + Math.random().toString(36).slice(2, 8));
}

export default function BringYourDataScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const colours = useColours();
  const S = makeStyles(colours);

  const [step, setStep] = useState<Step>('intro');
  const [busy, setBusy] = useState(false);
  const [lastStocktakeDate, setLastStocktakeDate] = useState('');

  // ── Products state ──────────────────────────────────────────────────────────
  const [productsCsv, setProductsCsv] = useState<string | null>(null);
  const [productsFileName, setProductsFileName] = useState<string | null>(null);
  const [productsCount, setProductsCount] = useState(0);
  const [productsMode, setProductsMode] = useState<ProductsMode>(null);
  const [productsExtracted, setProductsExtracted] = useState<Array<{ name: string; qty: number; unitPrice?: number }>>([]);
  const [processingProducts, setProcessingProducts] = useState(false);

  // ── Invoices state ──────────────────────────────────────────────────────────
  const [invoicesFileName, setInvoicesFileName] = useState<string | null>(null);
  const [invoicesType, setInvoicesType] = useState<InvoiceType>(null);
  const [invoiceLines, setInvoiceLines] = useState<Array<{ name: string; qty: number; unitPrice?: number }>>([]);
  const [invoiceSupplierName, setInvoiceSupplierName] = useState<string | null>(null);
  const [processingInvoice, setProcessingInvoice] = useState(false);

  // ── Sales state ─────────────────────────────────────────────────────────────
  const [salesFileName, setSalesFileName] = useState<string | null>(null);
  const [salesReport, setSalesReport] = useState<any | null>(null);
  const [salesProcessing, setSalesProcessing] = useState(false);

  // ── Products: CSV ──────────────────────────────────────────────────────────
  const pickProductsCsv = useCallback(async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (pick.canceled) return;
      const asset = pick.assets?.[0] ?? pick;
      const content = await FileSystem.readAsStringAsync(String(asset.uri), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      let count = 0;
      try { const parsed = parseCsv(content); count = toObjects(parsed).length; } catch {}
      setProductsCsv(content);
      setProductsFileName(String(asset.name || 'products.csv'));
      setProductsCount(count);
      setProductsMode('csv');
      setProductsExtracted([]);
    } catch (e: any) {
      Alert.alert('File error', e?.message || 'Could not read file');
    }
  }, []);

  // ── Products: PDF / Photo extraction ──────────────────────────────────────
  async function extractProductsFromFile(uri: string, type: 'pdf' | 'photo', fileName: string) {
    if (!venueId) return;
    setProcessingProducts(true);
    try {
      if (type === 'photo') {
        const result = await runPhotoOcrJob({ venueId, localUri: uri });
        const lines = (result.lines || []).filter((l: any) => l.name && l.name.length > 1);
        setProductsExtracted(lines);
        setProductsFileName(fileName);
        setProductsMode('photo');
        setProductsCsv(null);
      } else {
        const auth = getAuth();
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Not signed in');
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const destPath = `venues/${venueId}/onboarding/stocktake/${Date.now()}.pdf`;
        const uploadRes = await fetch(`${API_BASE}/upload-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ destPath, dataUrl: `data:application/pdf;base64,${base64}` }),
        });
        if (!uploadRes.ok) throw new Error('Upload failed');
        const { fullPath } = await uploadRes.json();
        const processRes = await fetch(`${API_BASE}/process-invoices-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ venueId, storagePath: fullPath }),
        });
        if (!processRes.ok) throw new Error('Could not read PDF');
        const result = await processRes.json();
        const lines = (result.lines || []).filter((l: any) => l.name && l.name.length > 1);
        setProductsExtracted(lines);
        setProductsFileName(fileName);
        setProductsMode('pdf');
        setProductsCsv(null);
      }
    } catch (e: any) {
      Alert.alert('Could not read file', e?.message || 'Try a CSV export instead.');
      setProductsMode(null);
    } finally {
      setProcessingProducts(false);
    }
  }

  const pickProductsPdf = useCallback(async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', '*/*'], copyToCacheDirectory: true });
      if (pick.canceled) return;
      const asset = pick.assets?.[0] ?? pick;
      await extractProductsFromFile(String(asset.uri), 'pdf', String(asset.name || 'stocktake.pdf'));
    } catch (e: any) {
      Alert.alert('File error', e?.message || 'Could not open file');
    }
  }, [venueId]);

  const captureProductsPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera required', 'Allow camera access to photograph your stocktake sheet.');
      return;
    }
    const pic = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (pic.canceled) return;
    await extractProductsFromFile(pic.assets[0].uri, 'photo', 'stocktake-photo.jpg');
  }, [venueId]);

  function clearProducts() {
    setProductsFileName(null);
    setProductsCsv(null);
    setProductsExtracted([]);
    setProductsMode(null);
    setProductsCount(0);
  }

  // ── Invoice processing ─────────────────────────────────────────────────────
  async function processInvoiceFile(uri: string, type: 'csv' | 'pdf', name: string) {
    if (!venueId) return;
    setProcessingInvoice(true);
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not signed in');
      const ext = type === 'csv' ? '.csv' : '.pdf';
      const mimeType = type === 'csv' ? 'text/csv' : 'application/pdf';
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const destPath = `venues/${venueId}/onboarding/invoices/${Date.now()}${ext}`;
      const uploadRes = await fetch(`${API_BASE}/upload-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ destPath, dataUrl: `data:${mimeType};base64,${base64}` }),
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { fullPath } = await uploadRes.json();
      const endpoint = type === 'csv' ? 'process-invoices-csv' : 'process-invoices-pdf';
      const processRes = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ venueId, storagePath: fullPath }),
      });
      if (!processRes.ok) throw new Error('Processing failed');
      const result = await processRes.json();
      setInvoiceLines(result.lines || []);
      setInvoiceSupplierName(result.invoice?.supplierName || null);
      setInvoicesFileName(name);
      setInvoicesType(type);
    } catch (e: any) {
      Alert.alert('Could not process invoice', e?.message || 'Saved — you can match it later from Orders.');
      setInvoicesFileName(name);
      setInvoicesType(type);
      setInvoiceLines([]);
      setInvoiceSupplierName(null);
    } finally {
      setProcessingInvoice(false);
    }
  }

  const pickInvoicesCsv = useCallback(async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (pick.canceled) return;
      const asset = pick.assets?.[0] ?? pick;
      await processInvoiceFile(String(asset.uri), 'csv', String(asset.name || 'invoices.csv'));
    } catch (e: any) {
      Alert.alert('File error', e?.message || 'Could not open file');
    }
  }, [venueId]);

  const pickInvoicesPdf = useCallback(async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', '*/*'], copyToCacheDirectory: true });
      if (pick.canceled) return;
      const asset = pick.assets?.[0] ?? pick;
      await processInvoiceFile(String(asset.uri), 'pdf', String(asset.name || 'invoice.pdf'));
    } catch (e: any) {
      Alert.alert('File error', e?.message || 'Could not open file');
    }
  }, [venueId]);

  const captureInvoicePhoto = useCallback(async () => {
    if (!venueId) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera required', 'Allow camera access to photograph an invoice.');
      return;
    }
    const pic = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (pic.canceled) return;
    setProcessingInvoice(true);
    try {
      const result = await runPhotoOcrJob({ venueId, localUri: pic.assets[0].uri });
      setInvoiceLines(result.lines || []);
      setInvoiceSupplierName(result.supplierName || null);
      setInvoicesFileName('invoice-photo.jpg');
      setInvoicesType('photo');
    } catch (e: any) {
      Alert.alert('Photo scan failed', e?.message || 'Could not read this invoice photo.');
      setInvoicesFileName('invoice-photo.jpg');
      setInvoicesType('photo');
      setInvoiceLines([]);
      setInvoiceSupplierName(null);
    } finally {
      setProcessingInvoice(false);
    }
  }, [venueId]);

  function clearInvoice() {
    setInvoicesFileName(null);
    setInvoicesType(null);
    setInvoiceLines([]);
    setInvoiceSupplierName(null);
  }

  // ── Sales report upload ────────────────────────────────────────────────────
  const pickSalesCsv = useCallback(async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (pick.canceled) return;
      const asset = pick.assets?.[0] ?? pick;
      setSalesProcessing(true);
      const report = await processSalesCsv({
        venueId,
        fileUri: String(asset.uri),
        filename: String(asset.name || 'sales.csv'),
      });
      setSalesReport(report);
      setSalesFileName(String(asset.name || 'sales.csv'));
    } catch (e: any) {
      Alert.alert('Could not read sales file', e?.message || 'Please try again.');
    } finally {
      setSalesProcessing(false);
    }
  }, [venueId]);

  // Derived
  const salesDaysLabel = (() => {
    if (!salesReport) return null;
    const lines = salesReport.lines || [];
    if (!lines.length) return null;
    const start = salesReport.period?.start;
    const end = salesReport.period?.end;
    if (start && end) {
      const diff = Math.round(Math.abs((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
      if (diff > 0) return `${diff} days`;
    }
    return `${lines.length} product${lines.length !== 1 ? 's' : ''} sold`;
  })();

  const totalProductsCount = productsMode === 'csv' ? productsCount : productsExtracted.length;

  // ── Finish: write everything to Firestore ──────────────────────────────────
  async function onFinish() {
    if (!venueId || busy) return;
    setBusy(true);
    try {
      const fsdb = getFirestore();
      let createdSupplierId: string | null = null;
      let createdSupplierName: string | null = null;

      // 1) Unassigned holding supplier
      await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
        name: 'Unassigned', email: null, phone: null,
        orderingMethod: 'email', isHoldingSupplier: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });

      // 2) Auto-create supplier from invoice if detected
      if (invoiceSupplierName && invoiceLines.length > 0) {
        const supRef = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
          name: invoiceSupplierName, email: null, phone: null,
          orderingMethod: 'email', importedFromInvoice: true,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        createdSupplierId = supRef.id;
        createdSupplierName = invoiceSupplierName;
      }

      // 3) Import products
      const allProducts = productsMode === 'csv' && productsCsv
        ? (() => {
            try {
              return toObjects(parseCsv(productsCsv)).slice(0, 500).map((r: any) => ({
                name: String(r.name || '').trim(),
                unit: r.unit ? String(r.unit).trim() : null,
                parLevel: Number.isFinite(Number(r.parLevel)) ? Number(r.parLevel) : null,
                costPrice: Number.isFinite(Number(r.costPrice)) ? Number(r.costPrice) : null,
              })).filter((r: any) => r.name);
            } catch { return []; }
          })()
        : productsExtracted.slice(0, 500).map((l) => ({
            name: String(l.name).trim(),
            unit: null,
            parLevel: typeof l.qty === 'number' && l.qty > 0 ? l.qty : null,
            costPrice: typeof l.unitPrice === 'number' ? l.unitPrice : null,
          })).filter((r) => r.name);

      if (allProducts.length > 0) {
        const batch = writeBatch(fsdb);
        for (const r of allProducts) {
          const pref = doc(fsdb, 'venues', venueId, 'products', slugId(r.name));
          batch.set(pref, {
            name: r.name,
            ...(r.unit ? { unit: r.unit } : {}),
            ...(r.parLevel != null ? { parLevel: r.parLevel } : {}),
            ...(r.costPrice != null ? { costPrice: r.costPrice } : {}),
            supplierId: createdSupplierId || null,
            supplierName: createdSupplierName || null,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
        await batch.commit();
      }

      // 4) Store sales report
      if (salesReport && (salesReport.lines?.length ?? 0) > 0) {
        await storeSalesReport({ venueId, report: salesReport, source: 'csv' });
      }

      // 5) Mark onboarding complete
      await updateDoc(doc(db, 'venues', venueId), {
        onboardingRoad: 'data',
        onboardingCompletedAt: serverTimestamp(),
        onboardingLastStocktakeDate: lastStocktakeDate || null,
        onboardingHasInvoices: !!invoicesFileName,
        onboardingHasSales: !!salesReport,
        onboardingInvoiceLinesCount: invoiceLines.length,
      });

      nav.navigate('Dashboard');
    } catch (e: any) {
      Alert.alert('Setup failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const linkedCount = invoiceSupplierName ? totalProductsCount : 0;
  const unassignedCount = invoiceSupplierName ? 0 : totalProductsCount;

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">

        {/* ── INTRO ──────────────────────────────────────────────────────── */}
        {step === 'intro' && (
          <>
            <Text style={S.eyebrow}>Road 2 — Bring your data</Text>
            <Text style={S.h1}>Let's see what you've got</Text>
            <Text style={S.lead}>
              We'll import your products, invoices, and sales data so you hit the ground running.
              Every step is optional — skip anything you don't have yet.
            </Text>

            <Text style={S.label}>When was your last stocktake?</Text>
            <Text style={S.hint}>
              We'll use this to figure out which invoices might be missing from your records.
            </Text>
            <TextInput
              style={S.input}
              placeholder="e.g. 1 April 2025 — or leave blank"
              value={lastStocktakeDate}
              onChangeText={setLastStocktakeDate}
              placeholderTextColor={colours.textSecondary}
            />

            <TouchableOpacity style={S.cta} onPress={() => setStep('products')}>
              <Text style={S.ctaText}>Next — Products →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => nav.goBack()} style={S.backBtn}>
              <Text style={S.backText}>Back to road selection</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── PRODUCTS ───────────────────────────────────────────────────── */}
        {step === 'products' && (
          <>
            <Text style={S.eyebrow}>Step 1 of 4</Text>
            <Text style={S.h1}>Your products & opening stock</Text>
            <Text style={S.lead}>
              Upload a product list or photograph your last stocktake sheet. Opening counts
              will be set from whatever you upload.
            </Text>

            {processingProducts ? (
              <View style={[S.uploadCard, S.uploadCardCentre]}>
                <ActivityIndicator color={colours.primary} style={{ marginBottom: 10 }} />
                <Text style={S.processingText}>Reading your stocktake…</Text>
              </View>
            ) : productsFileName ? (
              <View style={S.uploadCard}>
                <Text style={S.uploadedName}>✓ {productsFileName}</Text>
                <Text style={[S.uploadedCount, { color: colours.success }]}>
                  {productsMode === 'csv'
                    ? `${productsCount} product${productsCount !== 1 ? 's' : ''} ready to import`
                    : `${productsExtracted.length} item${productsExtracted.length !== 1 ? 's' : ''} found — opening stock set from your counts`}
                </Text>
                {productsMode !== 'csv' && productsExtracted.slice(0, 3).map((l, i) => (
                  <Text key={i} style={S.linePreview}>
                    · {l.name}{l.qty ? ` × ${l.qty}` : ''}
                  </Text>
                ))}
                {productsMode !== 'csv' && productsExtracted.length > 3 && (
                  <Text style={S.linePreviewMore}>+ {productsExtracted.length - 3} more</Text>
                )}
                <TouchableOpacity onPress={clearProducts} style={S.changeBtn}>
                  <Text style={S.changeBtnText}>Change file</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={S.uploadCard}>
                <Text style={S.uploadTypeLabel}>Choose a format:</Text>
                <View style={S.uploadTypeRow}>
                  <TouchableOpacity style={S.uploadTypeBtn} onPress={pickProductsCsv}>
                    <Text style={S.uploadTypeBtnIcon}>📄</Text>
                    <Text style={S.uploadTypeBtnText}>CSV</Text>
                    <Text style={S.uploadTypeBtnSub}>Product list</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.uploadTypeBtn} onPress={pickProductsPdf}>
                    <Text style={S.uploadTypeBtnIcon}>📋</Text>
                    <Text style={S.uploadTypeBtnText}>PDF</Text>
                    <Text style={S.uploadTypeBtnSub}>Stocktake sheet</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.uploadTypeBtn} onPress={captureProductsPhoto}>
                    <Text style={S.uploadTypeBtnIcon}>📷</Text>
                    <Text style={S.uploadTypeBtnText}>Photo</Text>
                    <Text style={S.uploadTypeBtnSub}>Paper sheet</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {productsFileName && productsMode !== 'csv' && (
              <View style={S.successBanner}>
                <Text style={S.successBannerTitle}>Your opening stock counts are ready.</Text>
                <Text style={S.successBannerBody}>
                  Quantities from your sheet have been set as opening stock levels.
                  You can adjust these after your first count.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[S.cta, processingProducts && S.ctaDisabled]}
              onPress={() => setStep('invoices')}
              disabled={processingProducts}
            >
              <Text style={S.ctaText}>
                {productsFileName ? 'Next — Invoices →' : 'Skip — go to invoices →'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep('intro')} style={S.backBtn}>
              <Text style={S.backText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── INVOICES ───────────────────────────────────────────────────── */}
        {step === 'invoices' && (
          <>
            <Text style={S.eyebrow}>Step 2 of 4</Text>
            <Text style={S.h1}>Invoices since your last stocktake</Text>
            <Text style={S.lead}>
              Invoices tell us what came in the door — without them, variance is estimated.
              Upload a file or photograph a paper invoice.
            </Text>

            {!!lastStocktakeDate && (
              <View style={S.ctxCard}>
                <Text style={S.ctxText}>
                  Last stocktake: <Text style={{ fontWeight: '700' }}>{lastStocktakeDate}</Text>
                </Text>
                <Text style={S.ctxHint}>Ideally we'd love invoices from this date forward.</Text>
              </View>
            )}

            {processingInvoice ? (
              <View style={[S.uploadCard, S.uploadCardCentre]}>
                <ActivityIndicator color={colours.primary} style={{ marginBottom: 10 }} />
                <Text style={S.processingText}>Reading invoice…</Text>
              </View>
            ) : invoicesFileName ? (
              <View style={S.uploadCard}>
                <Text style={S.uploadedName}>{invoicesFileName}</Text>
                {invoiceSupplierName && (
                  <View style={S.supplierFoundCard}>
                    <Text style={S.supplierFoundTitle}>We found {invoiceSupplierName}</Text>
                    <Text style={S.supplierFoundSub}>
                      The supplier will be created automatically. We're good like that.
                    </Text>
                  </View>
                )}
                {invoiceLines.length > 0 ? (
                  <>
                    <Text style={[S.uploadedCount, { color: colours.success, marginTop: 8 }]}>
                      {invoiceLines.length} line{invoiceLines.length !== 1 ? 's' : ''} extracted
                    </Text>
                    {invoiceLines.slice(0, 3).map((l, i) => (
                      <Text key={i} style={S.linePreview}>
                        · {l.name}{l.qty ? ` × ${l.qty}` : ''}{l.unitPrice ? ` @ $${l.unitPrice.toFixed(2)}` : ''}
                      </Text>
                    ))}
                    {invoiceLines.length > 3 && (
                      <Text style={S.linePreviewMore}>+ {invoiceLines.length - 3} more</Text>
                    )}
                  </>
                ) : (
                  <Text style={S.uploadedCount}>Saved — lines couldn't be extracted automatically</Text>
                )}
                <TouchableOpacity onPress={clearInvoice} style={S.changeBtn}>
                  <Text style={S.changeBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={S.uploadCard}>
                <Text style={S.uploadTypeLabel}>Choose a format:</Text>
                <View style={S.uploadTypeRow}>
                  <TouchableOpacity style={S.uploadTypeBtn} onPress={pickInvoicesCsv}>
                    <Text style={S.uploadTypeBtnIcon}>📄</Text>
                    <Text style={S.uploadTypeBtnText}>CSV</Text>
                    <Text style={S.uploadTypeBtnSub}>Exported file</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.uploadTypeBtn} onPress={pickInvoicesPdf}>
                    <Text style={S.uploadTypeBtnIcon}>📋</Text>
                    <Text style={S.uploadTypeBtnText}>PDF</Text>
                    <Text style={S.uploadTypeBtnSub}>Supplier invoice</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.uploadTypeBtn} onPress={captureInvoicePhoto}>
                    <Text style={S.uploadTypeBtnIcon}>📷</Text>
                    <Text style={S.uploadTypeBtnText}>Photo</Text>
                    <Text style={S.uploadTypeBtnSub}>Paper invoice</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[S.cta, processingInvoice && S.ctaDisabled]}
              onPress={() => setStep('sales')}
              disabled={processingInvoice}
            >
              <Text style={S.ctaText}>
                {invoicesFileName ? 'Next — Sales data →' : "I'll add invoices later →"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep('products')} style={S.backBtn}>
              <Text style={S.backText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── SALES ──────────────────────────────────────────────────────── */}
        {step === 'sales' && (
          <>
            <Text style={S.eyebrow}>Step 3 of 4</Text>
            <Text style={S.h1}>Sales report</Text>
            <Text style={S.lead}>
              Upload a sales report CSV from your POS (Vend, Lightspeed, Square, Impos, etc).
              This makes your variance reports accurate from your very first stocktake.
            </Text>

            <View style={S.unlockCard}>
              <Text style={S.unlockTitle}>Here's what this unlocks for you</Text>
              {[
                'Variance compares actual vs theoretical usage — not just counts',
                'Suggested orders based on real sales velocity',
                'AI insights that account for what you actually sold',
              ].map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: 7 }}>
                  <Text style={{ color: colours.primary, fontWeight: '700' }}>✓</Text>
                  <Text style={{ flex: 1, fontSize: 13, color: colours.text, lineHeight: 18 }}>{item}</Text>
                </View>
              ))}
            </View>

            {salesProcessing ? (
              <View style={[S.uploadCard, S.uploadCardCentre]}>
                <ActivityIndicator color={colours.primary} style={{ marginBottom: 10 }} />
                <Text style={S.processingText}>Reading sales report…</Text>
              </View>
            ) : salesFileName ? (
              <View style={S.uploadCard}>
                <Text style={S.uploadedName}>✓ {salesFileName}</Text>
                <Text style={[S.uploadedCount, { color: colours.success }]}>
                  {salesReport?.lines?.length || 0} products found
                  {salesDaysLabel ? ` · ${salesDaysLabel} of data` : ''}
                </Text>
                <Text style={S.salesReadyText}>
                  Sales data has been loaded. Your variance reports will be accurate
                  from your very first stocktake.
                </Text>
                <TouchableOpacity
                  onPress={() => { setSalesFileName(null); setSalesReport(null); }}
                  style={S.changeBtn}
                >
                  <Text style={S.changeBtnText}>Change file</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={S.uploadCard}>
                <TouchableOpacity style={S.uploadBtn} onPress={pickSalesCsv}>
                  <Text style={S.uploadBtnText}>Upload sales report CSV</Text>
                </TouchableOpacity>
                <Text style={[S.hint, { marginTop: 10, marginBottom: 0 }]}>
                  Expected columns: name, qty_sold — other columns are optional
                </Text>
              </View>
            )}

            {!salesFileName && (
              <View style={S.skipCard}>
                <Text style={S.skipCardTitle}>No problem if you skip</Text>
                <Text style={S.skipCardBody}>
                  Variance reports become more accurate after your first completed stocktake.
                  You can load sales data any time from Stock Control.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[S.cta, salesProcessing && S.ctaDisabled]}
              onPress={() => setStep('confirm')}
              disabled={salesProcessing}
            >
              <Text style={S.ctaText}>
                {salesFileName ? 'Next — Review →' : "I'll add sales data later →"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep('invoices')} style={S.backBtn}>
              <Text style={S.backText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── CONFIRM ────────────────────────────────────────────────────── */}
        {step === 'confirm' && (
          <>
            <Text style={S.eyebrow}>Here's what we have</Text>
            <Text style={S.h1}>You're ready to go</Text>

            <View style={S.confirmCard}>
              <ConfirmRow
                label="Products"
                value={totalProductsCount > 0
                  ? `${totalProductsCount} products${productsMode === 'photo' ? ' (from photo)' : productsMode === 'pdf' ? ' (from PDF)' : ''}`
                  : 'Not uploaded — add from Stock Control any time'}
                ok={totalProductsCount > 0}
                colours={colours}
              />
              <ConfirmRow
                label="Suppliers created"
                value={invoiceSupplierName
                  ? `${invoiceSupplierName} (from invoice)`
                  : 'None yet — link from Stock Control'}
                ok={!!invoiceSupplierName}
                colours={colours}
              />
              <ConfirmRow
                label="Products linked to supplier"
                value={linkedCount > 0
                  ? `${linkedCount} products linked to ${invoiceSupplierName}`
                  : unassignedCount > 0
                    ? `${unassignedCount} unassigned — link them from Stock Control`
                    : 'No products to link'}
                ok={linkedCount > 0}
                colours={colours}
              />
              <ConfirmRow
                label="Sales data"
                value={salesFileName
                  ? `${salesReport?.lines?.length || 0} products${salesDaysLabel ? ` · ${salesDaysLabel}` : ''} loaded`
                  : 'Not loaded yet — add from Stock Control'}
                ok={!!salesFileName}
                colours={colours}
                last
              />
            </View>

            {unassignedCount > 0 && !invoiceSupplierName && (
              <View style={S.nudgeCard}>
                <Text style={S.nudgeTitle}>{unassignedCount} products still unassigned</Text>
                <Text style={S.nudgeText}>
                  Link your products to suppliers from{' '}
                  <Text style={{ fontWeight: '700' }}>Stock Control → Products</Text>{' '}
                  to unlock accurate ordering and variance. You can do this any time.
                </Text>
              </View>
            )}

            <View style={S.holdingCard}>
              <Text style={S.holdingTitle}>We'll create an "Unassigned" supplier</Text>
              <Text style={S.holdingText}>
                Any products without a supplier will be grouped here — easy to reassign
                from Stock Control whenever you're ready.
              </Text>
            </View>

            <TouchableOpacity
              style={[S.cta, S.ctaGreen, busy && S.ctaDisabled]}
              onPress={onFinish}
              disabled={busy}
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={S.ctaText}>You're ready — let's go →</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('sales')} style={S.backBtn}>
              <Text style={S.backText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ConfirmRow({
  label, value, ok, colours, last,
}: {
  label: string; value: string; ok: boolean; colours: any; last?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10,
      borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderColor: colours.border,
    }}>
      <Text style={{ width: 20, fontSize: 14, marginTop: 1, color: ok ? colours.success : colours.textSecondary }}>
        {ok ? '✓' : '○'}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, color: colours.textSecondary, marginBottom: 2 }}>{label}</Text>
        <Text style={{ fontSize: 14, fontWeight: ok ? '700' : '400', color: ok ? colours.navy : colours.textSecondary }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColours>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    content: { padding: 24, paddingBottom: 40 },
    eyebrow: {
      fontSize: 12, fontWeight: '700', color: c.primary,
      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
    },
    h1: { fontSize: 24, fontWeight: '900', color: c.navy, marginBottom: 10, lineHeight: 32 },
    lead: { fontSize: 14, color: c.textSecondary, marginBottom: 20, lineHeight: 20 },
    label: { fontSize: 14, fontWeight: '700', color: c.navy, marginBottom: 4 },
    hint: { fontSize: 12, color: c.textSecondary, marginBottom: 8 },
    input: {
      borderWidth: 1, borderColor: c.border, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
      backgroundColor: c.surface, color: c.text, marginBottom: 20,
    },
    uploadCard: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: c.border, marginBottom: 20,
    },
    uploadCardCentre: { alignItems: 'center', paddingVertical: 28 },
    processingText: { fontSize: 13, color: c.textSecondary },
    uploadBtn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    uploadBtnText: { color: c.primaryText, fontWeight: '700' },
    uploadTypeLabel: { fontSize: 12, color: c.textSecondary, marginBottom: 10 },
    uploadTypeRow: { flexDirection: 'row', gap: 10 },
    uploadTypeBtn: {
      flex: 1, backgroundColor: c.primaryLight, borderRadius: 12, paddingVertical: 14,
      alignItems: 'center', borderWidth: 1, borderColor: c.border,
    },
    uploadTypeBtnIcon: { fontSize: 22, marginBottom: 4 },
    uploadTypeBtnText: { fontSize: 13, fontWeight: '700', color: c.navy },
    uploadTypeBtnSub: { fontSize: 10, color: c.textSecondary, marginTop: 2, textAlign: 'center' },
    uploadedName: { fontSize: 14, fontWeight: '700', color: c.navy, marginBottom: 4 },
    uploadedCount: { fontSize: 12, color: c.textSecondary, marginBottom: 8 },
    linePreview: { fontSize: 12, color: c.textSecondary, marginBottom: 2 },
    linePreviewMore: { fontSize: 11, color: c.textSecondary, marginTop: 2, fontStyle: 'italic' },
    changeBtn: {
      alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12,
      borderRadius: 8, borderWidth: 1, borderColor: c.border, marginTop: 8,
    },
    changeBtnText: { fontSize: 12, color: c.textSecondary },
    ctxCard: {
      backgroundColor: '#FFF8F0', borderRadius: 10, padding: 12,
      marginBottom: 16, borderWidth: 1, borderColor: '#F0D4A8',
    },
    ctxText: { fontSize: 14, color: c.navy },
    ctxHint: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    supplierFoundCard: {
      backgroundColor: '#F0FDF4', borderRadius: 10, padding: 12,
      marginTop: 10, borderWidth: 1, borderColor: '#BBF7D0',
    },
    supplierFoundTitle: { fontSize: 13, fontWeight: '800', color: '#166534' },
    supplierFoundSub: { fontSize: 12, color: '#166534', marginTop: 2 },
    successBanner: {
      backgroundColor: '#F0FDF4', borderRadius: 12, padding: 14,
      marginBottom: 16, borderWidth: 1, borderColor: '#BBF7D0',
    },
    successBannerTitle: { fontSize: 13, fontWeight: '800', color: '#166534' },
    successBannerBody: { fontSize: 12, color: '#166534', marginTop: 3, lineHeight: 17 },
    unlockCard: {
      backgroundColor: c.primaryLight, borderRadius: 14, padding: 16,
      marginBottom: 20, borderWidth: 1, borderColor: c.border,
    },
    unlockTitle: { fontSize: 14, fontWeight: '800', color: c.navy, marginBottom: 2 },
    salesReadyText: { fontSize: 12, color: c.textSecondary, marginTop: 6, lineHeight: 17 },
    skipCard: {
      backgroundColor: c.surface, borderRadius: 12, padding: 14,
      marginBottom: 16, borderWidth: 1, borderColor: c.border,
    },
    skipCardTitle: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 4 },
    skipCardBody: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    confirmCard: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16,
      marginBottom: 16, borderWidth: 1, borderColor: c.border,
    },
    nudgeCard: {
      backgroundColor: '#FFF8F0', borderRadius: 12, padding: 14,
      marginBottom: 16, borderWidth: 1, borderColor: '#F0D4A8',
    },
    nudgeTitle: { fontSize: 14, fontWeight: '800', color: c.navy, marginBottom: 6 },
    nudgeText: { fontSize: 13, color: c.text, lineHeight: 19 },
    holdingCard: {
      backgroundColor: c.primaryLight, borderRadius: 12, padding: 14,
      marginBottom: 20, borderWidth: 1, borderColor: c.border,
    },
    holdingTitle: { fontSize: 14, fontWeight: '800', color: c.navy, marginBottom: 4 },
    holdingText: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    cta: {
      backgroundColor: c.primary, borderRadius: 999,
      paddingVertical: 16, alignItems: 'center', marginBottom: 8,
    },
    ctaGreen: { backgroundColor: '#16A34A' },
    ctaDisabled: { opacity: 0.4 },
    ctaText: { color: c.primaryText, fontSize: 16, fontWeight: '800' },
    backBtn: { alignItems: 'center', paddingVertical: 14 },
    backText: { fontSize: 13, color: c.textSecondary, textDecorationLine: 'underline' },
  });
}
