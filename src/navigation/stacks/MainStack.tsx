import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Screens
import ExistingVenueDashboard from '../../screens/dashboard/ExistingVenueDashboard';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';
import SettingsScreen from '../../screens/settings/SettingsScreen';
import ReportsScreen from '../../screens/reports/ReportsScreen';
import LastCycleSummary from '../../screens/reports/LastCycleSummaryScreen';
import SetupWizard from '../../screens/setup/SetupWizard';
import SuppliersScreen from '../../screens/setup/SuppliersScreen';
import EditSupplierScreen from '../../screens/setup/EditSupplierScreen';
import ProductsScreen from '../../screens/setup/ProductsScreen';
import EditProductScreen from '../../screens/setup/EditProductScreen';
import SuggestedOrderScreen from '../../screens/orders/SuggestedOrderScreen';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import OrderDetailScreen from '../../screens/orders/OrderDetailScreen';

export type MainStackParamList = {
  Dashboard: undefined;
  Departments: undefined;
  Areas: { departmentId: string; departmentName?: string };
  AreaInventory: { departmentId: string; areaId: string; areaName?: string };
  Settings: undefined;
  Reports: undefined;
  LastCycleSummary: undefined;
  SetupWizard: undefined;

  Suppliers: undefined;
  SupplierEdit: { supplierId?: string | null; supplier?: any } | undefined;

  Products: undefined;
  ProductEdit: { productId?: string | null; product?: any } | undefined;

  SuggestedOrder: undefined;
  Orders: undefined;
  OrderDetail: { orderId: string };

  // Back-compat aliases
  VenueSetup: undefined;
  SetupVenue: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={ExistingVenueDashboard} options={{ title: 'Dashboard' }} />
      <Stack.Screen name="Departments" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
      <Stack.Screen name="Areas" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      <Stack.Screen name="AreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Area Inventory' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="LastCycleSummary" component={LastCycleSummary} options={{ title: 'Last Cycle Summary' }} />
      <Stack.Screen name="SetupWizard" component={SetupWizard} options={{ title: 'Setup' }} />
      <Stack.Screen name="Suppliers" component={SuppliersScreen} options={{ title: 'Suppliers' }} />
      <Stack.Screen name="SupplierEdit" component={EditSupplierScreen} options={{ title: 'Supplier' }} />
      <Stack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
      <Stack.Screen name="ProductEdit" component={EditProductScreen} options={{ title: 'Product' }} />
      <Stack.Screen name="SuggestedOrder" component={SuggestedOrderScreen} options={{ title: 'Suggested Orders' }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order Detail' }} />
      {/* Aliases */}
      <Stack.Screen name="VenueSetup" component={SetupWizard} options={{ headerShown: false }} />
      <Stack.Screen name="SetupVenue" component={SetupWizard} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
