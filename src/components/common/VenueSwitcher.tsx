// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Alert, View, Text, TouchableOpacity, Modal } from 'react-native';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useVenue } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';

type VenueOption = {
  id: string;
  name: string;
  type: string;
};

async function loadVenueOptions(venueIds: string[]): Promise<VenueOption[]> {
  const db = getFirestore();
  const results = await Promise.all(
    venueIds.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, 'venues', id));
        if (!snap.exists()) return null;
        return {
          id,
          name: (snap.data() as any).name || 'Unnamed venue',
          type: (snap.data() as any).venueType || 'venue',
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean) as VenueOption[];
}

const FESTIVAL_ONLY_SCREENS = [
  'FestivalPurchasingPrediction',
  'FestivalGoodsIn',
  'FestivalEndOfEventCount',
  'FestivalWeekReview',
  'FestivalStockOverview',
  'FestivalOpeningStock',
];

export function VenueSwitcher() {
  const { activeVenueId, venueIds, switchVenue } = useVenue();
  const c = useColours();
  const nav = useNavigation<any>();

  const currentRouteName = useNavigationState(
    state => state?.routes?.[state.index]?.name ?? ''
  );

  const [showPicker, setShowPicker] = useState(false);
  const [allVenues, setAllVenues] = useState<VenueOption[]>([]);
  const [currentName, setCurrentName] = useState('');

  useEffect(() => {
    if (!venueIds || venueIds.length <= 1) return;
    loadVenueOptions(venueIds).then(venues => {
      setAllVenues(venues);
      const active = venues.find(v => v.id === activeVenueId);
      if (active) setCurrentName(active.name);
    }).catch(() => {});
  }, [venueIds, activeVenueId]);

  if (!venueIds || venueIds.length <= 1) return null;

  return (
    <>
      <TouchableOpacity
        onPress={() => setShowPicker(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 4,
          backgroundColor: c.surface, borderRadius: 999,
          paddingVertical: 5, paddingHorizontal: 10,
          borderWidth: 1, borderColor: c.border,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.navy }} numberOfLines={1}>
          {currentName || '···'}
        </Text>
        <Text style={{ fontSize: 10, color: c.textSecondary }}>▾</Text>
      </TouchableOpacity>

      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          justifyContent: 'flex-end',
        }}>
          <View style={{
            backgroundColor: '#f5f3ee',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 20,
            paddingHorizontal: 16,
            paddingBottom: 48,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.15,
            shadowRadius: 8,
            elevation: 8,
          }}>
            <Text style={{
              fontSize: 17, fontWeight: '800', color: '#0B132B',
              marginBottom: 16, textAlign: 'center',
            }}>
              Switch workspace
            </Text>

            {allVenues.map(venue => (
              <TouchableOpacity
                key={venue.id}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: venue.id === activeVenueId ? '#dcfce7' : '#fff',
                  borderRadius: 12, padding: 14, marginBottom: 8,
                  borderWidth: 1.5,
                  borderColor: venue.id === activeVenueId ? '#16a34a' : '#e5e1d8',
                }}
                onPress={() => {
                  if (venue.id === activeVenueId) { setShowPicker(false); return; }
                  const isOnFestivalScreen = FESTIVAL_ONLY_SCREENS.includes(currentRouteName);
                  const switchingToNonFestival = venue.type !== 'festival';
                  if (isOnFestivalScreen && switchingToNonFestival) {
                    setShowPicker(false);
                    Alert.alert(
                      'Switch venue?',
                      `You are on a festival screen.\n\nSwitching to "${venue.name}" will leave this screen.\n\nAny unsaved changes will be lost.`,
                      [
                        { text: 'Stay here', style: 'cancel' },
                        { text: 'Switch anyway', onPress: async () => { try { await switchVenue(venue.id); } catch {} } },
                      ],
                    );
                    return;
                  }
                  setShowPicker(false);
                  switchVenue(venue.id).catch(() => {});
                }}
              >
                <Text style={{ fontSize: 24, marginRight: 12 }}>
                  {venue.type === 'festival' ? '🎪' : '🍺'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#0B132B' }}>
                    {venue.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>
                    {venue.type === 'festival' ? 'Festival' : 'Permanent venue'}
                  </Text>
                </View>
                {venue.id === activeVenueId && (
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#16a34a' }}>✓</Text>
                )}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={{
                backgroundColor: '#f3f4f6', borderRadius: 12,
                padding: 14, marginTop: 4, marginBottom: 4, alignItems: 'center',
              }}
              onPress={() => {
                setShowPicker(false);
                nav.navigate('CreateVenue');
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1b4f72' }}>
                + Add venue or event
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ padding: 14, alignItems: 'center' }}
              onPress={() => setShowPicker(false)}
            >
              <Text style={{ fontSize: 15, color: '#6b7280', fontWeight: '600' }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
