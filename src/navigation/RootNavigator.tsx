// @ts-nocheck
import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AuthNavigator from './AuthNavigator';
import MainStack from './stacks/MainStack';
import AuthGate from './AuthGate';
import OfflineBanner from '../components/OfflineBanner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WelcomeBetaScreen from '../screens/WelcomeBetaScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: 'white' },
};

const WELCOME_STORAGE_KEY = 'tallyup_welcome_seen_v1';

function AuthedStack() {
  const [initialRoute, setInitialRoute] = React.useState(null); // 'WelcomeBeta' | 'Main' | null

  React.useEffect(() => {
    let isMounted = true;

    async function checkWelcome() {
      try {
        const seen = await AsyncStorage.getItem(WELCOME_STORAGE_KEY);
        if (!isMounted) return;
        setInitialRoute(seen ? 'Main' : 'WelcomeBeta');
      } catch (e) {
        console.warn('[RootNavigator] Failed to read welcome flag', e);
        if (!isMounted) return;
        // Fail open into the main app if storage is unhappy
        setInitialRoute('Main');
      }
    }

    checkWelcome();

    return () => {
      isMounted = false;
    };
  }, []);

  if (initialRoute == null) {
    // Lightweight placeholder while we decide the initial route.
    // You could render a tiny loading indicator if you want.
    return null;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {initialRoute === 'WelcomeBeta' && (
        <Stack.Screen name="WelcomeBeta" component={WelcomeBetaScreen} />
      )}
      <Stack.Screen name="Main" component={MainStack} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <OfflineBanner />
      <AuthGate
        renderAuthed={() => <AuthedStack />}
        renderUnauthed={() => (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Auth" component={AuthNavigator} />
          </Stack.Navigator>
        )}
      />
    </NavigationContainer>
  );
}
