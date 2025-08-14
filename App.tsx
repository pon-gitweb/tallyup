import React, { useEffect, useState } from 'react';
import AppNavigator from './src/navigation/AppNavigator';
import './src/services/firebase'; // ensure Firebase side-effects run
import { auth } from './src/services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { View, ActivityIndicator } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);

  if (user === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <AppNavigator />;
}
