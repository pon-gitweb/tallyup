// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  ScrollView, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {
  collection, doc, getDocs, limit, query, serverTimestamp, setDoc,
  updateDoc, deleteDoc, where,
} from 'firebase/firestore';
import { db, auth } from '../../../services/firebase';
import { useVenueId } from '../../../context/VenueProvider';
import { useColours } from '../../../context/ThemeContext';
import { useToast } from '../../../components/common/Toast';
import { useConfirmModal } from '../../../components/common/useConfirmModal';

// ─── types ────────────────────────────────────────────────────────────────────

export type OnHandLocation = { id: string | null; name: string };

export type StockEntrySheetProps = {
  visible: boolean;
  editItem?: any | null;  // existing onHand doc, or null for new
  locations: OnHandLocation[];
  onClose: () => void;
};

export type EquipEntrySheetProps = {
  visible: boolean;
  editItem?: any | null;  // existing equipment doc, or null for new
  locations: OnHandLocation[];
  existingNames: string[];
  onClose: () => void;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: 'leftover', label: 'Leftover from previous event' },
  { value: 'pre_ordered', label: 'Pre-ordered / already purchased' },
  { value: 'supplier_loan', label: 'Supplier loan' },
  { value: 'other', label: 'Other' },
];

const OWNERSHIP_OPTIONS = [
  { value: 'venue', label: 'Our equipment' },
  { value: 'supplier', label: 'Supplier loan' },
  { value: 'hired', label: 'Hired' },
  { value: 'other', label: 'Other' },
];

