import React from 'react';
import { ScrollView, Text } from 'react-native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function PricingScreen() {
  const colours = useColours();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colours.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      <Text style={{ fontSize: 22, fontWeight: '900', color: colours.text, marginBottom: 16 }}>Pricing</Text>

      <Text style={{ fontSize: 15, color: colours.text, lineHeight: 24, marginBottom: 24 }}>
        Coming soon.{'\n\n'}
        We're currently running live trials in real venues to iron out the details and understand our own COGS before pricing goes live later this year.
      </Text>

      <Text style={{ fontSize: 13, color: colours.textSecondary }}>
        Questions? Contact us at{' '}
        <Text style={{ color: colours.primary, fontWeight: '700' }}>office@hosti.co.nz</Text>
      </Text>
    </ScrollView>
  );
}

export default withErrorBoundary(PricingScreen, 'Pricing');
