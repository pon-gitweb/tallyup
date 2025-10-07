// @ts-nocheck
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Core
import DashboardScreen from '../../screens/DashboardScreen';

// Stock-take
import DepartmentSelection from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';

// Control & settings
import StockControlScreen from '../../screens/stock/StockControlScreen';
import SettingsScreen from '../../screens/settings/SettingsScreen';

// Reports (compat wrapper → your hub)
import ReportsScreen from '../../screens/reports/ReportsScreen';

// Orders
import SuggestedOrderScreen from '../../screens/orders/SuggestedOrderScreen';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import NewOrderScreen from '../../screens/orders/NewOrderScreen';
import NewOrderStartScreen from '../../screens/orders/NewOrderStartScreen';
import OrderDetailScreen from '../../screens/orders/OrderDetailScreen';

const Stack = createNativeStackNavigator();

export default function MainStack() {
  return (
    <Stack.Navigator>
      {/* Home */}
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />

      {/* Stock-take */}
      <Stack.Screen name="DepartmentSelection" component={DepartmentSelection} options={{ title: 'Departments' }} />
      {/* IMPORTANT: use your existing Areas screen + original route names */}
      <Stack.Screen name="Areas" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      <Stack.Screen name="AreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Area Inventory' }} />

      {/* Control & settings */}
      <Stack.Screen name="StockControl" component={StockControlScreen} options={{ title: 'Stock Control' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />

      {/* Reports */}
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />

      {/* Orders */}
      <Stack.Screen name="SuggestedOrders" component={SuggestedOrderScreen} options={{ title: 'Suggested Orders' }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="NewOrder" component={NewOrderScreen} options={{ title: 'New Order' }} />
      <Stack.Screen name="NewOrderStart" component={NewOrderStartScreen} options={{ title: 'Choose Supplier' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
    </Stack.Navigator>
  );
}
