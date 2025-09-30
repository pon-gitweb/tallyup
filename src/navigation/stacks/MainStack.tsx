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
import ReportsIndexScreen from "../../screens/reports/ReportsIndexScreen";
import DepartmentVarianceScreen from "../../screens/reports/DepartmentVarianceScreen";
import CountActivityScreen from "../../screens/reports/CountActivityScreen";
import VarianceSnapshotScreen from '../../screens/reports/VarianceSnapshotScreen';

const InvoiceScreen = require('../../screens/orders/InvoiceScreen').default;
const ReceiveOrderScreen = require('../../screens/orders/ReceiveOrderScreen').default;
const BudgetsScreen = require('../../screens/reports/BudgetsScreen').default;
const SuppliersScreen = require('../../screens/setup/SuppliersScreen').default;
const ProductsScreen = require('../../screens/setup/ProductsScreen').default;

const Stack = createNativeStackNavigator();

export default function MainStack() {
  const routes = [
    { name: 'Dashboard', component: DashboardScreen, options: { title: 'Dashboard' } },
    { name: 'DepartmentSelection', component: DepartmentSelectionScreen, options: { title: 'Departments' } },
    { name: 'AreaSelection', component: AreaSelectionScreen, options: { title: 'Areas' } },
    { name: 'Areas', component: AreaSelectionScreen, options: { title: 'Areas' } },
    { name: 'StockTakeAreaInventory', component: StockTakeAreaInventoryScreen, options: { title: 'Area Inventory' } },
    { name: 'AreaInventory', component: StockTakeAreaInventoryScreen, options: { title: 'Area Inventory' } },
    { name: 'StockControl', component: StockControlScreen, options: { title: 'Stock Control' } },

    { name: 'Settings', component: SettingsScreen, options: { title: 'Settings' } },
    { name: 'SetupWizard', component: SetupWizard, options: { title: 'Setup Wizard' } },

    { name: 'Invoice', component: InvoiceScreen, options: { title: 'Invoice' } },
    { name: 'ReceiveOrder', component: ReceiveOrderScreen, options: { title: 'Receive Order' } },

    { name: 'Reports', component: ReportsScreen, options: { title: 'Reports' } },
    { name: 'LastCycleSummary', component: LastCycleSummaryScreen, options: { title: 'Last Cycle Summary' } },
    { name: 'ReportsIndex', component: ReportsIndexScreen, options: { title: 'Reports' } },
    { name: 'DepartmentVariance', component: DepartmentVarianceScreen, options: { title: 'Department Variance' } },
    { name: 'CountActivity', component: CountActivityScreen, options: { title: 'Count Activity' } },
    { name: 'VarianceSnapshot', component: VarianceSnapshotScreen, options: { title: 'Variance Snapshot' } },
    { name: 'DepartmentVariance', component: DepartmentVarianceScreen, options: { title: 'Department Variance' } },
    { name: 'Budgets', component: BudgetsScreen, options: { title: 'Budgets' } },
    { name: 'Suppliers', component: SuppliersScreen, options: { title: 'Suppliers' } },
    { name: 'Products', component: ProductsScreen, options: { title: 'Products' } },
  ] as const;

  return (
    <Stack.Navigator>
      {routes.map(r => (
        <Stack.Screen key={r.name} name={r.name as string} component={r.component as any} options={r.options as any} />
      ))}
    </Stack.Navigator>
  );
}
