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
  Pressable,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Share,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { HintService } from '../../services/hints/HintService';
import { useNavigation } from '@react-navigation/native';
import {
  getAuth, onAuthStateChanged, updateProfile,
  EmailAuthProvider, reauthenticateWithCredential,
  updatePassword, verifyBeforeUpdateEmail,
} from 'firebase/auth';
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
import { useVenueId, useVenueType } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

type MemberDoc = { role?: string };

const TIMEZONE_OPTIONS = [
  { value: 'Pacific/Auckland', label: 'NZ — Auckland' },
  { value: 'Pacific/Chatham', label: 'NZ — Chatham Islands' },
  { value: 'Australia/Sydney', label: 'AU — Sydney / Melbourne' },
  { value: 'Australia/Brisbane', label: 'AU — Brisbane' },
  { value: 'Australia/Perth', label: 'AU — Perth' },
];

export default function SettingsScreen() {
  const themeColours = useColours();
  const insets = useSafeAreaInsets() ?? { bottom: 0, top: 0 };
  const styles = makeStyles(themeColours);
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();

  const [showTimezonePicker, setShowTimezonePicker] = useState(false);

  const onShare = React.useCallback(async () => {
    try {
      await Share.share({
        message: "I'm using Hosti to manage my venue inventory. Check it out at hostistock.com",
        title: 'Hosti — Inventory for hospitality',
      });
    } catch (e: any) {
      showError('Could not share.');
    }
  }, [showError]);
  const nav = useNavigation<any>();
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();
  const venueType = useVenueType();
  const isFestival = venueType === 'festival';

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
      showInfo('Manager access required.');
      return;
    }
    try {
      const update: Record<string, any> = { weeklySummaryEmail: value };
      // Ensure timezone is always set when enabling for the first time
      if (value) update.timezone = venueTimezone || 'Pacific/Auckland';
      await updateDoc(doc(db, 'venues', venueId), update);
    } catch (e: any) {
      showError('Could not update preference.');
    }
  };

  const handleChangeTimezone = () => {
    if (!venueId || !isManager) return;
    setShowTimezonePicker(true);
  };

  const saveTimezone = async (tz: string) => {
    if (!venueId) return;
    try {
      await updateDoc(doc(db, 'venues', venueId), { timezone: tz });
    } catch (e: any) {
      showError('Could not save timezone.');
    }
  };

  const handleToggleAutoSuggestPar = async (value: boolean) => {
    if (!venueId || !isManager) {
      showInfo('Manager access required.');
      return;
    }
    try {
      await updateDoc(doc(db, 'venues', venueId), { autoSuggestPar: value });
    } catch (e: any) {
      showError('Could not update preference.');
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

  // Change password modal
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  // Change email modal
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [emailPwForAuth, setEmailPwForAuth] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

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
    if (name.length < 2) { showInfo('Name must be at least 2 characters.'); return; }
    if (name.length > 50) { showInfo('Name must be under 50 characters.'); return; }
    setSavingDisplayName(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not signed in');
      await updateProfile(currentUser, { displayName: name });
      await updateDoc(doc(db, 'users', currentUser.uid), { displayName: name });
      setEditingDisplayName(false);
      showToast('Name updated ✓');
    } catch (e: any) {
      showError('Could not save name.');
    } finally {
      setSavingDisplayName(false);
    }
  }

  async function saveVenueName() {
    if (!venueId) return;
    const name = venueNameInput.trim();
    if (name.length < 2) { showInfo('Venue name must be at least 2 characters.'); return; }
    if (name.length > 100) { showInfo('Venue name must be under 100 characters.'); return; }
    setSavingVenueName(true);
    try {
      await updateDoc(doc(db, 'venues', venueId), { name });
      setEditingVenueName(false);
      showToast('Venue name updated ✓');
    } catch (e: any) {
      showError('Could not save venue name.');
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
      showError('Sign out failed.');
    }
  }

  function doSetupWizardStub() {
    showInfo('Setup wizard coming soon.');
  }

  function doFullResetStub() {
    showInfo('Use per-department long-press reset from the Departments screen.');
  }

  async function executeAccountDeletion(currentUser: any) {
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
      showSuccess('✓ Account deleted.');
      await auth.signOut();
    } catch (e: any) {
      showError('Could not delete account.');
    } finally {
      setDeletingAccount(false);
    }
  }

  async function proceedToStep2Delete(currentUser: any) {
    if (venueId) {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        const ownerUid = (venueSnap.data() as any)?.ownerUid;
        if (ownerUid === currentUser.uid) {
          confirm({
            title: `You are the owner of ${venueName || 'this venue'}`,
            message: `Deleting your account will also delete this venue and all its data including stocktakes, products, orders and reports.\n\nAre you absolutely sure?`,
            confirmLabel: 'Delete everything',
            destructive: true,
            onConfirm: () => executeAccountDeletion(currentUser),
          });
          return;
        }
      } catch {}
    }
    executeAccountDeletion(currentUser);
  }

  function doDeleteAccount() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    confirm({
      title: 'Delete your account?',
      message: 'This will permanently delete your account and remove you from all venues. This cannot be undone.',
      confirmLabel: 'Delete Account',
      destructive: true,
      onConfirm: () => proceedToStep2Delete(currentUser),
    });
  }

  async function doChangePassword() {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) return;
    if (!currentPw) { showInfo('Please enter your current password.'); return; }
    if (newPw.length < 6) { showInfo('New password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { showInfo('Passwords do not match.'); return; }
    setSavingPw(true);
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPw);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPw);
      setChangePwOpen(false);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      showToast('✓ Password updated');
    } catch (e: any) {
      const code = (e?.code || '').toString();
      if (code.includes('wrong-password') || code.includes('invalid-credential')) {
        showError('Incorrect password.');
      } else {
        showError('Could not update password.');
      }
    } finally {
      setSavingPw(false);
    }
  }

  async function doChangeEmail() {
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) return;
    const trimmedEmail = newEmail.trim();
    if (!emailPwForAuth) { showInfo('Please enter your password to confirm.'); return; }
    if (!trimmedEmail || !trimmedEmail.includes('@')) { showInfo('Please enter a valid email address.'); return; }
    setSavingEmail(true);
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, emailPwForAuth);
      await reauthenticateWithCredential(currentUser, credential);
      await verifyBeforeUpdateEmail(currentUser, trimmedEmail);
      setChangeEmailOpen(false);
      setEmailPwForAuth(''); setNewEmail('');
      showToast('Verification sent — check ' + trimmedEmail);
    } catch (e: any) {
      const code = (e?.code || '').toString();
      if (code.includes('wrong-password') || code.includes('invalid-credential')) {
        showError('Incorrect password.');
      } else if (code.includes('email-already-in-use')) {
        showError('That email is already registered.');
      } else {
        showError('Could not update email.');
      }
    } finally {
      setSavingEmail(false);
    }
  }

  async function doResetCycle() {
    if (!venueId) return;

    const performReset = async () => {
      setResettingCycle(true);
      try {
        await resetAllDepartmentsStockTake(venueId);
        showSuccess('✓ Cycle reset. Ready for new stocktake.');
      } catch (e: any) {
        showError('Could not reset cycle.');
      } finally {
        setResettingCycle(false);
      }
    };

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
      confirm({
        title: 'Start new stocktake?',
        message,
        confirmLabel: inProgressUser ? 'Reset anyway' : 'Start new cycle',
        destructive: !!inProgressUser,
        onConfirm: performReset,
      });
    } catch {
      confirm({
        title: 'Start new stocktake?',
        message: 'This resets all areas for a fresh count.',
        confirmLabel: 'Start new cycle',
        onConfirm: performReset,
      });
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

          {/* Email with change option */}
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: themeColours.textSecondary, textTransform: 'uppercase', marginBottom: 4 }}>Email</Text>
            <TouchableOpacity onPress={() => { setNewEmail(''); setEmailPwForAuth(''); setChangeEmailOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 15, color: themeColours.navy, fontWeight: '600', flex: 1 }}>{user?.email || '—'}</Text>
              <Text style={{ color: themeColours.primary, fontSize: 13, fontWeight: '700' }}>Change</Text>
            </TouchableOpacity>
          </View>

          {/* Change password row */}
          <View style={{ marginBottom: 12 }}>
            <TouchableOpacity onPress={() => { setCurrentPw(''); setNewPw(''); setConfirmPw(''); setChangePwOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 15, color: themeColours.navy, fontWeight: '600', flex: 1 }}>Password</Text>
              <Text style={{ color: themeColours.primary, fontSize: 13, fontWeight: '700' }}>Change</Text>
            </TouchableOpacity>
          </View>

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
            onPress={() => confirm({
              title: 'Sign out?',
              confirmLabel: 'Sign out',
              onConfirm: doSignOut,
            })}
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

        {/* Festival-specific venue settings */}
        {isFestival && isManager && (
          <>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: themeColours.navy }]}
                onPress={() => nav.navigate('FestivalEventSetup')}
              >
                <Text style={styles.btnText}>Event details</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: themeColours.primary }]}
                onPress={() => nav.navigate('FestivalEventSetup', { section: 2 })}
              >
                <Text style={styles.btnText}>Bar configuration</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Adjustments — venue only */}
        {!isFestival && (
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: themeColours.primary }]}
              onPress={() => {
                if (!isManager) {
                  showInfo('Manager access required.');
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
        )}

        {/* Budget Approvals — venue only */}
        {!isFestival && (
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
        )}

        {/* Xero — venue only */}
        {!isFestival && (
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => nav.navigate('Xero')}
            >
              <Text style={styles.btnText}>Xero Integration</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* POS Integration — venue only */}
        {!isFestival && (
          <>
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
                  {/* TODO: replace with branded modal when POS integration is built */}
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
          </>
        )}

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

        {/* ─── STOCK CONTROL — venue only ─── */}
        {!isFestival && (
          <>
            <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Stock Control</Text></View>

            <View style={styles.row}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => nav.navigate('StockControl')}
              >
                <Text style={styles.btnText}>Open Stock Control (Suppliers, Products & Orders)</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.row}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => nav.navigate('ScaleSettings')}
              >
                <Text style={styles.btnText}>⚖️ Bluetooth Scale</Text>
              </TouchableOpacity>
            </View>

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

            <View style={styles.row}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => nav.navigate('ReportPreferences')}
              >
                <Text style={styles.btnText}>Report Preferences</Text>
              </TouchableOpacity>
            </View>

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
          </>
        )}

        {/* ─── REPORTS ─── */}
        <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Reports</Text></View>

        {/* Weekly summary email toggle — managers/owners only, venue only */}
        {isManager && !isFestival && (
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

        {/* Legal — Privacy Policy + Terms of Service */}
        {/* TODO: replace with live URLs before App Store submission */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: themeColours.navy }]}
            onPress={() => Linking.openURL('https://www.hosti.co.nz/legal/privacy')}
          >
            <Text style={styles.btnText}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: themeColours.navy }]}
            onPress={() => Linking.openURL('https://www.hosti.co.nz/legal/terms')}
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
                showSuccess('✓ Tips reset.');
              } catch (e: any) {
                showError('Could not reset tips.');
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
        <Text style={styles.versionText}>
          Hosti-Stock v{Constants.expoConfig?.version ?? '—'}
        </Text>

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

      {/* ── CHANGE PASSWORD MODAL ── */}
      <Modal visible={changePwOpen} transparent animationType="slide" onRequestClose={() => setChangePwOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setChangePwOpen(false)} />
          <View style={{ backgroundColor: themeColours.background, padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: themeColours.navy, marginBottom: 16 }}>Change password</Text>
            {[
              { label: 'Current password', value: currentPw, onChange: setCurrentPw },
              { label: 'New password', value: newPw, onChange: setNewPw },
              { label: 'Confirm new password', value: confirmPw, onChange: setConfirmPw },
            ].map(({ label, value, onChange }) => (
              <TextInput
                key={label}
                placeholder={label}
                placeholderTextColor={themeColours.textSecondary}
                secureTextEntry
                value={value}
                onChangeText={onChange}
                style={{ height: 48, borderWidth: 1.5, borderColor: themeColours.border, borderRadius: 10, paddingHorizontal: 14, marginBottom: 10, backgroundColor: themeColours.surface, color: themeColours.text, fontSize: 15 }}
              />
            ))}
            <TouchableOpacity
              onPress={doChangePassword}
              disabled={savingPw}
              style={{ height: 50, borderRadius: 999, backgroundColor: themeColours.primary, alignItems: 'center', justifyContent: 'center', opacity: savingPw ? 0.6 : 1, marginTop: 4 }}
            >
              {savingPw ? <ActivityIndicator color={themeColours.primaryText} /> : <Text style={{ color: themeColours.primaryText, fontWeight: '700', fontSize: 15 }}>Update password</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setChangePwOpen(false)} style={{ alignItems: 'center', paddingTop: 14 }}>
              <Text style={{ color: themeColours.textSecondary, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── CHANGE EMAIL MODAL ── */}
      <Modal visible={changeEmailOpen} transparent animationType="slide" onRequestClose={() => setChangeEmailOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setChangeEmailOpen(false)} />
          <View style={{ backgroundColor: themeColours.background, padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: themeColours.navy, marginBottom: 6 }}>Change email</Text>
            <Text style={{ fontSize: 13, color: themeColours.textSecondary, marginBottom: 16, lineHeight: 18 }}>
              A verification link will be sent to your new address. Your email won't change until you click it.
            </Text>
            <TextInput
              placeholder="Current password"
              placeholderTextColor={themeColours.textSecondary}
              secureTextEntry
              value={emailPwForAuth}
              onChangeText={setEmailPwForAuth}
              style={{ height: 48, borderWidth: 1.5, borderColor: themeColours.border, borderRadius: 10, paddingHorizontal: 14, marginBottom: 10, backgroundColor: themeColours.surface, color: themeColours.text, fontSize: 15 }}
            />
            <TextInput
              placeholder="New email address"
              placeholderTextColor={themeColours.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              value={newEmail}
              onChangeText={setNewEmail}
              style={{ height: 48, borderWidth: 1.5, borderColor: themeColours.border, borderRadius: 10, paddingHorizontal: 14, marginBottom: 10, backgroundColor: themeColours.surface, color: themeColours.text, fontSize: 15 }}
            />
            <TouchableOpacity
              onPress={doChangeEmail}
              disabled={savingEmail}
              style={{ height: 50, borderRadius: 999, backgroundColor: themeColours.primary, alignItems: 'center', justifyContent: 'center', opacity: savingEmail ? 0.6 : 1, marginTop: 4 }}
            >
              {savingEmail ? <ActivityIndicator color={themeColours.primaryText} /> : <Text style={{ color: themeColours.primaryText, fontWeight: '700', fontSize: 15 }}>Send verification</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setChangeEmailOpen(false)} style={{ alignItems: 'center', paddingTop: 14 }}>
              <Text style={{ color: themeColours.textSecondary, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── TIMEZONE PICKER ── */}
      <Modal
        visible={showTimezonePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTimezonePicker(false)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setShowTimezonePicker(false)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: themeColours.surface }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.pickerTitle, { color: themeColours.text }]}>Select timezone</Text>
            {TIMEZONE_OPTIONS.map(({ value, label }) => (
              <TouchableOpacity
                key={value}
                style={[
                  styles.pickerOption,
                  { borderBottomColor: themeColours.border },
                  venueTimezone === value && { backgroundColor: themeColours.background },
                ]}
                onPress={async () => {
                  setShowTimezonePicker(false);
                  await saveTimezone(value);
                }}
              >
                <Text style={[styles.pickerOptionText, { color: themeColours.text }]}>{label}</Text>
                {venueTimezone === value && (
                  <Text style={{ color: themeColours.primary }}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {modal}
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
    versionText: { fontSize: 12, color: c.textSecondary, textAlign: 'center', marginTop: 8 },

    pickerOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    pickerSheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: 40,
    },
    pickerTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 16,
    },
    pickerOption: {
      paddingVertical: 14,
      paddingHorizontal: 4,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottomWidth: 0.5,
    },
    pickerOptionText: {
      fontSize: 15,
    },
  });
}
