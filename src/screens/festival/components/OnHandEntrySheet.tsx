// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  ScrollView, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {
  collection, doc, getDocs, serverTimestamp, setDoc,
  updateDoc, deleteDoc,
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
  editItem?: any | null;
  locations: OnHandLocation[];
  onHandItems: any[];     // live array from screen's onSnapshot (includes pending)
  onClose: () => void;
};

export type EquipEntrySheetProps = {
  visible: boolean;
  editItem?: any | null;
  locations: OnHandLocation[];
  equipItems: any[];      // live array from screen's onSnapshot (includes pending)
  onClose: () => void;
};

// ─── constants ────────────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: 'owned',          label: 'Owned' },
  { value: 'sor',            label: 'Sale or return' },
  { value: 'sponsor',        label: 'Sponsor' },
  { value: 'venue_transfer', label: 'From one of our venues' },
];

const OWNERSHIP_OPTIONS = [
  { value: 'owned',         label: 'Ours' },
  { value: 'hired',         label: 'Hired' },
  { value: 'supplier_loan', label: 'Supplier loan' },
];

// ─── normalise legacy values ──────────────────────────────────────────────────

function normalizeSource(s: string): string {
  if (['owned', 'sor', 'sponsor', 'venue_transfer'].includes(s)) return s;
  if (s === 'supplier_loan') return 'sor';
  return 'owned'; // leftover, pre_ordered, other, anything legacy
}

function normalizeOwnership(o: string): string {
  if (['owned', 'hired', 'supplier_loan'].includes(o)) return o;
  if (o === 'venue') return 'owned';
  if (o === 'supplier') return 'supplier_loan';
  return 'owned';
}

