// @ts-nocheck
import OrderEditorScreen from '../../screens/orders/OrderEditorScreen';
import React from 'react';
import { View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import IzzyAssistant from '../../components/IzzyAssistant';

// Core
import DashboardScreen from '../../screens/DashboardScreen';

// Stock-take
import DepartmentSelection from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';

// Control & settings
import StockControlScreen from '../../screens/stock/StockControlScreen';
import SettingsScreen from '../../screens/settings/SettingsScreen';
import TeamMembersScreen from '../../screens/settings/TeamMembersScreen';
import AcceptInviteScreen from '../../screens/auth/AcceptInviteScreen';

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
import AppearanceScreen from '../../screens/settings/AppearanceScreen';
import AdvancedSettingsScreen from '../../screens/settings/AdvancedSettingsScreen';
import PricingScreen from '../../screens/settings/PricingScreen';
import TermsScreen from '../../screens/settings/TermsScreen';
import XeroScreen from '../../screens/settings/XeroScreen';
import ReportPreferencesScreen from '../../screens/settings/ReportPreferencesScreen';
import AiUsageScreen from '../../screens/settings/AiUsageScreen';
import InventoryImportScreen from '../../screens/onboarding/InventoryImportScreen';
import InventoryImportPreviewScreen from '../../screens/onboarding/InventoryImportPreviewScreen';
import OnboardingRoadScreen from '../../screens/onboarding/OnboardingRoadScreen';
import FreshStartScreen from '../../screens/onboarding/FreshStartScreen';
import BringYourDataScreen from '../../screens/onboarding/BringYourDataScreen';
import { FEATURES } from '../../config/features';
import StocktakeSummaryScreen from '../../screens/stock/StocktakeSummaryScreen';
import SupplierDashboardScreen from '../../screens/supplier/SupplierDashboardScreen';
import SupplierCatalogueScreen from '../../screens/supplier/SupplierCatalogueScreen';
import SupplierOrdersScreen from '../../screens/supplier/SupplierOrdersScreen';
import SupplierSpecialsScreen from '../../screens/supplier/SupplierSpecialsScreen';

// Adjustments
import AdjustmentInboxScreen from '../../screens/adjustments/AdjustmentInboxScreen';

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
import SuppliersScreen from '../../screens/setup/SuppliersScreen';

const Stack = createNativeStackNavigator();

export default function MainStack() {
  return (
    <View style={{ flex: 1 }}>
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
      <Stack.Screen name="TeamMembers" component={TeamMembersScreen} options={{ title: 'Team Members' }} />
      <Stack.Screen name="AcceptInvite" component={AcceptInviteScreen} options={{ title: 'Accept Invite', headerBackTitle: 'Back' }} />

      {/* Products */}
      <Stack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
      <Stack.Screen name="ProductsCsvImport" component={ProductsCsvImportScreen} options={{ title: 'Import Products (CSV)' }} />
      <Stack.Screen
        name="EditProductScreen"
        component={EditProductScreen}
        options={{ title: 'Edit Product' }}
      />
      <Stack.Screen name="Suppliers" component={SuppliersScreen} options={{ title: 'Suppliers' }} />

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
      <Stack.Screen name="Adjustments" component={AdjustmentInboxScreen} options={{ title: 'Adjustments' }} />
      <Stack.Screen name="ScaleSettings" component={ScaleSettingsScreen} options={{ title: 'Bluetooth Scale' }} />
      <Stack.Screen name="SetupGuide" component={SetupGuideScreen} options={{ title: 'Setup Guide' }} />
      <Stack.Screen name="Appearance" component={AppearanceScreen} options={{ title: 'Appearance' }} />
      <Stack.Screen name="AdvancedSettings" component={AdvancedSettingsScreen} options={{ title: 'Advanced Settings' }} />
      <Stack.Screen name="Pricing" component={PricingScreen} options={{ title: 'Pricing' }} />
      <Stack.Screen name="Terms" component={TermsScreen} options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="Xero" component={XeroScreen} options={{ title: 'Xero Integration' }} />
      <Stack.Screen name="ReportPreferences" component={ReportPreferencesScreen} options={{ title: 'Report Preferences' }} />
      <Stack.Screen name="AiUsage" component={AiUsageScreen} options={{ title: 'AI Usage' }} />
      <Stack.Screen name="InventoryImport" component={InventoryImportScreen} options={{ title: 'Import Inventory' }} />
      <Stack.Screen name="InventoryImportPreview" component={InventoryImportPreviewScreen} options={{ title: 'Review Import' }} />
      <Stack.Screen name="OnboardingRoad" component={OnboardingRoadScreen} options={{ title: 'Welcome', headerShown: false }} />
      <Stack.Screen name="OnboardingFreshStart" component={FreshStartScreen} options={{ title: 'Fresh Start' }} />
      <Stack.Screen name="OnboardingBringData" component={BringYourDataScreen} options={{ title: 'Bring Your Data' }} />
      <Stack.Screen name="StocktakeSummary" component={StocktakeSummaryScreen} options={{ title: 'Stocktake Complete', headerLeft: () => null }} />
      {/* SUPPLIER PORTAL — unlocked when FEATURES.SUPPLIER_PORTAL = true */}
      {FEATURES.SUPPLIER_PORTAL && (
        <>
          <Stack.Screen name="SupplierDashboard" component={SupplierDashboardScreen} options={{ title: 'Supplier Portal' }} />
          <Stack.Screen name="SupplierCatalogue" component={SupplierCatalogueScreen} options={{ title: 'Catalogue & Pricing' }} />
          <Stack.Screen name="SupplierOrders" component={SupplierOrdersScreen} options={{ title: 'Orders' }} />
          <Stack.Screen name="SupplierSpecials" component={SupplierSpecialsScreen} options={{ title: 'Specials & Promotions' }} />
        </>
      )}
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
    <IzzyAssistant />
    </View>
  );
}
