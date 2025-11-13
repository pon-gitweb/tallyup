import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Modal, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import IdentityBadge from '../../components/IdentityBadge';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';

// Firestore (for DEV fix)
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';

// Setup screens
import SuppliersScreen from '../setup/SuppliersScreen';
import ProductsScreen from '../setup/ProductsScreen';

// Panels (leaf-only, no nav edits)
import FastReceivePanel from './FastReceivePanel';                  // Scan/Upload flow
import FastReceivesReviewPanel from './FastReceivesReviewPanel';    // Pending review/attach
import SalesReportUploadPanel from './SalesReportUploadPanel';      // Sales CSV/PDF import
import ReconciliationsPanel from './ReconciliationsPanel';          // Invoice reconciliations list
import CraftUpPanel from '../recipes/CraftUpPanel';                 // Recipes (CraftUp)

export default function StockControlScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();
  const { name: venueName } = useVenueInfo(venueId);

  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showProducts, setShowProducts] = useState(false);

  // NEW modals
  const [showFastReceive, setShowFastReceive] = useState(false);
  const [showFastReview, setShowFastReview]   = useState(false);
  const [showSalesImport, setShowSalesImport] = useState(false);
  const [showRecon, setShowRecon]             = useState(false);
  const [showCraftUp, setShowCraftUp]         = useState(false); // Recipes (CraftUp)

  const friendly = useMemo(() => {
    return friendlyIdentity(
      { displayName: user?.displayName ?? null, email: user?.email ?? null, uid: user?.uid ?? null },
      { name: venueName ?? null, venueId: venueId ?? null }
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
    } catch (e:any) {
      Alert.alert('Failed to set membership', String(e?.message || e));
    }
  }, [venueId, user?.uid, user?.email]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.wrap}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Stock Control</Text>
            <Text style={styles.subtitle}>{friendly}</Text>
          </View>
          <IdentityBadge />
        </View>

        {/* Setup guidance */}
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionLabel}>Setup</Text>
          <Text style={styles.sectionHelp}>
            Start by adding your suppliers and products. You can enter items one-by-one or later use Supplier
            Tools in Products to link price lists and catalogues.
          </Text>
        </View>

        {/* Setup items */}
        <Item title="Manage Suppliers" onPress={() => setShowSuppliers(true)} />
        <Item title="Manage Products"  onPress={() => setShowProducts(true)} />

        {/* Day-to-day operations */}
        <View style={[styles.sectionBlock, { marginTop: 18 }]}>
          <Text style={styles.sectionLabel}>Day-to-day</Text>
          <Text style={styles.sectionHelp}>
            Use these tools for ordering, receiving, invoices and recipes once your base setup is in place.
          </Text>
        </View>

        <Item title="Suggested Orders" onPress={() => nav.navigate('SuggestedOrders' as never)} />
        <Item title="Orders"           onPress={() => nav.navigate('Orders' as never)} />
        {/* Reset Stock Take was removed previously as requested */}
        <Item title="Craft-It (Recipe Creator)" onPress={() => setShowCraftUp(true)} />

        {/* NEW: quick actions */}
        <Item title="Fast Receive (Scan / Upload)" onPress={() => setShowFastReceive(true)} />
        <Item title="Fast Receives (Pending)"      onPress={() => setShowFastReview(true)} />
        <Item title="Sales Reports (Import)"       onPress={() => setShowSalesImport(true)} />
        <Item title="Invoice Reconciliations"      onPress={() => setShowRecon(true)} />

        {/* DEV-only helper to repair membership (safe; leaf UI only) */}
        {__DEV__ ? (
          <Item title="(DEV) Fix my venue membership" onPress={ensureDevMembership} />
        ) : null}
      </View>

      {/* Suppliers */}
      <Modal visible={showSuppliers} animationType="slide" onRequestClose={() => setShowSuppliers(false)}>
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
      <Modal visible={showProducts} animationType="slide" onRequestClose={() => setShowProducts(false)}>
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
      <Modal visible={showFastReceive} animationType="slide" onRequestClose={() => setShowFastReceive(false)}>
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
      <Modal visible={showFastReview} animationType="slide" onRequestClose={() => setShowFastReview(false)}>
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
      <Modal visible={showSalesImport} animationType="slide" onRequestClose={() => setShowSalesImport(false)}>
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
      <Modal visible={showRecon} animationType="slide" onRequestClose={() => setShowRecon(false)}>
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
      <Modal visible={showCraftUp} animationType="slide" onRequestClose={() => setShowCraftUp(false)}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: 'white' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#6B7280', marginTop: 2 },

  sectionBlock: { marginBottom: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: '#4B5563', textTransform: 'uppercase', marginBottom: 2 },
  sectionHelp: { fontSize: 12, color: '#6B7280' },

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
});
