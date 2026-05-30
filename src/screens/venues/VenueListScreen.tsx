// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, deleteDoc, updateDoc, arrayRemove } from 'firebase/firestore';
import { useVenue } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
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

  async function handleSwitch(venueId: string) {
    if (venueId === activeVenueId) return;
    setSwitching(venueId);
    try { await switchVenue(venueId); } catch {}
    setSwitching(null);
  }

  async function handleLeave(venue: VenueRow) {
    Alert.alert(
      `Leave "${venue.name}"?`,
      'You will lose access to this venue. You can be re-invited by an owner.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave venue', style: 'destructive',
          onPress: async () => {
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
              Alert.alert('Error', e?.message || 'Could not leave venue. Please try again.');
            } finally {
              setActing(null);
            }
          },
        },
      ],
    );
  }

  async function handleDelete(venue: VenueRow) {
    Alert.alert(
      `Delete "${venue.name}"?`,
      'This permanently deletes the venue and all its data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete venue', style: 'destructive',
          onPress: async () => {
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
              Alert.alert('Error', e?.message || 'Could not delete venue. Please try again or contact support at office@hosti.co.nz.');
            } finally {
              setActing(null);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 }}>
          My venues
        </Text>
        <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
          {venues.length} workspace{venues.length !== 1 ? 's' : ''}
        </Text>

        {venues.map(venue => {
          const isActive = venue.id === activeVenueId;
          return (
            <View
              key={venue.id}
              style={{
                backgroundColor: isActive ? '#dcfce7' : '#fff',
                borderRadius: 14, padding: 16, marginBottom: 10,
                borderWidth: 1.5,
                borderColor: isActive ? '#16a34a' : '#e5e1d8',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 28, marginRight: 12 }}>
                  {venue.type === 'festival' ? '🎪' : '🍺'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 2 }}>
                    {venue.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#6b7280' }}>
                    {venue.type === 'festival' ? 'Festival' : 'Permanent venue'}
                    {venue.role ? ` · ${venue.role.charAt(0).toUpperCase() + venue.role.slice(1)}` : ''}
                  </Text>
                </View>
                {isActive && (
                  <View style={{
                    backgroundColor: '#16a34a', borderRadius: 999,
                    paddingVertical: 4, paddingHorizontal: 10,
                  }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>Active ✓</Text>
                  </View>
                )}
              </View>

              {!isActive && (
                <TouchableOpacity
                  style={{
                    marginTop: 12, backgroundColor: '#1b4f72', borderRadius: 999,
                    paddingVertical: 10, alignItems: 'center',
                  }}
                  onPress={() => handleSwitch(venue.id)}
                  disabled={switching === venue.id}
                >
                  {switching === venue.id
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                        Switch to this venue
                      </Text>
                  }
                </TouchableOpacity>
              )}

              {/* Owner: delete venue | Non-owner: leave venue */}
              {venue.role === 'owner' ? (
                <TouchableOpacity
                  style={{
                    marginTop: 8, borderWidth: 1.5, borderColor: '#dc2626', borderRadius: 999,
                    paddingVertical: 8, alignItems: 'center', opacity: acting === venue.id ? 0.5 : 1,
                  }}
                  onPress={() => handleDelete(venue)}
                  disabled={acting === venue.id}
                >
                  {acting === venue.id
                    ? <ActivityIndicator color="#dc2626" size="small" />
                    : <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 13 }}>Delete venue</Text>
                  }
                </TouchableOpacity>
              ) : venue.role !== null ? (
                <TouchableOpacity
                  style={{
                    marginTop: 8, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 999,
                    paddingVertical: 8, alignItems: 'center', opacity: acting === venue.id ? 0.5 : 1,
                  }}
                  onPress={() => handleLeave(venue)}
                  disabled={acting === venue.id}
                >
                  {acting === venue.id
                    ? <ActivityIndicator color="#6b7280" size="small" />
                    : <Text style={{ color: '#6b7280', fontWeight: '700', fontSize: 13 }}>Leave venue</Text>
                  }
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        <TouchableOpacity
          style={{
            backgroundColor: '#f3f4f6', borderRadius: 14, padding: 16,
            marginTop: 4, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8',
          }}
          onPress={() => nav.navigate('CreateVenue')}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#1b4f72' }}>
            + Add new venue or event
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
