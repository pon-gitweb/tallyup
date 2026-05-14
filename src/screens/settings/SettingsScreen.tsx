import React, { useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColours } from '../../context/ThemeContext';
import { FEATURES } from '../../config/features';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Share,
  ActivityIndicator,
} from 'react-native';
import { HintService } from '../../services/hints/HintService';
import { useNavigation } from '@react-navigation/native';
import { getAuth, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { db } from '../../services/firebase';
import { doc, getDoc, onSnapshot, updateDoc, collection, getDocs } from 'firebase/firestore';
import { AI_BASE_URL } from '../../config/ai';
import { resetAllDepartmentsStockTake } from '../../services/reset';

import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import LegalFooter from '../../components/LegalFooter';
import IdentityBadge from '../../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';
import { usePendingAdjustmentsCount } from '../../hooks/usePendingAdjustments';
import { usePendingBudgetApprovalsCount } from '../../hooks/usePendingBudgetApprovals';
import { useVenueId } from '../../context/VenueProvider';

type MemberDoc = { role?: string };

export default function SettingsScreen() {
  const themeColours = useColours();
  const insets = useSafeAreaInsets() ?? { bottom: 0, top: 0 };
  const styles = makeStyles(themeColours);
  const onShare = React.useCallback(async () => {
    try {
      await Share.share({
        message: "I'm using Hosti to manage my venue inventory. Check it out at hostistock.com",
        title: 'Hosti — Inventory for hospitality',
      });
    } catch (e: any) {
      Alert.alert('Could not share', e?.message || 'Please try again.');
    }
  }, []);
  const nav = useNavigation<any>();
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();

  const [isManager, setIsManager] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  // Inline edit — display name
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [savingDisplayName, setSavingDisplayName] = useState(false);

  // Inline edit — venue name
  const [editingVenueName, setEditingVenueName] = useState(false);
  const [venueNameInput, setVenueNameInput] = useState('');
  const [savingVenueName, setSavingVenueName] = useState(false);

  // Success toast
  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<any>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  const [weeklySummaryOn, setWeeklySummaryOn] = useState(false);
  const [venueTimezone, setVenueTimezone] = useState('Pacific/Auckland');
  const [autoSuggestPar, setAutoSuggestPar] = useState(false);

  // Subscribe to venue doc for preferences
  useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId), (snap) => {
      const d = snap.data() as any;
      setWeeklySummaryOn(d?.weeklySummaryEmail === true);
      setVenueTimezone(d?.timezone || 'Pacific/Auckland');
      setAutoSuggestPar(d?.autoSuggestPar === true);
    });
    return () => unsub();
  }, [venueId]);

  const handleToggleWeeklySummary = async (value: boolean) => {
    if (!venueId) return;
    if (!isManager) {
      Alert.alert('Manager only', 'Only managers and owners can change email preferences.');
      return;
    }
    try {
      const update: Record<string, any> = { weeklySummaryEmail: value };
      // Ensure timezone is always set when enabling for the first time
      if (value) update.timezone = venueTimezone || 'Pacific/Auckland';
      await updateDoc(doc(db, 'venues', venueId), update);
    } catch (e: any) {
      Alert.alert('Could not update preference', e?.message ?? String(e));
    }
  };

  const handleChangeTimezone = () => {
    if (!venueId || !isManager) return;
    const save = async (tz: string) => {
      try {
        await updateDoc(doc(db, 'venues', venueId), { timezone: tz });
      } catch (e: any) {
        Alert.alert('Could not save timezone', e?.message ?? String(e));
      }
    };
    Alert.alert(
      'Select Timezone',
      'Choose your venue timezone for the Monday 8am email.',
      [
        { text: 'NZ — Auckland',            onPress: () => save('Pacific/Auckland') },
        { text: 'NZ — Chatham Islands',     onPress: () => save('Pacific/Chatham') },
        { text: 'AU — Sydney / Melbourne',  onPress: () => save('Australia/Sydney') },
        { text: 'AU — Brisbane',            onPress: () => save('Australia/Brisbane') },
        { text: 'AU — Perth',               onPress: () => save('Australia/Perth') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleToggleAutoSuggestPar = async (value: boolean) => {
    if (!venueId || !isManager) {
      Alert.alert('Manager only', 'Only managers and owners can change this setting.');
      return;
    }
    try {
      await updateDoc(doc(db, 'venues', venueId), { autoSuggestPar: value });
    } catch (e: any) {
      Alert.alert('Could not update preference', e?.message ?? String(e));
    }
  };

  const { count: pendingCount } = usePendingAdjustmentsCount(venueId);
  const { count: budgetPendingCount } = usePendingBudgetApprovalsCount(venueId);

  const { name: venueName } = useVenueInfo(venueId);
  const friendly = useMemo(() => {
    return friendlyIdentity(
      { displayName: user?.displayName ?? null, email: user?.email ?? null, uid: user?.uid ?? null },
      { name: venueName ?? null, venueId: venueId ?? null }
    );
  }, [user?.displayName, user?.email, user?.uid, venueName, venueId]);

  const [aboutOpen, setAboutOpen] = useState(false);
  const [resettingCycle, setResettingCycle] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

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
          setIsOwner(true);
          return;
        }
        unsubMember = onSnapshot(doc(db, 'venues', venueId, 'members', u.uid), (snap) => {
          const md = snap.data() as MemberDoc | undefined;
          if (__DEV__) console.log('[Settings] member role snapshot', { role: md?.role, uid: u.uid, venueId });
          setIsManager(md?.role === 'manager' || md?.role === 'owner');
          setIsOwner(md?.role === 'owner');
        });
      } catch (e:any) {
        if (__DEV__) console.log('[Settings] role check error', e?.message);
        setIsManager(false);
        setIsOwner(false);
      }
    });
    return () => { unsubAuth(); unsubMember && unsubMember(); };
  }, [venueId]);

  async function saveDisplayName() {
    const name = displayNameInput.trim();
    if (name.length < 2) { Alert.alert('Name too short', 'Please enter at least 2 characters.'); return; }
    if (name.length > 50) { Alert.alert('Name too long', 'Maximum 50 characters.'); return; }
    setSavingDisplayName(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not signed in');
      await updateProfile(currentUser, { displayName: name });
      await updateDoc(doc(db, 'users', currentUser.uid), { displayName: name });
      setEditingDisplayName(false);
      showToast('Name updated ✓');
    } catch (e: any) {
      Alert.alert('Could not save name', e?.message || 'Please try again.');
    } finally {
      setSavingDisplayName(false);
    }
  }

  async function saveVenueName() {
    if (!venueId) return;
    const name = venueNameInput.trim();
    if (name.length < 2) { Alert.alert('Name too short', 'Please enter at least 2 characters.'); return; }
    if (name.length > 100) { Alert.alert('Name too long', 'Maximum 100 characters.'); return; }
    setSavingVenueName(true);
    try {
      await updateDoc(doc(db, 'venues', venueId), { name });
      setEditingVenueName(false);
      showToast('Venue name updated ✓');
    } catch (e: any) {
      Alert.alert('Could not save venue name', e?.message || 'Please try again.');
    } finally {
      setSavingVenueName(false);
    }
  }

  async function doSignOut() {
    try {
      await auth.signOut();
      if (__DEV__) console.log('[TallyUp Settings] signOut success');
    } catch (e:any) {
      if (__DEV__) console.log('[TallyUp Settings] signOut error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Sign Out Failed', e?.message || 'Unknown error');
    }
  }

  function doSetupWizardStub() {
    Alert.alert(
      'Setup Wizard',
      'We are refreshing the setup flow. For now, use Stock Control to manage suppliers and products.'
    );
  }

  function doFullResetStub() {
    Alert.alert(
      'Full Reset',
      'The full venue-wide stock-take reset is not available here. Use per-department long-press reset from the Departments screen.'
    );
  }

  async function doDeleteAccount() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    // Step 1 — initial confirmation
    const step1 = await new Promise<boolean>(resolve =>
      Alert.alert(
        'Delete your account?',
        'This will permanently delete your account and remove you from all venues. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete Account', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: false }
      )
    );
    if (!step1) return;

    // Step 2 — extra warning if user is venue owner
    if (venueId) {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        const ownerUid = (venueSnap.data() as any)?.ownerUid;
        if (ownerUid === currentUser.uid) {
          const step2 = await new Promise<boolean>(resolve =>
            Alert.alert(
              `You are the owner of ${venueName || 'this venue'}`,
              `Deleting your account will also delete this venue and all its data including stocktakes, products, orders and reports.\n\nAre you absolutely sure?`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Yes, delete everything', style: 'destructive', onPress: () => resolve(true) },
              ],
              { cancelable: false }
            )
          );
          if (!step2) return;
        }
      } catch {}
    }

    // Step 3 — execute deletion via backend
    setDeletingAccount(true);
    try {
      const idToken = await currentUser.getIdToken();
      const resp = await fetch(`${AI_BASE_URL}/api/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || 'Account deletion failed');
      }
      Alert.alert('Account deleted', 'Your account has been permanently deleted.');
      await auth.signOut();
    } catch (e: any) {
      Alert.alert('Deletion failed', e?.message || 'Please try again or contact support at office@hosti.co.nz.');
    } finally {
      setDeletingAccount(false);
    }
  }

  async function doResetCycle() {
    if (!venueId) return;
    try {
      const currentUid = auth.currentUser?.uid ?? null;
      const depsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      let inProgressUser: string | null = null;
      for (const dep of depsSnap.docs) {
        const areas = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
        for (const area of areas.docs) {
          const d = area.data() as any;
          if (d.startedAt && !d.completedAt && d.currentLock?.uid && d.currentLock.uid !== currentUid) {
            inProgressUser = d.currentLock.displayName || 'Another user';
            break;
          }
        }
        if (inProgressUser) break;
      }
      const message = inProgressUser
        ? `${inProgressUser} is currently counting. Resetting now will discard their in-progress count. Are you sure?`
        : 'This resets all areas for a fresh count. Completed data is saved.';
      Alert.alert('Start new stocktake?', message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: inProgressUser ? 'Reset anyway' : 'Start new cycle',
          style: inProgressUser ? 'destructive' : 'default',
          onPress: async () => {
            setResettingCycle(true);
            try {
              await resetAllDepartmentsStockTake(venueId);
              Alert.alert('Cycle reset', 'All areas have been reset. You can start a fresh stocktake.');
            } catch (e: any) {
              Alert.alert('Error', 'Could not reset: ' + (e?.message || e?.code || 'unknown'));
            } finally {
              setResettingCycle(false);
            }
          },
        },
      ]);
    } catch {
      Alert.alert('Start new stocktake?', 'This resets all areas for a fresh count.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start new cycle',
          onPress: async () => {
            setResettingCycle(true);
            try {
              await resetAllDepartmentsStockTake(venueId);
              Alert.alert('Cycle reset', 'All areas have been reset. You can start a fresh stocktake.');
            } catch (e: any) {
              Alert.alert('Error', 'Could not reset: ' + (e?.message || e?.code || 'unknown'));
            } finally {
              setResettingCycle(false);
            }
          },
        },
      ]);
    }
  }

  const openAbout = () => setAboutOpen(true);
  const closeAbout = () => setAboutOpen(false);

  return (
    <LocalThemeGate>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={styles.scrollRoot}
        contentContainerStyle={[styles.wrap, { paddingBottom: 40 + (insets?.bottom ?? 0) }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header with badge */}
        <View style={styles.headerRow}>
          <MaybeTText style={styles.title}>Settings</MaybeTText>
          <IdentityBadge />
        </View>

        {/* ─── MY ACCOUNT ─── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>My Account</Text></View>

        {/* Identity card — display name + venue name editing */}
        <View style={styles.card}>
          <MaybeTText style={styles.heading}>Account</MaybeTText>

          {/* Toast */}
          {toast ? (
            <View style={{ backgroundColor: '#dcfce7', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 10 }}>
              <Text style={{ color: '#15803d', fontWeight: '700', fontSize: 13 }}>{toast}</Text>
            </View>
          ) : null}

          {/* Email — read only */}
          <Text style={{ color: themeColours.textSecondary, fontSize: 13, marginBottom: 12 }}>
            Email: {user?.email || '—'}
          </Text>

          {/* Display name */}
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: themeColours.textSecondary, textTransform: 'uppercase', marginBottom: 4 }}>
              Display name
            </Text>
            {editingDisplayName ? (
              <View>
                <TextInput
                  value={displayNameInput}
                  onChangeText={setDisplayNameInput}
                  autoFocus
                  maxLength={50}
                  placeholder="Your name"
                  placeholderTextColor={themeColours.textSecondary}
                  style={{
                    borderWidth: 1, borderColor: themeColours.primary, borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 8,
                    fontSize: 15, color: themeColours.text,
                    backgroundColor: themeColours.background,
                  }}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={saveDisplayName}
                    disabled={savingDisplayName}
                    style={{ flex: 1, backgroundColor: themeColours.primary, borderRadius: 999, paddingVertical: 9, alignItems: 'center' }}
                  >
                    {savingDisplayName
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: themeColours.primaryText, fontWeight: '700', fontSize: 13 }}>Save</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setEditingDisplayName(false)}
                    style={{ flex: 1, backgroundColor: themeColours.surface, borderRadius: 999, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: themeColours.border }}
                  >
                    <Text style={{ color: themeColours.textSecondary, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => { setDisplayNameInput(user?.displayName || ''); setEditingDisplayName(true); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <Text style={{ fontSize: 15, color: themeColours.navy, fontWeight: '600', flex: 1 }}>
                  {user?.displayName || 'Not set'}
                </Text>
                <Text style={{ color: themeColours.primary, fontSize: 13, fontWeight: '700' }}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Venue name */}
          <View>
            <Text style={{ fontSize: 11, fontWeight: '700', color: themeColours.textSecondary, textTransform: 'uppercase', marginBottom: 4 }}>
              Venue
            </Text>
            {isOwner && editingVenueName ? (
              <View>
                <TextInput
                  value={venueNameInput}
                  onChangeText={setVenueNameInput}
                  autoFocus
                  maxLength={100}
                  placeholder="Venue name"
                  placeholderTextColor={themeColours.textSecondary}
                  style={{
                    borderWidth: 1, borderColor: themeColours.primary, borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 8,
                    fontSize: 15, color: themeColours.text,
                    backgroundColor: themeColours.background,
                  }}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={saveVenueName}
                    disabled={savingVenueName}
                    style={{ flex: 1, backgroundColor: themeColours.primary, borderRadius: 999, paddingVertical: 9, alignItems: 'center' }}
                  >
                    {savingVenueName
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: themeColours.primaryText, fontWeight: '700', fontSize: 13 }}>Save</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setEditingVenueName(false)}
                    style={{ flex: 1, backgroundColor: themeColours.surface, borderRadius: 999, paddingVertical: 9, alignItems: 'center', borderWidth: 1, borderColor: themeColours.border }}
                  >
                    <Text style={{ color: themeColours.textSecondary, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 15, color: themeColours.navy, fontWeight: '600', flex: 1 }}>
                  {venueName || '—'}
                </Text>
                {isOwner ? (
                  <TouchableOpacity onPress={() => { setVenueNameInput(venueName || ''); setEditingVenueName(true); }}>
                    <Text style={{ color: themeColours.primary, fontSize: 13, fontWeight: '700' }}>Edit</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>
        </View>

        {/* Sign out */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => Alert.alert(
              'Sign out of Hosti?',
              '',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'default', onPress: doSignOut },
              ]
            )}
          >
            <Text style={styles.btnText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* ─── MY VENUE ─── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>My Venue</Text></View>

        {/* Team Members — owners and managers only */}
        {isManager && (
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: themeColours.navy }]}
              onPress={() => nav.navigate('TeamMembers')}
            >
              <Text style={styles.btnText}>Team Members</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Adjustments */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: themeColours.primary }]}
            onPress={() => {
              if (!isManager) {
                Alert.alert('Manager access required', 'Only managers and owners can view and action adjustments.');
                return;
              }
              nav.navigate('Adjustments');
            }}
          >
            <Text style={styles.btnText}>Adjustments</Text>
            {isManager && pendingCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Budget Approvals */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: themeColours.danger }]}
            onPress={() => nav.navigate('BudgetApprovalInbox')}
          >
            <Text style={styles.btnText}>Budget Approvals</Text>
            {isManager && budgetPendingCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{budgetPendingCount > 99 ? '99+' : budgetPendingCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Xero */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => nav.navigate('Xero')}
          >
            <Text style={styles.btnText}>Xero Integration</Text>
          </TouchableOpacity>
        </View>

        {/* POS Integration */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>POS Integration</Text></View>
        {([
          { key: 'wizbang',    label: 'Wizbang Onetap' },
          { key: 'lightspeed', label: 'Lightspeed' },
          { key: 'square',     label: 'Square' },
          { key: 'bepoz',      label: 'BEPOZ' },
          { key: 'impos',      label: 'Impos' },
        ] as const).map(({ key, label }) => (
          <View key={key} style={[styles.row, { alignItems: 'center' }]}>
            <View style={[styles.btn, {
              backgroundColor: themeColours.surface,
              borderWidth: 1,
              borderColor: themeColours.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }]}>
              <Text style={{ color: themeColours.text, fontWeight: '700', flex: 1 }}>{label}</Text>
              <View style={{
                backgroundColor: themeColours.background,
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: themeColours.border,
                marginLeft: 8,
                marginRight: 8,
              }}>
                <Text style={{ fontSize: 11, color: themeColours.textSecondary, fontWeight: '700' }}>Coming soon</Text>
              </View>
              <TouchableOpacity
                onPress={() => Alert.alert(
                  `Connect ${label}`,
                  `Connect ${label} to import products and sales data automatically. Contact your POS provider and mention Hosti to request integration.`
                )}
              >
                <Text style={{ color: themeColours.primary, fontWeight: '700', fontSize: 13 }}>Learn more</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <View style={styles.row}>
          <View style={[styles.btn, {
            backgroundColor: themeColours.surface,
            borderWidth: 1,
            borderColor: themeColours.border,
          }]}>
            <Text style={{ color: themeColours.textSecondary, fontSize: 13, textAlign: 'center' }}>
              Using a different POS?{'\n'}Email us at{' '}
              <Text style={{ color: themeColours.primary, fontWeight: '700' }}>office@hosti.co.nz</Text>
            </Text>
          </View>
        </View>

        {/* Supplier Portal — only visible when feature flag is on */}
        {FEATURES.SUPPLIER_PORTAL && (
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: themeColours.success }]}
              onPress={() => nav.navigate('SupplierDashboard', { supplierId: 'demo' })}
            >
              <Text style={styles.btnText}>Supplier Portal</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── STOCK CONTROL ─── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Stock Control</Text></View>

        {/* Open Stock Control */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => nav.navigate('StockControl')}
          >
            <Text style={styles.btnText}>Open Stock Control (Suppliers, Products & Orders)</Text>
          </TouchableOpacity>
        </View>

        {/* Bluetooth scales */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => nav.navigate('ScaleSettings')}
          >
            <Text style={styles.btnText}>⚖️ Bluetooth Scale</Text>
          </TouchableOpacity>
        </View>

        {/* Cycle reset — manager/owner only */}
        {isManager && (
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#c47b2b', opacity: resettingCycle ? 0.6 : 1 }]}
              onPress={doResetCycle}
              disabled={resettingCycle}
            >
              {resettingCycle ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={styles.btnText}>Reset Stocktake Cycle</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 3, textAlign: 'center' }}>
                    Starts a new stocktake cycle for all areas. This cannot be undone.
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Default counting preferences */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => nav.navigate('ReportPreferences')}
          >
            <Text style={styles.btnText}>Report Preferences</Text>
          </TouchableOpacity>
        </View>

        {/* Auto suggest PAR after each cycle — manager/owner only */}
        {isManager && (
          <View style={styles.row}>
            <View style={[styles.btn, {
              backgroundColor: themeColours.surface,
              borderWidth: 1,
              borderColor: themeColours.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 10,
            }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ color: themeColours.text, fontWeight: '800' }}>Auto-suggest PAR after each cycle</Text>
                <Text style={{ color: themeColours.textSecondary, fontSize: 12, marginTop: 2 }}>
                  {autoSuggestPar
                    ? 'Enabled — PAR review shown after each stocktake'
                    : 'Disabled — turn on to review PAR levels post-cycle'}
                </Text>
              </View>
              <Switch
                value={autoSuggestPar}
                onValueChange={handleToggleAutoSuggestPar}
                trackColor={{ false: themeColours.border, true: themeColours.primary }}
                thumbColor="white"
                ios_backgroundColor={themeColours.border}
              />
            </View>
          </View>
        )}

        {/* ─── REPORTS ─── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Reports</Text></View>

        {/* Weekly summary email toggle — managers/owners only */}
        {isManager && (
          <View style={styles.row}>
            <View style={[styles.btn, {
              backgroundColor: themeColours.surface,
              borderWidth: 1,
              borderColor: themeColours.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 10,
            }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ color: themeColours.text, fontWeight: '800' }}>Weekly Summary Email</Text>
                <Text style={{ color: themeColours.textSecondary, fontSize: 12, marginTop: 2 }}>
                  {weeklySummaryOn
                    ? `Mondays 8am · ${venueTimezone}`
                    : 'Disabled — sends to all managers'}
                </Text>
                {weeklySummaryOn && (
                  <TouchableOpacity onPress={handleChangeTimezone} style={{ marginTop: 4 }}>
                    <Text style={{ color: themeColours.primary, fontSize: 12, fontWeight: '700' }}>
                      Change timezone
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <Switch
                value={weeklySummaryOn}
                onValueChange={handleToggleWeeklySummary}
                trackColor={{ false: themeColours.border, true: themeColours.primary }}
                thumbColor="white"
                ios_backgroundColor={themeColours.border}
              />
            </View>
          </View>
        )}

        {/* ─── AI & USAGE ─── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>AI & Usage</Text></View>

        {/* AI usage dashboard */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: themeColours.primary }]}
            onPress={() => nav.navigate('AiUsage')}
          >
            <Text style={styles.btnText}>AI Usage</Text>
          </TouchableOpacity>
        </View>

        {/* ─── SUPPORT ─── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Support</Text></View>

        {/* Pricing & Plans */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => nav.navigate('Pricing')}
          >
            <Text style={styles.btnText}>Pricing & Plans</Text>
          </TouchableOpacity>
        </View>

        {/* Terms of Service */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: themeColours.navy }]}
            onPress={() => nav.navigate('Terms')}
          >
            <Text style={styles.btnText}>Terms of Service</Text>
          </TouchableOpacity>
        </View>

        {/* Share Hosti */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={onShare}
          >
            <Text style={styles.btnText}>Share Hosti</Text>
          </TouchableOpacity>
        </View>

        {/* Reset Tips & Hints */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: themeColours.amber }]}
            onPress={async () => {
              try {
                await HintService.resetAll();
                Alert.alert('Done', 'Tips have been reset.');
              } catch (e: any) {
                Alert.alert('Error', 'Could not reset tips. Please try again.');
              }
            }}
          >
            <Text style={styles.btnText}>Reset Tips & Hints</Text>
          </TouchableOpacity>
        </View>

        {/* About Hosti */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, styles.aboutBtn]}
            onPress={openAbout}
          >
            <Text style={styles.btnText}>About Hosti</Text>
          </TouchableOpacity>
        </View>

        {/* Setup Guide */}
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => nav.navigate('SetupGuide')}
          >
            <Text style={styles.btnText}>Setup Guide</Text>
          </TouchableOpacity>
        </View>

        {/* App version */}
        <View style={{ marginTop: 12, alignItems: 'center' }}>
          <Text style={{ color: themeColours.textSecondary, fontSize: 12 }}>
            Hosti v{Constants.expoConfig?.version ?? '—'}
          </Text>
        </View>

        {/* APPEARANCE — temporarily hidden, not working.
            Restore when implemented. */}
        {false && (
          <>
            <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Appearance</Text></View>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => nav.navigate('Appearance')}
              >
                <Text style={styles.btnText}>🎨 Appearance</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ─── DANGER ZONE ─── */}
        <View style={{ marginHorizontal: 4, marginTop: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#dc2626', padding: 14 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Danger Zone</Text>
          <TouchableOpacity
            style={{ backgroundColor: '#fee2e2', borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: deletingAccount ? 0.6 : 1 }}
            onPress={doDeleteAccount}
            disabled={deletingAccount}
          >
            {deletingAccount
              ? <ActivityIndicator color="#dc2626" size="small" />
              : <>
                  <Text style={{ color: '#dc2626', fontWeight: '800', fontSize: 14 }}>Delete Account</Text>
                  <Text style={{ color: '#dc2626', fontSize: 11, marginTop: 2, opacity: 0.8 }}>Permanently removes your account and data</Text>
                </>
            }
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 8 }}>
          <LegalFooter />
        </View>

        {/* About modal – scrollable overview */}
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
                <Text style={styles.aboutTitle}>About Hosti</Text>
                <View style={{ width: 60 }} />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.aboutContent}
              >
                <View style={styles.aboutCard}>
                  <Text style={styles.aboutLabel}>Build</Text>
                  <Text style={styles.aboutValue}>Hosti</Text>
                  <Text style={styles.aboutSub}>
                    Hosti is designed for real NZ hospitality venues to run live stocktakes,
                    orders and invoice workflows.
                  </Text>
                </View>

                <View style={styles.aboutCard}>
                  <Text style={styles.aboutHeading}>What's included</Text>
                  <Text style={styles.aboutBullet}>• Department → area → item stocktakes with expected quantities.</Text>
                  <Text style={styles.aboutBullet}>• Supplier and product management with prep for CSV/catalog imports.</Text>
                  <Text style={styles.aboutBullet}>• Suggested orders and ordering flows per supplier.</Text>
                  <Text style={styles.aboutBullet}>• Receiving flows including manual, CSV/PDF and Fast Receive snapshots.</Text>
                  <Text style={styles.aboutBullet}>• Early invoice reconciliation and variance views.</Text>
                  <Text style={styles.aboutBullet}>• Craft-It recipe tooling and COGS / GP groundwork.</Text>
                </View>

                <View style={styles.aboutCard}>
                  <Text style={styles.aboutHeading}>Data & privacy</Text>
                  <Text style={styles.aboutBody}>
                    Your data is stored in secure, venue-scoped collections in Firebase (Auth, Firestore and
                    Storage). Each venue only sees its own data, and sensitive actions are limited to owners
                    or managers according to the Truth Document rules.
                  </Text>
                  <Text style={styles.aboutBody}>
                    Hosti is focused on getting real-world workflows right. Formal legal wording and full
                    policy links are available in Terms of Service.
                  </Text>
                </View>

                <View style={styles.aboutCard}>
                  <Text style={styles.aboutHeading}>Feedback</Text>
                  <Text style={styles.aboutBody}>
                    Your feedback directly decides what ships next: stocktake UX, suggested orders, invoice
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
                    You can come back to this screen any time from Settings → About to remind yourself what's
                    included in Hosti and how we treat your data.
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
      </ScrollView>
      </KeyboardAvoidingView>
    </LocalThemeGate>
  );
}

function makeStyles(c: ReturnType<typeof useColours>) {
  return StyleSheet.create({
    scrollRoot: { flex: 1, backgroundColor: c.background },
    wrap: { padding: 16, gap: 12, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: c.text, fontSize: 22, fontWeight: '800', marginBottom: 4 },
    card: { backgroundColor: c.surface, padding: 12, borderRadius: 12, gap: 6, borderWidth: 1, borderColor: c.border },
    heading: { color: c.text, fontWeight: '800', marginBottom: 4 },
    bold: { fontWeight: '800', color: c.text },
    sectionHeader: { paddingHorizontal: 4, paddingTop: 16, paddingBottom: 6 },
    sectionHeaderText: { fontSize: 11, fontWeight: '900', color: c.textSecondary, letterSpacing: 1, textTransform: 'uppercase' },
    row: { flexDirection: 'row', gap: 10 },
    btn: {
      flex: 1,
      backgroundColor: c.primary,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      position: 'relative',
    },
    btnText: { color: c.primaryText, fontWeight: '700', textAlign: 'center' },
    stubBtn: { backgroundColor: c.border },
    stubBtnText: { fontWeight: '800', color: c.text, textAlign: 'center' },
    aboutBtn: { backgroundColor: c.navy },
    signOut: {
      backgroundColor: c.danger,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    signOutText: { color: c.primaryText, fontWeight: '800' },
    badge: {
      position: 'absolute',
      top: -6,
      right: -6,
      backgroundColor: c.danger,
      minWidth: 20,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.surface,
    },
    badgeText: { color: c.primaryText, fontSize: 12, fontWeight: '800' },

    aboutWrap: { flex: 1, backgroundColor: c.navy },
    aboutHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    aboutBack: { color: c.primaryText, fontSize: 16, fontWeight: '700' },
    aboutTitle: { color: c.primaryText, fontSize: 18, fontWeight: '800' },
    aboutContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 24,
      gap: 12,
    },
    aboutCard: {
      backgroundColor: 'rgba(255,255,255,0.07)',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      padding: 12,
    },
    aboutLabel: {
      color: 'rgba(255,255,255,0.5)',
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 4,
    },
    aboutValue: { color: c.primaryText, fontSize: 14, fontWeight: '800', marginBottom: 4 },
    aboutSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 18 },
    aboutHeading: { color: c.primaryText, fontSize: 14, fontWeight: '800', marginBottom: 4 },
    aboutBullet: { color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 18, marginTop: 2 },
    aboutBody: { color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 18, marginTop: 2 },
    aboutFooter: {
      padding: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.12)',
    },
    aboutCloseBtn: {
      backgroundColor: c.primary,
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: 'center',
    },
    aboutCloseText: { color: c.primaryText, fontWeight: '800' },
  });
}
