// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useVenue } from '../context/VenueProvider';

/**
 * Invisible routing screen shown immediately after auth.
 * Reads venueType from the venue doc and resets the stack to
 * FestivalDashboard (festival) or MainTabs (all other types).
 */
export default function HomeRouterScreen() {
  const nav = useNavigation<any>();
  const { loading, venueId } = useVenue();
  const routed = useRef(false);

  useEffect(() => {
    if (loading || routed.current) return;
    routed.current = true;

    if (!venueId) {
      nav.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      return;
    }

    getDoc(doc(db, 'venues', venueId))
      .then(snap => {
        const vt = snap.exists() ? (snap.data() as any)?.venueType : null;
        nav.reset({
          index: 0,
          routes: [{ name: vt === 'festival' ? 'FestivalDashboard' : 'MainTabs' }],
        });
      })
      .catch(() => {
        nav.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      });
  }, [loading, venueId]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#1b4f72" size="large" />
    </View>
  );
}
