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

// Orders
import OrdersScreen from '../screens/orders/OrdersScreen';
import SuggestedOrderScreen from '../screens/orders/SuggestedOrderScreen';
// Use the header wrapper so Submit/Receive/Invoice buttons appear
import OrderDetailWithHeader from '../screens/orders/OrderDetailWithHeader';
import ReceiveAlias from '../screens/orders/ReceiveAlias';
import InvoiceScreen from '../screens/orders/InvoiceScreen';

export type AppStackParamList = {
  Dashboard: undefined;
  DepartmentSelection: { venueId: string; sessionId?: string };
  AreaSelection: { venueId: string; departmentId: string };
  StockTakeAreaInventory: { venueId: string; departmentId: string; areaId: string };
  Settings: undefined;
  Reports: undefined;
  CreateVenue: { origin?: 'auth' | 'app' } | undefined;
  VenueSetup: undefined;

  // Orders
  SuggestedOrders: undefined;
  Orders: undefined;
  OrderDetail: { orderId: string };
  Receive: { orderId: string };
  InvoiceEdit: { orderId: string; status?: string };
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
        <Stack.Screen name="OrderDetail" component={OrderDetailWithHeader} options={{ title: 'Order' }} />
        <Stack.Screen name="Receive" component={ReceiveAlias} options={{ title: 'Receive' }} />
        <Stack.Screen name="InvoiceEdit" component={InvoiceScreen} options={{ title: 'Invoice' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

