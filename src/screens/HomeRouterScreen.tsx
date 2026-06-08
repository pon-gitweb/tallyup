// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

  // Emergency last-resort fallback — the venue-doc fetch below has its own
  // 8s internal timeout, so this should never fire in practice. It exists
  // only to guarantee `loading` can never spin forever (10s > 8s getDoc bound).
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (routed.current) return;
      routed.current = true;
      let lastKnownType: string | null = null;
      try { lastKnownType = await AsyncStorage.getItem('lastKnownVenueType'); } catch {}
      console.warn('[HomeRouter] emergency fallback — routing to', lastKnownType === 'festival' ? 'FestivalDashboard' : 'MainTabs');
      nav.reset({ index: 0, routes: [{ name: lastKnownType === 'festival' ? 'FestivalDashboard' : 'MainTabs' }] });
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loading || routed.current) return;

    if (!venueId) {
      if (venueIds && venueIds.length > 0) {
        // User has venues but activeVenueId not set yet — VenueProvider is auto-selecting.
        // Don't route yet; wait for the next context update with a resolved venueId.
        return;
      }
      // Truly new user — no venue created yet. Send to venue creation.
      routed.current = true;
      nav.reset({ index: 0, routes: [{ name: 'CreateVenue' }] });
      return;
    }

    (async () => {
      // Bounded — if Firestore hangs, fall back to the cached venue type
      // instead of leaving the spinner up indefinitely.
      const venueSnap = await Promise.race([
        getDoc(doc(db, 'venues', venueId)),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);

      // Guard against double-navigation if the emergency fallback already routed
      if (routed.current) return;

      if (!venueSnap || !venueSnap.exists()) {
        let lastKnownType: string | null = null;
        try { lastKnownType = await AsyncStorage.getItem('lastKnownVenueType'); } catch {}
        routed.current = true;
        nav.reset({ index: 0, routes: [{ name: lastKnownType === 'festival' ? 'FestivalDashboard' : 'MainTabs' }] });
        return;
      }

      const vt = (venueSnap.data() as any)?.venueType;
      // Festival ONLY when explicitly set. null/undefined/anything-else → venue app.
      const destination = vt === 'festival' ? 'FestivalDashboard' : 'MainTabs';
      routed.current = true;
      nav.reset({ index: 0, routes: [{ name: destination }] });
    })().catch(() => {
      if (routed.current) return;
      routed.current = true;
      nav.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    });
  }, [loading, venueId]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#1b4f72" size="large" />
    </View>
  );
}
