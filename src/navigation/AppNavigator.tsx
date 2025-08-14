import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DashboardScreen from '../screens/DashboardScreen';
import DepartmentSelectionScreen from '../screens/DepartmentSelectionScreen';
import AreaSelectionScreen from '../screens/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../screens/StockTakeAreaInventoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ReportsScreen from '../screens/ReportsScreen';

export type RootStackParamList = {
  Dashboard: undefined;
  DepartmentSelection: { venueId: string; sessionId: string };
  AreaSelection: { venueId: string; sessionId: string; departmentId: string };
  StockTakeAreaInventory: { venueId: string; sessionId: string; departmentId: string; areaName: string };
  Settings: undefined;
  Reports: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Dashboard" screenOptions={{ headerShown: true }}>
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
        <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
        <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
        <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Reports" component={ReportsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
