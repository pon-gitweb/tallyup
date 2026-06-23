// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, deleteDoc, updateDoc, arrayRemove } from 'firebase/firestore';
import { useVenue } from '../../context/VenueProvider';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { AI_BASE_URL } from '../../config/ai';

type VenueRow = {
  id: string;
  name: string;
  type: string;
  role: string | null;
  deletedAt?: any;
  scheduledHardDeleteAt?: any;
};

async function loadUserVenues(venueIds: string[], uid: string): Promise<VenueRow[]> {
  const db = getFirestore();
  const results = await Promise.all(
    venueIds.map(async (id) => {
      try {
        const [venueSnap, memberSnap] = await Promise.all([
          getDoc(doc(db, 'venues', id)),
          getDoc(doc(db, 'venues', id, 'members', uid)),
        ]);
        if (!venueSnap.exists()) return null;
        const data = venueSnap.data() as any;
        return {
          id,
          name: data.name || 'Unnamed project',
          type: data.venueType || 'venue',
          role: memberSnap.exists() ? (memberSnap.data() as any).role ?? null : null,
          deletedAt: data.deletedAt ?? null,
          scheduledHardDeleteAt: data.scheduledHardDeleteAt ?? null,
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean) as VenueRow[];
}

function toMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

function recoveryCountdownText(scheduledHardDeleteAt: any): string {
  const msLeft = toMillis(scheduledHardDeleteAt) - Date.now();
  if (msLeft <= 0) return 'Recovery window expired';
  const hours = Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000)));
  return `Recoverable for ${hours} hour${hours !== 1 ? 's' : ''}`;
}

export default function VenueListScreen() {
  const nav = useNavigation<any>();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const { user, activeVenueId, venueIds, switchVenue } = useVenue();

  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleteConfirmVenue, setDeleteConfirmVenue] = useState<VenueRow | null>(null);
  const [deleteTypedName, setDeleteTypedName] = useState('');

  const refreshVenues = React.useCallback(async () => {
    if (!user || !venueIds || venueIds.length === 0) { setVenues([]); setLoading(false); return; }
    try {
      const rows = await loadUserVenues(venueIds, user.uid);
      setVenues(rows);
    } finally {
      setLoading(false);
    }
  }, [venueIds, user?.uid]);

  useEffect(() => {
    setLoading(true);
    refreshVenues();
  }, [refreshVenues]);

  async function doSwitch(venueId: string) {
    if (venueId === activeVenueId) return;
    setSwitching(venueId);
    try {
      await switchVenue(venueId);
      nav.navigate('HomeRouter');
    } catch {}
    setSwitching(null);
  }

  function handleSwitch(venue: VenueRow) {
    if (venue.id === activeVenueId) return;
    confirm({
      title: `Switch to "${venue.name}"?`,
      message: 'This will change your active project.',
      confirmLabel: 'Switch',
      onConfirm: () => doSwitch(venue.id),
    });
  }

  function handleLeave(venue: VenueRow) {
    confirm({
      title: `Leave "${venue.name}"?`,
      message: 'You will lose access to this project. You can be re-invited by an owner.',
      confirmLabel: 'Leave project',
      destructive: true,
      onConfirm: async () => {
        if (!user) return;
        setActing(venue.id);
        try {
          const db = getFirestore();
          await deleteDoc(doc(db, 'venues', venue.id, 'members', user.uid));
          await updateDoc(doc(db, 'users', user.uid), { venueIds: arrayRemove(venue.id) });
          if (activeVenueId === venue.id) {
            const remaining = venues.filter(v => v.id !== venue.id);
            if (remaining.length > 0) await switchVenue(remaining[0].id);
            else await updateDoc(doc(db, 'users', user.uid), { activeVenueId: null });
          }
        } catch (e: any) {
          showError(e?.message || 'Could not leave project. Please try again.');
        } finally {
          setActing(null);
        }
      },
    });
  }

  function handleDelete(venue: VenueRow) {
    confirm({
      title: `Delete "${venue.name}"?`,
      message: 'This permanently deletes the project and all its data. This cannot be undone.',
      confirmLabel: 'Delete project',
      destructive: true,
      onConfirm: () => {
        setDeleteTypedName('');
        setDeleteConfirmVenue(venue);
      },
    });
  }

  async function confirmDeletePermanently() {
    const venue = deleteConfirmVenue;
    if (!venue || !user || deleteTypedName !== venue.name) return;
    setDeleteConfirmVenue(null);
    setActing(venue.id);
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      const resp = await fetch(`${AI_BASE_URL}/api/deleteVenue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ venueId: venue.id }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || 'Delete failed');
      }
      // Soft-deleted server-side — venueIds stays as-is so it still surfaces
      // in "Recently deleted" until the recovery window closes or it's restored.
      if (activeVenueId === venue.id) {
        const remaining = venues.filter(v => v.id !== venue.id && !v.deletedAt);
        if (remaining.length > 0) await switchVenue(remaining[0].id);
        else await updateDoc(doc(getFirestore(), 'users', user.uid), { activeVenueId: null });
      }
      await refreshVenues();
      showInfo(`${venue.name} will be permanently deleted in 48 hours. You can restore it from My Projects until then.`);
    } catch (e: any) {
      showError(e?.message || 'Could not delete project. Please try again or contact support at office@hosti.co.nz.');
    } finally {
      setActing(null);
    }
  }

  async function handleRestore(venue: VenueRow) {
    if (!user) return;
    setRestoring(venue.id);
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      const resp = await fetch(`${AI_BASE_URL}/api/restoreVenue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ venueId: venue.id }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || 'Restore failed');
      }
      await refreshVenues();
      showSuccess(`${venue.name} restored.`);
    } catch (e: any) {
      showError(e?.message || 'Could not restore project. Please try again.');
    } finally {
      setRestoring(null);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  const activeVenues = venues.filter(v => !v.deletedAt);
  const recentlyDeleted = venues.filter(v => v.deletedAt && toMillis(v.scheduledHardDeleteAt) > Date.now());

  const sortedVenues = [...activeVenues].sort((a, b) => {
    const aActive = a.id === activeVenueId;
    const bActive = b.id === activeVenueId;
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (a.type !== b.type) return a.type === 'festival' ? 1 : -1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      {modal}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 4 }}>
          My Projects
        </Text>
        <Text style={{ fontSize: 14, color: c.slateMid, marginBottom: 20 }}>
          {activeVenues.length} project{activeVenues.length !== 1 ? 's' : ''}
        </Text>

        {activeVenues.length === 0 && (
          <Text style={{ fontSize: 14, color: c.slateMid, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
            No projects yet.{'\n'}Create your first venue or festival.
          </Text>
        )}

        {sortedVenues.map(venue => {
          const isActive = venue.id === activeVenueId;
          return (
            <View
              key={venue.id}
              style={{
                backgroundColor: isActive ? c.positiveSoft : c.surface,
                borderRadius: 14, padding: 16, marginBottom: 10,
                borderWidth: 1.5,
                borderColor: isActive ? c.success : c.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 28, marginRight: 12 }}>
                  {venue.type === 'festival' ? '🎪' : '🍺'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: c.navy, marginBottom: 2 }}>
                    {venue.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: c.slateMid }}>
                    {venue.type === 'festival' ? 'Festival' : 'Permanent venue'}
                    {venue.role ? ` · ${venue.role.charAt(0).toUpperCase() + venue.role.slice(1)}` : ''}
                  </Text>
                </View>
                {isActive && (
                  <View style={{
                    backgroundColor: c.success, borderRadius: 999,
                    paddingVertical: 4, paddingHorizontal: 10,
                  }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: c.surface }}>Active ✓</Text>
                  </View>
                )}
              </View>

              {!isActive && (
                <TouchableOpacity
                  style={{
                    marginTop: 12, backgroundColor: c.deepBlue, borderRadius: 999,
                    paddingVertical: 10, alignItems: 'center',
                  }}
                  onPress={() => handleSwitch(venue)}
                  disabled={switching === venue.id}
                >
                  {switching === venue.id
                    ? <ActivityIndicator color={c.surface} size="small" />
                    : <Text style={{ color: c.surface, fontWeight: '700', fontSize: 13 }}>
                        Switch to this project
                      </Text>
                  }
                </TouchableOpacity>
              )}

              {/* Owner: delete venue | Non-owner: leave venue */}
              {venue.role === 'owner' ? (
                <TouchableOpacity
                  style={{
                    marginTop: 8, borderWidth: 1.5, borderColor: c.error, borderRadius: 999,
                    paddingVertical: 8, alignItems: 'center', opacity: acting === venue.id ? 0.5 : 1,
                  }}
                  onPress={() => handleDelete(venue)}
                  disabled={acting === venue.id}
                >
                  {acting === venue.id
                    ? <ActivityIndicator color={c.error} size="small" />
                    : <Text style={{ color: c.error, fontWeight: '700', fontSize: 13 }}>Delete project</Text>
                  }
                </TouchableOpacity>
              ) : venue.role !== null ? (
                <TouchableOpacity
                  style={{
                    marginTop: 8, borderWidth: 1.5, borderColor: c.slateMid, borderRadius: 999,
                    paddingVertical: 8, alignItems: 'center', opacity: acting === venue.id ? 0.5 : 1,
                  }}
                  onPress={() => handleLeave(venue)}
                  disabled={acting === venue.id}
                >
                  {acting === venue.id
                    ? <ActivityIndicator color={c.slateMid} size="small" />
                    : <Text style={{ color: c.slateMid, fontWeight: '700', fontSize: 13 }}>Leave project</Text>
                  }
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        <TouchableOpacity
          style={{
            backgroundColor: c.oat, borderRadius: 14, padding: 16,
            marginTop: 4, alignItems: 'center', borderWidth: 1, borderColor: c.border,
          }}
          onPress={() => nav.navigate('CreateVenue')}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.deepBlue }}>
            + Add new project
          </Text>
        </TouchableOpacity>

        {recentlyDeleted.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.slateMid, marginBottom: 10 }}>
              Recently deleted
            </Text>
            {recentlyDeleted.map(venue => (
              <View
                key={venue.id}
                style={{
                  backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                  borderWidth: 1.5, borderColor: c.border, opacity: 0.85,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 28, marginRight: 12 }}>
                    {venue.type === 'festival' ? '🎪' : '🍺'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: c.navy, marginBottom: 2 }}>
                      {venue.name}
                    </Text>
                    <Text style={{ fontSize: 13, color: c.error }}>
                      {recoveryCountdownText(venue.scheduledHardDeleteAt)}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={{
                    marginTop: 12, backgroundColor: c.deepBlue, borderRadius: 999,
                    paddingVertical: 10, alignItems: 'center',
                  }}
                  onPress={() => handleRestore(venue)}
                  disabled={restoring === venue.id}
                >
                  {restoring === venue.id
                    ? <ActivityIndicator color={c.surface} size="small" />
                    : <Text style={{ color: c.surface, fontWeight: '700', fontSize: 13 }}>Restore</Text>
                  }
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!deleteConfirmVenue}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmVenue(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            padding: 24, paddingBottom: 40,
          }}>
            <View style={{
              width: 40, height: 4, backgroundColor: c.border, borderRadius: 2,
              alignSelf: 'center', marginBottom: 16,
            }} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: c.navy, marginBottom: 8 }}>
              Type the project name to confirm
            </Text>
            <Text style={{ fontSize: 14, color: c.error, marginBottom: 16, lineHeight: 20 }}>
              This cannot be undone. All data will be permanently deleted in 48 hours.
            </Text>
            <TextInput
              value={deleteTypedName}
              onChangeText={setDeleteTypedName}
              placeholder="Type the project name to confirm"
              placeholderTextColor={c.slateMid}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                borderWidth: 1.5, borderColor: c.border, borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.navy,
                marginBottom: 20, backgroundColor: c.background,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={{
                  flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1.5, borderColor: c.border,
                }}
                onPress={() => setDeleteConfirmVenue(null)}
              >
                <Text style={{ fontSize: 15, color: c.slateMid, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: c.error,
                  opacity: deleteConfirmVenue && deleteTypedName === deleteConfirmVenue.name ? 1 : 0.4,
                }}
                onPress={confirmDeletePermanently}
                disabled={!deleteConfirmVenue || deleteTypedName !== deleteConfirmVenue.name}
              >
                <Text style={{ fontSize: 15, color: c.surface, fontWeight: '700' }}>Delete permanently</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
