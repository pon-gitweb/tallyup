import { Text, TouchableOpacity, Button } from 'react-native';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Dashboards & stock
import DashboardScreen from '../../screens/DashboardScreen';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';
import StockControlScreen from '../../screens/stock/StockControlScreen';

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

// Adjustments
import AdjustmentInboxScreen from '../../screens/adjustments/AdjustmentInboxScreen';
import AdjustmentDetailScreen from '../../screens/adjustments/AdjustmentDetailScreen';

// V2 dev-only preview (guarded)
import { ENABLE_V2_THEME } from '../../flags/v2Brand';
import AboutScreen from '../../screens/AboutScreen';

const Stack = createNativeStackNavigator();

export default function MainStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />

      {/* Stock take */}
      <Stack.Screen name="Departments" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
      <Stack.Screen name="Areas" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      <Stack.Screen name="AreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />

      {/* Stock control */}
      <Stack.Screen name="StockControl" component={StockControlScreen} options={{ title: 'Stock Control' }} />

      {/* Setup / Settings */}
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="SetupWizard" component={SetupWizard} options={{ title: 'Setup Wizard' }} />

      {/* Orders */}
      <Stack.Screen name="SuggestedOrder" component={SuggestedOrderScreen} options={{ title: 'Suggested Orders' }} />
      <Stack.Screen
        name="Orders"
        component={OrdersScreen}
        options={({ navigation }) => ({
          title: 'Orders',
          headerRight: () => (<Button title="New" onPress={() => navigation.navigate('NewOrder')} />)
        })}
      />
      <Stack.Screen name="NewOrder" component={require('../../screens/orders/NewOrderScreen').default} options={{ title: 'New Order' }} />
      <Stack.Screen
        name="OrderDetail"
        component={require('../../screens/orders/OrderDetailScreen.withHeader').default}
        options={({ route, navigation }) => ({
          title: 'Order Detail',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate("InvoiceEdit" as never, { orderId: (route.params as any)?.orderId, status: (route.params as any)?.status } as never)}
              style={{ paddingHorizontal: 12 }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600" }}>
                {((route.params as any)?.status === "received") ? "Log Invoice" : "Invoice"}
              </Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen name="Invoice" component={require('../../screens/orders/InvoiceScreen').default} options={{ title: 'Invoice' }} />
      <Stack.Screen name="ReceiveOrder" component={require('../../screens/orders/ReceiveOrderScreen').default} options={{ title: 'Receive Order' }} />

      {/* Reports */}
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={({navigation}) => ({
          title: 'Reports',
          headerRight: () => (<Text onPress={() => navigation.navigate('Budgets')} style={{color:'#0A84FF',fontWeight:'800'}}>Budgets</Text>)
        })}
      />
      <Stack.Screen name="LastCycleSummary" component={LastCycleSummaryScreen} options={{ title: 'Last Cycle Summary' }} />
      <Stack.Screen name="VarianceSnapshot" component={VarianceSnapshotScreen} options={{ title: 'Variance Snapshot' }} />
      <Stack.Screen name="Budgets" component={require('../../screens/reports/BudgetsScreen').default} options={{ title: 'Budgets' }} />
      <Stack.Screen name="Suppliers" component={require('../../screens/setup/SuppliersScreen').default} options={{ title: 'Suppliers' }} />
      <Stack.Screen name="Products" component={require('../../screens/setup/ProductsScreen').default} options={{ title: 'Products' }} />
      <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} options={{ title: 'Departments' }} />
      <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} options={{ title: 'Areas' }} />
      <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />
      <Stack.Screen name="SupplierEdit" component={require('../../screens/setup/EditSupplierScreen').default} options={{ title: 'Edit Supplier' }} />
      <Stack.Screen name="ProductEdit" component={require('../../screens/setup/EditProductScreen').default} options={{ title: 'Edit Product' }} />
      <Stack.Screen name="VenueSetup" component={require('../../screens/setup/SetupWizard').default} options={{ title: 'Setup Wizard' }} />
      <Stack.Screen name="InvoiceEdit" component={require("../../screens/invoices/InvoiceEditScreen").default} options={{ title: "Invoice" }} />
      <Stack.Screen name="Receive" component={require("../../screens/orders/ReceiveAlias").default} options={{ title: "Receive" }} />

      {/* Adjustments */}
      <Stack.Screen name="Adjustments" component={AdjustmentInboxScreen} options={{ title: 'Adjustments' }} />
      <Stack.Screen name="AdjustmentDetail" component={AdjustmentDetailScreen} options={{ title: 'Adjustment Detail' }} />

      {/* Dev-only: only visible when both dev mode and flag are on */}
      {__DEV__ && ENABLE_V2_THEME ? (
        <>
          <Stack.Screen name="DevAbout" component={AboutScreen} options={{ title: 'About (Dev)' }} />
          <Stack.Screen name="DevTerms" component={require('../../screens/legal/TermsScreen').default} options={{ title: 'Terms (Dev)' }} />
          <Stack.Screen name="DevPrivacy" component={require('../../screens/legal/PrivacyScreen').default} options={{ title: 'Privacy (Dev)' }} />
        </>
      ) : null}
    </Stack.Navigator>
  );
}
