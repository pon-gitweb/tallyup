import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ExistingVenueDashboard from '../screens/dashboard/ExistingVenueDashboard';
import DepartmentSelectionScreen from '../screens/DepartmentSelectionScreen';
import AreaSelectionScreen from '../screens/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../screens/StockTakeAreaInventoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ReportsScreen from '../screens/ReportsScreen';
import CreateVenueScreen from '../screens/CreateVenueScreen';

// Orders / Suggested Orders (use the singular file)
import OrdersScreen from '../screens/orders/OrdersScreen';
import SuggestedOrderScreen from '../screens/orders/SuggestedOrderScreen';
import OrderDetailScreen from '../screens/orders/OrderDetailScreen';

export type AppStackParamList = {
  Dashboard: undefined;
  DepartmentSelection: { venueId: string; sessionId?: string };
  AreaSelection: { venueId: string; departmentId: string };
  StockTakeAreaInventory: { venueId: string; departmentId: string; areaId: string };
  Settings: undefined;
  Reports: undefined;
  CreateVenue: { origin?: 'auth' | 'app' } | undefined;

  // Orders
  SuggestedOrders: undefined;
  Orders: undefined;
  OrderDetail: { orderId: string };
};

const Stack = createNativeStackNavigator<AppStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Dashboard">
        <Stack.Screen name="Dashboard" component={ExistingVenueDashboard} options={{ headerShown: false }} />
        <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
        <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
        <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
        <Stack.Screen name="CreateVenue" component={CreateVenueScreen} options={{ title: 'Create Venue' }} />
        <Stack.Screen name="VenueSetup" component={require('../screens/setup/SetupWizard').default} options={{ title: 'Setup Wizard' }} />

        {/* Orders flow */}
        <Stack.Screen name="SuggestedOrders" component={SuggestedOrderScreen} options={{ title: 'Suggested Orders' }} />
        <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
        <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
