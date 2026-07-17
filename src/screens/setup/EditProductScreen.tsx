// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { getFirestore, doc, setDoc, addDoc, collection, serverTimestamp, updateDoc, Timestamp } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import AutoFillFromCatalog from '../../components/products/AutoFillFromCatalog';
import { searchGlobalCatalogByNamePrefix, catalogHitToProductPatch, CatalogHit } from '../../services/globalCatalog';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

import * as svc from '../../services/products';
import { listSuppliers, createSupplier, Supplier } from '../../services/suppliers';
import {
  listProductSuppliers,
  upsertProductSupplier,
  setPreferredProductSupplier,
  removeProductSupplier,
  ProductSupplierLink,
} from '../../services/productSuppliers';
const hasCreate = typeof svc.createProduct === 'function';
const hasUpdate = typeof svc.updateProduct === 'function';
const hasUpsert = typeof svc.upsertProduct === 'function';

// PAR level defaults by product category.
// Applied automatically when a category is inferred from the global catalog.
const PAR_DEFAULTS: Record<string, number> = {
  spirits: 2,
  spirit: 2,
  wine: 6,
  wines: 6,
  beer: 24,
  beers: 24,
  ale: 24,
  lager: 24,
  cider: 24,
  'dry goods': 2,
  'dry good': 2,
  perishable: 1,
  perishables: 1,
  produce: 1,
  dairy: 1,
};

