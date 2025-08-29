import { Text, TouchableOpacity, Button } from 'react-native';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Dashboards & stock
import DashboardScreen from '../../screens/DashboardScreen';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';

// Setup / settings / orders
import SettingsScreen from '../../screens/settings/SettingsScreen';
import SetupWizard from '../../screens/setup/SetupWizard';
import ReportsScreen from '../../screens/reports/ReportsScreen';
import LastCycleSummaryScreen from '../../screens/reports/LastCycleSummaryScreen';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import OrderDetailScreen from '../../screens/orders/OrderDetailScreen';
import SuggestedOrderScreen from '../../screens/orders/SuggestedOrderScreen';

// NEW report
import VarianceSnapshotScreen from '../../screens/reports/VarianceSnapshotScreen';

const Stack = createNativeStackNavigator();

export default function MainStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />

      {/* Stock take */}
      <Stack.Screen name="Departments" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
      <Stack.Screen name="Areas" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      <Stack.Screen name="AreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />

      {/* Setup / Settings */}
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="SetupWizard" component={SetupWizard} options={{ title: 'Setup Wizard' }} />

      {/* Orders */}
      <Stack.Screen name="SuggestedOrder" component={SuggestedOrderScreen} options={{ title: 'Suggested Orders' }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={({ navigation }) => ({ title: 'Orders', headerRight: () => (<Button title="New" onPress={() => navigation.navigate('NewOrder')} />) })} />
      <Stack.Screen name="NewOrder" component={require('../../screens/orders/NewOrderScreen').default} options={{ title: 'New Order' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order Detail' }} />

      {/* Reports */}
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="LastCycleSummary" component={LastCycleSummaryScreen} options={{ title: 'Last Cycle Summary' }} />
      <Stack.Screen name="VarianceSnapshot" component={VarianceSnapshotScreen} options={{ title: 'Variance Snapshot' }} />
      <Stack.Screen name="Suppliers" component={require('../../screens/setup/SuppliersScreen').default} options={{ title: 'Suppliers' }} />
      <Stack.Screen name="Products" component={require('../../screens/setup/ProductsScreen').default} options={{ title: 'Products' }} />
      <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
      <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />
      <Stack.Screen name="SupplierEdit" component={require('../../screens/setup/EditSupplierScreen').default} options={{ title: 'Edit Supplier' }} />
      <Stack.Screen name="ProductEdit" component={require('../../screens/setup/EditProductScreen').default} options={{ title: 'Edit Product' }} />
      <Stack.Screen name="VenueSetup" component={require('../../screens/setup/SetupWizard').default} options={{ title: 'Setup Wizard' }} />
    </Stack.Navigator>
  );
}
