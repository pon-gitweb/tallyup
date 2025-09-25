import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import OriginalDashboard from './DashboardScreen';

export default function DashboardWithStockControl() {
  const nav = useNavigation<any>();
  return (
    <View style={{ flex: 1 }}>
      <OriginalDashboard />
      {/* Non-invasive floating button in bottom-right */}
      <TouchableOpacity
        onPress={() => nav.navigate('StockControl')}
        style={{
          position: 'absolute', right: 16, bottom: 24,
          backgroundColor: '#0A84FF', paddingVertical: 12, paddingHorizontal: 16,
          borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3
        }}
        accessibilityRole="button"
        accessibilityLabel="Open Stock Control"
      >
        <Text style={{ color: 'white', fontWeight: '800' }}>Stock Control</Text>
      </TouchableOpacity>
    </View>
  );
}
