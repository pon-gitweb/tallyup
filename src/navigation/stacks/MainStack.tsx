// @ts-nocheck
import OrderEditorScreen from '../../screens/orders/OrderEditorScreen';
import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import IzzyAssistant, { openIzzy } from '../../components/IzzyAssistant';
import MainTabs from './MainTabs';

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
import StocktakeHistoryScreen from '../../screens/reports/StocktakeHistoryScreen';
import StocktakeCycleDetailScreen from '../../screens/reports/StocktakeCycleDetailScreen';
import CycleComparisonScreen from '../../screens/reports/CycleComparisonScreen';
import ProductPerformanceScreen from '../../screens/reports/ProductPerformanceScreen';
import SupplierSpendScreen from '../../screens/reports/SupplierSpendScreen';
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
import SetupWizardScreen from '../../screens/onboarding/SetupWizardScreen';
import { FEATURES } from '../../config/features';
import StocktakeSummaryScreen from '../../screens/stock/StocktakeSummaryScreen';
import DepartmentSummaryScreen from '../../screens/stock/DepartmentSummaryScreen';
import StockHoldingScreen from '../../screens/stock/StockHoldingScreen';
import SupplierDashboardScreen from '../../screens/supplier/SupplierDashboardScreen';
import SupplierCatalogueScreen from '../../screens/supplier/SupplierCatalogueScreen';
import SupplierOrdersScreen from '../../screens/supplier/SupplierOrdersScreen';
import SupplierSpecialsScreen from '../../screens/supplier/SupplierSpecialsScreen';

// Invoices
import InvoiceSummaryScreen from '../../screens/invoices/InvoiceSummaryScreen';

// Adjustments
import AdjustmentInboxScreen from '../../screens/adjustments/AdjustmentInboxScreen';

// Orders
import SuggestedOrderScreen from '../../screens/orders/SuggestedOrderScreen';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import NewOrderScreen from '../../screens/orders/NewOrderScreen';
import NewOrderStartScreen from '../../screens/orders/NewOrderStartScreen';
import OrderDetailScreen from '../../screens/orders/OrderDetailScreen';

// Home router (venueType-based routing)
import HomeRouterScreen from '../../screens/HomeRouterScreen';
import CreateVenueScreen from '../../screens/CreateVenueScreen';
import VenueListScreen from '../../screens/venues/VenueListScreen';

// Festival
import FestivalDashboardScreen from '../../screens/festival/FestivalDashboardScreen';
import FestivalEventSetupScreen from '../../screens/festival/FestivalEventSetupScreen';
import FestivalBarSelectionScreen from '../../screens/festival/FestivalBarSelectionScreen';
import FestivalBarDashboardScreen from '../../screens/festival/FestivalBarDashboardScreen';
import FestivalTopUpRequestScreen from '../../screens/festival/FestivalTopUpRequestScreen';
import FestivalDeliveryTasksScreen from '../../screens/festival/FestivalDeliveryTasksScreen';
import FestivalTransferScreen from '../../screens/festival/FestivalTransferScreen';
import FestivalSessionCountScreen from '../../screens/festival/FestivalSessionCountScreen';
import FestivalWastageScreen from '../../screens/festival/FestivalWastageScreen';
import FestivalOpsScreen from '../../screens/festival/FestivalOpsScreen';
import FestivalReportsScreen from '../../screens/festival/FestivalReportsScreen';
import FestivalContainerLayoutScreen from '../../screens/festival/FestivalContainerLayoutScreen';
import FestivalPlanogramScreen from '../../screens/festival/FestivalPlanogramScreen';
import FestivalPurchasingPredictionScreen from '../../screens/festival/FestivalPurchasingPredictionScreen';
import FestivalContractScreen from '../../screens/festival/FestivalContractScreen';
import FestivalObligationsScreen from '../../screens/festival/FestivalObligationsScreen';
import FestivalRidersScreen from '../../screens/festival/FestivalRidersScreen';
import FestivalRiderDetailScreen from '../../screens/festival/FestivalRiderDetailScreen';
import FestivalActivationsScreen from '../../screens/festival/FestivalActivationsScreen';
import FestivalEndOfEventCountScreen from '../../screens/festival/FestivalEndOfEventCountScreen';
import FestivalReturnPhotoScreen from '../../screens/festival/FestivalReturnPhotoScreen';
import FestivalReturnsScreen from '../../screens/festival/FestivalReturnsScreen';
import FestivalPackingSlipScreen from '../../screens/festival/FestivalPackingSlipScreen';
import FestivalReconciliationScreen from '../../screens/festival/FestivalReconciliationScreen';
import FestivalEventCloseScreen from '../../screens/festival/FestivalEventCloseScreen';
import FestivalEventHistoryScreen from '../../screens/festival/FestivalEventHistoryScreen';
import FestivalGoodsInScreen from '../../screens/festival/FestivalGoodsInScreen';
import FestivalStockOverviewScreen from '../../screens/festival/FestivalStockOverviewScreen';
import FestivalNewEventScreen from '../../screens/festival/FestivalNewEventScreen';
import FestivalWeekReviewScreen from '../../screens/festival/FestivalWeekReviewScreen';
import FestivalDebriefScreen from '../../screens/festival/FestivalDebriefScreen';
import FestivalReturnRiskScreen from '../../screens/festival/FestivalReturnRiskScreen';
import FestivalSalesUploadScreen from '../../screens/festival/FestivalSalesUploadScreen';
import FestivalOpeningStockScreen from '../../screens/festival/FestivalOpeningStockScreen';
import FestivalHistoricalDataScreen from '../../screens/festival/FestivalHistoricalDataScreen';

