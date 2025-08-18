import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Your existing screen
import CreateVenueScreen from '../../screens/CreateVenueScreen';

const Stack = createNativeStackNavigator();

export default function SetupStack({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="CreateVenue"
        component={CreateVenueScreen}
        options={{ title: 'Create Venue' }}
      />
    </Stack.Navigator>
  );
}
