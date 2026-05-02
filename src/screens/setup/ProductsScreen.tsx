// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { listProducts, deleteProductById } from '../../services/products';
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
                  Upload a supplier catalogue to browse products here.
                </Text>
                <TouchableOpacity onPress={onUpload} style={cS.emptyLink}>
                  <Text style={cS.emptyLinkText}>Upload a supplier catalogue →</Text>
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
            Hosti-Stock, or email us at hello@hostistock.com
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

  async function load() {
    if (!venueId) { setRows([]); setLoading(false); return; }
    try {
      const data = await listProducts(venueId);
      setRows(data);
    } catch (e: any) {
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  // Pre-load global suppliers so Card 3 can show "no catalogues" hint immediately
  useEffect(() => {
    (async () => {
      try {
        const db = getFirestore();
        const snap = await getDocs(collection(db, 'global_suppliers'));
        setGlobalSuppliers(
          snap.docs.map(d => ({ id: d.id, name: String(d.data().name || d.id) }))
        );
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
              Alert.alert(
                'Done',
                `Added ${summary.created} products, updated ${summary.updated}.`
              );
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((p: any) => {
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
  }, [rows, q]);

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
        <Text style={S.searchLabel}>Or search existing products</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name, SKU, unit, or supplier"
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
      <FlatList
        data={filtered}
        keyExtractor={p => p.id}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          const supplierName = item.supplierName ? String(item.supplierName) : '';
          return (
            <View style={S.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={S.rowName}>{item.name}</Text>
                <Text style={S.rowSub}>
                  {item.sku ? `SKU ${item.sku} · ` : ''}
                  {item.unit || 'unit?'}
                  {typeof item.parLevel === 'number' ? ` · Par ${item.parLevel}` : ''}
                </Text>
                <Text style={[S.badge, supplierName ? S.badgeOk : S.badgeWarn]}>
                  {supplierName ? `Preferred: ${supplierName}` : 'Needs supplier'}
                </Text>
              </View>
              <TouchableOpacity style={S.editBtn} onPress={() => onEdit(item)}>
                <Text style={S.editBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.deleteBtn} onPress={() => onDelete(item)}>
                <Text style={S.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
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