function yyyymmddToDate(s: string): Date {
  if (!s) return new Date();
  const parts = s.split('-');
  if (parts.length !== 3) return new Date();
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return isNaN(d.getTime()) ? new Date() : d;
}
function dateToYyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultParForCategory(cat: string | null | undefined): number | null {
  if (!cat) return null;
  const k = cat.toLowerCase().trim();
  if (k in PAR_DEFAULTS) return PAR_DEFAULTS[k];
  for (const [key, val] of Object.entries(PAR_DEFAULTS)) {
    if (k.includes(key) || key.includes(k)) return val;
  }
  return null;
}

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
  const colours = useColours();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();

  const params: NavParams = route?.params || {};
  const editingId = params?.productId || null;
  const seed = params?.product || null;

  // ----- Form state (kept simple + tolerant to legacy fields)
  const [form, setForm] = useState<any>(() => ({
    name: seed?.name ?? '',
    sku: seed?.sku ?? seed?.externalSku ?? null,
    unit: seed?.unit ?? '',
    size: seed?.size ?? null,               // "700ml"
    packSize: seed?.packSize ?? null,       // units per case
    abv: seed?.abv ?? null,                 // %
    costPrice: seed?.costPrice ?? seed?.price ?? seed?.unitCost ?? null, // ex GST
    gstPercent: seed?.gstPercent ?? 15,
    parLevel: seed?.parLevel ?? seed?.par ?? null,

    // existing link fields (do not set automatically here)
    supplierId: seed?.supplierId ?? null,
    supplierName: seed?.supplierName ?? seed?.supplier?.name ?? '',

    // hints from global catalog (non-authoritative)
    supplierNameSuggested: seed?.supplierNameSuggested ?? null,
    supplierGlobalId: seed?.supplierGlobalId ?? null,
    categorySuggested: seed?.categorySuggested ?? null,
    // category is the authoritative field used by prediction; defaults to suggestion
    category: seed?.category ?? seed?.categorySuggested ?? null,

    // activity
    active: typeof seed?.active === 'boolean' ? seed.active : true,

    // expiry
    expiryDate: seed?.expiryDate
      ? (typeof seed.expiryDate.toDate === 'function'
          ? seed.expiryDate.toDate().toISOString().slice(0, 10)
          : String(seed.expiryDate).slice(0, 10))
      : '',
  }));

  const [saving, setSaving] = useState(false);
  const [inductionMissing, setInductionMissing] = useState<string[] | null>(null);
  const [showExpiryDatePicker, setShowExpiryDatePicker] = useState(false);

  // Background catalogue matching — best-effort suggestion banner while typing the name
  const [catalogSuggestion, setCatalogSuggestion] = useState<CatalogHit | null>(null);
  const [dismissedSuggestionKey, setDismissedSuggestionKey] = useState<string | null>(null);

  // Supplier picker state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Multi-supplier section state (FIX 2 + FIX 6)
  const [productSuppliers, setProductSuppliers] = useState<ProductSupplierLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [linkingToProduct, setLinkingToProduct] = useState(false);
  const [relationshipPickerVisible, setRelationshipPickerVisible] = useState(false);
  const [editingRelationshipLink, setEditingRelationshipLink] = useState<ProductSupplierLink | null>(null);

  const canSave = useMemo(() => {
    return clean(form.name).length > 0 && !!venueId;
  }, [form, venueId]);

  // Shared merge logic — used by both the manual AutoFillFromCatalog search
  // and the background suggestion banner below, so a catalogue hit is always
  // applied the same way: fill empty fields only, never overwrite typed values.
  function applyCatalogPatch(patch: any) {
    setForm((prev: any) => {
      const newCategory = patch.categorySuggested ?? prev.categorySuggested ?? null;
      const existingPar = intOrNull(prev.parLevel);
      const autoPar = existingPar == null ? defaultParForCategory(newCategory) : null;
      return {
        ...prev,
        name: clean(prev.name).length ? prev.name : patch.name,
        sku: prev.sku ?? patch.sku ?? null,
        unit: clean(prev.unit) ? prev.unit : (patch.unit ?? prev.unit ?? null),
        size: clean(prev.size) ? prev.size : (patch.size ?? prev.size ?? null),
        packSize: intOrNull(prev.packSize) != null ? prev.packSize : (patch.packSize ?? prev.packSize ?? null),
        abv: numOrNull(prev.abv) != null ? prev.abv : (patch.abv ?? prev.abv ?? null),
        costPrice: numOrNull(prev.costPrice) != null ? prev.costPrice : (patch.costPrice ?? prev.costPrice ?? null),
        gstPercent: prev.gstPercent ?? patch.gstPercent ?? 15,
        supplierNameSuggested: prev.supplierNameSuggested ?? patch.supplierNameSuggested ?? null,
        supplierGlobalId: prev.supplierGlobalId ?? patch.supplierGlobalId ?? null,
        categorySuggested: newCategory,
        parLevel: existingPar != null ? prev.parLevel : (autoPar != null ? String(autoPar) : prev.parLevel),
      };
    });
  }

  // Background catalogue matching — debounced ~500ms after the name stops
  // changing. Best-effort: any failure or empty result just means no banner,
  // never an error shown to the user.
  useEffect(() => {
    const name = clean(form.name);
    if (name.length < 3) { setCatalogSuggestion(null); return; }

    const h = setTimeout(async () => {
      try {
        const hits = await searchGlobalCatalogByNamePrefix(name, 10, 40);
        const top = Array.isArray(hits) && hits.length > 0 ? hits[0] : null;
        if (!top) { setCatalogSuggestion(null); return; }
        // Only worth suggesting if it would actually fill something still empty
        const wouldHelp = !clean(form.unit) || !intOrNull(form.packSize) || !clean(form.supplierName);
        setCatalogSuggestion(wouldHelp ? top : null);
      } catch (e: any) {
        console.log('[EditProductScreen] catalog suggestion search failed (non-fatal):', e?.message || e);
        setCatalogSuggestion(null);
      }
    }, 500);

    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name]);

  const suggestionKey = catalogSuggestion
    ? `${catalogSuggestion.supplierGlobalId || ''}:${catalogSuggestion.name || ''}`
    : null;
  const showSuggestionBanner = !!catalogSuggestion && suggestionKey !== dismissedSuggestionKey;

  function applySuggestion() {
    if (!catalogSuggestion) return;
    applyCatalogPatch(catalogHitToProductPatch(catalogSuggestion));
    setDismissedSuggestionKey(suggestionKey);
  }

  function dismissSuggestion() {
    setDismissedSuggestionKey(suggestionKey);
  }

  // Load suppliers when the picker is opened
  useEffect(() => {
    if (!venueId || !showSupplierModal || suppliers.length > 0) return;
    listSuppliers(venueId)
      .then((list) => setSuppliers(list.filter((s) => !s.isHoldingSupplier)))
      .catch(() => {});
  }, [venueId, showSupplierModal]);

  // Load multi-supplier links when editing an existing product
  useEffect(() => {
    if (!editingId || !venueId) return;
    setLoadingLinks(true);
    listProductSuppliers(venueId, editingId)
      .then(links => setProductSuppliers(links.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0))))
      .catch(() => {})
      .finally(() => setLoadingLinks(false));
  }, [editingId, venueId]);

  async function handleLinkSupplier(sup: Supplier) {
    if (!editingId || !venueId) return;
    const hasPreferred = productSuppliers.some(l => l.isPreferred);
    try {
      await upsertProductSupplier(venueId, editingId, sup.id!, {
        supplierName: sup.name,
        isPreferred: !hasPreferred,
        relationship: 'alternative',
        unitCost: null,
      });
      const links = await listProductSuppliers(venueId, editingId);
      setProductSuppliers(links.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0)));
    } catch (e: any) {
      showError(e?.message || 'Could not link supplier.');
    }
  }

  async function handleSetPreferred(supplierId: string) {
    if (!editingId || !venueId) return;
    try {
      await setPreferredProductSupplier(venueId, editingId, supplierId);
      const links = await listProductSuppliers(venueId, editingId);
      setProductSuppliers(links.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0)));
    } catch (e: any) { showError(e?.message || 'Something went wrong'); }
  }

  async function handleRemoveSupplierLink(supplierId: string) {
    if (!editingId || !venueId) return;
    confirm({
      title: 'Remove supplier link?',
      message: 'This removes the link between this product and the supplier.',
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: async () => {
        try {
          await removeProductSupplier(venueId, editingId, supplierId);
          setProductSuppliers(prev => prev.filter(l => l.supplierId !== supplierId));
        } catch (e: any) { showError(e?.message || 'Something went wrong'); }
      },
    });
  }

  async function handleSaveRelationship(relationship: string) {
    if (!editingId || !venueId || !editingRelationshipLink) return;
    try {
      await upsertProductSupplier(venueId, editingId, editingRelationshipLink.supplierId, { relationship: relationship as any });
      const links = await listProductSuppliers(venueId, editingId);
      setProductSuppliers(links.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0)));
    } catch (e: any) { showError(e?.message || 'Something went wrong'); }
    setRelationshipPickerVisible(false);
    setEditingRelationshipLink(null);
  }

  function relColour(r: string | undefined) {
    switch (r) {
      case 'contracted': return '#1b4f72';
      case 'preferred': return '#065f46';
      case 'emergency': return '#b91c1c';
      default: return '#64748b';
    }
  }

  async function handleAddNewSupplier() {
    if (!venueId || !newSupplierName.trim()) return;
    setSavingSupplier(true);
    try {
      const id = await createSupplier(venueId, {
        name: newSupplierName.trim(),
        email: newSupplierEmail.trim() || null,
        phone: newSupplierPhone.trim() || null,
        orderingMethod: 'email',
      });
      const created: Supplier = { id, name: newSupplierName.trim(), email: newSupplierEmail.trim() || null, phone: newSupplierPhone.trim() || null };
      setSuppliers((prev) => [created, ...prev]);
      setForm((p: any) => ({ ...p, supplierId: id, supplierName: created.name }));
      setShowSupplierModal(false);
      setAddingSupplier(false);
      setNewSupplierName('');
      setNewSupplierEmail('');
      setNewSupplierPhone('');
    } catch (e: any) {
      if (e?.message?.startsWith('SIMILAR_EXISTS:')) {
        const parts = e.message.split(':');
        const similarName = parts[1];
        const existingId = parts[2];
        showInfo(`Note: "${similarName}" already exists — linked instead.`);
        const linked: Supplier = { id: existingId, name: similarName };
        setSuppliers((prev: any) => prev.some((s: any) => s.id === existingId) ? prev : [linked, ...prev]);
        setForm((p: any) => ({ ...p, supplierId: existingId, supplierName: similarName }));
        setShowSupplierModal(false);
        setAddingSupplier(false);
        setNewSupplierName('');
        setNewSupplierEmail('');
        setNewSupplierPhone('');
      } else {
        showError(e?.message || 'Could not save supplier — please try again.');
      }
    } finally {
      setSavingSupplier(false);
    }
  }

  // -------- Save (service first, then Firestore fallback)
  async function save() {
    if (!venueId) {
      showInfo('No venue selected.');
      return;
    }
    if (!canSave) {
      showInfo('Please enter a product name.');
      return;
    }

    // Induction: surface minimum metadata gaps — informational only, never blocks.
    const missing: string[] = [];
    if (!clean(form.unit)) missing.push('Unit');
    if (!intOrNull(form.packSize)) missing.push('Pack size (units per case)');
    const gstNum = numOrNull(form.gstPercent ?? 15);
    if (gstNum === null) missing.push('GST %');
    if (!clean(form.supplierName)) missing.push('Supplier');

    if (missing.length > 0) {
      setInductionMissing(missing);
      return;
    }

    await performSave();
  }

  // The actual write — called either directly from save() when nothing is
  // missing, or from the inductionMissing modal's "Save anyway" button.
  // Proceeds with whatever values are present; missing fields are written
  // as null (or 'Unassigned' for supplier), same as the venue-search
  // induction path already does elsewhere in the app.
  async function performSave() {
    const gstNum = numOrNull(form.gstPercent ?? 15) ?? 15;

    // Prepare payload: keep fields flat and tolerant to your legacy schema
    const skuClean = clean(form.sku || '');
    const payload:any = {
      name: clean(form.name),
      sku: skuClean || null,
      unit: clean(form.unit) || null,
      size: form.size || null,               // free text "700ml"
      packSize: intOrNull(form.packSize),
      caseSize: intOrNull(form.packSize),   // alias — prediction + packing slips read caseSize
      abv: numOrNull(form.abv),
      costPrice: numOrNull(form.costPrice),
      gstPercent: gstNum,
      parLevel: intOrNull(form.parLevel),

      supplierId: form.supplierId || null,
      // Matches the "Unassigned" convention already used by Bring Your Data —
      // keeps this product alongside other unassigned products rather than
      // as a separate null/empty category.
      supplierName: clean(form.supplierName) || 'Unassigned',

      // keep hints for UI; they're safe to store or ignore
      supplierNameSuggested: form.supplierNameSuggested || null,
      supplierGlobalId: form.supplierGlobalId || null,
      categorySuggested: form.categorySuggested || null,
      // authoritative category field — used by purchasing prediction
      category: form.category || form.categorySuggested || null,

      active: !!form.active,
      updatedAt: (serverTimestamp ? serverTimestamp() : new Date()),
      ...(editingId ? {} : { inductionSource: 'manual', inductionStatus: 'complete' }),

      // Expiry date: convert YYYY-MM-DD string to Firestore Timestamp (or null)
      expiryDate: (() => {
        const raw = (form.expiryDate || '').trim();
        if (!raw) return null;
        const d = new Date(raw + 'T00:00:00.000Z');
        return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
      })(),
    };

    setSaving(true);
    try {
      if (hasUpsert) {
        // prefer unified upsert if your services expose it
        await svc.upsertProduct(venueId, editingId || undefined, payload);
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
      showError(e?.message || 'Save failed — unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.select({ ios:'padding', android: undefined })}
    >
      <ScrollView
        contentContainerStyle={[styles.wrap, { backgroundColor: colours.background }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={[styles.title, { color: colours.text }]}>{editingId ? 'Edit Product' : 'Add Product'}</Text>

        {/* ---- Global Catalog Autofill (reads-only; applies a patch into the form) ---- */}
        <AutoFillFromCatalog
          initialTerm={form.name ?? ''}
          onApply={(patch) => {
            setForm((prev:any) => {
              const newCategory = patch.categorySuggested ?? prev.categorySuggested ?? null;
              // Auto-set PAR from category only when the field is still empty
              const existingPar = intOrNull(prev.parLevel);
              const autoPar = existingPar == null ? defaultParForCategory(newCategory) : null;
              return {
                ...prev,
                name: clean(prev.name).length ? prev.name : patch.name,
                sku: patch.sku ?? prev.sku ?? null,
                unit: patch.unit ?? prev.unit ?? null,
                size: patch.size ?? prev.size ?? null,
                packSize: patch.packSize ?? prev.packSize ?? null,
                abv: patch.abv ?? prev.abv ?? null,
                costPrice: patch.costPrice ?? prev.costPrice ?? null,
                gstPercent: patch.gstPercent ?? prev.gstPercent ?? 15,
                supplierNameSuggested: patch.supplierNameSuggested ?? prev.supplierNameSuggested ?? null,
                supplierGlobalId: patch.supplierGlobalId ?? prev.supplierGlobalId ?? null,
                categorySuggested: newCategory,
                parLevel: existingPar != null ? prev.parLevel : (autoPar != null ? String(autoPar) : prev.parLevel),
              };
            });
          }}
        />

        {/* ---- Background catalogue match suggestion (passive, dismissible) ---- */}
        {showSuggestionBanner && (
          <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.warning }]}>
            <Text style={{ color: colours.text, fontSize: 13, lineHeight: 18 }}>
              Found <Text style={{ fontWeight: '800' }}>"{catalogSuggestion!.name}"</Text> in our catalogue — use this to fill in unit, pack size, and supplier?
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <TouchableOpacity
                onPress={applySuggestion}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colours.warning }}
              >
                <Text style={{ color: colours.primaryText, fontWeight: '700', fontSize: 13 }}>Use this</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={dismissSuggestion}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colours.border }}
              >
                <Text style={{ color: colours.textSecondary, fontWeight: '700', fontSize: 13 }}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ---- Core fields ---- */}
        <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
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
              {form.categorySuggested && intOrNull(form.parLevel) === defaultParForCategory(form.categorySuggested) && intOrNull(form.parLevel) != null && (
                <Text style={{ fontSize: 11, color: colours.amber, marginTop: 3 }}>
                  Auto-set from {form.categorySuggested}
                </Text>
              )}
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Unit *" style={{ flex: 1 }}>
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

            <Field label="Pack (units) *" style={{ width: 120 }}>
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

            <Field label="GST % *" style={{ width: 110 }}>
              <TextInput
                value={form.gstPercent?.toString() ?? '15'}
                onChangeText={(v)=>setForm((p:any)=>({ ...p, gstPercent: v.replace(/[^0-9.]/g,'') }))}
                placeholder="15"
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </Field>
          </FieldRow>

          <Field label="Expiry date (optional)">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={[styles.input, { justifyContent: 'center', flex: 1 }]}
                onPress={() => setShowExpiryDatePicker(true)}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14, color: form.expiryDate ? colours.navy : colours.textSecondary }}>
                  {form.expiryDate || 'Select expiry date'}
                </Text>
              </TouchableOpacity>
              {!!form.expiryDate && (
                <TouchableOpacity
                  onPress={() => setForm((p: any) => ({ ...p, expiryDate: '' }))}
                  style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ fontSize: 18, color: colours.textSecondary }}>×</Text>
                </TouchableOpacity>
              )}
            </View>
            {showExpiryDatePicker && (
              <DateTimePicker
                value={yyyymmddToDate(form.expiryDate)}
                mode="date"
                display="default"
                onChange={(event: any, selectedDate?: Date) => {
                  setShowExpiryDatePicker(false);
                  if (event?.type === 'dismissed' || !selectedDate) return;
                  setForm((p: any) => ({ ...p, expiryDate: dateToYyyymmdd(selectedDate) }));
                }}
              />
            )}
            <Text style={[styles.hintDim, { color: colours.textSecondary, marginTop: 3 }]}>
              Used to detect expiry risk in Product Performance report
            </Text>
          </Field>

          <Field label="Supplier *">
            <TouchableOpacity
              onPress={() => setShowSupplierModal(true)}
              style={[styles.input, { justifyContent: 'center', minHeight: 40 }]}
            >
              <Text style={{ color: form.supplierName ? colours.text : colours.textSecondary }}>
                {form.supplierName || 'Select supplier…'}
              </Text>
            </TouchableOpacity>
          </Field>
        </View>

        {/* ---- Category picker (authoritative field used by purchasing prediction) ---- */}
        <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
          <Text style={[styles.cardTitle, { color: colours.text }]}>Category</Text>
          <Text style={[styles.hintDim, { color: colours.textSecondary, marginBottom: 8 }]}>
            Used for purchasing predictions. Correct this if auto-detection is wrong.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['beer', 'wine', 'spirits', 'rtd', 'na'].map(cat => (
              <TouchableOpacity
                key={cat}
                onPress={() => setForm((p: any) => ({ ...p, category: cat }))}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                  backgroundColor: (form.category || form.categorySuggested) === cat
                    ? '#1b4f72' : colours.surface,
                  borderWidth: 1,
                  borderColor: (form.category || form.categorySuggested) === cat
                    ? '#1b4f72' : colours.border,
                }}
              >
                <Text style={{
                  fontSize: 13, fontWeight: '700',
                  color: (form.category || form.categorySuggested) === cat ? '#fff' : colours.textSecondary,
                }}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ---- Supplier hints (non-binding) ---- */}
        {(form.supplierNameSuggested || form.supplierGlobalId || form.categorySuggested) ? (
          <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
            <Text style={[styles.cardTitle, { color: colours.text }]}>Supplier hint</Text>
            {!!form.supplierNameSuggested && (
              <Text style={[styles.hint, { color: colours.text }]}>
                Suggested supplier: <Text style={styles.bold}>{form.supplierNameSuggested}</Text>
              </Text>
            )}
            {!!form.categorySuggested && (
              <Text style={[styles.hint, { color: colours.text }]}>
                Suggested category: <Text style={styles.bold}>{form.categorySuggested}</Text>
              </Text>
            )}
            {!!form.supplierGlobalId && (
              <Text style={[styles.hintDim, { color: colours.textSecondary }]}>Catalog source: {form.supplierGlobalId}</Text>
            )}
            <Text style={[styles.hintDim, { color: colours.textSecondary, marginTop: 6 }]}>
              This does not link a venue supplier. Use "Supplier Tools" on the Products screen to set a preferred supplier.
            </Text>
          </View>
        ) : null}

        {/* ---- Linked Suppliers (FIX 2 + FIX 6) ---- */}
        {!!editingId && (
          <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
            <Text style={[styles.cardTitle, { color: colours.text }]}>
              Suppliers ({productSuppliers.length})
            </Text>
            {loadingLinks ? (
              <ActivityIndicator size="small" style={{ marginVertical: 8 }} />
            ) : productSuppliers.length === 0 ? (
              <Text style={[styles.hintDim, { color: colours.textSecondary, marginBottom: 8 }]}>
                No supplier links yet. Link a supplier below to track pricing per supplier.
              </Text>
            ) : (
              productSuppliers.map(link => (
                <View key={link.supplierId} style={{ borderBottomWidth: 1, borderBottomColor: colours.border, paddingVertical: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {link.isPreferred && <Text style={{ fontSize: 14 }}>⭐</Text>}
                    <Text style={{ fontWeight: '700', color: colours.text, flex: 1 }}>{link.supplierName}</Text>
                    <View style={{ backgroundColor: relColour(link.relationship), paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff', textTransform: 'capitalize' }}>
                        {link.relationship || 'alternative'}
                      </Text>
                    </View>
                  </View>
                  {link.unitCost != null && (
                    <Text style={{ fontSize: 13, color: colours.textSecondary }}>
                      ${link.unitCost.toFixed(2)}/unit
                      {link.caseSize ? ` · Case of ${link.caseSize} · $${(link.caseCost ?? link.unitCost * link.caseSize).toFixed(2)}/case` : ''}
                    </Text>
                  )}
                  {link.lastInvoicePrice != null && (
                    <Text style={{ fontSize: 12, color: colours.textSecondary }}>
                      Last invoice: ${link.lastInvoicePrice.toFixed(2)}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {!link.isPreferred && (
                      <TouchableOpacity
                        onPress={() => handleSetPreferred(link.supplierId)}
                        style={{ paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#f0fdf4', borderRadius: 8 }}
                      >
                        <Text style={{ fontSize: 12, color: '#0f766e', fontWeight: '700' }}>Set preferred</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => { setEditingRelationshipLink(link); setRelationshipPickerVisible(true); }}
                      style={{ paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#f1f5f9', borderRadius: 8 }}
                    >
                      <Text style={{ fontSize: 12, color: '#374151', fontWeight: '700' }}>Relationship</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRemoveSupplierLink(link.supplierId)}
                      style={{ paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#fef2f2', borderRadius: 8 }}
                    >
                      <Text style={{ fontSize: 12, color: '#b91c1c', fontWeight: '700' }}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
            <TouchableOpacity
              onPress={() => { setLinkingToProduct(true); setShowSupplierModal(true); }}
              style={{ marginTop: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colours.border, borderRadius: 10 }}
            >
              <Text style={{ color: colours.primary, fontWeight: '700', fontSize: 14 }}>+ Link another supplier</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ---- Actions ---- */}
        <View style={{ height: 8 }} />
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btnSecondary, { backgroundColor: colours.border }]} onPress={()=>nav.goBack()} disabled={saving}>
            <Text style={[styles.btnSecondaryText, { color: colours.text }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnPrimary, { backgroundColor: colours.primary }, !canSave && { opacity: 0.5 }]}
            onPress={save}
            disabled={!canSave || saving}
          >
            {saving ? (
              <ActivityIndicator color={colours.primaryText} />
            ) : (
              <Text style={[styles.btnPrimaryText, { color: colours.primaryText }]}>{editingId ? 'Save' : 'Create'}</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Supplier picker modal */}
      <Modal
        transparent
        visible={showSupplierModal}
        animationType="slide"
        onRequestClose={() => { setShowSupplierModal(false); setAddingSupplier(false); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colours.surface, maxHeight: '75%' }]}>
            {addingSupplier ? (
              <>
                <Text style={[styles.modalTitle, { color: colours.text }]}>New Supplier</Text>
                <TextInput
                  value={newSupplierName}
                  onChangeText={setNewSupplierName}
                  placeholder="Supplier name *"
                  placeholderTextColor={colours.textSecondary}
                  style={[styles.input, { color: colours.text, borderColor: colours.border, marginBottom: 8 }]}
                  autoFocus
                />
                <TextInput
                  value={newSupplierEmail}
                  onChangeText={setNewSupplierEmail}
                  placeholder="Email (optional)"
                  placeholderTextColor={colours.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.input, { color: colours.text, borderColor: colours.border, marginBottom: 8 }]}
                />
                <TextInput
                  value={newSupplierPhone}
                  onChangeText={setNewSupplierPhone}
                  placeholder="Phone (optional)"
                  placeholderTextColor={colours.textSecondary}
                  keyboardType="phone-pad"
                  style={[styles.input, { color: colours.text, borderColor: colours.border, marginBottom: 16 }]}
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colours.border, marginRight: 8 }]}
                    onPress={() => setAddingSupplier(false)}
                    disabled={savingSupplier}
                  >
                    <Text style={[styles.modalBtnText, { color: colours.text }]}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colours.primary, opacity: newSupplierName.trim() ? 1 : 0.5 }]}
                    onPress={handleAddNewSupplier}
                    disabled={savingSupplier || !newSupplierName.trim()}
                  >
                    {savingSupplier
                      ? <ActivityIndicator color={colours.primaryText} size="small" />
                      : <Text style={[styles.modalBtnText, { color: colours.primaryText }]}>Save & select</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.modalTitle, { color: colours.text }]}>Select Supplier</Text>
                <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                  {suppliers.length === 0 && (
                    <Text style={{ color: colours.textSecondary, fontSize: 13, paddingVertical: 8 }}>
                      No suppliers yet
                    </Text>
                  )}
                  {suppliers.map((sup) => (
                    <TouchableOpacity
                      key={sup.id}
                      onPress={() => {
                        if (linkingToProduct) {
                          setShowSupplierModal(false);
                          setLinkingToProduct(false);
                          handleLinkSupplier(sup);
                        } else {
                          setForm((p: any) => ({ ...p, supplierId: sup.id || null, supplierName: sup.name }));
                          setShowSupplierModal(false);
                        }
                      }}
                      style={{
                        paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colours.border,
                        backgroundColor: form.supplierId === sup.id ? colours.primaryLight : 'transparent',
                        paddingHorizontal: 4, borderRadius: 6,
                      }}
                    >
                      <Text style={{ fontWeight: '600', color: colours.text }}>{sup.name}</Text>
                      {sup.email ? <Text style={{ fontSize: 11, color: colours.textSecondary }}>{sup.email}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  onPress={() => setAddingSupplier(true)}
                  style={{ paddingVertical: 12, marginTop: 4, alignItems: 'center' }}
                >
                  <Text style={{ color: colours.primary, fontWeight: '700' }}>+ Add new supplier</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: colours.border, alignSelf: 'flex-end' }]}
                  onPress={() => setShowSupplierModal(false)}
                >
                  <Text style={[styles.modalBtnText, { color: colours.text }]}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Relationship type picker (FIX 6) */}
      <Modal
        transparent
        visible={relationshipPickerVisible}
        animationType="fade"
        onRequestClose={() => { setRelationshipPickerVisible(false); setEditingRelationshipLink(null); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colours.surface }]}>
            <Text style={[styles.modalTitle, { color: colours.text }]}>Relationship type</Text>
            {(['preferred', 'contracted', 'alternative', 'emergency'] as const).map(r => (
              <TouchableOpacity
                key={r}
                onPress={() => handleSaveRelationship(r)}
                style={{ paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colours.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                {editingRelationshipLink?.relationship === r && (
                  <Text style={{ color: colours.primary, fontWeight: '800' }}>✓</Text>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: colours.text, textTransform: 'capitalize' }}>{r}</Text>
                  <Text style={{ fontSize: 12, color: colours.textSecondary }}>
                    {r === 'preferred' ? 'Your go-to supplier' :
                     r === 'contracted' ? 'You have a supply agreement' :
                     r === 'alternative' ? 'Backup option' : 'Last resort only'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => { setRelationshipPickerVisible(false); setEditingRelationshipLink(null); }}
              style={{ paddingVertical: 12, alignItems: 'center', marginTop: 4 }}
            >
              <Text style={{ color: colours.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Induction modal for missing required metadata */}
      {inductionMissing && (
        <Modal
          transparent
          visible={!!inductionMissing}
          animationType="fade"
          onRequestClose={() => setInductionMissing(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: colours.surface }]}>
              <Text style={[styles.modalTitle, { color: colours.text }]}>Just a few details</Text>
              <Text style={[styles.modalText, { color: colours.text }]}>
                To use this product in stocktakes and ordering, we need:
              </Text>
              {inductionMissing.map((m) => (
                <Text key={m} style={[styles.modalBullet, { color: colours.text }]}>• {m}</Text>
              ))}
              <Text style={[styles.modalText, { color: colours.text, marginTop: 8 }]}>
                You can go back and fill these in now, or save anyway and complete them later.
              </Text>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: colours.border, marginRight: 8 }]}
                  onPress={() => setInductionMissing(null)}
                  disabled={saving}
                >
                  <Text style={[styles.modalBtnText, { color: colours.text }]}>Go back and fill in</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: colours.navy }]}
                  onPress={() => { setInductionMissing(null); performSave(); }}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color={colours.primaryText} size="small" />
                    : <Text style={[styles.modalBtnText, { color: colours.primaryText }]}>Save anyway</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {modal}
    </KeyboardAvoidingView>
  );
}

// ------- Small layout helpers -------

function Field({ label, children, style, labelColour }:any) {
  return (
    <View style={[{ marginBottom: 10 }, style]}>
      <Text style={[styles.label, labelColour && { color: labelColour }]}>{label}</Text>
      {children}
    </View>
  );
}

function FieldRow({ children }:any) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

// ------- Styles -------
// Static styles (brand-neutral). Colour-sensitive styles use inline colours from useColours().
const styles = StyleSheet.create({
  wrap: { padding: 16 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 12 },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  cardTitle: { fontWeight: '800', marginBottom: 6 },

  label: { fontWeight: '700', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  hint: {},
  hintDim: { fontSize: 12 },
  bold: { fontWeight: '700' },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  btnPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    minWidth: 110,
    alignItems: 'center',
  },
  btnPrimaryText: { fontWeight: '800' },
  btnSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    minWidth: 110,
    alignItems: 'center',
  },
  btnSecondaryText: { fontWeight: '800' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  modalText: { fontSize: 14 },
  modalBullet: { fontSize: 14, marginTop: 4 },
  modalActions: { marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end' },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
  },
  modalBtnText: { fontWeight: '700' },
});
