// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useVenue } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';

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
