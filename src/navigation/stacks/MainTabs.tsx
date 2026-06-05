// @ts-nocheck
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { openIzzy } from '../../components/IzzyAssistant';

import DashboardScreen from '../../screens/DashboardScreen';
import DepartmentSelectionScreen from '../../screens/stock/DepartmentSelectionScreen';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import ReportsScreen from '../../screens/reports/ReportsScreen';
import MoreScreen from '../../screens/MoreScreen';
import FestivalDashboardScreen from '../../screens/festival/FestivalDashboardScreen';
import FestivalBarSelectionScreen from '../../screens/festival/FestivalBarSelectionScreen';
import FestivalReportsScreen from '../../screens/festival/FestivalReportsScreen';
import { useFestivalMode } from '../../hooks/useFestivalMode';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, { default: string; focused: string }> = {
  Home:    { default: 'home-outline',                focused: 'home' },
  Stock:   { default: 'cube-outline',                focused: 'cube' },
  Orders:  { default: 'cart-outline',                focused: 'cart' },
  Reports: { default: 'bar-chart-outline',           focused: 'bar-chart' },
  More:    { default: 'ellipsis-horizontal-outline', focused: 'ellipsis-horizontal' },
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
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          const name = icons ? (focused ? icons.focused : icons.default) : 'ellipsis-horizontal';
          return <Ionicons name={name} size={size} color={color} />;
        },
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
      {isFestival ? (
        <>
          <Tab.Screen name="Home"    component={FestivalDashboardScreen} />
          <Tab.Screen name="Stock"   component={FestivalBarSelectionScreen} />
          <Tab.Screen name="Reports" component={FestivalReportsScreen} />
          <Tab.Screen name="More"    component={MoreScreen} />
        </>
      ) : (
        <>
          <Tab.Screen name="Home"    component={DashboardScreen} />
          <Tab.Screen name="Stock"   component={DepartmentSelectionScreen} />
          <Tab.Screen name="Orders"  component={OrdersScreen} />
          <Tab.Screen name="Reports" component={ReportsScreen} />
          <Tab.Screen name="More"    component={MoreScreen} />
        </>
      )}
    </Tab.Navigator>
  );
}
