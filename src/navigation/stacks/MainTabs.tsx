// @ts-nocheck
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openIzzy } from '../../components/IzzyAssistant';

import DashboardScreen from '../../screens/DashboardScreen';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import ReportsScreen from '../../screens/reports/ReportsScreen';
import MoreScreen from '../../screens/MoreScreen';
import FestivalDashboardScreen from '../../screens/festival/FestivalDashboardScreen';
import FestivalReportsScreen from '../../screens/festival/FestivalReportsScreen';
import { useFestivalMode } from '../../hooks/useFestivalMode';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Home:    '🏠',
  Stock:   '📦',
  Orders:  '📋',
  Reports: '📊',
  More:    '⋯',
};

const IzzyHeaderButton = () => (
  <TouchableOpacity onPress={openIzzy} style={{ marginRight: 16, padding: 4 }}>
    <Text style={{ color: '#1b4f72', fontSize: 18, fontWeight: '600' }}>✦</Text>
  </TouchableOpacity>
);

export default function MainTabs() {
  const insets = useSafeAreaInsets();
  const { isFestival } = useFestivalMode();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color }) => (
          <Text style={{ fontSize: focused ? 22 : 19, color, marginBottom: -2 }}>
            {TAB_ICONS[route.name] ?? '•'}
          </Text>
        ),
        tabBarLabel: ({ focused, color }) => (
          <Text style={{
            fontSize: 10, fontWeight: focused ? '700' : '500',
            color, marginTop: 2, marginBottom: 0,
          }}>
            {route.name}
          </Text>
        ),
        tabBarActiveTintColor: '#1b4f72',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          backgroundColor: '#f5f3ee',
          borderTopWidth: 1,
          borderTopColor: '#e5e1d8',
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 6,
          height: 60 + (insets.bottom > 0 ? insets.bottom : 8),
        },
      })}
    >
      <Tab.Screen name="Home"    component={DashboardScreen} />
      <Tab.Screen name="Stock"   component={isFestival ? FestivalDashboardScreen : DepartmentSelectionScreen} />
      <Tab.Screen name="Orders"  component={OrdersScreen} />
      <Tab.Screen name="Reports" component={isFestival ? FestivalReportsScreen : ReportsScreen} />
      <Tab.Screen name="More"    component={MoreScreen} />
    </Tab.Navigator>
  );
}
