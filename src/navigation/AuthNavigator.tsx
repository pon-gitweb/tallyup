import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import CreateVenueScreen from '../screens/CreateVenueScreen';

export type AuthStackParamList = {
  Login: undefined;
  CreateVenue: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="CreateVenue" component={CreateVenueScreen} options={{ headerShown: true, title: 'Create Venue' }} />
        <Stack.Screen name="VenueSetup" component={require('../screens/setup/SetupWizard').default} options={{ title: 'Setup Wizard' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
