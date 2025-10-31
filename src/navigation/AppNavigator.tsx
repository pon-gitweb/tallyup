// @ts-nocheck
import OrderEditorScreen from '../screens/orders/OrderEditorScreen';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DashboardScreen from '../screens/DashboardScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import StockControlScreen from '../screens/stock/StockControlScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';

// Orders
import SuggestedOrderScreen from '../screens/orders/SuggestedOrderScreen';
import OrdersScreen from '../screens/orders/OrdersScreen';
import NewOrderScreen from '../screens/orders/NewOrderScreen';
import NewOrderStartScreen from '../screens/orders/NewOrderStartScreen';
import OrderDetailScreen from '../screens/orders/OrderDetailScreen';

// Stock-take
import DepartmentSelection from '../screens/stock/DepartmentSelectionScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Stack.Screen name="DepartmentSelection" component={DepartmentSelection} options={{ title: 'Stock Take' }} />

      <Stack.Screen name="StockControl" component={StockControlScreen} options={{ title: 'Stock Control' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />

      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />

      <Stack.Screen name="SuggestedOrders" component={SuggestedOrderScreen} options={{ title: 'Suggested Orders' }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="NewOrder" component={NewOrderScreen} options={{ title: 'New Order' }} />
      <Stack.Screen name="NewOrderStart" component={NewOrderStartScreen} options={{ title: 'Choose Supplier' }} />
      <Stack.Screen name="OrderEditor" component={OrderEditorScreen} options={{ title: 'Edit Order' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
    </Stack.Navigator>
  );
}
