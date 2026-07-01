import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColours } from '../../context/ThemeContext';

export default function InvoicesScreen() {
  const nav = useNavigation<any>();
  const colours = useColours();
  const insets = useSafeAreaInsets();

  const actions = [
    {
      icon: '📷',
      label: 'Scan an invoice',
      sub: 'Photograph or upload a supplier invoice',
      onPress: () => nav.navigate('PendingDeliveries'),
    },
    {
      icon: '📦',
      label: 'Pending deliveries',
      sub: 'Stock received — awaiting invoice match',
      onPress: () => nav.navigate('PendingDeliveries'),
    },
    {
      icon: '💳',
      label: 'Credit notes',
      sub: 'Record supplier credits',
      onPress: () => nav.navigate('CreditNoteForm'),
    },
    {
      icon: '🚩',
      label: 'Price changes',
      sub: 'Review flagged price differences',
      onPress: () => nav.navigate('PriceChangeFlags'),
    },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colours.cream }}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ paddingHorizontal: 16, paddingTop: (insets.top || 0) + 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: colours.navy, letterSpacing: -0.5 }}>
          Invoices
        </Text>
        <Text style={{ fontSize: 14, color: colours.textSecondary, marginTop: 4 }}>
          Scan deliveries, review pending stock, manage credits
        </Text>
      </View>

      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        {actions.map((action, i) => (
          <TouchableOpacity
            key={i}
            onPress={action.onPress}
            activeOpacity={0.75}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colours.surface,
              borderRadius: 12,
              padding: 16,
              marginBottom: 10,
              borderWidth: 1,
              borderColor: colours.border,
            }}
          >
            <Text style={{ fontSize: 22, marginRight: 14 }}>{action.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colours.navy }}>{action.label}</Text>
              <Text style={{ fontSize: 13, color: colours.textSecondary, marginTop: 2 }}>{action.sub}</Text>
            </View>
            <Text style={{ fontSize: 18, color: colours.deepBlue, fontWeight: '300' }}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
