import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Your existing screens (examples; keep your actual names/paths)
import ExistingVenueDashboard from '../../screens/dashboard/ExistingVenueDashboard';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import AreaSelectionScreen from '../../screens/stock/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from '../../screens/stock/StockTakeAreaInventoryScreen';
import SettingsScreen from '../../screens/settings/SettingsScreen';
import ReportsScreen from '../../screens/reports/ReportsScreen';

const Stack = createNativeStackNavigator();

export default function MainStack({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Dashboard" component={ExistingVenueDashboard} options={{ headerShown: false }} />
      <Stack.Screen name="Departments" component={DepartmentSelectionScreen} />
      <Stack.Screen name="Areas" component={AreaSelectionScreen} />
      <Stack.Screen name="AreaInventory" component={StockTakeAreaInventoryScreen} options={{ title: 'Inventory' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
    </Stack.Navigator>
  );
}
