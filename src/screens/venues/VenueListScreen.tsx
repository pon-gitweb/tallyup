// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
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
        return {
          id,
          name: (venueSnap.data() as any).name || 'Unnamed venue',
          type: (venueSnap.data() as any).venueType || 'venue',
          role: memberSnap.exists() ? (memberSnap.data() as any).role ?? null : null,
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean) as VenueRow[];
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

  useEffect(() => {
    if (!user || !venueIds || venueIds.length === 0) { setLoading(false); return; }
    loadUserVenues(venueIds, user.uid).then(rows => {
      setVenues(rows);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [venueIds, user?.uid]);

  async function doSwitch(venueId: string) {
    if (venueId === activeVenueId) return;
    setSwitching(venueId);
    try { await switchVenue(venueId); } catch {}
    setSwitching(null);
  }

  function handleSwitch(venue: VenueRow) {
    if (venue.id === activeVenueId) return;
    confirm({
      title: `Switch to "${venue.name}"?`,
      message: 'This will change your active venue.',
      confirmLabel: 'Switch',
      onConfirm: () => doSwitch(venue.id),
    });
  }

  function handleLeave(venue: VenueRow) {
    confirm({
      title: `Leave "${venue.name}"?`,
      message: 'You will lose access to this venue. You can be re-invited by an owner.',
      confirmLabel: 'Leave venue',
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
          showError(e?.message || 'Could not leave venue. Please try again.');
        } finally {
          setActing(null);
        }
      },
    });
  }

  function handleDelete(venue: VenueRow) {
    confirm({
      title: `Delete "${venue.name}"?`,
      message: 'This permanently deletes the venue and all its data. This cannot be undone.',
      confirmLabel: 'Delete venue',
      destructive: true,
      onConfirm: async () => {
        if (!user) return;
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
          const db = getFirestore();
          await updateDoc(doc(db, 'users', user.uid), { venueIds: arrayRemove(venue.id) });
          if (activeVenueId === venue.id) {
            const remaining = venues.filter(v => v.id !== venue.id);
            if (remaining.length > 0) await switchVenue(remaining[0].id);
            else await updateDoc(doc(db, 'users', user.uid), { activeVenueId: null });
          }
        } catch (e: any) {
          showError(e?.message || 'Could not delete venue. Please try again or contact support at office@hosti.co.nz.');
        } finally {
          setActing(null);
        }
      },
    });
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  const sortedVenues = [...venues].sort((a, b) => {
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
          {venues.length} workspace{venues.length !== 1 ? 's' : ''}
        </Text>

        {venues.length === 0 && (
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
                        Switch to this venue
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
                    : <Text style={{ color: c.error, fontWeight: '700', fontSize: 13 }}>Delete venue</Text>
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
                    : <Text style={{ color: c.slateMid, fontWeight: '700', fontSize: 13 }}>Leave venue</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}
