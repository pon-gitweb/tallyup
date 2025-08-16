import React, { useEffect, useState } from 'react';
import AppNavigator from './src/navigation/AppNavigator';
import './src/services/firebase';
import { auth } from './src/services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { View, ActivityIndicator } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';
import NetStatusBanner from './src/components/NetStatusBanner';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);

  if (user === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <NetStatusBanner />
      </View>
    );
  }

  if (!user) {
    return (
      <>
        <LoginScreen />
        <NetStatusBanner />
      </>
    );
  }

  return (
    <>
      <AppNavigator />
      <NetStatusBanner />
    </>
  );
}
