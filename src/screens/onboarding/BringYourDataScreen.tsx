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
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { parseCsv, toObjects } from '../../services/imports/csv';

type Step = 'intro' | 'products' | 'invoices' | 'confirm';

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
  const [productsCsv, setProductsCsv] = useState<string | null>(null);
  const [productsFileName, setProductsFileName] = useState<string | null>(null);
  const [productsCount, setProductsCount] = useState(0);
  const [invoicesFileName, setInvoicesFileName] = useState<string | null>(null);

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
      try {
        const parsed = parseCsv(content);
        count = toObjects(parsed).length;
      } catch {}
      setProductsCsv(content);
      setProductsFileName(String(asset.name || 'products.csv'));
      setProductsCount(count);
    } catch (e: any) {
      Alert.alert('File error', e?.message || 'Could not read file');
    }
  }, []);

  const pickInvoices = useCallback(async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'application/pdf', '*/*'],
        copyToCacheDirectory: true,
      });
      if (pick.canceled) return;
      const asset = pick.assets?.[0] ?? pick;
      setInvoicesFileName(String(asset.name || 'invoices'));
    } catch (e: any) {
      Alert.alert('File error', e?.message || 'Could not read file');
    }
  }, []);

  async function onFinish() {
    if (!venueId || busy) return;
    setBusy(true);
    try {
      // Create "Unassigned" holding supplier
      await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
        name: 'Unassigned',
        email: null,
        phone: null,
        orderingMethod: 'email',
        portalUrl: null,
        defaultLeadDays: 2,
        isHoldingSupplier: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Write products from CSV if provided
      if (productsCsv && productsCount > 0) {
        try {
          const parsed = parseCsv(productsCsv);
          const rows = toObjects(parsed);
          const fsdb = getFirestore();
          const batch = writeBatch(fsdb);
          for (const r of rows.slice(0, 500)) {
            const name = String(r.name || '').trim();
            if (!name) continue;
            const pref = doc(fsdb, 'venues', venueId, 'products', slugId(name));
            const parLevel = Number.isFinite(Number(r.parLevel)) ? Number(r.parLevel) : null;
            const costPrice = Number.isFinite(Number(r.costPrice)) ? Number(r.costPrice) : null;
            batch.set(pref, {
              name,
              ...(r.unit ? { unit: String(r.unit).trim() } : {}),
              ...(parLevel != null ? { parLevel } : {}),
              ...(costPrice != null ? { costPrice } : {}),
              supplierId: null,
              supplierName: null,
              updatedAt: serverTimestamp(),
            }, { merge: true });
          }
          await batch.commit();
        } catch {}
      }

      // Mark onboarding complete on venue doc
      await updateDoc(doc(db, 'venues', venueId), {
        onboardingRoad: 'data',
        onboardingCompletedAt: serverTimestamp(),
        onboardingLastStocktakeDate: lastStocktakeDate || null,
        onboardingHasInvoices: !!invoicesFileName,
      });

      nav.navigate('Dashboard');
    } catch (e: any) {
      Alert.alert('Setup failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const missingInvoices = !invoicesFileName && !!lastStocktakeDate;

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">

        {step === 'intro' && (
          <>
            <Text style={S.eyebrow}>Road 2 — Bring your data</Text>
            <Text style={S.h1}>Let's see what you've got</Text>
            <Text style={S.lead}>
              We'll import your products, invoices, and last counts so you hit the ground running. Every step is
              optional — skip anything you don't have yet.
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

        {step === 'products' && (
          <>
            <Text style={S.eyebrow}>Step 2 of 3</Text>
            <Text style={S.h1}>Your product list</Text>
            <Text style={S.lead}>
              Upload a CSV of your products and last stocktake counts. Expected columns:{' '}
              <Text style={{ fontWeight: '700' }}>name, unit, category, parLevel, costPrice</Text>.
            </Text>

            <View style={S.uploadCard}>
              {productsFileName ? (
                <>
                  <Text style={S.uploadedName}>{productsFileName}</Text>
                  <Text style={S.uploadedCount}>
                    {productsCount} product{productsCount !== 1 ? 's' : ''} ready to import
                  </Text>
                  <TouchableOpacity onPress={pickProductsCsv} style={S.changeBtn}>
                    <Text style={S.changeBtnText}>Change file</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={S.uploadBtn} onPress={pickProductsCsv}>
                  <Text style={S.uploadBtnText}>Upload products CSV</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity style={S.cta} onPress={() => setStep('invoices')}>
              <Text style={S.ctaText}>
                {productsFileName ? 'Next — Invoices →' : 'Skip — go to invoices →'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('intro')} style={S.backBtn}>
              <Text style={S.backText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'invoices' && (
          <>
            <Text style={S.eyebrow}>Step 3 of 3</Text>
            <Text style={S.h1}>Invoices since your last stocktake</Text>
            <Text style={S.lead}>
              Invoices tell us what came in the door — without them, variance is estimated. You can always add
              them later from <Text style={{ fontWeight: '700' }}>Orders → Upload Invoice</Text>.
            </Text>

            {!!lastStocktakeDate && (
              <View style={S.dateCtxCard}>
                <Text style={S.dateCtxText}>
                  Last stocktake: <Text style={{ fontWeight: '700' }}>{lastStocktakeDate}</Text>
                </Text>
                <Text style={S.dateCtxHint}>
                  Ideally we'd love invoices from this date forward.
                </Text>
              </View>
            )}

            <View style={S.uploadCard}>
              {invoicesFileName ? (
                <>
                  <Text style={S.uploadedName}>{invoicesFileName}</Text>
                  <Text style={S.uploadedCount}>Ready to process</Text>
                  <TouchableOpacity onPress={pickInvoices} style={S.changeBtn}>
                    <Text style={S.changeBtnText}>Change file</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={S.uploadBtn} onPress={pickInvoices}>
                  <Text style={S.uploadBtnText}>Upload invoices (CSV or PDF)</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity style={S.cta} onPress={() => setStep('confirm')}>
              <Text style={S.ctaText}>
                {invoicesFileName ? 'Next — Review →' : "I'll add invoices later →"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('products')} style={S.backBtn}>
              <Text style={S.backText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'confirm' && (
          <>
            <Text style={S.eyebrow}>Here's what we have</Text>
            <Text style={S.h1}>Looking good — let's get you started</Text>

            <View style={S.confirmCard}>
              <ConfirmRow
                label="Last stocktake"
                value={lastStocktakeDate || 'Not provided'}
                ok={!!lastStocktakeDate}
                colours={colours}
              />
              <ConfirmRow
                label="Products"
                value={productsFileName
                  ? `${productsCount} products from ${productsFileName}`
                  : 'Not uploaded — you can add from Stock Control'}
                ok={!!productsFileName}
                colours={colours}
              />
              <ConfirmRow
                label="Invoices"
                value={invoicesFileName || 'Not uploaded'}
                ok={!!invoicesFileName}
                colours={colours}
                last
              />
            </View>

            {missingInvoices && (
              <View style={S.nudgeCard}>
                <Text style={S.nudgeTitle}>One thing worth knowing</Text>
                <Text style={S.nudgeText}>
                  You've told us your last stocktake was{' '}
                  <Text style={{ fontWeight: '700' }}>{lastStocktakeDate}</Text> but we don't have invoices
                  from that period yet. Variance reports will be estimated until you add them — you can do that
                  anytime from <Text style={{ fontWeight: '700' }}>Orders → Upload Invoice</Text>.
                </Text>
              </View>
            )}

            <View style={S.holdingCard}>
              <Text style={S.holdingTitle}>We'll create an "Unassigned" supplier</Text>
              <Text style={S.holdingText}>
                Any products without a supplier in your import will be grouped here — easy to reassign from
                Stock Control whenever you're ready.
              </Text>
            </View>

            <TouchableOpacity
              style={[S.cta, busy && { opacity: 0.6 }]}
              onPress={onFinish}
              disabled={busy}
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={S.ctaText}>Get started</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('invoices')} style={S.backBtn}>
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
        <Text style={{
          fontSize: 14,
          fontWeight: ok ? '700' : '400',
          color: ok ? colours.navy : colours.textSecondary,
        }}>
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
    uploadBtn: {
      backgroundColor: c.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    },
    uploadBtnText: { color: c.primaryText, fontWeight: '700' },
    uploadedName: { fontSize: 14, fontWeight: '700', color: c.navy, marginBottom: 4 },
    uploadedCount: { fontSize: 12, color: c.textSecondary, marginBottom: 10 },
    changeBtn: {
      alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12,
      borderRadius: 8, borderWidth: 1, borderColor: c.border,
    },
    changeBtnText: { fontSize: 12, color: c.textSecondary },
    dateCtxCard: {
      backgroundColor: '#FFF8F0', borderRadius: 10, padding: 12, marginBottom: 16,
      borderWidth: 1, borderColor: '#F0D4A8',
    },
    dateCtxText: { fontSize: 14, color: c.navy },
    dateCtxHint: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
    confirmCard: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16,
      marginBottom: 16, borderWidth: 1, borderColor: c.border,
    },
    nudgeCard: {
      backgroundColor: '#FFF8F0', borderRadius: 12, padding: 14, marginBottom: 16,
      borderWidth: 1, borderColor: '#F0D4A8',
    },
    nudgeTitle: { fontSize: 14, fontWeight: '800', color: c.navy, marginBottom: 6 },
    nudgeText: { fontSize: 13, color: c.text, lineHeight: 19 },
    holdingCard: {
      backgroundColor: c.primaryLight, borderRadius: 12, padding: 14, marginBottom: 20,
      borderWidth: 1, borderColor: c.border,
    },
    holdingTitle: { fontSize: 14, fontWeight: '800', color: c.navy, marginBottom: 4 },
    holdingText: { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
    cta: {
      backgroundColor: c.primary, borderRadius: 999,
      paddingVertical: 16, alignItems: 'center', marginBottom: 8,
    },
    ctaText: { color: c.primaryText, fontSize: 16, fontWeight: '800' },
    backBtn: { alignItems: 'center', paddingVertical: 14 },
    backText: { fontSize: 13, color: c.textSecondary, textDecorationLine: 'underline' },
  });
}
