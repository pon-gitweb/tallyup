import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { db } from '../../services/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import LegalFooter from '../../components/LegalFooter';
import IdentityBadge from '../../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';
import { usePendingAdjustmentsCount } from '../../hooks/usePendingAdjustments';
import { useVenueId } from '../../context/VenueProvider';

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
          if (__DEV__) console.log('[Settings] role=owner', { uid: u.uid, venueId });
          setIsManager(true);
          return;
        }
        unsubMember = onSnapshot(doc(db, 'venues', venueId, 'members', u.uid), (snap) => {
          const md = snap.data() as MemberDoc | undefined;
          if (__DEV__) console.log('[Settings] member role snapshot', { role: md?.role, uid: u.uid, venueId });
          setIsManager(md?.role === 'manager' || md?.role === 'owner');
        });
      } catch (e:any) {
        if (__DEV__) console.log('[Settings] role check error', e?.message);
        setIsManager(false);
      }
    });
    return () => { unsubAuth(); unsubMember && unsubMember(); };
  }, [venueId]);

  async function doSignOut() {
    try {
      await auth.signOut();
      if (__DEV__) console.log('[TallyUp Settings] signOut success');
    } catch (e:any) {
      if (__DEV__) console.log('[TallyUp Settings] signOut error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Sign Out Failed', e?.message || 'Unknown error');
    }
  }

  // STUB: Nuclear reset is disabled until post-BETA
  function doFullResetStub() {
    Alert.alert(
      'Full Reset (stub)',
      'The full venue-wide stock-take reset is disabled for BETA. Use per-department long-press reset from the Departments screen.'
    );
  }

  return (
    <LocalThemeGate>
      <View style={styles.wrap}>
        {/* Header with badge */}
        <View style={styles.headerRow}>
          <MaybeTText style={styles.title}>Settings</MaybeTText>
          <IdentityBadge />
        </View>

        {/* Identity summary */}
        <View style={styles.card}>
          <MaybeTText style={styles.heading}>Account</MaybeTText>
          <Text>Signed in as: <Text style={styles.bold}>{friendly}</Text></Text>
          <Text>Email: {user?.email || '—'}</Text>
          <Text>Venue: {venueName || '—'}</Text>
        </View>

        {/* Primary actions */}
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => nav.navigate('SetupWizard')}>
            <Text style={styles.btnText}>Open Setup Wizard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.stubBtn]}
            onPress={doFullResetStub}
          >
            <Text style={styles.stubBtnText}>Full Reset of All Stock Takes (stub)</Text>
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

        {/* Adjustments button (badge if manager/owner and count>0) */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#6A1B9A' }]}
            onPress={() => nav.navigate('Adjustments')}
          >
            <Text style={{ color: 'white', fontWeight: '800' }}>Adjustments</Text>
            {isManager && pendingCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
              </View>
            ) : null}
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
  stubBtn: { backgroundColor: '#E5E7EB' },
  stubBtnText: { fontWeight: '800', color: '#111827', textAlign: 'center' },
  signOut: { marginTop: 'auto', backgroundColor: '#FF3B30', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  signOutText: { color: 'white', fontWeight: '800' },
  badge: { position: 'absolute', top: -6, right: -6, backgroundColor: '#EF4444', minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '800' },
});
