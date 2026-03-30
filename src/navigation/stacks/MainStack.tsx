// @ts-nocheck
import OrderEditorScreen from '../../screens/orders/OrderEditorScreen';
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

// Reports
import ReportsScreen from '../../screens/reports/ReportsScreen';
import DepartmentVarianceScreen from '../../screens/reports/DepartmentVarianceScreen';
import ReconciliationsScreen from '../../screens/reports/ReconciliationsScreen';
import VarianceSnapshotScreen from '../../screens/reports/VarianceSnapshotScreen';
import LastCycleSummaryScreen from '../../screens/reports/LastCycleSummaryScreen';
import BudgetsScreen from '../../screens/reports/BudgetsScreen';
import BudgetApprovalInboxScreen from '../../screens/orders/BudgetApprovalInboxScreen';
import ScaleSettingsScreen from '../../screens/settings/ScaleSettingsScreen';
import SetupGuideScreen from '../../screens/settings/SetupGuideScreen';

// Orders
import SuggestedOrderScreen from '../../screens/orders/SuggestedOrderScreen';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import NewOrderScreen from '../../screens/orders/NewOrderScreen';
import NewOrderStartScreen from '../../screens/orders/NewOrderStartScreen';
import OrderDetailScreen from '../../screens/orders/OrderDetailScreen';

// Products (setup area)
import ProductsScreen from '../../screens/setup/ProductsScreen';
import ProductsCsvImportScreen from '../../screens/setup/ProductsCsvImportScreen';
import EditProductScreen from '../../screens/setup/EditProductScreen';

const Stack = createNativeStackNavigator();

export default function MainStack() {
  return (
    <Stack.Navigator>
      {/* Home */}
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />

      {/* Stock-take */}
      <Stack.Screen
        name="DepartmentSelection"
        component={DepartmentSelection}
        options={{ title: 'Departments' }}
      />
      <Stack.Screen name="Areas" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      <Stack.Screen
        name="AreaInventory"
        component={StockTakeAreaInventoryScreen}
        options={{ title: 'Area Inventory' }}
      />

      {/* Control & settings */}
      <Stack.Screen
        name="StockControl"
        component={StockControlScreen}
        options={{ title: 'Stock Control' }}
      />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />

      {/* Products */}
      <Stack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
      <Stack.Screen name="ProductsCsvImport" component={ProductsCsvImportScreen} options={{ title: 'Import Products (CSV)' }} />
      <Stack.Screen
        name="EditProductScreen"
        component={EditProductScreen}
        options={{ title: 'Edit Product' }}
      />

      {/* Reports hub + detail */}
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen
        name="Reconciliations"
        component={ReconciliationsScreen}
        options={{ title: 'Invoice Reconciliations' }}
      />
      <Stack.Screen
        name="VarianceSnapshot"
        component={VarianceSnapshotScreen}
        options={{ title: 'Variance Snapshot' }}
      />
      <Stack.Screen
        name="LastCycleSummary"
        component={LastCycleSummaryScreen}
        options={{ title: 'Last Cycle Summary' }}
      />
      <Stack.Screen
        name="Budgets"
        component={BudgetsScreen}
        options={{ title: 'Budgets' }}
      />
      <Stack.Screen name="BudgetApprovalInbox" component={BudgetApprovalInboxScreen} options={{ title: 'Budget Approvals' }} />
      <Stack.Screen name="ScaleSettings" component={ScaleSettingsScreen} options={{ title: 'Bluetooth Scale' }} />
      <Stack.Screen name="SetupGuide" component={SetupGuideScreen} options={{ title: 'Setup Guide' }} />
      <Stack.Screen
        name="DepartmentVariance"
        component={DepartmentVarianceScreen}
        options={{ title: 'Department Variance' }}
      />

      {/* Orders */}
      <Stack.Screen
        name="SuggestedOrders"
        component={SuggestedOrderScreen}
        options={{ title: 'Suggested Orders' }}
      />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="NewOrder" component={NewOrderScreen} options={{ title: 'New Order' }} />
      <Stack.Screen
        name="NewOrderStart"
        component={NewOrderStartScreen}
        options={{ title: 'Choose Supplier' }}
      />
      <Stack.Screen
        name="OrderEditor"
        component={OrderEditorScreen}
        options={{ title: 'Edit Order' }}
      />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
    </Stack.Navigator>
  );
}
