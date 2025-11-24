// src/screens/stock/StockControlScreen.tsx
import React, { useMemo, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Modal,
  Alert,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import IdentityBadge from '../../components/IdentityBadge';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';

// Firestore
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../services/firebase';

// Setup screens
import SuppliersScreen from '../setup/SuppliersScreen';
import ProductsScreen from '../setup/ProductsScreen';

// Panels (leaf-only, no nav edits)
import FastReceivePanel from './FastReceivePanel'; // Scan/Upload flow
import FastReceivesReviewPanel from './FastReceivesReviewPanel'; // Pending review/attach
import SalesReportUploadPanel from './SalesReportUploadPanel'; // Sales CSV/PDF import
import ReconciliationsPanel from './ReconciliationsPanel'; // Invoice reconciliations list
import CraftUpPanel from '../recipes/CraftUpPanel'; // Recipes (CraftUp)

type ResolverProduct = {
  id: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  // completeness flags
  missingSupplier: boolean;
  missingPar: boolean;
  missingCost: boolean;
  missingPackSize: boolean;
  // raw values for editor
  par: number | null;
  costPrice: number | null;
  packSize: number | null;
};

type ResolverSupplier = {
  id: string;
  name: string;
};

export default function StockControlScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();
  const { name: venueName } = useVenueInfo(venueId);

  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showProducts, setShowProducts] = useState(false);

  // Modals
  const [showFastReceive, setShowFastReceive] = useState(false);
  const [showFastReview, setShowFastReview] = useState(false);
  const [showSalesImport, setShowSalesImport] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
  const [showCraftUp, setShowCraftUp] = useState(false); // Recipes (CraftUp)

  // Resolver state: products that need setup, and supplier picker
  const [resolverOpen, setResolverOpen] = useState(false);
  const [resolverLoading, setResolverLoading] = useState(false);
  const [resolverProducts, setResolverProducts] = useState<ResolverProduct[]>([]);
  const [resolverCount, setResolverCount] = useState<number | null>(null);
  const [resolverSuppliers, setResolverSuppliers] = useState<ResolverSupplier[]>([]);
  const [resolverSuppliersLoading, setResolverSuppliersLoading] = useState(false);
  const [resolverAssigningId, setResolverAssigningId] = useState<string | null>(null);
  const [resolverPickerProductId, setResolverPickerProductId] = useState<string | null>(null);

  // Inline editor for incomplete products
  const [editProduct, setEditProduct] = useState<ResolverProduct | null>(null);
  const [editPar, setEditPar] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editPackSize, setEditPackSize] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const friendly = useMemo(() => {
    return friendlyIdentity(
      { displayName: user?.displayName ?? null, email: user?.email ?? null, uid: user?.uid ?? null },
      { name: venueName ?? null, venueId: venueId ?? null },
    );
  }, [user?.displayName, user?.email, user?.uid, venueName, venueId]);

  useEffect(() => {
    try {
      const state = nav.getState?.();
      const logger = (global as any).dlog ?? console.log;
      logger?.('[StockControl] routeNames:', state?.routeNames);
    } catch {}
  }, [nav]);

  const Item = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.rowText}>{title}</Text>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );

  // DEV-only: ensure venues/{venueId}/members/{uid} exists (role: owner)
  const ensureDevMembership = useCallback(async () => {
    try {
      if (!__DEV__) return;
      if (!venueId) throw new Error('No venue selected yet');
      if (!user?.uid) throw new Error('No signed-in user');
      const mref = doc(db, 'venues', venueId, 'members', user.uid);
      const snap = await getDoc(mref);
      if (!snap.exists()) {
        await setDoc(mref, {
          role: 'owner',
          addedAt: serverTimestamp(),
          email: user.email ?? null,
        });
      }
      Alert.alert('Membership OK', `You are a member of venue ${venueId}.`);
    } catch (e: any) {
      Alert.alert('Failed to set membership', String(e?.message || e));
    }
  }, [venueId, user?.uid, user?.email]);

  // Load products that need setup (supplier / par / price / pack)
  const loadResolverProducts = useCallback(async () => {
    if (!venueId) {
      setResolverProducts([]);
      setResolverLoading(false);
      setResolverCount(0);
      return;
    }
    setResolverLoading(true);
    try {
      const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const rows: ResolverProduct[] = [];
      snap.forEach((d) => {
        const v: any = d.data() || {};
        const sid = v?.supplierId || v?.supplier?.id || null;
        const sname = v?.supplierName || v?.supplier?.name || null;

        const rawPar = Number(v?.par);
        const par = Number.isFinite(rawPar) ? rawPar : null;

        const rawPack = Number(v?.packSize);
        const packSize = Number.isFinite(rawPack) ? rawPack : null;

        const rawCostPrice = Number(v?.costPrice);
        const rawUnitCost = Number(v?.unitCost);
        const rawPrice = Number(v?.price);

        const costPrice = Number.isFinite(rawCostPrice)
          ? rawCostPrice
          : Number.isFinite(rawUnitCost)
          ? rawUnitCost
          : Number.isFinite(rawPrice)
          ? rawPrice
          : null;

        const missingSupplier = !sid;
        const missingPar = !Number.isFinite(rawPar) || rawPar <= 0;
        const missingCost = !Number.isFinite(costPrice) || costPrice <= 0;
        const missingPackSize = !Number.isFinite(rawPack) || rawPack <= 0;

        // Core completeness: supplier, PAR, price.
        if (missingSupplier || missingPar || missingCost) {
          rows.push({
            id: d.id,
            name:
              typeof v?.name === 'string' && v.name.trim().length
                ? v.name
                : String(d.id),
            supplierId: sid,
            supplierName: sname ?? null,
            missingSupplier,
            missingPar,
            missingCost,
            missingPackSize,
            par,
            costPrice,
            packSize,
          });
        }
      });
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setResolverProducts(rows);
      setResolverCount(rows.length);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message || 'Could not load products needing setup.');
      setResolverProducts([]);
      setResolverCount(0);
    } finally {
      setResolverLoading(false);
    }
  }, [venueId]);

  // Load suppliers for picker
  const loadResolverSuppliers = useCallback(async () => {
    if (!venueId) {
      setResolverSuppliers([]);
      return;
    }
    setResolverSuppliersLoading(true);
    try {
      const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
      const rows: ResolverSupplier[] = [];
      snap.forEach((d) => {
        const v: any = d.data() || {};
        rows.push({
          id: d.id,
          name:
            typeof v?.name === 'string' && v.name.trim().length
              ? v.name
              : String(d.id),
        });
      });
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setResolverSuppliers(rows);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message || 'Could not load suppliers.');
      setResolverSuppliers([]);
    } finally {
      setResolverSuppliersLoading(false);
    }
  }, [venueId]);

  // Prefetch count on mount so the main row can show a badge
  useEffect(() => {
    loadResolverProducts();
  }, [loadResolverProducts]);

  const openResolver = useCallback(() => {
    setResolverOpen(true);
    loadResolverProducts();
  }, [loadResolverProducts]);

  const openSupplierPickerForProduct = useCallback(
    async (productId: string) => {
      if (!venueId) {
        Alert.alert('Missing venue', 'Please select a venue first.');
        return;
      }
      if (!resolverSuppliers.length) {
        await loadResolverSuppliers();
      }
      setResolverPickerProductId(productId);
    },
    [venueId, resolverSuppliers.length, loadResolverSuppliers],
  );

  const assignSupplierToProduct = useCallback(
    async (supplierId: string) => {
      if (!venueId || !resolverPickerProductId) {
        setResolverPickerProductId(null);
        return;
      }
      try {
        const supplier = resolverSuppliers.find((s) => s.id === supplierId) || null;
        setResolverAssigningId(resolverPickerProductId);
        const pref = doc(
          db,
          'venues',
          venueId,
          'products',
          resolverPickerProductId,
        );
        await updateDoc(pref, {
          supplierId,
          supplierName: supplier?.name ?? null,
          supplier: supplier
            ? { id: supplier.id, name: supplier.name }
            : null,
          updatedAt: serverTimestamp(),
        });
        setResolverPickerProductId(null);
        setResolverAssigningId(null);
        await loadResolverProducts();
      } catch (e: any) {
        setResolverAssigningId(null);
        Alert.alert('Assign failed', e?.message || 'Could not assign supplier.');
      }
    },
    [venueId, resolverPickerProductId, resolverSuppliers, loadResolverProducts],
  );

  // When editProduct changes, seed editor fields
  useEffect(() => {
    if (!editProduct) {
      setEditPar('');
      setEditCost('');
      setEditPackSize('');
      return;
    }
    setEditPar(
      editProduct.par != null && Number.isFinite(editProduct.par)
        ? String(editProduct.par)
        : '',
    );
    setEditCost(
      editProduct.costPrice != null && Number.isFinite(editProduct.costPrice)
        ? String(editProduct.costPrice)
        : '',
    );
    setEditPackSize(
      editProduct.packSize != null && Number.isFinite(editProduct.packSize)
        ? String(editProduct.packSize)
        : '',
    );
  }, [editProduct]);

  const saveEditProduct = useCallback(async () => {
    if (!venueId || !editProduct) return;
    try {
      setEditBusy(true);

      const trimmedPar = editPar.trim();
      const trimmedCost = editCost.trim();
      const trimmedPack = editPackSize.trim();

      const parNum = trimmedPar ? Number(trimmedPar) : null;
      const costNum = trimmedCost ? Number(trimmedCost) : null;
      const packNum = trimmedPack ? Number(trimmedPack) : null;

      const update: any = {
        updatedAt: serverTimestamp(),
      };

      if (parNum != null && Number.isFinite(parNum) && parNum > 0) {
        update.par = parNum;
      } else {
        update.par = null;
      }

      if (costNum != null && Number.isFinite(costNum) && costNum >= 0) {
        update.costPrice = costNum;
      } else {
        update.costPrice = null;
      }

      if (packNum != null && Number.isFinite(packNum) && packNum > 0) {
        update.packSize = packNum;
      } else {
        update.packSize = null;
      }

      const pref = doc(db, 'venues', venueId, 'products', editProduct.id);
      await updateDoc(pref, update);

      await loadResolverProducts();
      setEditProduct(null);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not update product.');
    } finally {
      setEditBusy(false);
    }
  }, [venueId, editProduct, editPar, editCost, editPackSize, loadResolverProducts]);

  const ResolverRow = ({ item }: { item: ResolverProduct }) => {
    const assigning = resolverAssigningId === item.id;

    const missingLabels: string[] = [];
    if (item.missingSupplier) missingLabels.push('Supplier');
    if (item.missingPar) missingLabels.push('PAR');
    if (item.missingCost) missingLabels.push('Price');
    if (item.missingPackSize) missingLabels.push('Pack size');

    const subtitle =
      missingLabels.length > 0
        ? `Missing: ${missingLabels.join(', ')}`
        : 'Ready for suggestions';

    return (
      <View style={styles.resRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.resName}>{item.name}</Text>
          <Text style={styles.resSub}>{subtitle}</Text>
          {item.supplierId ? (
            <Text style={styles.resSubSmall}>
              Supplier: {item.supplierName || item.supplierId}
            </Text>
          ) : (
            <Text style={styles.resSubSmall}>Supplier: not set</Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {item.missingSupplier && (
            <TouchableOpacity
              style={[styles.resAssignBtn, assigning && { opacity: 0.6 }]}
              onPress={() => openSupplierPickerForProduct(item.id)}
              disabled={assigning}
            >
              <Text style={styles.resAssignText}>
                {assigning ? 'Saving…' : 'Assign'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.resEditBtn}
            onPress={() => setEditProduct(item)}
          >
            <Text style={styles.resEditText}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const resolverLabel = (() => {
    if (resolverCount == null) return 'Products needing setup';
    if (resolverCount === 0) return 'Products needing setup (0)';
    return `Products needing setup (${resolverCount})`;
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.wrap}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Stock Control</Text>
              <Text style={styles.subtitle}>Hi {friendly}</Text>
              <Text style={styles.subtitleHint}>
                Set up suppliers and products, then use these tools for ordering, receiving,
                sales imports and recipes. Some tools may be owner-only in your venue.
              </Text>
            </View>
            <IdentityBadge />
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>Setup</Text>
            <Text style={styles.sectionHelp}>
              Start by adding your suppliers and products. You can enter items one-by-one or later use Supplier
              Tools in Products to link price lists and catalogues. For BETA pilots, we recommend loading at least
              your main suppliers and top-selling items first.
            </Text>
          </View>

          <Item title="Manage Suppliers" onPress={() => setShowSuppliers(true)} />
          <Item title="Manage Products" onPress={() => setShowProducts(true)} />
          <Item title={resolverLabel} onPress={openResolver} />

          <View style={[styles.sectionBlock, { marginTop: 18 }]}>
            <Text style={styles.sectionLabel}>Day-to-day</Text>
            <Text style={styles.sectionHelp}>
              Once your base setup is in place, use these for suggested orders, open orders and building recipes
              with real COGS and GP. Orders and recipes still respect your stocktake and venue settings.
            </Text>
          </View>

          <Item
            title="Suggested Orders"
            onPress={() => nav.navigate('SuggestedOrders' as never)}
          />
          <Item title="Orders" onPress={() => nav.navigate('Orders' as never)} />
          <Item
            title="Craft-It (Recipe Creator)"
            onPress={() => setShowCraftUp(true)}
          />

          <View style={[styles.sectionBlock, { marginTop: 18 }]}>
            <Text style={styles.sectionLabel}>Fast tools</Text>
            <Text style={styles.sectionHelp}>
              Use these to quickly receive stock, attach documents, import sales/POS reports and reconcile invoices.
              Ideal for catching up after deliveries or paperwork.
            </Text>
          </View>

          <Item
            title="Fast Receive (Scan / Upload)"
            onPress={() => setShowFastReceive(true)}
          />
          <Item
            title="Fast Receives (Pending)"
            onPress={() => setShowFastReview(true)}
          />
          <Item
            title="Sales Reports (Import)"
            onPress={() => setShowSalesImport(true)}
          />
          <Item
            title="Invoice Reconciliations"
            onPress={() => setShowRecon(true)}
          />

          {__DEV__ ? (
            <Item
              title="(DEV) Fix my venue membership"
              onPress={ensureDevMembership}
            />
          ) : null}
        </View>
      </ScrollView>

      {/* Suppliers */}
      <Modal
        visible={showSuppliers}
        animationType="slide"
        onRequestClose={() => setShowSuppliers(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSuppliers(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Suppliers</Text>
            <View style={{ width: 60 }} />
          </View>
          <SuppliersScreen />
        </SafeAreaView>
      </Modal>

      {/* Products */}
      <Modal
        visible={showProducts}
        animationType="slide"
        onRequestClose={() => setShowProducts(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowProducts(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Products</Text>
            <View style={{ width: 60 }} />
          </View>
          <ProductsScreen />
        </SafeAreaView>
      </Modal>

      {/* Fast Receive (Scan/Upload) */}
      <Modal
        visible={showFastReceive}
        animationType="slide"
        onRequestClose={() => setShowFastReceive(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowFastReceive(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Fast Receive</Text>
            <View style={{ width: 60 }} />
          </View>
          <FastReceivePanel onClose={() => setShowFastReceive(false)} />
        </SafeAreaView>
      </Modal>

      {/* Fast Receives (Pending Review/Attach) */}
      <Modal
        visible={showFastReview}
        animationType="slide"
        onRequestClose={() => setShowFastReview(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowFastReview(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Fast Receives (Pending)</Text>
            <View style={{ width: 60 }} />
          </View>
          <FastReceivesReviewPanel onClose={() => setShowFastReview(false)} />
        </SafeAreaView>
      </Modal>

      {/* Sales Report Import (CSV/PDF) */}
      <Modal
        visible={showSalesImport}
        animationType="slide"
        onRequestClose={() => setShowSalesImport(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSalesImport(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Sales Reports (Import)</Text>
            <View style={{ width: 60 }} />
          </View>
          <SalesReportUploadPanel onClose={() => setShowSalesImport(false)} />
        </SafeAreaView>
      </Modal>

      {/* Invoice Reconciliations (modalized) */}
      <Modal
        visible={showRecon}
        animationType="slide"
        onRequestClose={() => setShowRecon(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowRecon(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Invoice Reconciliations</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={{ flex: 1 }}>
            <ReconciliationsPanel />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Recipes (CraftUp) */}
      <Modal
        visible={showCraftUp}
        animationType="slide"
        onRequestClose={() => setShowCraftUp(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCraftUp(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Craft-It (Recipe Creator)</Text>
            <View style={{ width: 60 }} />
          </View>
          <CraftUpPanel onClose={() => setShowCraftUp(false)} />
        </SafeAreaView>
      </Modal>

      {/* Resolver: products needing setup */}
      <Modal
        visible={resolverOpen}
        animationType="slide"
        onRequestClose={() => setResolverOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setResolverOpen(false)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Products needing setup</Text>
            <TouchableOpacity onPress={loadResolverProducts}>
              <Text
                style={[
                  styles.back,
                  { textAlign: 'right', color: '#6B7280' },
                ]}
              >
                Reload
              </Text>
            </TouchableOpacity>
          </View>
          {resolverLoading ? (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <ActivityIndicator />
              <Text style={{ marginTop: 8, color: '#6B7280' }}>Loading…</Text>
            </View>
          ) : resolverProducts.length === 0 ? (
            <View style={{ padding: 20 }}>
              <Text style={{ color: '#6B7280' }}>
                All products meet the minimum setup (supplier, PAR and price). Any
                newly added items with missing details will appear here until fixed.
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            >
              {resolverProducts.map((p) => (
                <ResolverRow key={p.id} item={p} />
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Supplier picker for resolver */}
      <Modal
        visible={!!resolverPickerProductId}
        transparent
        animationType="fade"
        onRequestClose={() => setResolverPickerProductId(null)}
      >
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Choose supplier</Text>
            {resolverSuppliersLoading ? (
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                <ActivityIndicator />
              </View>
            ) : resolverSuppliers.length === 0 ? (
              <Text style={{ color: '#6B7280', marginTop: 8 }}>
                No suppliers found. Close this and add suppliers first.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {resolverSuppliers.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.pickerRow}
                    onPress={() => assignSupplierToProduct(s.id)}
                  >
                    <Text style={styles.pickerRowText}>{s.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <TouchableOpacity
                onPress={() => setResolverPickerProductId(null)}
              >
                <Text style={{ color: '#2563EB', fontWeight: '700' }}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Inline editor for incomplete product */}
      <Modal
        visible={!!editProduct}
        animationType="slide"
        onRequestClose={() => setEditProduct(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setEditProduct(null)}>
              <Text style={styles.back}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit product setup</Text>
            <View style={{ width: 60 }} />
          </View>

          {editProduct ? (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <Text style={styles.editLabel}>Product</Text>
              <Text style={styles.editTitle}>{editProduct.name}</Text>

              <Text style={[styles.editLabel, { marginTop: 16 }]}>
                PAR (target level)
              </Text>
              <TextInput
                style={styles.editInput}
                value={editPar}
                onChangeText={setEditPar}
                keyboardType="numeric"
                placeholder="e.g. 6"
              />

              <Text style={styles.editLabel}>Price / unit (ex-GST)</Text>
              <TextInput
                style={styles.editInput}
                value={editCost}
                onChangeText={setEditCost}
                keyboardType="numeric"
                placeholder="e.g. 12.50"
              />

              <Text style={styles.editLabel}>Pack size (units per case)</Text>
              <TextInput
                style={styles.editInput}
                value={editPackSize}
                onChangeText={setEditPackSize}
                keyboardType="numeric"
                placeholder="optional"
              />

              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  marginTop: 20,
                  gap: 10,
                }}
              >
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: '#e5e7eb' }]}
                  onPress={() => setEditProduct(null)}
                  disabled={editBusy}
                >
                  <Text style={[styles.smallBtnText, { color: '#111827' }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={saveEditProduct}
                  disabled={editBusy}
                >
                  <Text style={styles.smallBtnText}>
                    {editBusy ? 'Saving…' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 24,
  },
  wrap: { flex: 1, padding: 16, backgroundColor: 'white' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#6B7280', marginTop: 2, fontSize: 14 },
  subtitleHint: {
    color: '#9CA3AF',
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 280,
  },

  sectionBlock: { marginBottom: 10 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4B5563',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  sectionHelp: { fontSize: 12, color: '#6B7280', lineHeight: 16 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
    backgroundColor: '#F9FAFB',
  },
  rowText: { fontSize: 16, fontWeight: '700' },
  chev: { fontSize: 22, color: '#94A3B8', marginLeft: 8 },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  back: { fontSize: 18, color: '#2563EB', width: 60 },
  modalTitle: { fontSize: 18, fontWeight: '800' },

  // Resolver styles
  resRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
    backgroundColor: '#F9FAFB',
  },
  resName: { fontSize: 15, fontWeight: '700' },
  resSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  resSubSmall: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  resAssignBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#111827',
    marginLeft: 8,
  },
  resAssignText: { color: 'white', fontSize: 12, fontWeight: '700' },
  resEditBtn: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignSelf: 'flex-end',
  },
  resEditText: { fontSize: 11, fontWeight: '700', color: '#111827' },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
  },
  pickerTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  pickerRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 6,
  },
  pickerRowText: { fontSize: 14, fontWeight: '600' },

  // Inline editor
  editLabel: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  editTitle: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  editInput: {
    borderWidth: 1,
    borderColor: '#D0D3D7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    marginTop: 4,
  },

  smallBtn: {
    backgroundColor: '#111827',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
