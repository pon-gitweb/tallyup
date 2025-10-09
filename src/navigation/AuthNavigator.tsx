// @ts-nocheck
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import CreateVenueScreen from '../screens/CreateVenueScreen';

export type AuthStackParamList = {
  Login: undefined;
  CreateVenue: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * NOTE: No <NavigationContainer/> here.
 * RootNavigator owns the single app-wide container.
 */
export default function AuthNavigator() {
  return (
    <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen
        name="CreateVenue"
        component={CreateVenueScreen}
        options={{ headerShown: true, title: 'Create Venue' }}
      />
      {/* SetupWizard is referenced dynamically in the old file; keep it if you use it */}
      <Stack.Screen
        name="VenueSetup"
        component={require('../screens/setup/SetupWizard').default}
        options={{ title: 'Setup Wizard' }}
      />
    </Stack.Navigator>
  );
}
