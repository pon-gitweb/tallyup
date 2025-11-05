import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import IdentityBadge from '../../components/IdentityBadge';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';

// Use your real list screens from setup (exact paths you provided)
import SuppliersScreen from '../setup/SuppliersScreen';
import ProductsScreen from '../setup/ProductsScreen';

// NEW: read-only reconciliations panel
import ReconciliationsPanel from './ReconciliationsPanel';

export default function StockControlScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();
  const { name: venueName } = useVenueInfo(venueId);

  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showProducts, setShowProducts] = useState(false);

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

        <Item title="Manage Suppliers" onPress={() => setShowSuppliers(true)} />
        <Item title="Manage Products"  onPress={() => setShowProducts(true)} />
        <Item title="Suggested Orders" onPress={() => nav.navigate('SuggestedOrders' as never)} />
        <Item title="Orders"           onPress={() => nav.navigate('Orders' as never)} />
        <Item title="Reset Stock Take" onPress={() => nav.navigate('Settings' as never)} />

        {/* Read-only: reconciliations summary */}
        <ReconciliationsPanel />
      </View>

      {/* Suppliers: full-screen modal with your rich screen */}
      <Modal visible={showSuppliers} animationType="slide" onRequestClose={() => setShowSuppliers(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSuppliers(false)}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Suppliers</Text>
            <View style={{ width: 60 }} />
          </View>
          <SuppliersScreen />
        </SafeAreaView>
      </Modal>

      {/* Products: full-screen modal with your rich screen */}
      <Modal visible={showProducts} animationType="slide" onRequestClose={() => setShowProducts(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowProducts(false)}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
            <Text style={styles.modalTitle}>Products</Text>
            <View style={{ width: 60 }} />
          </View>
          <ProductsScreen />
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
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#F9FAFB'
  },
  rowText: { fontSize: 16, fontWeight: '700' },
  chev: { fontSize: 22, color: '#94A3B8', marginLeft: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: '#E5E7EB' },
  back: { fontSize: 18, color: '#2563EB', width: 60 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
});