// Recipes / CraftUp
import CraftUpListScreen from '../../screens/recipes/CraftUpListScreen';

// Products (setup area)
import ProductsScreen from '../../screens/setup/ProductsScreen';
import BatchPriceEntryScreen from '../../screens/setup/BatchPriceEntryScreen';
import ProductsCsvImportScreen from '../../screens/setup/ProductsCsvImportScreen';
import EditProductScreen from '../../screens/setup/EditProductScreen';
import SuppliersScreen from '../../screens/setup/SuppliersScreen';

const Stack = createNativeStackNavigator();

export default function MainStack() {
  return (
    <View style={{ flex: 1 }}>
    <Stack.Navigator
      screenOptions={{
        headerRight: () => (
          <TouchableOpacity onPress={openIzzy} style={{ marginRight: 16, padding: 4 }}>
            <Text style={{ color: '#1b4f72', fontSize: 18, fontWeight: '600' }}>✦</Text>
          </TouchableOpacity>
        ),
      }}
    >
      {/* Routing screen — reads venueType and resets to MainTabs or FestivalDashboard */}
      <Stack.Screen name="HomeRouter" component={HomeRouterScreen} options={{ headerShown: false }} />
      {/* Venue creation — reachable for new users with no venue */}
      <Stack.Screen name="CreateVenue" component={CreateVenueScreen} options={{ title: 'Create your venue', headerShown: false }} />
      {/* Venue list — manage all venues for this account */}
      <Stack.Screen name="VenueList" component={VenueListScreen} options={{ title: 'My Venues' }} />
      {/* Root — bottom tab navigator */}
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      {/* Legacy direct route kept for nav.navigate('Dashboard') calls */}
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
      <Stack.Screen name="BatchPriceEntry" component={BatchPriceEntryScreen} options={{ title: 'Add Cost Prices' }} />
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
      <Stack.Screen name="StocktakeHistory" component={StocktakeHistoryScreen} options={{ title: 'Stocktake History' }} />
      <Stack.Screen name="StocktakeCycleDetail" component={StocktakeCycleDetailScreen} options={{ title: 'Cycle Details' }} />
      <Stack.Screen name="CycleComparison" component={CycleComparisonScreen} options={{ title: 'Compare Cycles' }} />
      <Stack.Screen name="ProductPerformance" component={ProductPerformanceScreen} options={{ title: 'Product Performance' }} />
      <Stack.Screen name="SupplierSpend" component={SupplierSpendScreen} options={{ title: 'Supplier Spend' }} />
      <Stack.Screen name="Adjustments" component={AdjustmentInboxScreen} options={{ title: 'Adjustments' }} />
      <Stack.Screen name="InvoiceSummary" component={InvoiceSummaryScreen} options={{ title: 'Invoice Processed' }} />
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
      <Stack.Screen name="SetupWizard" component={SetupWizardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="FestivalDashboard" component={FestivalDashboardScreen} options={{ title: 'Festival Mode' }} />
      <Stack.Screen name="FestivalEventSetup" component={FestivalEventSetupScreen} options={{ title: 'Event Setup' }} />
      <Stack.Screen name="FestivalBarSelection" component={FestivalBarSelectionScreen} options={{ title: 'Bars' }} />
      <Stack.Screen name="FestivalBarDashboard" component={FestivalBarDashboardScreen} options={{ title: 'Bar' }} />
      <Stack.Screen name="FestivalTopUpRequest" component={FestivalTopUpRequestScreen} options={{ title: 'Request Top-Up' }} />
      <Stack.Screen name="FestivalDeliveryTasks" component={FestivalDeliveryTasksScreen} options={{ title: 'Delivery Tasks' }} />
      <Stack.Screen name="FestivalTransfer" component={FestivalTransferScreen} options={{ title: 'Transfer Stock' }} />
      <Stack.Screen name="FestivalSessionCount" component={FestivalSessionCountScreen} options={{ title: 'Session Count' }} />
      <Stack.Screen name="FestivalWastage" component={FestivalWastageScreen} options={{ title: 'Record Wastage' }} />
      <Stack.Screen name="FestivalOps" component={FestivalOpsScreen} options={{ title: 'Ops Overview' }} />
      <Stack.Screen name="FestivalReports" component={FestivalReportsScreen} options={{ title: 'Festival Reports' }} />
      <Stack.Screen name="FestivalContainerLayout" component={FestivalContainerLayoutScreen} options={{ title: 'Container Layout' }} />
      <Stack.Screen name="FestivalPlanogram" component={FestivalPlanogramScreen} options={{ title: 'Fridge Planogram' }} />
      <Stack.Screen name="FestivalPurchasingPrediction" component={FestivalPurchasingPredictionScreen} options={{ title: 'Purchasing Prediction' }} />
      <Stack.Screen name="FestivalContracts" component={FestivalContractScreen} options={{ title: 'Contracts' }} />
      <Stack.Screen name="FestivalObligations" component={FestivalObligationsScreen} options={{ title: 'Obligations' }} />
      <Stack.Screen name="FestivalRiders" component={FestivalRidersScreen} options={{ title: 'Riders' }} />
      <Stack.Screen name="FestivalRiderDetail" component={FestivalRiderDetailScreen} options={{ title: 'Rider Detail' }} />
      <Stack.Screen name="FestivalActivations" component={FestivalActivationsScreen} options={{ title: 'Activations' }} />
      <Stack.Screen name="FestivalEndOfEventCount" component={FestivalEndOfEventCountScreen} options={{ title: 'End of Event Count' }} />
      <Stack.Screen name="FestivalReturnPhoto" component={FestivalReturnPhotoScreen} options={{ title: 'Return Photos' }} />
      <Stack.Screen name="FestivalReturns" component={FestivalReturnsScreen} options={{ title: 'Returns' }} />
      <Stack.Screen name="FestivalPackingSlip" component={FestivalPackingSlipScreen} options={{ title: 'Packing Slips' }} />
      <Stack.Screen name="FestivalReconciliation" component={FestivalReconciliationScreen} options={{ title: 'Reconciliation' }} />
      <Stack.Screen name="FestivalEventClose" component={FestivalEventCloseScreen} options={{ title: 'Close Event' }} />
      <Stack.Screen name="FestivalEventHistory" component={FestivalEventHistoryScreen} options={{ title: 'Event History' }} />
      <Stack.Screen name="FestivalGoodsIn" component={FestivalGoodsInScreen} options={{ title: 'Goods In' }} />
      <Stack.Screen name="FestivalStockOverview" component={FestivalStockOverviewScreen} options={{ title: 'Stock Overview' }} />
      <Stack.Screen name="FestivalNewEvent" component={FestivalNewEventScreen} options={{ title: 'New Event' }} />
      <Stack.Screen name="FestivalWeekReview" component={FestivalWeekReviewScreen} options={{ title: 'Week Review' }} />
      <Stack.Screen name="FestivalDebrief" component={FestivalDebriefScreen} options={{ title: 'Event Debrief' }} />
      <Stack.Screen name="FestivalReturnRisk" component={FestivalReturnRiskScreen} options={{ title: 'Return Risk' }} />
      <Stack.Screen name="FestivalSalesUpload" component={FestivalSalesUploadScreen} options={{ title: 'Sales Data' }} />
      <Stack.Screen name="FestivalOpeningStock" component={FestivalOpeningStockScreen} options={{ title: 'Opening Stock' }} />
      <Stack.Screen name="FestivalHistoricalData" component={FestivalHistoricalDataScreen} options={{ title: 'Prior Year Data' }} />
      <Stack.Screen name="StocktakeSummary" component={StocktakeSummaryScreen} options={{ title: 'Stocktake Complete', headerLeft: () => null }} />
      <Stack.Screen name="DepartmentSummary" component={DepartmentSummaryScreen} options={{ title: 'Department Complete', headerLeft: () => null }} />
      <Stack.Screen name="StockHolding" component={StockHoldingScreen} options={{ title: 'Stock Holding Report' }} />
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

      {/* Recipes */}
      <Stack.Screen name="CraftUp" component={CraftUpListScreen} options={{ title: 'Recipes (CraftUp)' }} />

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
