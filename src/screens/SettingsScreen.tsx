import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { db } from '../../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import Constants from 'expo-constants';
import { useVenueId } from '../../context/VenueProvider';
import { resetAllDepartmentsStockTake } from '../../services/reset';
import { seedDemoSuppliersAndProducts } from '../../services/devSeedDemo';

export default function SettingsScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();

  const devVenueId =
    (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_DEV_VENUE_ID ||
    (Constants.expoConfig?.extra as any)?.DEV_VENUE_ID ||
    process.env.EXPO_PUBLIC_DEV_VENUE_ID ||
    undefined;

  async function doSignOut() {
    try {
      await auth.signOut();
      console.log('[TallyUp Settings] signOut success');
    } catch (e: any) {
      console.log('[TallyUp Settings] signOut error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Sign Out Failed', e?.message || 'Unknown error');
    }
  }

  async function doResetCycle() {
    if (!venueId) { Alert.alert('No Venue', 'You are not attached to a venue.'); return; }
    Alert.alert('Reset Stock Take','This reopens all areas in all departments for this venue. Continue?',[
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        try {
          console.log('[Settings] reset start', { venueId });
          const res = await resetAllDepartmentsStockTake(venueId);
          console.log('[Settings] reset ok', res);
          Alert.alert('Reset Complete', `Departments: ${res.departments} • Areas reopened: ${res.areasReset}`);
        } catch (e: any) {
          console.log('[TallyUp Settings] reset error', JSON.stringify({ code: e?.code, message: e?.message }));
          Alert.alert('Reset Failed', e?.message || 'Unknown error.');
        }
      }}
    ]);
  }

  async function doAttachDevVenue() {
    if (!user) { Alert.alert('Not Signed In', 'Sign in first.'); return; }
    if (!devVenueId) { Alert.alert('Dev Venue Not Configured', 'Set EXPO_PUBLIC_DEV_VENUE_ID in app.json > extra.'); return; }
    if (venueId) { Alert.alert('Already Attached', `You are already attached to: ${venueId}`); return; }

    try {
      const uref = doc(db, 'users', user.uid);
      const usnap = await getDoc(uref);
      const hasVenueField = usnap.exists() && (usnap.data() as any)?.venueId != null;
      if (hasVenueField) { Alert.alert('Cannot Attach', 'Your user already has venueId set.'); return; }
      await setDoc(uref, { venueId: devVenueId }, { merge: true });
      Alert.alert('Attached', `Pinned to dev venue: ${devVenueId}`);
      console.log('[TallyUp Settings] attached dev venue', { uid: user.uid, venueId: devVenueId });
    } catch (e: any) {
      console.log('[TallyUp Settings] attach error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Attach Failed', e?.message || 'Unknown error.');
    }
  }

  async function doSeedDemo() {
    try {
      if (!venueId) { Alert.alert('No Venue', 'Attach or create a venue first.'); return; }
      const res = await seedDemoSuppliersAndProducts(venueId);
      Alert.alert('Seeded', `Supplier + ${res.count} products added. Try Suggested Orders.`);
    } catch (e: any) {
      console.log('[TallyUp Settings] seed error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Seed Failed', e?.message || 'Unknown error');
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.heading}>Account</Text>
        <Text>Email: {user?.email || '—'}</Text>
        <Text>UID: {user?.uid || '—'}</Text>
        <Text>Venue: {venueId || '—'}</Text>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('SetupWizard')}>
          <Text style={styles.btnText}>Open Setup Wizard</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={doResetCycle}>
          <Text style={styles.btnText}>Reset Stock Take</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('Suppliers')}>
          <Text style={styles.btnText}>Manage Suppliers</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('Products')}>
          <Text style={styles.btnText}>Manage Products</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('SuggestedOrder')}>
          <Text style={styles.btnText}>Suggested Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('Orders')}>
          <Text style={styles.btnText}>Orders</Text>
        </TouchableOpacity>
      </View>

      {/* Lighter blue stub pills */}
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.stub}
          onPress={() => Alert.alert('Coming soon', 'CSV uploads & integrations will land here.')}
        >
          <Text style={styles.stubText}>Data & Integrations (CSV)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.stub}
          onPress={() => Alert.alert('Coming soon', 'Sales report imports will land here.')}
        >
          <Text style={styles.stubText}>Sales Reports (CSV)</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Developer Utilities</Text>
        <Text style={{ opacity: 0.7, marginBottom: 8 }}>
          Dev venue ID: {devVenueId || 'not configured'}
        </Text>
        <TouchableOpacity style={styles.devBtn} onPress={doAttachDevVenue}>
          <Text style={styles.devBtnText}>Attach Dev Venue (once)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.devBtn} onPress={doSeedDemo}>
          <Text style={styles.devBtnText}>Seed Demo Suppliers & Products</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.signOut} onPress={doSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, gap: 6 },
  heading: { fontWeight: '800', marginBottom: 4 },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: '700' },
  stub: { flex: 1, backgroundColor: '#D6E9FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#A9D2FF' },
  stubText: { color: '#0A84FF', fontWeight: '700' },
  devBtn: { backgroundColor: '#E5E7EB', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  devBtnText: { fontWeight: '700' },
  signOut: { marginTop: 'auto', backgroundColor: '#FF3B30', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  signOutText: { color: 'white', fontWeight: '800' },
});
