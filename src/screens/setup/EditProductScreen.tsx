// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import AutoFillFromCatalog from '../../components/products/AutoFillFromCatalog';

// ---- Optional services (best effort). We gracefully fall back to raw Firestore if absent.
let svc:any = {};
try {
  svc = require('../../services/products');
} catch {}
const hasCreate = typeof svc.createProduct === 'function';
const hasUpdate = typeof svc.updateProduct === 'function';
const hasUpsert = typeof svc.upsertProduct === 'function';

// ---- Firestore fallback (only used if services missing)
let getApp:any, getFirestore:any, doc:any, setDoc:any, addDoc:any, collection:any, serverTimestamp:any, updateDoc:any;
try {
  ({ getApp } = require('firebase/app'));
  ({ getFirestore, doc, setDoc, addDoc, collection, serverTimestamp, updateDoc } = require('firebase/firestore'));
} catch { /* noop */ }

type NavParams = { productId?: string | null; product?: any | null };

const numOrNull = (v:any)=> {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v:any)=> {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};
const clean = (s:any)=> typeof s === 'string' ? s.trim() : '';

export default function EditProductScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = useVenueId();

  const params: NavParams = route?.params || {};
  const editingId = params?.productId || null;
  const seed = params?.product || null;

  // ----- Form state (kept simple + tolerant to legacy fields)
  const [form, setForm] = useState<any>(() => ({
    name: seed?.name ?? '',
    sku: seed?.sku ?? seed?.externalSku ?? null,
    unit: seed?.unit ?? null,
    size: seed?.size ?? null,               // "700ml"
    packSize: seed?.packSize ?? null,       // units per case
    abv: seed?.abv ?? null,                 // %
    costPrice: seed?.costPrice ?? seed?.price ?? seed?.unitCost ?? null, // ex GST
    gstPercent: seed?.gstPercent ?? 15,
    parLevel: seed?.parLevel ?? seed?.par ?? null,

    // existing link fields (do not set automatically here)
    supplierId: seed?.supplierId ?? null,
    supplierName: seed?.supplierName ?? seed?.supplier?.name ?? null,

    // hints from global catalog (non-authoritative)
    supplierNameSuggested: seed?.supplierNameSuggested ?? null,
    supplierGlobalId: seed?.supplierGlobalId ?? null,
    categorySuggested: seed?.categorySuggested ?? null,

    // activity
    active: typeof seed?.active === 'boolean' ? seed.active : true,
  }));

  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => {
    return clean(form.name).length > 0 && !!venueId;
  }, [form, venueId]);

  // -------- Save (service first, then Firestore fallback)
  async function save() {
    if (!venueId) {
      Alert.alert('Missing venue', 'No venue selected.');
      return;
    }
    if (!canSave) {
      Alert.alert('Missing name', 'Please enter a product name.');
      return;
    }

    // Prepare payload: keep fields flat and tolerant to your legacy schema
    const payload:any = {
      name: clean(form.name),
      sku: clean(form.sku || ''),
      unit: form.unit || null,
      size: form.size || null,
      packSize: intOrNull(form.packSize),
      abv: numOrNull(form.abv),
      costPrice: numOrNull(form.costPrice),
      gstPercent: numOrNull(form.gstPercent ?? 15) ?? 15,
      parLevel: intOrNull(form.parLevel),

      supplierId: form.supplierId || null,
      supplierName: form.supplierName || null,

      // keep hints for UI; they’re safe to store or ignore
      supplierNameSuggested: form.supplierNameSuggested || null,
      supplierGlobalId: form.supplierGlobalId || null,
      categorySuggested: form.categorySuggested || null,

      active: !!form.active,
      updatedAt: (serverTimestamp ? serverTimestamp() : new Date()),
    };

    setSaving(true);
    try {
      if (hasUpsert) {
        // prefer unified upsert if your services expose it
        const res = await svc.upsertProduct(venueId, editingId || undefined, payload);
        // navigate back on success
        nav.goBack();
        return;
      }
      if (editingId) {
        if (hasUpdate) {
          await svc.updateProduct(venueId, editingId, payload);
          nav.goBack();
          return;
        }
        // Raw Firestore fallback update
        if (getFirestore && doc && updateDoc) {
          const db = getFirestore(getApp());
          await updateDoc(doc(db, 'venues', venueId, 'products', editingId), payload);
          nav.goBack();
          return;
        }
        throw new Error('No update method available.');
      } else {
        if (hasCreate) {
          await svc.createProduct(venueId, payload);
          nav.goBack();
          return;
        }
        // Raw Firestore fallback create
        if (getFirestore && addDoc && collection) {
          const db = getFirestore(getApp());
          await addDoc(collection(db, 'venues', venueId, 'products'), {
            ...payload,
            createdAt: (serverTimestamp ? serverTimestamp() : new Date()),
          });
          nav.goBack();
          return;
        }
        throw new Error('No create method available.');
      }
    } catch (e:any) {
      Alert.alert('Save failed', e?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.select({ ios:'padding', android: undefined })}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>{editingId ? 'Edit Product' : 'Add Product'}</Text>

        {/* ---- Global Catalog Autofill (reads-only; applies a patch into the form) ---- */}
        <AutoFillFromCatalog
          initialTerm={form.name ?? ''}
          onApply={(patch) => {
            setForm((prev:any) => ({
              ...prev,
              // never override a name the user already typed (unless empty)
              name: clean(prev.name).length ? prev.name : patch.name,
              // merge rest
              sku: patch.sku ?? prev.sku ?? null,
              unit: patch.unit ?? prev.unit ?? null,
              size: patch.size ?? prev.size ?? null,
              packSize: patch.packSize ?? prev.packSize ?? null,
              abv: patch.abv ?? prev.abv ?? null,
              costPrice: patch.costPrice ?? prev.costPrice ?? null,
              gstPercent: patch.gstPercent ?? prev.gstPercent ?? 15,
              supplierNameSuggested: patch.supplierNameSuggested ?? prev.supplierNameSuggested ?? null,
              supplierGlobalId: patch.supplierGlobalId ?? prev.supplierGlobalId ?? null,
              categorySuggested: patch.categorySuggested ?? prev.categorySuggested ?? null,
            }));
          }}
        />

        {/* ---- Core fields ---- */}
        <View style={styles.card}>
          <Field label="Name *">
            <TextInput
              value={form.name}
              onChangeText={(v)=>setForm((p:any)=>({ ...p, name: v }))}
              placeholder="e.g., Absolut Vodka"
              autoCapitalize="words"
              style={styles.input}
            />
          </Field>

          <FieldRow>
            <Field label="SKU / Code" style={{ flex: 1 }}>
              <TextInput
                value={form.sku ?? ''}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, sku: v }))}
                placeholder="External SKU (optional)"
                autoCapitalize="none"
                style={styles.input}
              />
            </Field>

            <Field label="Par" style={{ width: 110 }}>
              <TextInput
                value={form.parLevel?.toString() ?? ''}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, parLevel: v.replace(/[^0-9]/g,'') }))}
                placeholder="e.g., 6"
                keyboardType="number-pad"
                style={styles.input}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Unit" style={{ flex: 1 }}>
              <TextInput
                value={form.unit ?? ''}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, unit: v }))}
                placeholder="bottle, rtd, keg, bib, can…"
                autoCapitalize="none"
                style={styles.input}
              />
            </Field>

            <Field label="Size" style={{ flex: 1 }}>
              <TextInput
                value={form.size ?? ''}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, size: v }))}
                placeholder="e.g., 700ml"
                autoCapitalize="none"
                style={styles.input}
              />
            </Field>

            <Field label="Pack (units)" style={{ width: 120 }}>
              <TextInput
                value={form.packSize?.toString() ?? ''}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, packSize: v.replace(/[^0-9]/g,'') }))}
                placeholder="e.g., 6"
                keyboardType="number-pad"
                style={styles.input}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="ABV %" style={{ width: 110 }}>
              <TextInput
                value={form.abv?.toString() ?? ''}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, abv: v.replace(/[^0-9.]/g,'') }))}
                placeholder="e.g., 40"
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </Field>

            <Field label="Cost ex GST" style={{ flex: 1 }}>
              <TextInput
                value={form.costPrice?.toString() ?? ''}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, costPrice: v.replace(/[^0-9.]/g,'') }))}
                placeholder="e.g., 24.95"
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </Field>

            <Field label="GST %" style={{ width: 110 }}>
              <TextInput
                value={form.gstPercent?.toString() ?? '15'}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, gstPercent: v.replace(/[^0-9.]/g,'') }))}
                placeholder="15"
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </Field>
          </FieldRow>
        </View>

        {/* ---- Supplier hints (non-binding) ---- */}
        {(form.supplierNameSuggested || form.supplierGlobalId || form.categorySuggested) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Supplier hint</Text>
            {!!form.supplierNameSuggested && (
              <Text style={styles.hint}>Suggested supplier: <Text style={styles.bold}>{form.supplierNameSuggested}</Text></Text>
            )}
            {!!form.categorySuggested && (
              <Text style={styles.hint}>Suggested category: <Text style={styles.bold}>{form.categorySuggested}</Text></Text>
            )}
            {!!form.supplierGlobalId && (
              <Text style={styles.hintDim}>Catalog source: {form.supplierGlobalId}</Text>
            )}
            <Text style={[styles.hintDim, { marginTop: 6 }]}>
              This does not link a venue supplier. Use “Supplier Tools” on the Products screen to set a preferred supplier.
            </Text>
          </View>
        ) : null}

        {/* ---- Actions ---- */}
        <View style={{ height: 8 }} />
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnSecondary} onPress={()=>nav.goBack()} disabled={saving}>
            <Text style={styles.btnSecondaryText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, !canSave && { opacity: 0.5 }]}
            onPress={save}
            disabled={!canSave || saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>{editingId ? 'Save' : 'Create'}</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ------- Small layout helpers -------

function Field({ label, children, style }:any) {
  return (
    <View style={[{ marginBottom: 10 }, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function FieldRow({ children }:any) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

// ------- Styles -------
const styles = StyleSheet.create({
  wrap: { padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 12 },

  card: { backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: 12, marginBottom: 12 },
  cardTitle: { fontWeight: '800', marginBottom: 6 },

  label: { fontWeight: '700', marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },

  hint: { color: '#374151' },
  hintDim: { color: '#6B7280', fontSize: 12 },
  bold: { fontWeight: '700' },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btnPrimary: { backgroundColor: '#0A84FF', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, minWidth: 110, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },
  btnSecondary: { backgroundColor: '#E5E7EB', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, minWidth: 110, alignItems: 'center' },
  btnSecondaryText: { color: '#111827', fontWeight: '800' },
});
