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
 * If no venue exists yet, sends the user to CreateVenueScreen.
 */
export default function HomeRouterScreen() {
  const nav = useNavigation<any>();
  const { loading, venueId, venueIds } = useVenue();
  const routed = useRef(false);

  // Fallback: if loading never resolves, route to MainTabs after 5s
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!routed.current) {
        console.warn('[HomeRouter] timeout — routing to MainTabs as fallback');
        routed.current = true;
        nav.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loading || routed.current) return;
    routed.current = true;

    if (!venueId) {
      if (venueIds && venueIds.length > 0) {
        // User has venues but activeVenueId not set yet — VenueProvider is auto-selecting.
        // Don't route yet; wait for the next context update with a resolved venueId.
        routed.current = false;
        return;
      }
      // Truly new user — no venue created yet. Send to venue creation.
      nav.reset({ index: 0, routes: [{ name: 'CreateVenue' }] });
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
