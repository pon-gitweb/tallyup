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
  const { loading, venueId, venueIds, user } = useVenue();
  const routed = useRef(false);

  // Emergency last-resort fallback — the venue-doc fetch below has its own
  // 8s internal timeout, so this should never fire in practice. It exists
  // only to guarantee `loading` can never spin forever (5s > most VenueProvider
  // iOS startup races, while still under the 8s getDoc bound it's backstopping).
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (routed.current) return;
      routed.current = true;
      let lastKnownType: string | null = null;
      let lastKnownVenueId: string | null = null;
      try {
        [lastKnownType, lastKnownVenueId] = await Promise.all([
          AsyncStorage.getItem('lastKnownVenueType'),
          AsyncStorage.getItem('lastKnownVenueId'),
        ]);
      } catch {}
      console.warn('[HomeRouter] emergency fallback — routing to', lastKnownType === 'festival' ? 'FestivalDashboard' : 'MainTabs');
      // If we have a last known venueId, set it directly so the dashboard has context
      if (lastKnownVenueId) {
        try {
          const { getFirestore, doc, updateDoc } = await import('firebase/firestore');
          const { getAuth } = await import('firebase/auth');
          const auth = getAuth();
          if (auth.currentUser) {
            await updateDoc(doc(getFirestore(), 'users', auth.currentUser.uid), {
              activeVenueId: lastKnownVenueId,
            });
          }
        } catch {}
      }
      nav.reset({ index: 0, routes: [{ name: lastKnownType === 'festival' ? 'FestivalDashboard' : 'MainTabs' }] });
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loading || routed.current) return;

    (async () => {
      // Only require verification for accounts created after email verification
      // was introduced. Existing users (no flag) pass through.
      if (user && !user.emailVerified) {
        try {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          const requiresVerification = userSnap.data()?.requiresEmailVerification === true;
          if (requiresVerification) {
            if (routed.current) return;
            routed.current = true;
            nav.reset({ index: 0, routes: [{ name: 'EmailVerification' }] });
            return;
          }
          // Flag not set = existing user — fall through to normal routing
        } catch (e) {
          // If doc read fails — don't block, fall through to normal routing
          console.warn('[HomeRouter] could not check verification flag:', e);
        }
      }

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
  }, [loading, venueId, user]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#1b4f72" size="large" />
    </View>
  );
}