function Chip({ label, active, onPress, c }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
        backgroundColor: active ? c.deepBlue : c.border,
        marginRight: 6, marginBottom: 6,
      }}
    >
      <Text style={{ fontSize: 13, color: active ? '#fff' : c.navy, fontWeight: active ? '600' : '400' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SheetHeader({ title, onClose, c }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
      <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: c.navy }}>{title}</Text>
      <TouchableOpacity onPress={onClose} hitSlop={12}>
        <Text style={{ fontSize: 22, color: c.slateMid, lineHeight: 24 }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

function FieldLabel({ label, c }) {
  return <Text style={{ fontSize: 13, fontWeight: '600', color: c.navy, marginBottom: 4 }}>{label}</Text>;
}

// ─── Stock entry sheet ────────────────────────────────────────────────────────

export function StockEntrySheet({ visible, editItem, locations, onClose }: StockEntrySheetProps) {
  const c = useColours();
  const venueId = useVenueId();
  const { showError, showSuccess } = useToast();
  const { confirm, modal } = useConfirmModal();

  const [productSearch, setProductSearch] = useState('');
  const [productSuggestions, setProductSuggestions] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [cases, setCases] = useState('');
  const [units, setUnits] = useState('');
  const [source, setSource] = useState('leftover');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [inTransit, setInTransit] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef<any>(null);

  const isEdit = !!editItem;

  useEffect(() => {
    if (!visible) return;
    if (editItem) {
      setSelectedProduct({ id: editItem.productId, name: editItem.productName, packSize: editItem.packSize });
      setProductSearch(editItem.productName || '');
      const totalUnits = editItem.qtyUnits || 0;
      const ps = editItem.packSize || 1;
      if (ps > 1) {
        const c_ = Math.floor(totalUnits / ps);
        const u_ = totalUnits % ps;
        setCases(c_ > 0 ? String(c_) : '');
        setUnits(u_ > 0 ? String(u_) : '');
      } else {
        setCases('');
        setUnits(String(totalUnits));
      }
      setSource(editItem.source || 'leftover');
      setLocationId(editItem.locationId ?? null);
      setInTransit(!!editItem.inTransit);
    } else {
      setSelectedProduct(null);
      setProductSearch('');
      setProductSuggestions([]);
      setCases('');
      setUnits('');
      setSource('leftover');
      setLocationId(null);
      setInTransit(false);
    }
  }, [visible, editItem]);

  function searchProducts(text: string) {
    setProductSearch(text);
    setSelectedProduct(null);
    clearTimeout(searchTimer.current);
    if (!text.trim() || !venueId) { setProductSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      setLoadingProducts(true);
      try {
        const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
        const lower = text.toLowerCase();
        const matched = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((p: any) => p.name?.toLowerCase().includes(lower))
          .slice(0, 8);
        setProductSuggestions(matched);
      } catch {} finally {
        setLoadingProducts(false);
      }
    }, 250);
  }

  function pickProduct(p: any) {
    setSelectedProduct(p);
    setProductSearch(p.name);
    setProductSuggestions([]);
  }

  function computeQtyUnits(): number {
    const ps = selectedProduct?.packSize || 1;
    const c_ = parseInt(cases, 10) || 0;
    const u_ = parseInt(units, 10) || 0;
    return c_ * ps + u_;
  }

  async function handleSave() {
    if (!venueId) return;
    if (!selectedProduct) { showError('Select a product.'); return; }
    const qtyUnits = computeQtyUnits();
    if (qtyUnits <= 0) { showError('Quantity must be greater than zero.'); return; }

    const cNum = parseInt(cases, 10) || 0;
    if (cNum > 500) {
      const go = await new Promise(res => confirm({
        title: 'Large quantity',
        message: `${cNum} cases is a very large amount. Continue?`,
        confirmLabel: 'Yes, save',
        onConfirm: () => res(true),
      }));
      if (!go) return;
    }
    if (qtyUnits > 12000) {
      const go2 = await new Promise(res => confirm({
        title: 'Large quantity',
        message: `${qtyUnits} units is very large. Continue?`,
        confirmLabel: 'Yes, save',
        onConfirm: () => res(true),
      }));
      if (!go2) return;
    }

    if (!isEdit) {
      // Duplicate check: same productId + locationId + source
      try {
        const dupSnap = await getDocs(query(
          collection(db, 'venues', venueId, 'onHand'),
          where('productId', '==', selectedProduct.id),
          where('source', '==', source),
          limit(5),
        ));
        const matching = dupSnap.docs.filter(d => {
          const data = d.data();
          const loc1 = data.locationId ?? null;
          const loc2 = locationId ?? null;
          return loc1 === loc2;
        });
        if (matching.length > 0) {
          const existingDoc = matching[0];
          const existingQty = existingDoc.data().qtyUnits || 0;
          let resolved = false;
          await new Promise<void>(res => {
            confirm({
              title: 'Duplicate entry',
              message: `${selectedProduct.name} is already recorded at this location with source "${source}" (${existingQty} units). Replace or add?`,
              confirmLabel: 'Replace',
              onConfirm: () => {
                resolved = true;
                const uid = auth.currentUser?.uid;
                updateDoc(existingDoc.ref, {
                  qtyUnits, packSize: selectedProduct.packSize || 1,
                  inTransit, updatedBy: uid, updatedAt: serverTimestamp(),
                }).catch(e => showError(e.message));
                showSuccess('Updated.');
                onClose();
                res();
              },
            });
          });
          if (resolved) return;
          // If they cancelled (chose not to replace), we don't proceed
          return;
        }
      } catch {}
    }

    // Non-blocking write
    const uid = auth.currentUser?.uid;
    if (isEdit) {
      updateDoc(doc(db, 'venues', venueId, 'onHand', editItem.id), {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        packSize: selectedProduct.packSize || 1,
        qtyUnits,
        source,
        locationId: locationId ?? null,
        inTransit,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      }).catch(e => showError(e.message));
    } else {
      const ref = doc(collection(db, 'venues', venueId, 'onHand'));
      setDoc(ref, {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        packSize: selectedProduct.packSize || 1,
        qtyUnits,
        source,
        locationId: locationId ?? null,
        inTransit,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      }).catch(e => showError(e.message));
    }
    onClose();
  }

  function handleDelete() {
    if (!editItem?.id || !venueId) return;
    confirm({
      title: 'Remove on hand',
      message: `Remove "${editItem.productName}" from on hand?`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: () => {
        deleteDoc(doc(db, 'venues', venueId, 'onHand', editItem.id)).catch(e => showError(e.message));
        onClose();
      },
    });
  }

  const packSize = selectedProduct?.packSize || 1;
  const showCases = packSize > 1;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {modal}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: c.surface }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <SheetHeader title={isEdit ? 'Edit stock on hand' : 'Add stock on hand'} onClose={onClose} c={c} />

          {/* Product */}
          <FieldLabel label="Product" c={c} />
          <View style={{ marginBottom: 14 }}>
            <TextInput
              value={productSearch}
              onChangeText={searchProducts}
              placeholder="Search products…"
              placeholderTextColor={c.slateMid}
              style={{
                borderWidth: 1, borderColor: c.border, borderRadius: 8,
                padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat,
              }}
              autoCorrect={false}
            />
            {loadingProducts && <ActivityIndicator size="small" color={c.deepBlue} style={{ marginTop: 6 }} />}
            {productSuggestions.length > 0 && (
              <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, marginTop: 4, backgroundColor: c.surface }}>
                {productSuggestions.map(p => (
                  <TouchableOpacity key={p.id} onPress={() => pickProduct(p)} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                    <Text style={{ color: c.navy, fontSize: 14 }}>{p.name}</Text>
                    {p.packSize > 1 && <Text style={{ color: c.slateMid, fontSize: 12 }}>Pack size: {p.packSize}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {selectedProduct && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.success }} />
                <Text style={{ color: c.success, fontSize: 13 }}>{selectedProduct.name} selected</Text>
              </View>
            )}
          </View>

          {/* Quantity */}
          <FieldLabel label="Quantity" c={c} />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            {showCases && (
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: c.slateMid, marginBottom: 4 }}>Cases (× {packSize})</Text>
                <TextInput
                  value={cases}
                  onChangeText={setCases}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={c.slateMid}
                  style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat }}
                />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: c.slateMid, marginBottom: 4 }}>Units</Text>
              <TextInput
                value={units}
                onChangeText={setUnits}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={c.slateMid}
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat }}
              />
            </View>
          </View>

          {/* Source */}
          <FieldLabel label="Source" c={c} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 }}>
            {SOURCE_OPTIONS.map(opt => (
              <Chip key={opt.value} label={opt.label} active={source === opt.value} onPress={() => setSource(opt.value)} c={c} />
            ))}
          </View>

          {/* Location */}
          <FieldLabel label="Location" c={c} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {locations.map(loc => (
                <Chip
                  key={String(loc.id)}
                  label={loc.name}
                  active={locationId === loc.id}
                  onPress={() => setLocationId(loc.id)}
                  c={c}
                />
              ))}
            </View>
          </ScrollView>

          {/* In transit */}
          <TouchableOpacity
            onPress={() => setInTransit(v => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, paddingVertical: 8 }}
          >
            <View style={{
              width: 22, height: 22, borderRadius: 4, borderWidth: 2,
              borderColor: inTransit ? c.deepBlue : c.border,
              backgroundColor: inTransit ? c.deepBlue : 'transparent',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {inTransit && <Text style={{ color: '#fff', fontSize: 13, lineHeight: 16 }}>✓</Text>}
            </View>
            <Text style={{ color: c.navy, fontSize: 15 }}>In transit (ordered but not yet on site)</Text>
          </TouchableOpacity>

          {/* Save */}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={{ backgroundColor: c.deepBlue, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: isEdit ? 10 : 0 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{isEdit ? 'Save changes' : 'Add to on hand'}</Text>
          </TouchableOpacity>

          {isEdit && (
            <TouchableOpacity
              onPress={handleDelete}
              style={{ borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.error || '#e74c3c' }}
            >
              <Text style={{ color: c.error || '#e74c3c', fontWeight: '600', fontSize: 15 }}>Remove from on hand</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Equipment entry sheet ────────────────────────────────────────────────────

export function EquipEntrySheet({ visible, editItem, locations, existingNames, onClose }: EquipEntrySheetProps) {
  const c = useColours();
  const venueId = useVenueId();
  const { showError } = useToast();
  const { confirm, modal } = useConfirmModal();

  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [need, setNeed] = useState('');
  const [ownership, setOwnership] = useState('venue');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const isEdit = !!editItem;

  useEffect(() => {
    if (!visible) return;
    if (editItem) {
      setName(editItem.name || '');
      setQty(editItem.qty != null ? String(editItem.qty) : '');
      setNeed(editItem.need != null ? String(editItem.need) : '');
      setOwnership(editItem.ownership || 'venue');
      setLocationId(editItem.locationId ?? null);
      setNotes(editItem.notes || '');
    } else {
      setName('');
      setQty('');
      setNeed('');
      setOwnership('venue');
      setLocationId(null);
      setNotes('');
    }
    setShowSuggestions(false);
  }, [visible, editItem]);

  const nameSuggestions = existingNames.filter(n => n !== name && n.toLowerCase().includes(name.toLowerCase())).slice(0, 5);

  function handleSave() {
    if (!venueId) return;
    if (!name.trim()) { showError('Enter an equipment name.'); return; }
    const qtyNum = parseInt(qty, 10);
    const needNum = parseInt(need, 10);
    if (!Number.isFinite(qtyNum) || qtyNum < 0) { showError('Enter a valid quantity.'); return; }
    const uid = auth.currentUser?.uid;
    const data: any = {
      name: name.trim(),
      qty: qtyNum,
      need: Number.isFinite(needNum) && needNum >= 0 ? needNum : 0,
      ownership,
      locationId: locationId ?? null,
      notes: notes.trim(),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    };
    if (isEdit) {
      updateDoc(doc(db, 'venues', venueId, 'equipment', editItem.id), data).catch(e => showError(e.message));
    } else {
      const ref = doc(collection(db, 'venues', venueId, 'equipment'));
      setDoc(ref, { ...data, createdBy: uid, createdAt: serverTimestamp() }).catch(e => showError(e.message));
    }
    onClose();
  }

  function handleDelete() {
    if (!editItem?.id || !venueId) return;
    confirm({
      title: 'Remove equipment',
      message: `Remove "${editItem.name}"?`,
      confirmLabel: 'Remove',
      destructive: true,
      onConfirm: () => {
        deleteDoc(doc(db, 'venues', venueId, 'equipment', editItem.id)).catch(e => showError(e.message));
        onClose();
      },
    });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {modal}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: c.surface }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <SheetHeader title={isEdit ? 'Edit equipment' : 'Add equipment'} onClose={onClose} c={c} />

          {/* Name */}
          <FieldLabel label="Equipment name" c={c} />
          <TextInput
            value={name}
            onChangeText={v => { setName(v); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="e.g. Keg coupler, Tap head, Ice bin…"
            placeholderTextColor={c.slateMid}
            style={{
              borderWidth: 1, borderColor: c.border, borderRadius: 8,
              padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat,
              marginBottom: showSuggestions && nameSuggestions.length > 0 ? 0 : 14,
            }}
          />
          {showSuggestions && nameSuggestions.length > 0 && (
            <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, marginBottom: 14, backgroundColor: c.surface }}>
              {nameSuggestions.map(n => (
                <TouchableOpacity key={n} onPress={() => { setName(n); setShowSuggestions(false); }} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <Text style={{ color: c.navy, fontSize: 14 }}>{n}</Text>
                  <Text style={{ color: c.slateMid, fontSize: 12 }}>Tap to edit existing</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Qty + Need */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel label="Qty on hand" c={c} />
              <TextInput
                value={qty}
                onChangeText={setQty}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={c.slateMid}
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel label="Need (required)" c={c} />
              <TextInput
                value={need}
                onChangeText={setNeed}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={c.slateMid}
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat }}
              />
            </View>
          </View>

          {/* Ownership */}
          <FieldLabel label="Ownership" c={c} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 }}>
            {OWNERSHIP_OPTIONS.map(opt => (
              <Chip key={opt.value} label={opt.label} active={ownership === opt.value} onPress={() => setOwnership(opt.value)} c={c} />
            ))}
          </View>

          {/* Location */}
          <FieldLabel label="Location" c={c} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {locations.map(loc => (
                <Chip
                  key={String(loc.id)}
                  label={loc.name}
                  active={locationId === loc.id}
                  onPress={() => setLocationId(loc.id)}
                  c={c}
                />
              ))}
            </View>
          </ScrollView>

          {/* Notes */}
          <FieldLabel label="Notes" c={c} />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes…"
            placeholderTextColor={c.slateMid}
            multiline
            numberOfLines={3}
            style={{
              borderWidth: 1, borderColor: c.border, borderRadius: 8,
              padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat,
              minHeight: 72, textAlignVertical: 'top', marginBottom: 20,
            }}
          />

          {/* Save */}
          <TouchableOpacity
            onPress={handleSave}
            style={{ backgroundColor: c.deepBlue, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: isEdit ? 10 : 0 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{isEdit ? 'Save changes' : 'Add equipment'}</Text>
          </TouchableOpacity>

          {isEdit && (
            <TouchableOpacity
              onPress={handleDelete}
              style={{ borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.error || '#e74c3c' }}
            >
              <Text style={{ color: c.error || '#e74c3c', fontWeight: '600', fontSize: 15 }}>Remove equipment</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
