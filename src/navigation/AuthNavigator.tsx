import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import SetupWizard from '../screens/setup/SetupWizard';
import CreateVenueScreen from '../screens/CreateVenueScreen';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  Setup: undefined;
  CreateVenue: { origin?: 'auth' } | undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator id={undefined as any}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create Account' }} />
      <Stack.Screen name="CreateVenue" component={CreateVenueScreen} options={{ title: 'Create your venue' }} />
      <Stack.Screen name="Setup" component={SetupWizard} options={{ title: 'Set up your venue', headerBackTitle: 'Back' }} />
    </Stack.Navigator>
  );
}
