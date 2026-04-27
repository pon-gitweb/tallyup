// @ts-nocheck
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function PricingScreen() {
  const colours = useColours();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colours.background }}
      contentContainerStyle={{ flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{
        backgroundColor: colours.surface,
        borderRadius: 16,
        padding: 28,
        borderWidth: 1,
        borderColor: colours.border,
        alignItems: 'center',
        gap: 12,
        maxWidth: 400,
        width: '100%',
      }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colours.text, textAlign: 'center' }}>
          Hosti-Stock is currently in pilot.
        </Text>
        <Text style={{ fontSize: 16, color: colours.textSecondary, textAlign: 'center', lineHeight: 24 }}>
          Your access is complimentary during this period.
        </Text>
        <Text style={{ fontSize: 16, color: colours.textSecondary, textAlign: 'center', lineHeight: 24 }}>
          Pricing details coming soon.
        </Text>
      </View>
    </ScrollView>
  );
}

export default withErrorBoundary(PricingScreen, 'Pricing');
