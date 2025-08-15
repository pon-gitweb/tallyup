import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

import LoginScreen from 'src/screens/auth/LoginScreen';
import RegisterScreen from 'src/screens/auth/RegisterScreen';
import VenueSetupScreen from 'src/screens/auth/VenueSetupScreen';

import AppNavigator from 'src/navigation/AppNavigator';

type UserProfile = { defaultVenueId?: string | null };

const AuthStack = createNativeStackNavigator();
const GateStack = createNativeStackNavigator();

function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: true }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="VenueSetup" component={VenueSetupScreen} options={{ title: 'Create Venue' }} />
    </AuthStack.Navigator>
  );
}

function Gate() {
  const auth = getAuth();
  const db = getFirestore();

  const [checked, setChecked] = useState(false);
  const [route, setRoute] = useState<'auth' | 'setup' | 'app'>('auth');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setRoute('auth');
        setChecked(true);
        return;
      }
      try {
        const userSnap = await getDoc(doc(db, 'users', u.uid));
        const profile = (userSnap.exists() ? userSnap.data() : {}) as UserProfile;
        const defaultVenueId = profile.defaultVenueId;

        if (!defaultVenueId) {
          setRoute('setup');
        } else {
          // verify membership exists
          const memberSnap = await getDoc(doc(db, 'venues', defaultVenueId, 'members', u.uid));
          setRoute(memberSnap.exists() ? 'app' : 'setup');
        }
      } catch {
        setRoute('setup');
      } finally {
        setChecked(true);
      }
    });
    return unsub;
  }, [auth, db]);

  if (!checked) return null;

  if (route === 'auth') return <AuthFlow />;
  if (route === 'setup') return (
    <GateStack.Navigator>
      <GateStack.Screen name="VenueSetup" component={VenueSetupScreen} options={{ title: 'Create Venue' }} />
    </GateStack.Navigator>
  );
  return <AppNavigator />;
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Gate />
    </NavigationContainer>
  );
}
