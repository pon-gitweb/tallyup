import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged, getAuth } from 'firebase/auth';
import { db } from '../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

// Stacks (defined below)
import AuthStack from './stacks/AuthStack';
import SetupStack from './stacks/SetupStack';
import MainStack from './stacks/MainStack';

type Phase = 'loading' | 'auth' | 'setup' | 'main';

export default function RootNavigator() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (user) => {
      console.log('[TallyUp Gate] auth change', JSON.stringify({ uid: user?.uid || null }));
      if (!user) {
        setPhase('auth');
        return;
      }

      // Signed in → inspect user doc for venueId
      try {
        const uref = doc(db, 'users', user.uid);
        const usnap = await getDoc(uref);

        const venueId = usnap.exists() ? (usnap.data().venueId ?? null) : null;
        console.log('[TallyUp Gate] user doc', JSON.stringify({ exists: usnap.exists(), venueId }));

        if (!venueId) {
          // No venue yet → Setup stack (Create Venue)
          setPhase('setup');
          return;
        }

        // Has venueId → verify membership exists (or ownerUid fallback)
        const venueRef = doc(db, 'venues', venueId);
        const venueSnap = await getDoc(venueRef);
        if (!venueSnap.exists()) {
          // User doc points to a missing venue (rare) → treat as setup
          console.log('[TallyUp Gate] venue missing; redirecting to setup');
          setPhase('setup');
          return;
        }

        // Optional: quick membership presence check (not strictly required for gate)
        const ownerUid = venueSnap.data()?.ownerUid;
        const memberRef = doc(db, 'venues', venueId, 'members', user.uid);
        const memberSnap = await getDoc(memberRef);
        const hasMembership = memberSnap.exists() || ownerUid === user.uid;

        console.log('[TallyUp Gate] membership check', JSON.stringify({ hasMembership, owner: ownerUid === user.uid }));
        setPhase(hasMembership ? 'main' : 'setup');
      } catch (e: any) {
        console.log('[TallyUp Gate] error', JSON.stringify({ code: e?.code, message: e?.message }));
        // Fail-safe: do not block; let user proceed to setup if something odd happens
        setPhase('setup');
      }
    });
    return () => unsub();
  }, [refreshKey]);

  const content = useMemo(() => {
    if (phase === 'loading') {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      );
    }
    if (phase === 'auth') return <AuthStack onRefresh={() => setRefreshKey(k => k + 1)} />;
    if (phase === 'setup') return <SetupStack onRefresh={() => setRefreshKey(k => k + 1)} />;
    return <MainStack onRefresh={() => setRefreshKey(k => k + 1)} />;
  }, [phase]);

  return (
    <NavigationContainer>
      {content}
    </NavigationContainer>
  );
}
