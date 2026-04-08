// @ts-nocheck
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

const PLANS = [
  {
    name: 'Starter',
    price: '$49',
    period: '/month',
    colour: '#0369A1',
    features: [
      '1 venue',
      'Up to 500 products',
      'Unlimited stocktakes',
      'AI variance explanations',
      'PDF reports',
      'Email order dispatch',
    ],
  },
  {
    name: 'Core',
    price: '$99',
    period: '/month',
    colour: '#0F172A',
    badge: 'Most popular',
    features: [
      'Up to 3 venues',
      'Unlimited products',
      'Unlimited stocktakes',
      'All AI features',
      'Suggested orders',
      'Supplier portal (coming soon)',
      'Xero integration (coming soon)',
      'Priority support',
    ],
  },
  {
    name: 'Multi-site',
    price: 'Talk to us',
    period: '',
    colour: '#065F46',
    features: [
      'Unlimited venues',
      'Custom onboarding',
      'Dedicated support',
      'Custom integrations',
      'White label options',
    ],
  },
];

function PricingScreen() {
  const nav = useNavigation<any>();
  const colours = useColours();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <View style={{ backgroundColor: colours.primary, borderRadius: 16, padding: 20, alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 24, fontWeight: '900', color: '#fff' }}>Hosti-Stock Pricing</Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>
          Simple, transparent pricing for hospitality venues
        </Text>
      </View>

      {/* Beta notice */}
      <View style={{ backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' }}>
        <Text style={{ fontWeight: '900', color: '#166534', marginBottom: 4 }}>🎉 You are on the Beta Plan</Text>
        <Text style={{ color: '#166534', fontSize: 13 }}>
          Free access to all features during our pilot. Pricing will apply when we launch publicly. We will give you plenty of notice before anything changes.
        </Text>
      </View>

      {/* Plans */}
      {PLANS.map((plan, i) => (
        <View key={i} style={{
          backgroundColor: colours.surface, borderRadius: 16, overflow: 'hidden',
          borderWidth: plan.badge ? 2 : 1, borderColor: plan.badge ? plan.colour : colours.border,
        }}>
          {plan.badge && (
            <View style={{ backgroundColor: plan.colour, paddingVertical: 6, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{plan.badge}</Text>
            </View>
          )}
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: colours.text }}>{plan.name}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 28, fontWeight: '900', color: plan.colour }}>{plan.price}</Text>
                {plan.period ? <Text style={{ color: colours.textSecondary, fontSize: 12 }}>{plan.period}</Text> : null}
              </View>
            </View>
            {plan.features.map((f, j) => (
              <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Text style={{ color: plan.colour, fontWeight: '900' }}>✓</Text>
                <Text style={{ color: colours.text, fontSize: 14 }}>{f}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {/* Contact */}
      <View style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colours.border, alignItems: 'center', gap: 8 }}>
        <Text style={{ fontWeight: '800', color: colours.text }}>Questions about pricing?</Text>
        <Text style={{ color: colours.textSecondary, fontSize: 13, textAlign: 'center' }}>
          Contact us at hello@hosti.co.nz — we are happy to talk through the right plan for your venue.
        </Text>
      </View>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(PricingScreen, 'Pricing');
