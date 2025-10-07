// @ts-nocheck
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DashboardScreen from '../screens/DashboardScreen';
import OrdersScreen from '../screens/OrdersScreen';
import NewOrderStartScreen from '../screens/orders/NewOrderStartScreen';
import OrderEditorScreen from '../screens/orders/OrderEditorScreen';
import ReportsScreen from '../screens/ReportsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CreateVenueScreen from '../screens/CreateVenueScreen';

export type RootStackParamList = {
  Dashboard: undefined;
  Orders: undefined;
  NewOrderStart: undefined;
  OrderEditor: { orderId: string; supplierName?: string };
  Reports: undefined;
  Settings: undefined;
  CreateVenue: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="NewOrderStart" component={NewOrderStartScreen} options={{ title: 'New Order' }} />
      <Stack.Screen name="OrderEditor" component={OrderEditorScreen} options={{ title: 'Order Editor' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="CreateVenue" component={CreateVenueScreen} options={{ title: 'Create Venue' }} />
    </Stack.Navigator>
  );
}
