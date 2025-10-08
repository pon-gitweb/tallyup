// @ts-nocheck
import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AuthNavigator from './AuthNavigator';
import MainStack from './stacks/MainStack';
import AuthGate from './AuthGate';
import OfflineBanner from '../components/OfflineBanner';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: 'white' },
};

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <OfflineBanner />
      <AuthGate
        renderAuthed={() => (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Main" component={MainStack} />
          </Stack.Navigator>
        )}
        renderUnauthed={() => (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Auth" component={AuthNavigator} />
          </Stack.Navigator>
        )}
      />
    </NavigationContainer>
  );
}
