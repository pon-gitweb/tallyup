import React, { useEffect, useRef, useState } from 'react';
import './src/services/firebase';
import { auth, db } from './src/services/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ActivityIndicator, View } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import AuthNavigator from './src/navigation/AuthNavigator';
import { DEV_FORCE_SIGNOUT_ON_START } from './src/config/dev';
import { doc, getDoc } from 'firebase/firestore';
import { ensureDevAttachmentIfNeeded } from './src/services/devBootstrap';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [userHasVenue, setUserHasVenue] = useState<boolean | undefined>(undefined);
  const forced = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          await ensureDevAttachmentIfNeeded();
          const uSnap = await getDoc(doc(db, 'users', u.uid));
          setUserHasVenue(uSnap.exists() && !!(uSnap.data() as any)?.venueId);
        } catch {
          setUserHasVenue(false);
        }
      } else {
        setUserHasVenue(undefined);
      }
    });
    return unsub;
  }, []);

  // Dev: always show Login on first boot to avoid state confusion
  useEffect(() => {
    (async () => {
      if (DEV_FORCE_SIGNOUT_ON_START && !forced.current && user !== undefined) {
        forced.current = true;
        try { await signOut(auth); } catch {}
        setUser(null);
      }
    })();
  }, [user]);

  if (user === undefined) {
    return <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><ActivityIndicator/></View>;
  }
  if (!user) return <AuthNavigator />;

  // Signed-in: render the main app. If they have no venue yet,
  // the Dashboard will immediately redirect them to CreateVenue(origin:'app').
  return <AppNavigator />;
}
