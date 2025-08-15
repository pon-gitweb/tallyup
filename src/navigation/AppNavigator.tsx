import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../services/firebase';

// Screens
import AuthEntryScreen from '../screens/auth/AuthEntryScreen';
import CreateVenueScreen from '../screens/onboarding/CreateVenueScreen';
import ExistingVenueDashboard from '../screens/dashboard/ExistingVenueDashboard';
import DepartmentSelectionScreen from '../screens/DepartmentSelectionScreen';
import AreaSelectionScreen from '../screens/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../screens/StockTakeAreaInventoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ReportsScreen from '../screens/ReportsScreen';
import LastCycleSummaryScreen from '../screens/reports/LastCycleSummaryScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [user, setUser] = useState<User | null>(auth.currentUser ?? null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
    return unsub;
  }, []);

  if (!ready) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: true }}>
        {!user ? (
          <>
            <Stack.Screen name="AuthEntry" component={AuthEntryScreen} options={{ title: 'Sign In' }} />
            <Stack.Screen name="OnboardingCreateVenue" component={CreateVenueScreen} options={{ title: 'Create Venue' }} />
          </>
        ) : (
          <>
            <Stack.Screen name="ExistingVenueDashboard" component={ExistingVenueDashboard} options={{ title: 'Dashboard' }} />
            <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
            <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
            <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Reports" component={ReportsScreen} />
            <Stack.Screen name="LastCycleSummary" component={LastCycleSummaryScreen} options={{ title: 'Last Completed Cycle' }} />
            <Stack.Screen name="OnboardingCreateVenue" component={CreateVenueScreen} options={{ title: 'Create Venue' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
