import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { db } from '../../services/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import Constants from 'expo-constants';
import { useVenueId } from '../../context/VenueProvider';
import { resetVenueCycle } from '../../services/session';
import { seedDemoSuppliersAndProducts } from '../../services/devSeedDemo';
import { usePendingAdjustmentsCount } from '../../hooks/usePendingAdjustments';

import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import LegalFooter from '../../components/LegalFooter';
import IdentityBadge from '../../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';

type MemberDoc = { role?: string };

export default function SettingsScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();

  const [isManager, setIsManager] = useState(false);
  const { count: pendingCount } = usePendingAdjustmentsCount(venueId);

  const { name: venueName } = useVenueInfo(venueId);
  const friendly = useMemo(() => {
    return friendlyIdentity(
      { displayName: user?.displayName ?? null, email: user?.email ?? null, uid: user?.uid ?? null },
      { name: venueName ?? null, venueId: venueId ?? null }
    );
  }, [user?.displayName, user?.email, user?.uid, venueName, venueId]);

  useEffect(() => {
    let unsubMember: any;
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!venueId || !u) { setIsManager(false); return; }
      try {
        const vdoc = await getDoc(doc(db, 'venues', venueId));
        const ownerUid = (vdoc.data() as any)?.ownerUid;
        if (ownerUid && ownerUid === u.uid) {
          console.log('[Settings] role=owner', { uid: u.uid, venueId });
          setIsManager(true);
          return;
        }
        unsubMember = onSnapshot(doc(db, 'venues', venueId, 'members', u.uid), (snap) => {
          const md = snap.data() as MemberDoc | undefined;
          console.log('[Settings] member role snapshot', { role: md?.role, uid: u.uid, venueId });
          setIsManager(md?.role === 'manager');
        });
      } catch (e:any) {
        console.log('[Settings] role check error', e?.message);
        setIsManager(false);
      }
    });
    return () => { unsubAuth(); unsubMember && unsubMember(); };
  }, [venueId]);

  const devVenueId =
    (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_DEV_VENUE_ID ||
    (Constants.expoConfig?.extra as any)?.DEV_VENUE_ID ||
    process.env.EXPO_PUBLIC_DEV_VENUE_ID ||
    undefined;

  async function doSignOut() {
    try { await auth.signOut(); console.log('[TallyUp Settings] signOut success'); }
    catch (e: any) { console.log('[TallyUp Settings] signOut error', JSON.stringify({ code: e?.code, message: e?.message })); Alert.alert('Sign Out Failed', e?.message || 'Unknown error'); }
  }

  async function doResetCycle() {
    if (!venueId) { Alert.alert('No Venue', 'You are not attached to a venue.'); return; }
    Alert.alert('Reset Stock Take','This will reset in-progress area flags for the current cycle. Continue?',[
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        try { await resetVenueCycle(venueId); Alert.alert('Reset Complete', 'Cycle reset flag written.'); }
        catch (e: any) { console.log('[TallyUp Settings] reset error', JSON.stringify({ code: e?.code, message: e?.message })); Alert.alert('Reset Failed', e?.message || 'Unknown error.'); }
      }}
    ]);
  }

  async function doAttachDevVenue() {
    if (!user) { Alert.alert('Not Signed In', 'Sign in first.'); return; }
    if (!devVenueId) { Alert.alert('Dev Venue Not Configured', 'Set EXPO_PUBLIC_DEV_VENUE_ID in app.json > extra.'); return; }
    if (venueId) { Alert.alert('Already Attached', `You are already attached to a venue.`); return; }

    try {
      const uref = doc(db, 'users', user.uid);
      const usnap = await getDoc(uref);
      const hasVenueField = usnap.exists() && (usnap.data() as any)?.venueId != null;
      if (hasVenueField) { Alert.alert('Cannot Attach', 'Your user already has a venue assigned.'); return; }
      await setDoc(uref, { venueId: devVenueId }, { merge: true });
      Alert.alert('Attached', `Pinned to dev venue.`);
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
    <LocalThemeGate>
      <View style={styles.wrap}>
        {/* Header with badge */}
        <View style={styles.headerRow}>
          <MaybeTText style={styles.title}>Settings</MaybeTText>
          <IdentityBadge />
        </View>

        {/* Friendly identity (no raw IDs shown) */}
        <View style={styles.card}>
          <MaybeTText style={styles.heading}>Account</MaybeTText>
          <Text>Signed in as: <Text style={styles.bold}>{friendly}</Text></Text>
          <Text>Email: {user?.email || '—'}</Text>
          <Text>Venue: {venueName || '—'}</Text>
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
          <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('SuggestedOrders')}>
            <Text style={styles.btnText}>Suggested Orders</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('Orders')}>
            <Text style={styles.btnText}>Orders</Text>
          </TouchableOpacity>
        </View>

        {/* Always show Adjustments entry; screen itself will enforce manager rights */}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#6A1B9A' }]} onPress={() => nav.navigate('Adjustments')}>
            <Text style={{ color: 'white', fontWeight: '800' }}>Adjustments</Text>
            {isManager && pendingCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Stubs */}
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
          <MaybeTText style={styles.heading}>Developer Utilities</MaybeTText>
          <Text style={{ opacity: 0.7, marginBottom: 8 }}>
            Dev venue ID configured: {devVenueId ? 'yes' : 'no'}
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

        <View style={{ marginTop: 12 }}>
          <LegalFooter />
        </View>
      </View>
    </LocalThemeGate>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: '#0F1115' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: 'white', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  card: { backgroundColor: '#111827', padding: 12, borderRadius: 12, gap: 6 },
  heading: { color: 'white', fontWeight: '800', marginBottom: 4 },
  bold: { fontWeight: '800', color: 'white' },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center', position: 'relative' },
  btnText: { color: 'white', fontWeight: '700' },
  stub: { flex: 1, backgroundColor: '#D6E9FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#A9D2FF' },
  stubText: { color: '#0A84FF', fontWeight: '700' },
  devBtn: { backgroundColor: '#E5E7EB', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  devBtnText: { fontWeight: '700' },
  signOut: { marginTop: 'auto', backgroundColor: '#FF3B30', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  signOutText: { color: 'white', fontWeight: '800' },
  badge: { position: 'absolute', top: -6, right: -6, backgroundColor: '#EF4444', minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '800' },
});
