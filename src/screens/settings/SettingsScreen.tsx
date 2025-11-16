import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
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

  const [aboutOpen, setAboutOpen] = useState(false);

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

  const openAbout = () => setAboutOpen(true);
  const closeAbout = () => setAboutOpen(false);

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
          <Text>
            Signed in as: <Text style={styles.bold}>{friendly}</Text>
          </Text>
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

        {/* Single, unambiguous entry point to stock flows */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => nav.navigate('StockControl')}
          >
            <Text style={styles.btnText}>Open Stock Control (Suppliers, Products & Orders)</Text>
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

        {/* About / BETA overview */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.aboutBtn]}
            onPress={openAbout}
          >
            <Text style={styles.btnText}>About TallyUp (BETA)</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.signOut} onPress={doSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ marginTop: 12 }}>
          <LegalFooter />
        </View>

        {/* About modal – scrollable BETA overview */}
        <Modal
          visible={aboutOpen}
          animationType="slide"
          onRequestClose={closeAbout}
        >
          <LocalThemeGate>
            <View style={styles.aboutWrap}>
              <View style={styles.aboutHeader}>
                <TouchableOpacity onPress={closeAbout}>
                  <Text style={styles.aboutBack}>‹ Settings</Text>
                </TouchableOpacity>
                <Text style={styles.aboutTitle}>About TallyUp</Text>
                <View style={{ width: 60 }} />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.aboutContent}
              >
                <View style={styles.aboutCard}>
                  <Text style={styles.aboutLabel}>Build</Text>
                  <Text style={styles.aboutValue}>Hosti-STOCK BETA</Text>
                  <Text style={styles.aboutSub}>
                    This pilot build is designed for real NZ hospitality venues to run live stocktakes,
                    orders and invoice workflows.
                  </Text>
                </View>

                <View style={styles.aboutCard}>
                  <Text style={styles.aboutHeading}>What’s in this BETA</Text>
                  <Text style={styles.aboutBullet}>• Department → area → item stocktakes with expected quantities.</Text>
                  <Text style={styles.aboutBullet}>• Supplier and product management with prep for CSV/catalog imports.</Text>
                  <Text style={styles.aboutBullet}>• Suggested orders and ordering flows per supplier.</Text>
                  <Text style={styles.aboutBullet}>• Receiving flows including manual, CSV/PDF and Fast Receive snapshots.</Text>
                  <Text style={styles.aboutBullet}>• Early invoice reconciliation and variance views.</Text>
                  <Text style={styles.aboutBullet}>• Craft-It recipe tooling and COGS / GP groundwork.</Text>
                </View>

                <View style={styles.aboutCard}>
                  <Text style={styles.aboutHeading}>Data & privacy (BETA)</Text>
                  <Text style={styles.aboutBody}>
                    Your data is stored in secure, venue-scoped collections in Firebase (Auth, Firestore and
                    Storage). Each venue only sees its own data, and sensitive actions are limited to owners
                    or managers according to the Truth Document rules.
                  </Text>
                  <Text style={styles.aboutBody}>
                    This BETA is focused on getting real-world workflows right. Formal legal wording and full
                    policy links will ship alongside the production release.
                  </Text>
                </View>

                <View style={styles.aboutCard}>
                  <Text style={styles.aboutHeading}>Feedback & pilots</Text>
                  <Text style={styles.aboutBody}>
                    Pilot feedback directly decides what ships next: stocktake UX, suggested orders, invoice
                    matching, Craft-It recipes and reporting.
                  </Text>
                  <Text style={styles.aboutBody}>
                    If something feels slow, confusing or missing, please tell your Hosti contact so we can
                    adjust before general release.
                  </Text>
                </View>

                <View style={[styles.aboutCard, { marginBottom: 12 }]}>
                  <Text style={styles.aboutHeading}>Revisit the overview</Text>
                  <Text style={styles.aboutBody}>
                    You can come back to this screen any time from Settings → About to remind yourself what’s
                    included in the BETA and how we treat your data.
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.aboutFooter}>
                <TouchableOpacity
                  style={styles.aboutCloseBtn}
                  onPress={closeAbout}
                >
                  <Text style={styles.aboutCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </LocalThemeGate>
        </Modal>
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
  btn: {
    flex: 1,
    backgroundColor: '#0A84FF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    position: 'relative',
  },
  btnText: { color: 'white', fontWeight: '700', textAlign: 'center' },
  stubBtn: { backgroundColor: '#E5E7EB' },
  stubBtnText: { fontWeight: '800', color: '#111827', textAlign: 'center' },
  aboutBtn: { backgroundColor: '#334155' },
  signOut: {
    marginTop: 'auto',
    backgroundColor: '#FF3B30',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  signOutText: { color: 'white', fontWeight: '800' },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#EF4444',
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '800' },

  // About modal styles
  aboutWrap: { flex: 1, backgroundColor: '#020617' },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1F2937',
  },
  aboutBack: { color: '#38BDF8', fontSize: 16, fontWeight: '700' },
  aboutTitle: { color: 'white', fontSize: 18, fontWeight: '800' },
  aboutContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  aboutCard: {
    backgroundColor: '#020617',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
    padding: 12,
  },
  aboutLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  aboutValue: { color: '#E5E7EB', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  aboutSub: { color: '#9CA3AF', fontSize: 12, lineHeight: 18 },
  aboutHeading: { color: '#E5E7EB', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  aboutBullet: { color: '#CBD5F5', fontSize: 12, lineHeight: 18, marginTop: 2 },
  aboutBody: { color: '#CBD5F5', fontSize: 12, lineHeight: 18, marginTop: 2 },
  aboutFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1F2937',
  },
  aboutCloseBtn: {
    backgroundColor: '#0A84FF',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  aboutCloseText: { color: 'white', fontWeight: '800' },
});
