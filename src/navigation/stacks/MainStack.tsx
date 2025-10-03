import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

/** Core / Stock **/
import DashboardScreen from '../../screens/DashboardScreen';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';
import StockControlScreen from '../../screens/stock/StockControlScreen';

/** Settings / Setup **/
import SettingsScreen from '../../screens/settings/SettingsScreen';
import SetupWizard from '../../screens/setup/SetupWizard';

/** Reports (existing) **/
import ReportsScreen from '../../screens/reports/ReportsScreen';
import LastCycleSummaryScreen from '../../screens/reports/LastCycleSummaryScreen';
import VarianceSnapshotScreen from '../../screens/reports/VarianceSnapshotScreen';

/** Reports (new) **/
import ReportsIndexScreen from '../../screens/reports/ReportsIndexScreen';
import DepartmentVarianceScreen from '../../screens/reports/DepartmentVarianceScreen';
import CountActivityScreen from '../../screens/reports/CountActivityScreen';

/** Orders (require style kept to match project) **/
const InvoiceScreen = require('../../screens/orders/InvoiceScreen').default;
const ReceiveOrderScreen = require('../../screens/orders/ReceiveOrderScreen').default;
const OrdersScreen = require("../../screens/orders/OrdersScreen.tsx").default;
const SuggestedOrderScreen = require('../../screens/orders/SuggestedOrderScreen').default;

/** Data setup (require style as in project) **/
const BudgetsScreen = require('../../screens/reports/BudgetsScreen').default;
const SuppliersScreen = require('../../screens/setup/SuppliersScreen').default;
const ProductsScreen = require('../../screens/setup/ProductsScreen').default;

const Stack = createNativeStackNavigator();

export default function MainStack() {
  return (
    <Stack.Navigator>
      {/* Core app */}
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
      <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      {/* alias some legacy route names used across the app */}
      <Stack.Screen name="Areas" component={AreaSelectionScreen} options={{ title: 'Areas' }} />

      {/* Stock */}
      <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Area Inventory' }} />
      <Stack.Screen name="AreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Area Inventory' }} />
      <Stack.Screen name="StockControl" component={StockControlScreen} options={{ title: 'Stock Control' }} />

      {/* Settings / Setup */}
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="SetupWizard" component={SetupWizard} options={{ title: 'Setup Wizard' }} />

      {/* Orders */}
      <Stack.Screen name="Invoice" component={InvoiceScreen} options={{ title: 'Invoice' }} />
      <Stack.Screen name="ReceiveOrder" component={ReceiveOrderScreen} options={{ title: 'Receive Order' }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="SuggestedOrder" component={SuggestedOrderScreen} options={{ title: 'Suggested Order' }} />

      {/* Reports (existing) */}
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="LastCycleSummary" component={LastCycleSummaryScreen} options={{ title: 'Last Cycle Summary' }} />
      <Stack.Screen name="VarianceSnapshot" component={VarianceSnapshotScreen} options={{ title: 'Variance Snapshot' }} />

      {/* Reports (new) */}
      <Stack.Screen name="ReportsIndex" component={ReportsIndexScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="DepartmentVariance" component={DepartmentVarianceScreen} options={{ title: 'Department Variance' }} />
      <Stack.Screen name="CountActivity" component={CountActivityScreen} options={{ title: 'Count Activity' }} />

      {/* Data setup */}
      <Stack.Screen name="Budgets" component={BudgetsScreen} options={{ title: 'Budgets' }} />
      <Stack.Screen name="Suppliers" component={SuppliersScreen} options={{ title: 'Suppliers' }} />
      <Stack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
    </Stack.Navigator>
  );
}
