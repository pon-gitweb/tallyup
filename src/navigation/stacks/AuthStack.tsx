// @ts-nocheck
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Your existing screens
import LoginScreen from '../../screens/auth/LoginScreen';
import RegisterScreen from '../../screens/auth/RegisterScreen';

const Stack = createNativeStackNavigator();

export default function AuthStack({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Register' }} />
      <Stack.Screen name="VenueSetup" component={require('../../screens/setup/SetupWizard').default} options={{ title: 'Setup Wizard' }} />
    </Stack.Navigator>
  );
}
