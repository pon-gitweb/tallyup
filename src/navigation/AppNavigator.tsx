import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthGate from 'src/navigation/AuthGate';
import SignInScreen from 'src/screens/auth/SignInScreen';
import RegisterScreen from 'src/screens/auth/RegisterScreen';
import ExistingVenueDashboard from 'src/screens/dashboard/ExistingVenueDashboard';
import DepartmentSelectionScreen from 'src/screens/DepartmentSelectionScreen';
import AreaSelectionScreen from 'src/screens/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from 'src/screens/StockTakeAreaInventoryScreen'; // your existing file

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <AuthGate
      renderUnauthed={() => (
        <Stack.Navigator>
          <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Sign In' }} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Register' }} />
        </Stack.Navigator>
      )}
      renderAuthed={() => (
        <Stack.Navigator initialRouteName="ExistingVenueDashboard">
          <Stack.Screen name="ExistingVenueDashboard" component={ExistingVenueDashboard} options={{ title: 'Dashboard' }} />
          <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
          <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
          <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />
        </Stack.Navigator>
      )}
    />
  );
}
