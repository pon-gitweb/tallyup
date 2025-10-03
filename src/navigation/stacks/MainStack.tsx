import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DashboardScreen from '../../screens/DashboardScreen';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';
import StockControlScreen from '../../screens/stock/StockControlScreen';

import SettingsScreen from '../../screens/settings/SettingsScreen';
import SetupWizard from '../../screens/setup/SetupWizard';

import ReportsScreen from '../../screens/reports/ReportsScreen';
import LastCycleSummaryScreen from '../../screens/reports/LastCycleSummaryScreen';

// NEW reports (registered once, no duplicates)
import ReportsIndexScreen from '../../screens/reports/ReportsIndexScreen';
import DepartmentVarianceScreen from '../../screens/reports/DepartmentVarianceScreen';
import CountActivityScreen from '../../screens/reports/CountActivityScreen';

// Existing extra report
import VarianceSnapshotScreen from '../../screens/reports/VarianceSnapshotScreen';

// Lazy/require screens kept as they were in your file
const InvoiceScreen = require('../../screens/orders/InvoiceScreen').default;
const ReceiveOrderScreen = require('../../screens/orders/ReceiveOrderScreen').default;
const SuggestedOrderScreen = require("../../screens/orders/SuggestedOrderScreen").default;
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
      {/* keep alias routes that other code may navigate to */}
      <Stack.Screen name="Areas" component={AreaSelectionScreen} options={{ title: 'Areas' }} />

      {/* Stock */}
      <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Area Inventory' }} />
      {/* alias kept */}
      <Stack.Screen name="AreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Area Inventory' }} />
      <Stack.Screen name="StockControl" component={StockControlScreen} options={{ title: 'Stock Control' }} />

      {/* Settings / Setup */}
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="SetupWizard" component={SetupWizard} options={{ title: 'Setup Wizard' }} />

      {/* Orders */}
      <Stack.Screen name="Invoice" component={InvoiceScreen} options={{ title: 'Invoice' }} />
      <Stack.Screen name="ReceiveOrder" component={ReceiveOrderScreen} options={{ title: 'Receive Order' }} />

      {/* Existing Reports entry points */}
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="LastCycleSummary" component={LastCycleSummaryScreen} options={{ title: 'Last Cycle Summary' }} />

      {/* NEW Reports suite (single registration each) */}
      <Stack.Screen name="ReportsIndex" component={ReportsIndexScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="DepartmentVariance" component={DepartmentVarianceScreen} options={{ title: 'Department Variance' }} />
      <Stack.Screen name="CountActivity" component={CountActivityScreen} options={{ title: 'Count Activity' }} />

      {/* Other report(s) you already had imported */}
      <Stack.Screen name="VarianceSnapshot" component={VarianceSnapshotScreen} options={{ title: 'Variance Snapshot' }} />

      {/* Setup data screens already required in this stack */}
      <Stack.Screen name="Budgets" component={BudgetsScreen} options={{ title: 'Budgets' }} />
      <Stack.Screen name="Suppliers" component={SuppliersScreen} options={{ title: 'Suppliers' }} />
      <Stack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
    </Stack.Navigator>
  );
}
