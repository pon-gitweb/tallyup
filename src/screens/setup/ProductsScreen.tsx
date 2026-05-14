// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getFirestore, collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { listProducts, deleteProductById } from '../../services/products';
import { listSuppliers } from '../../services/suppliers';
import { adoptGlobalCatalogToVenue } from '../../services/catalog/adoptGlobalCatalogToVenue';
import BarcodeScannerModal from '../stock/components/BarcodeScannerModal';

type GlobalSupplier = { id: string; name: string };

// ─── Catalogue bottom-sheet modal (Task 2 fix) ────────────────────────────────

function CatalogueModal({
  visible,
  suppliers,
  adoptingId,
  onSelect,
  onClose,
  onUpload,
}: {
  visible: boolean;
  suppliers: GlobalSupplier[] | null;
  adoptingId: string | null;
  onSelect: (s: GlobalSupplier) => void;
  onClose: () => void;
  onUpload: () => void;
}) {
  const isLoading = suppliers === null;
  const hasSuppliers = Array.isArray(suppliers) && suppliers.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={cS.wrap}>
        <TouchableOpacity style={cS.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={cS.sheet}>
          <View style={cS.header}>
            <View style={{ flex: 1 }}>
              <Text style={cS.title}>🏪 Supplier Catalogues</Text>
              <Text style={cS.sub}>Browse and add products from a supplier catalogue</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
              <Text style={{ fontSize: 18, color: '#64748b', fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {isLoading ? (
              <View style={cS.centered}>
                <ActivityIndicator color="#1b4f72" />
                <Text style={cS.loadingText}>Loading catalogues…</Text>
              </View>
            ) : !hasSuppliers ? (
              <View style={cS.emptyState}>
                <Text style={cS.emptyTitle}>No catalogues available yet</Text>
                <Text style={cS.emptyBody}>
                  Upload a supplier catalogue to browse and add products in bulk.
                </Text>
                <TouchableOpacity onPress={onUpload} style={cS.emptyLink}>
                  <Text style={cS.emptyLinkText}>Want to add a supplier catalogue? → Go to Suppliers</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={cS.hint}>
                  Tap a supplier to add their products to your venue.
                </Text>
                {suppliers.map(s => (
                  <TouchableOpacity
                    key={s.id}
                    style={[cS.supplierRow, adoptingId === s.id && { opacity: 0.5 }]}
                    onPress={() => onSelect(s)}
                    disabled={!!adoptingId}
                    activeOpacity={0.75}
                  >
                    <Text style={cS.supplierName}>{s.name || s.id}</Text>
                    {adoptingId === s.id
                      ? <ActivityIndicator size="small" color="#1b4f72" />
                      : <Text style={cS.chev}>›</Text>
                    }
                  </TouchableOpacity>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── POS info modal ───────────────────────────────────────────────────────────

function PosModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={pS.outer}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
        <View style={pS.card}>
          <Text style={pS.title}>POS Integration</Text>
          <Text style={pS.body}>
            Connect your POS to import products automatically.{'\n\n'}
            Coming soon: Lightspeed · Square · Wizbang Onetap · BEPOZ{'\n\n'}
            To request integration, contact your POS provider and mention
            Hosti, or email us at office@hosti.co.nz
          </Text>
          <TouchableOpacity style={pS.btn} onPress={onClose}>
            <Text style={pS.btnText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Path card ────────────────────────────────────────────────────────────────

function PathCard({
  icon,
  title,
  desc,
  hint,
  onPress,
}: {
  icon: string;
  title: string;
  desc: string;
  hint?: { text: string; linkText?: string; onPress?: () => void } | null;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={S.card} onPress={onPress} activeOpacity={0.75}>
      <View style={S.cardIconWrap}>
        <Text style={S.cardIconText}>{icon}</Text>
      </View>
      <View style={S.cardBody}>
        <Text style={S.cardTitle}>{title}</Text>
        <Text style={S.cardDesc}>{desc}</Text>
        {hint ? (
          <Text style={S.cardHint}>
            {hint.text}
            {hint.linkText ? (
              <Text style={S.cardHintLink} onPress={hint.onPress}>
                {' '}{hint.linkText}
              </Text>
            ) : null}
          </Text>
        ) : null}
      </View>
      <Text style={S.cardChev}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Unassigned check (non-critical, silent-fail) ────────────────────────────

async function fetchAssignedProductIds(venueId: string): Promise<{ ids: Set<string>; names: Set<string> }> {
  const db = getFirestore();
  const ids = new Set<string>();
  const names = new Set<string>();
  try {
    const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
    await Promise.all(deptsSnap.docs.map(async deptDoc => {
      const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'));
      await Promise.all(areasSnap.docs.map(async areaDoc => {
        const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas', areaDoc.id, 'items'));
        itemsSnap.docs.forEach(d => {
          const item = d.data() as any;
          if (item.productId) ids.add(item.productId);
          if (item.name) names.add((item.name as string).toLowerCase().trim());
        });
      }));
    }));
  } catch {}
  return { ids, names };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');

  // Catalogue
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [globalSuppliers, setGlobalSuppliers] = useState<GlobalSupplier[] | null>(null);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);

  // POS modal
  const [posOpen, setPosOpen] = useState(false);

  // Barcode scanner
  const [barcodeOpen, setBarcodeOpen] = useState(false);

  // Unassigned products
  const [unassignedIds, setUnassignedIds] = useState<string[]>([]);
  const [unassignedLoading, setUnassignedLoading] = useState(false);
  const [unassignedDismissed, setUnassignedDismissed] = useState(false);
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);

  // Multi-select
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Supplier picker (for bulk assign)
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [venueSuppliers, setVenueSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierQ, setSupplierQ] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Import toast
  const [importToast, setImportToast] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<any>(null);
  const prevRowCount = useRef<number>(-1);

  function showImportToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setImportToast(msg);
    toastAnim.setValue(0);
    Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setImportToast(null));
    }, 4000);
  }

  async function runUnassignedCheck(products: any[]) {
    if (!venueId || products.length === 0) { setUnassignedIds([]); return; }
    setUnassignedLoading(true);
    try {
      const { ids, names } = await fetchAssignedProductIds(venueId);
      const unassigned = products
        .filter(p => !ids.has(p.id) && !names.has((p.name || '').toLowerCase().trim()))
        .map(p => p.id);
      setUnassignedIds(unassigned);
    } catch {}
    finally { setUnassignedLoading(false); }
  }

  async function load(opts?: { silent?: boolean }) {
    if (!venueId) { setRows([]); setLoading(false); return; }
    if (!opts?.silent) setLoading(true);
    try {
      const data = await listProducts(venueId);
      // Detect newly added products (from navigation-based imports)
      if (prevRowCount.current >= 0 && data.length > prevRowCount.current) {
        const added = data.length - prevRowCount.current;
        showImportToast(`${added} product${added !== 1 ? 's' : ''} added to your venue. Find them in any area by searching during your stocktake.`);
      }
      prevRowCount.current = data.length;
      setRows(data);
      runUnassignedCheck(data);
    } catch (e: any) {
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  // Reload when screen comes back into focus (catches navigation-based imports)
  useFocusEffect(
    useCallback(() => {
      if (prevRowCount.current >= 0) load({ silent: true });
    }, [venueId])
  );

  // Pre-load global suppliers so Card 3 can show "no catalogues" hint immediately
  useEffect(() => {
    (async () => {
      try {
        const db = getFirestore();
        const snap = await getDocs(collection(db, 'global_suppliers'));
        const gSuppliers = snap.docs.map(d => ({ id: d.id, name: String(d.data().name || d.id) }));
        gSuppliers.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
        setGlobalSuppliers(gSuppliers);
      } catch {
        setGlobalSuppliers([]);
      }
    })();
  }, []);

  async function handleAdoptCatalogue(supplier: GlobalSupplier) {
    if (!venueId || adoptingId) return;
    Alert.alert(
      'Add catalogue?',
      `This will add ${supplier.name}'s products to your venue.\n\nExisting products are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add products',
          onPress: async () => {
            setAdoptingId(supplier.id);
            try {
              const summary = await adoptGlobalCatalogToVenue({
                venueId,
                globalSupplierId: supplier.id,
              });
              setCatalogueOpen(false);
              await load();
              if (summary.created > 0) {
                showImportToast(`${summary.created} product${summary.created !== 1 ? 's' : ''} added to your venue. Find them in any area by searching during your stocktake.`);
              }
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Could not import catalogue.');
            } finally {
              setAdoptingId(null);
            }
          },
        },
      ]
    );
  }

  function onNew() {
    const seed: any = {
      name: '', sku: null, unit: '', size: '', packSize: null,
      abv: null, costPrice: null, gstPercent: 15, parLevel: null,
      supplierId: null, supplierName: '', active: true,
    };
    nav.navigate('EditProductScreen', { productId: null, product: seed });
  }

  function onEdit(p: any) {
    let safeProduct: any = null;
    try { safeProduct = JSON.parse(JSON.stringify(p)); } catch {
      safeProduct = { id: p.id, name: p?.name ?? '' };
    }
    nav.navigate('EditProductScreen', { productId: p.id, product: safeProduct });
  }

  function onDelete(p: any) {
    Alert.alert('Delete Product', `Delete ${p.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (!venueId || !p.id) return;
            await deleteProductById(venueId, p.id);
            await load();
          } catch (e: any) {
            Alert.alert('Delete Failed', e?.message || 'Unknown error');
          }
        },
      },
    ]);
  }

  function handleCardAction(action: string) {
    switch (action) {
      case 'stocktake':
        nav.navigate('InventoryImport');
        break;
      case 'invoice':
        nav.navigate('InventoryImport');
        break;
      case 'catalogue':
        setCatalogueOpen(true);
        break;
      case 'scan':
        Alert.alert('Scan a product', 'How would you like to identify it?', [
          { text: 'Cancel', style: 'cancel' },
          { text: '📸 Photo identify', onPress: () => nav.navigate('InventoryImport') },
          { text: '🔍 Scan barcode', onPress: () => setBarcodeOpen(true) },
        ]);
        break;
      case 'pos':
        setPosOpen(true);
        break;
      case 'manual':
        onNew();
        break;
    }
  }

  // ── Multi-select ──────────────────────────────────────────────────────────

  function enterMultiSelect(firstId?: string) {
    setMultiSelectMode(true);
    setSelectedIds(firstId ? new Set([firstId]) : new Set());
  }

  function exitMultiSelect() {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(filtered.map((p: any) => p.id)));
  }

  function selectAllUnassigned() {
    setSelectedIds(new Set(unassignedIds));
    setMultiSelectMode(true);
  }

  async function openSupplierPicker() {
    if (!venueId) return;
    try {
      const data = await listSuppliers(venueId);
      setVenueSuppliers(data.map((s: any) => ({ id: s.id!, name: s.name || '' })));
    } catch { setVenueSuppliers([]); }
    setSupplierQ('');
    setSupplierPickerOpen(true);
  }

  function confirmAndAssign(supplier: { id: string; name: string }) {
    const count = selectedIds.size;
    Alert.alert(
      'Assign supplier?',
      `Assign ${count} product${count !== 1 ? 's' : ''} to ${supplier.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Assign', onPress: () => doAssign(supplier) },
      ]
    );
  }

  async function doAssign(supplier: { id: string; name: string }) {
    if (!venueId || selectedIds.size === 0) return;
    setAssigning(true);
    setSupplierPickerOpen(false);
    try {
      const db = getFirestore();
      const batch = writeBatch(db);
      const count = selectedIds.size;
      selectedIds.forEach(id => {
        batch.update(doc(db, 'venues', venueId, 'products', id), {
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      exitMultiSelect();
      showImportToast(`✓ ${count} product${count !== 1 ? 's' : ''} assigned to ${supplier.name}`);
      await load({ silent: true });
    } catch (e: any) {
      Alert.alert('Assignment failed', e?.message || 'Please try again.');
    } finally {
      setAssigning(false);
    }
  }

  const filtered = useMemo(() => {
    let base = rows;
    if (showOnlyUnassigned) {
      const idSet = new Set(unassignedIds);
      base = base.filter((p: any) => idSet.has(p.id));
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((p: any) => {
      const name = (p.name || '').toLowerCase();
      const sku = p.sku ? String(p.sku).toLowerCase() : '';
      const unit = p.unit ? String(p.unit).toLowerCase() : '';
      const supplier = p.supplierName ? String(p.supplierName).toLowerCase() : '';
      return (
        name.includes(needle) ||
        sku.includes(needle) ||
        unit.includes(needle) ||
        supplier.includes(needle)
      );
    });
  }, [rows, q, showOnlyUnassigned, unassignedIds]);

  const filteredVenueSuppliers = useMemo(() => {
    const needle = supplierQ.trim().toLowerCase();
    if (!needle) return venueSuppliers;
    return venueSuppliers.filter(s => s.name.toLowerCase().includes(needle));
  }, [venueSuppliers, supplierQ]);

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: '#6b7280' }}>Loading products…</Text>
      </View>
    );
  }

  const noCatalogues =
    Array.isArray(globalSuppliers) && globalSuppliers.length === 0;

  const listHeader = (
    <View style={S.listHeader}>
      {/* Unassigned products card */}
      {!unassignedDismissed && unassignedIds.length > 0 && (
        <View style={S.unassignedCard}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={{ fontSize: 20 }}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={S.unassignedTitle}>
                {showOnlyUnassigned
                  ? `Showing ${unassignedIds.length} unassigned product${unassignedIds.length !== 1 ? 's' : ''}`
                  : `${unassignedIds.length} product${unassignedIds.length !== 1 ? 's' : ''} not in a stocktake area yet`}
              </Text>
              <Text style={S.unassignedBody}>
                {showOnlyUnassigned
                  ? 'Add these to a stocktake area by searching for them during your next stocktake.'
                  : 'Find them in any area by searching during your stocktake.'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowOnlyUnassigned(v => !v);
                  if (showOnlyUnassigned) setQ('');
                }}
                style={S.unassignedBtn}
              >
                <Text style={S.unassignedBtnText}>
                  {showOnlyUnassigned ? '← Show all products' : 'View unassigned products →'}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => { setUnassignedDismissed(true); setShowOnlyUnassigned(false); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ fontSize: 16, color: '#94a3b8', fontWeight: '600' }}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={S.pageTitle}>Add Products</Text>
      <Text style={S.pageSub}>Choose how you'd like to get your products in</Text>

      <View style={S.cards}>
        <PathCard
          icon="📄"
          title="From a past stocktake"
          desc="Import from a CSV, PDF, or photo of your last stocktake"
          onPress={() => handleCardAction('stocktake')}
        />
        <PathCard
          icon="🧾"
          title="From an invoice"
          desc="Scan or upload a supplier invoice — we'll read it for you"
          onPress={() => handleCardAction('invoice')}
        />
        <PathCard
          icon="🏪"
          title="From a supplier catalogue"
          desc="Browse a supplier's product list and add what you carry"
          hint={noCatalogues ? {
            text: 'No catalogues available yet.',
            linkText: 'Upload a supplier catalogue →',
            onPress: () => nav.navigate('Suppliers'),
          } : null}
          onPress={() => handleCardAction('catalogue')}
        />
        <PathCard
          icon="📷"
          title="Scan a product"
          desc="Photo the front of a bottle or scan its barcode"
          onPress={() => handleCardAction('scan')}
        />
        <PathCard
          icon="🔗"
          title="From your POS"
          desc="Import your full product list from your POS system"
          onPress={() => handleCardAction('pos')}
        />
        <PathCard
          icon="✏️"
          title="Add manually"
          desc="Type in your product details one by one"
          onPress={() => handleCardAction('manual')}
        />
      </View>

      <View style={S.searchSection}>
        {showOnlyUnassigned ? (
          <View style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 4, height: 20, borderRadius: 2, backgroundColor: '#14b8a6' }} />
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f766e' }}>
                  Showing {unassignedIds.length} unassigned product{unassignedIds.length !== 1 ? 's' : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => { setShowOnlyUnassigned(false); setQ(''); }}>
                <Text style={{ color: '#1b4f72', fontSize: 13, fontWeight: '700' }}>Show all →</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={selectAllUnassigned}
              style={{ alignSelf: 'flex-start', backgroundColor: '#ccfbf1', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f766e' }}>
                Select all unassigned →
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={S.searchLabel}>All products ({rows.length})</Text>
        )}
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={showOnlyUnassigned ? 'Filter unassigned…' : 'Search by name, SKU, unit, or supplier'}
          autoCapitalize="none"
          style={S.searchInput}
          clearButtonMode="while-editing"
          placeholderTextColor="#9ca3af"
        />
      </View>
    </View>
  );

  return (
    <View style={S.wrap}>
      {/* Import toast */}
      {importToast ? (
        <Animated.View
          style={[S.importToast, {
            opacity: toastAnim,
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }]}
          pointerEvents="none"
        >
          <Text style={S.importToastText}>{importToast}</Text>
        </Animated.View>
      ) : null}

      {/* Multi-select action bar */}
      {multiSelectMode && (
        <View style={MS.bar}>
          <TouchableOpacity onPress={exitMultiSelect} style={MS.cancelBtn}>
            <Text style={MS.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
            <Text style={MS.countText}>{selectedIds.size} selected</Text>
            <TouchableOpacity onPress={selectAllVisible}>
              <Text style={MS.selectAllText}>Select all ({filtered.length})</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={openSupplierPicker}
            disabled={selectedIds.size === 0 || assigning}
            style={[MS.assignBtn, (selectedIds.size === 0 || assigning) && MS.assignBtnDisabled]}
          >
            <Text style={MS.assignBtnText}>{assigning ? 'Assigning…' : 'Assign supplier'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={p => p.id}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          const supplierName = item.supplierName ? String(item.supplierName) : '';
          const isSelected = selectedIds.has(item.id);
          return (
            <TouchableOpacity
              style={[
                S.rowCard,
                !multiSelectMode && showOnlyUnassigned && { borderLeftWidth: 3, borderLeftColor: '#14b8a6', paddingLeft: 11 },
                multiSelectMode && isSelected && { backgroundColor: '#f0fdfa', borderColor: '#14b8a6' },
              ]}
              onPress={() => multiSelectMode ? toggleSelected(item.id) : onEdit(item)}
              onLongPress={() => { if (!multiSelectMode) enterMultiSelect(item.id); }}
              delayLongPress={400}
              activeOpacity={0.75}
            >
              {multiSelectMode && (
                <View style={[MS.checkbox, isSelected && MS.checkboxSelected]}>
                  {isSelected && <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900', lineHeight: 16 }}>✓</Text>}
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={S.rowName}>{item.name}</Text>
                {item.category ? <Text style={S.rowSub}>{item.category}</Text> : null}
                <Text style={S.rowSub}>
                  {item.sku ? `SKU ${item.sku} · ` : ''}
                  {item.unit || 'unit?'}
                  {typeof item.parLevel === 'number' ? ` · Par ${item.parLevel}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {showOnlyUnassigned && (
                    <Text style={[S.badge, { backgroundColor: '#fef3c7', color: '#92400e' }]}>
                      Not in any area
                    </Text>
                  )}
                  <Text style={[S.badge, supplierName ? S.badgeOk : S.badgeWarn]}>
                    {supplierName ? `Preferred: ${supplierName}` : 'Needs supplier'}
                  </Text>
                </View>
              </View>
              {!multiSelectMode && (
                <>
                  <TouchableOpacity style={S.editBtn} onPress={() => onEdit(item)}>
                    <Text style={S.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.deleteBtn} onPress={() => onDelete(item)}>
                    <Text style={S.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </>
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={S.emptyText}>
            {q.trim()
              ? 'No products match your search.'
              : 'No products yet. Use one of the options above to get started.'}
          </Text>
        }
      />

      <CatalogueModal
        visible={catalogueOpen}
        suppliers={globalSuppliers}
        adoptingId={adoptingId}
        onSelect={handleAdoptCatalogue}
        onClose={() => setCatalogueOpen(false)}
        onUpload={() => { setCatalogueOpen(false); nav.navigate('Suppliers'); }}
      />

      <PosModal visible={posOpen} onClose={() => setPosOpen(false)} />

      {/* Supplier picker — for bulk assign */}
      <Modal visible={supplierPickerOpen} transparent animationType="slide" onRequestClose={() => setSupplierPickerOpen(false)}>
        <View style={MS.pickerWrap}>
          <TouchableOpacity style={MS.pickerBackdrop} onPress={() => setSupplierPickerOpen(false)} activeOpacity={1} />
          <View style={MS.pickerSheet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>
                  Assign {selectedIds.size} product{selectedIds.size !== 1 ? 's' : ''} to a supplier
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSupplierPickerOpen(false)} style={{ padding: 8 }}>
                <Text style={{ fontSize: 18, color: '#64748b', fontWeight: '600' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
              <TextInput
                value={supplierQ}
                onChangeText={setSupplierQ}
                placeholder="Search suppliers…"
                placeholderTextColor="#94a3b8"
                style={S.searchInput}
                clearButtonMode="while-editing"
                autoFocus={false}
              />
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
              {filteredVenueSuppliers.length === 0 ? (
                <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 24, fontSize: 14 }}>
                  {supplierQ.trim() ? 'No suppliers match your search.' : 'No suppliers yet. Add one below.'}
                </Text>
              ) : (
                filteredVenueSuppliers.map(s => (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => { setSupplierPickerOpen(false); confirmAndAssign(s); }}
                    style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', alignItems: 'center' }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{s.name}</Text>
                    <Text style={{ fontSize: 18, color: '#cbd5e1' }}>›</Text>
                  </TouchableOpacity>
                ))
              )}
              <TouchableOpacity
                onPress={() => { setSupplierPickerOpen(false); nav.navigate('Suppliers'); }}
                style={{ margin: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#1b4f72' }}>+ Add new supplier</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* STUB — hidden until built: Scan UPC batch, Suggest PARs, AI normalize units */}
      <BarcodeScannerModal
        visible={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        venueId={venueId}
        onFound={product => {
          setBarcodeOpen(false);
          onEdit(product);
        }}
        onNotFound={barcode => {
          setBarcodeOpen(false);
          Alert.alert(
            'Not found',
            `No product with barcode ${barcode}. Add it manually?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Add manually', onPress: onNew },
            ]
          );
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#f9fafb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },

  listHeader: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  pageSub: { fontSize: 14, color: '#64748b', marginBottom: 20 },

  // Path cards
  cards: { gap: 10, marginBottom: 28 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eef6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { fontSize: 20 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  cardDesc: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  cardHint: { fontSize: 12, color: '#94a3b8', marginTop: 5 },
  cardHintLink: { color: '#1b4f72', fontWeight: '600' },
  cardChev: { fontSize: 22, color: '#cbd5e1', fontWeight: '300' },

  // Search
  searchSection: { marginBottom: 16 },
  searchLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
  searchInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },

  // Product rows
  rowCard: {
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  rowName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  rowSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  badge: {
    fontSize: 11,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 5,
    overflow: 'hidden',
  },
  badgeOk: { backgroundColor: '#ecfdf5', color: '#065f46' },
  badgeWarn: { backgroundColor: '#fffbeb', color: '#92400e' },
  editBtn: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  editBtnText: { fontWeight: '700', fontSize: 12, color: '#374151' },
  deleteBtn: {
    backgroundColor: '#fef2f2',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  deleteBtnText: { fontWeight: '700', fontSize: 12, color: '#b91c1c' },
  emptyText: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
    paddingVertical: 24,
    paddingHorizontal: 32,
  },

  // Unassigned card
  unassignedCard: {
    backgroundColor: '#f0fdfa',
    borderWidth: 1.5,
    borderColor: '#14b8a6',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  unassignedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f766e',
    marginBottom: 4,
  },
  unassignedBody: {
    fontSize: 13,
    color: '#115e59',
    lineHeight: 18,
    marginBottom: 10,
  },
  unassignedBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#ccfbf1',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  unassignedBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f766e',
  },

  // Import toast
  importToast: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    zIndex: 999,
    backgroundColor: '#1b4f72',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  importToastText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
});

// Catalogue modal styles
const cS = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '72%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  hint: { fontSize: 13, color: '#64748b', marginBottom: 14 },
  centered: { alignItems: 'center', paddingVertical: 32 },
  loadingText: { color: '#64748b', marginTop: 12, fontSize: 13 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginBottom: 8 },
  emptyBody: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  emptyLink: {
    backgroundColor: '#eef6ff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  emptyLinkText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  supplierName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0f172a' },
  chev: { fontSize: 22, color: '#94a3b8' },
});

// Multi-select styles
const MS = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  cancelBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  cancelText: { color: '#94a3b8', fontWeight: '700', fontSize: 13 },
  countText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  selectAllText: { color: '#14b8a6', fontSize: 12, fontWeight: '600' },
  assignBtn: {
    backgroundColor: '#14b8a6',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  assignBtnDisabled: { backgroundColor: '#374151' },
  assignBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  checkboxSelected: {
    backgroundColor: '#14b8a6',
    borderColor: '#14b8a6',
  },
  pickerWrap: { flex: 1, justifyContent: 'flex-end' },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  pickerSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
});

// POS modal styles
const pS = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  body: { fontSize: 14, color: '#374151', lineHeight: 22, marginBottom: 20 },
  btn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