function normalizeStatus(item: any): 'on_hand' | 'in_transit' {
  if (item.status === 'in_transit') return 'in_transit';
  if (item.status === 'on_hand') return 'on_hand';
  if (item.inTransit) return 'in_transit';
  return 'on_hand';
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function byName(): string {
  const user = auth.currentUser;
  return user?.displayName || user?.email || 'Unnamed member';
}

function fmtQtySimple(qtyUnits: number, packSize: number): string {
  const ps = packSize || 1;
  if (ps > 1) {
    const c = Math.floor(qtyUnits / ps);
    const u = qtyUnits % ps;
    if (c > 0 && u > 0) return `${c} cases + ${u} units`;
    if (c > 0) return `${c} cases`;
    return `${u} units`;
  }
  return `${qtyUnits} units`;
}

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

export function StockEntrySheet({ visible, editItem, locations, onHandItems, onClose }: StockEntrySheetProps) {
  const c = useColours();
  const venueId = useVenueId();
  const { showError } = useToast();
  const { confirm, modal } = useConfirmModal();

  // Product list (loaded once per open)
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // Inline new-product form
  const [addProductMode, setAddProductMode] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdCaseSize, setNewProdCaseSize] = useState('');

  // Form fields
  const [cases, setCases] = useState('');
  const [units, setUnits] = useState('');
  const [source, setSource] = useState<string>('owned');
  const [status, setStatus] = useState<'on_hand' | 'in_transit'>('on_hand');
  const [locationId, setLocationId] = useState<string | null>(null);

  // In-sheet panels (replace await-Promise anti-pattern)
  const [largeQtyPanel, setLargeQtyPanel] = useState<null | { msg: string }>(null);
  const [dupPanel, setDupPanel] = useState<null | { existing: any }>(null);
  const [pendingQty, setPendingQty] = useState<number>(0);

  const isEdit = !!editItem;

  // Load products when sheet opens
  useEffect(() => {
    if (!visible || !venueId) return;
    setLoadingProducts(true);
    getDocs(collection(db, 'venues', venueId, 'products'))
      .then(snap => {
        const prods = snap.docs
          .map(d => {
            const data = d.data() as any;
            return { id: d.id, ...data, packSize: data.packSize || data.caseSize || 1 };
          })
          .filter(p => p.active !== false);
        setAllProducts(prods);
      })
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, [visible, venueId]);

  // Initialise form when sheet opens
  useEffect(() => {
    if (!visible) return;
    setLargeQtyPanel(null);
    setDupPanel(null);
    setPendingQty(0);
    setAddProductMode(false);
    setNewProdName('');
    setNewProdCaseSize('');
    if (editItem) {
      setSelectedProduct({ id: editItem.productId, name: editItem.productName, packSize: editItem.packSize || 1 });
      setProductSearch(editItem.productName || '');
      const ps = editItem.packSize || 1;
      const total = editItem.qtyUnits || 0;
      if (ps > 1) {
        const c_ = Math.floor(total / ps);
        const u_ = total % ps;
        setCases(c_ > 0 ? String(c_) : '');
        setUnits(u_ > 0 ? String(u_) : '');
      } else {
        setCases('');
        setUnits(String(total));
      }
      setSource(normalizeSource(editItem.source || 'owned'));
      setStatus(normalizeStatus(editItem));
      setLocationId(editItem.locationId ?? null);
    } else {
      setSelectedProduct(null);
      setProductSearch('');
      setCases('');
      setUnits('');
      setSource('owned');
      setStatus('on_hand');
      setLocationId(null);
    }
  }, [visible, editItem]);

  // When source changes away from venue_transfer, reset status
  useEffect(() => {
    if (source !== 'venue_transfer') setStatus('on_hand');
  }, [source]);

  const packSize = selectedProduct?.packSize || 1;
  const showCases = packSize > 1;

  const filteredProducts = productSearch.trim()
    ? allProducts.filter(p => p.name?.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8)
    : [];

  function pickProduct(p: any) {
    setSelectedProduct(p);
    setProductSearch(p.name);
    setAddProductMode(false);
  }

  function computeQtyUnits(): number {
    const c_ = parseInt(cases, 10) || 0;
    const u_ = parseInt(units, 10) || 0;
    return c_ * packSize + u_;
  }

  function doWrite(qty: number, overrideId?: string) {
    const uid = auth.currentUser?.uid;
    const name_ = byName();
    const locationName = locationId != null ? (locations.find(l => l.id === locationId)?.name ?? null) : null;
    const statusVal = source === 'venue_transfer' ? status : 'on_hand';
    if (isEdit || overrideId) {
      const docId = overrideId ?? editItem.id;
      updateDoc(doc(db, 'venues', venueId, 'onHand', docId), {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        packSize: selectedProduct.packSize || 1,
        qtyUnits: qty,
        source,
        status: statusVal,
        locationId: locationId ?? null,
        locationName,
        updatedBy: uid,
        updatedByName: name_,
        updatedAt: serverTimestamp(),
      }).catch(e => showError(e.message));
    } else {
      const ref = doc(collection(db, 'venues', venueId, 'onHand'));
      setDoc(ref, {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        packSize: selectedProduct.packSize || 1,
        qtyUnits: qty,
        source,
        status: statusVal,
        locationId: locationId ?? null,
        locationName,
        createdBy: uid,
        createdByName: name_,
        createdAt: serverTimestamp(),
        updatedBy: uid,
        updatedByName: name_,
        updatedAt: serverTimestamp(),
      }).catch(e => showError(e.message));
    }
  }

  function doProceed(qty: number) {
    const normSrc = source;
    const existing = onHandItems.find(item =>
      item.productId === selectedProduct.id &&
      (item.locationId ?? null) === (locationId ?? null) &&
      normalizeSource(item.source) === normSrc &&
      item.id !== editItem?.id
    );
    if (existing) {
      setPendingQty(qty);
      setLargeQtyPanel(null);
      setDupPanel({ existing });
      return;
    }
    doWrite(qty);
    onClose();
  }

  function handleSave() {
    if (!venueId) return;
    if (!selectedProduct) { showError('Select a product.'); return; }
    const qty = computeQtyUnits();
    if (qty <= 0) { showError('Quantity must be greater than zero.'); return; }
    const cNum = parseInt(cases, 10) || 0;
    if (cNum > 500) {
      setPendingQty(qty);
      setLargeQtyPanel({ msg: `That's ${cNum} cases — is that right?` });
      return;
    }
    if (qty > 12000) {
      setPendingQty(qty);
      setLargeQtyPanel({ msg: `That's ${qty} units — is that right?` });
      return;
    }
    doProceed(qty);
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

  function handleAddNewProduct() {
    if (!newProdName.trim()) { showError('Enter a product name.'); return; }
    const ps = parseInt(newProdCaseSize, 10) || 1;
    const ref = doc(collection(db, 'venues', venueId, 'products'));
    const newProd = { id: ref.id, name: newProdName.trim(), packSize: ps, caseSize: ps, active: true };
    setDoc(ref, { ...newProd, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      .catch(e => showError(e.message));
    setAllProducts(prev => [...prev, newProd]);
    pickProduct(newProd);
    setNewProdName('');
    setNewProdCaseSize('');
    setAddProductMode(false);
  }

  const showSearchDropdown = !selectedProduct && (filteredProducts.length > 0 || (productSearch.trim().length > 1 && !loadingProducts));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {modal}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: c.surface }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <SheetHeader title={isEdit ? 'Edit stock on hand' : 'Add stock on hand'} onClose={onClose} c={c} />

          {/* Product */}
          <FieldLabel label="Product" c={c} />
          <View style={{ marginBottom: 14 }}>
            {!addProductMode ? (
              <>
                <TextInput
                  value={productSearch}
                  onChangeText={v => { setProductSearch(v); setSelectedProduct(null); }}
                  placeholder="Search products…"
                  placeholderTextColor={c.slateMid}
                  style={{
                    borderWidth: 1, borderColor: c.border, borderRadius: 8,
                    padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.oat,
                  }}
                  autoCorrect={false}
                />
                {loadingProducts && <ActivityIndicator size="small" color={c.deepBlue} style={{ marginTop: 6 }} />}
                {showSearchDropdown && (
                  <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, marginTop: 4, backgroundColor: c.surface }}>
                    {filteredProducts.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => pickProduct(p)} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                        <Text style={{ color: c.navy, fontSize: 14 }}>{p.name}</Text>
                        {p.packSize > 1 && <Text style={{ color: c.slateMid, fontSize: 12 }}>Pack size: {p.packSize}</Text>}
                      </TouchableOpacity>
                    ))}
                    {productSearch.trim().length > 1 && (
                      <TouchableOpacity
                        onPress={() => { setAddProductMode(true); setNewProdName(productSearch.trim()); setNewProdCaseSize(''); }}
                        style={{ padding: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                      >
                        <Text style={{ color: c.deepBlue, fontSize: 14, fontWeight: '600' }}>+ Add new product "{productSearch.trim()}"</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {selectedProduct && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.success }} />
                    <Text style={{ color: c.success, fontSize: 13 }}>{selectedProduct.name} selected</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={{ backgroundColor: c.oat, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: c.navy, marginBottom: 10 }}>New product</Text>
                <FieldLabel label="Name" c={c} />
                <TextInput
                  value={newProdName}
                  onChangeText={setNewProdName}
                  placeholder="Product name"
                  placeholderTextColor={c.slateMid}
                  style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.surface, marginBottom: 10 }}
                  autoFocus
                />
                <FieldLabel label="Units per case (1 = no cases)" c={c} />
                <TextInput
                  value={newProdCaseSize}
                  onChangeText={setNewProdCaseSize}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={c.slateMid}
                  style={{ borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, fontSize: 15, color: c.navy, backgroundColor: c.surface, marginBottom: 10 }}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={handleAddNewProduct}
                    style={{ flex: 1, backgroundColor: c.deepBlue, borderRadius: 8, padding: 10, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Add</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setAddProductMode(false); setNewProdName(''); setNewProdCaseSize(''); }}
                    style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, alignItems: 'center' }}
                  >
                    <Text style={{ color: c.navy }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
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
                <Chip key={String(loc.id)} label={loc.name} active={locationId === loc.id} onPress={() => setLocationId(loc.id)} c={c} />
              ))}
            </View>
          </ScrollView>

          {/* In transit — only for venue_transfer */}
          {source === 'venue_transfer' && (
            <TouchableOpacity
              onPress={() => setStatus(s => s === 'in_transit' ? 'on_hand' : 'in_transit')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, paddingVertical: 8 }}
            >
              <View style={{
                width: 22, height: 22, borderRadius: 4, borderWidth: 2,
                borderColor: status === 'in_transit' ? c.deepBlue : c.border,
                backgroundColor: status === 'in_transit' ? c.deepBlue : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {status === 'in_transit' && <Text style={{ color: '#fff', fontSize: 13, lineHeight: 16 }}>✓</Text>}
              </View>
              <Text style={{ color: c.navy, fontSize: 15 }}>In transit (ordered but not yet on site)</Text>
            </TouchableOpacity>
          )}

          {/* Large-qty panel */}
          {largeQtyPanel && (
            <View style={{ backgroundColor: c.amber + '22', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '600', marginBottom: 12 }}>
                {largeQtyPanel.msg}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => { setLargeQtyPanel(null); doProceed(pendingQty); }}
                  style={{ flex: 1, backgroundColor: c.deepBlue, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Save anyway</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setLargeQtyPanel(null); setPendingQty(0); }}
                  style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: c.navy, fontWeight: '600' }}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Duplicate panel */}
          {dupPanel && (
            <View style={{ backgroundColor: c.amber + '22', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '600', marginBottom: 4 }}>
                {selectedProduct?.name} already recorded here
              </Text>
              <Text style={{ fontSize: 13, color: c.slateMid, marginBottom: 12 }}>
                {fmtQtySimple(dupPanel.existing.qtyUnits || 0, dupPanel.existing.packSize || 1)} currently logged
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => {
                    const newQty = (dupPanel.existing.qtyUnits || 0) + pendingQty;
                    const uid = auth.currentUser?.uid;
                    const name_ = byName();
                    const locationName = locationId != null ? (locations.find(l => l.id === locationId)?.name ?? null) : null;
                    updateDoc(doc(db, 'venues', venueId, 'onHand', dupPanel.existing.id), {
                      qtyUnits: newQty,
                      updatedBy: uid,
                      updatedByName: name_,
                      locationName,
                      updatedAt: serverTimestamp(),
                    }).catch(e => showError(e.message));
                    if (isEdit && editItem?.id) {
                      deleteDoc(doc(db, 'venues', venueId, 'onHand', editItem.id)).catch(e => showError(e.message));
                    }
                    setDupPanel(null);
                    onClose();
                  }}
                  style={{ flex: 1, minWidth: 110, backgroundColor: c.deepBlue, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Add to existing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    doWrite(pendingQty, dupPanel.existing.id);
                    if (isEdit && editItem?.id) {
                      deleteDoc(doc(db, 'venues', venueId, 'onHand', editItem.id)).catch(e => showError(e.message));
                    }
                    setDupPanel(null);
                    onClose();
                  }}
                  style={{ flex: 1, minWidth: 80, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: c.navy, fontWeight: '600', fontSize: 13 }}>Replace</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setDupPanel(null); setPendingQty(0); }}
                  style={{ flex: 1, minWidth: 70, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: c.navy, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Save / Delete — hidden while a panel is active */}
          {!largeQtyPanel && !dupPanel && (
            <>
              <TouchableOpacity
                onPress={handleSave}
                style={{ backgroundColor: c.deepBlue, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: isEdit ? 10 : 0 }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                  {isEdit ? 'Save changes' : 'Add to on hand'}
                </Text>
              </TouchableOpacity>
              {isEdit && (
                <TouchableOpacity
                  onPress={handleDelete}
                  style={{ borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.error || '#e74c3c' }}
                >
                  <Text style={{ color: c.error || '#e74c3c', fontWeight: '600', fontSize: 15 }}>Remove from on hand</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Equipment entry sheet ────────────────────────────────────────────────────

export function EquipEntrySheet({ visible, editItem, locations, equipItems, onClose }: EquipEntrySheetProps) {
  const c = useColours();
  const venueId = useVenueId();
  const { showError } = useToast();
  const { confirm, modal } = useConfirmModal();

  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [need, setNeed] = useState('');
  const [ownership, setOwnership] = useState<string>('owned');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // In-sheet panels
  const [largeQtyPanel, setLargeQtyPanel] = useState<null | { msg: string }>(null);
  const [dupPanel, setDupPanel] = useState<null | { existing: any }>(null);

  const isEdit = !!editItem;

  useEffect(() => {
    if (!visible) return;
    setLargeQtyPanel(null);
    setDupPanel(null);
    setShowSuggestions(false);
    if (editItem) {
      setName(editItem.name || '');
      setQty(editItem.qty != null ? String(editItem.qty) : '');
      setNeed(editItem.need != null ? String(editItem.need) : '');
      setOwnership(normalizeOwnership(editItem.ownership || 'owned'));
      setLocationId(editItem.locationId ?? null);
      setNotes(editItem.notes || '');
    } else {
      setName('');
      setQty('');
      setNeed('');
      setOwnership('owned');
      setLocationId(null);
      setNotes('');
    }
  }, [visible, editItem]);

  const existingNames = [...new Set(equipItems.map(e => e.name).filter(Boolean))] as string[];
  const nameSuggestions = name.trim()
    ? existingNames.filter(n => n !== name && n.toLowerCase().includes(name.toLowerCase())).slice(0, 5)
    : [];

  function pickExistingName(n: string) {
    const existing = equipItems.find(e => e.name === n);
    if (existing) {
      setName(existing.name);
      setQty(existing.qty != null ? String(existing.qty) : '');
      setNeed(existing.need != null ? String(existing.need) : '');
      setOwnership(normalizeOwnership(existing.ownership || 'owned'));
      setLocationId(existing.locationId ?? null);
      setNotes(existing.notes || '');
    } else {
      setName(n);
    }
    setShowSuggestions(false);
  }

  function doWrite(qtyNum: number, needNum: number, overrideId?: string) {
    const uid = auth.currentUser?.uid;
    const name_ = byName();
    const nameKey = name.trim().toLowerCase();
    const locationName = locationId != null ? (locations.find(l => l.id === locationId)?.name ?? null) : null;
    const data: any = {
      name: name.trim(),
      nameKey,
      qty: qtyNum,
      need: needNum,
      ownership,
      locationId: locationId ?? null,
      locationName,
      notes: notes.trim(),
      updatedBy: uid,
      updatedByName: name_,
      updatedAt: serverTimestamp(),
    };
    const docId = overrideId ?? (isEdit ? editItem.id : null);
    if (docId) {
      updateDoc(doc(db, 'venues', venueId, 'equipment', docId), data).catch(e => showError(e.message));
    } else {
      const ref = doc(collection(db, 'venues', venueId, 'equipment'));
      setDoc(ref, { ...data, createdBy: uid, createdByName: name_, createdAt: serverTimestamp() }).catch(e => showError(e.message));
    }
  }

  function doProceed(qtyNum: number, needNum: number) {
    const nameKey = name.trim().toLowerCase();
    const existing = equipItems.find(e =>
      (e.nameKey || e.name?.trim().toLowerCase()) === nameKey &&
      (e.locationId ?? null) === (locationId ?? null) &&
      e.id !== editItem?.id
    );
    if (existing) {
      setLargeQtyPanel(null);
      setDupPanel({ existing });
      return;
    }
    doWrite(qtyNum, needNum);
    onClose();
  }

  function handleSave() {
    if (!venueId) return;
    if (!name.trim()) { showError('Enter an equipment name.'); return; }
    const qtyNum = Math.max(0, parseInt(qty, 10) || 0);
    if (!Number.isFinite(qtyNum)) { showError('Enter a valid quantity.'); return; }
    const needNum = need.trim() === '' ? qtyNum : Math.max(0, parseInt(need, 10) || 0);
    if (qtyNum > 1000 || needNum > 1000) {
      const hi = Math.max(qtyNum, needNum);
      setDupPanel(null);
      setLargeQtyPanel({ msg: `That's ${hi} — is that right?` });
      return;
    }
    doProceed(qtyNum, needNum);
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

  const qtyNumVal = Math.max(0, parseInt(qty, 10) || 0);
  const needNumVal = need.trim() === '' ? qtyNumVal : Math.max(0, parseInt(need, 10) || 0);

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
                <TouchableOpacity key={n} onPress={() => pickExistingName(n)} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
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
              <FieldLabel label="Need (blank = same as qty)" c={c} />
              <TextInput
                value={need}
                onChangeText={setNeed}
                keyboardType="number-pad"
                placeholder={qty || '0'}
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
                <Chip key={String(loc.id)} label={loc.name} active={locationId === loc.id} onPress={() => setLocationId(loc.id)} c={c} />
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

          {/* Large-qty panel */}
          {largeQtyPanel && (
            <View style={{ backgroundColor: c.amber + '22', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '600', marginBottom: 12 }}>
                {largeQtyPanel.msg}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => { setLargeQtyPanel(null); doProceed(qtyNumVal, needNumVal); }}
                  style={{ flex: 1, backgroundColor: c.deepBlue, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Save anyway</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setLargeQtyPanel(null)}
                  style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: c.navy, fontWeight: '600' }}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Duplicate panel */}
          {dupPanel && (
            <View style={{ backgroundColor: c.amber + '22', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '600', marginBottom: 4 }}>
                {name.trim()} already recorded here
              </Text>
              <Text style={{ fontSize: 13, color: c.slateMid, marginBottom: 12 }}>
                {dupPanel.existing.qty ?? 0} on hand · {dupPanel.existing.need ?? 0} needed
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => {
                    const mergedQty = (dupPanel.existing.qty || 0) + qtyNumVal;
                    const mergedNeed = Math.max(dupPanel.existing.need || 0, needNumVal);
                    doWrite(mergedQty, mergedNeed, dupPanel.existing.id);
                    if (isEdit && editItem?.id) {
                      deleteDoc(doc(db, 'venues', venueId, 'equipment', editItem.id)).catch(e => showError(e.message));
                    }
                    setDupPanel(null);
                    onClose();
                  }}
                  style={{ flex: 1, minWidth: 110, backgroundColor: c.deepBlue, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Add to existing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    doWrite(qtyNumVal, needNumVal, dupPanel.existing.id);
                    if (isEdit && editItem?.id) {
                      deleteDoc(doc(db, 'venues', venueId, 'equipment', editItem.id)).catch(e => showError(e.message));
                    }
                    setDupPanel(null);
                    onClose();
                  }}
                  style={{ flex: 1, minWidth: 70, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: c.navy, fontWeight: '600', fontSize: 13 }}>Replace</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setDupPanel(null); }}
                  style={{ flex: 1, minWidth: 70, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: c.navy, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Save / Delete — hidden while panel active */}
          {!largeQtyPanel && !dupPanel && (
            <>
              <TouchableOpacity
                onPress={handleSave}
                style={{ backgroundColor: c.deepBlue, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: isEdit ? 10 : 0 }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                  {isEdit ? 'Save changes' : 'Add equipment'}
                </Text>
              </TouchableOpacity>
              {isEdit && (
                <TouchableOpacity
                  onPress={handleDelete}
                  style={{ borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.error || '#e74c3c' }}
                >
                  <Text style={{ color: c.error || '#e74c3c', fontWeight: '600', fontSize: 15 }}>Remove equipment</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
