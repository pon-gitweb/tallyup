import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useVenueId } from '../../context/VenueProvider';
import { useSubscription } from '../../context/VenueProvider';

const MODULES = [
  { id: 'procurement', name: 'Procurement', price: '$59', desc: 'Purchase orders, supplier management, receiving.' },
  { id: 'recipes', name: 'Recipes & GP', price: '$49', desc: 'Recipe costing, GP tracking, variance attribution.' },
  { id: 'integrations', name: 'Integrations', price: '$19', desc: 'POS sync, accounting exports, API access.' },
  { id: 'analytics', name: 'Analytics & Insights', price: '$149', desc: 'AI insights, trend analysis, benchmark reports.' },
];

function PlanLabel({ status, plan }: { status: string | null; plan: string | null }) {
  const colours = useColours();
  if (!status || !['active', 'trialing'].includes(status)) {
    return (
      <View style={[styles.planBadge, { backgroundColor: colours.surface, borderColor: '#38bdf8' }]}>
        <Text style={[styles.planBadgeText, { color: '#38bdf8' }]}>Complimentary Access</Text>
      </View>
    );
  }
  if (status === 'active' || status === 'trialing') {
    const label = plan === 'pro_ops' ? 'Pro Ops Bundle' : plan === 'core' ? 'Core Plan' : (plan ?? 'Active');
    return (
      <View style={[styles.planBadge, { backgroundColor: colours.surface, borderColor: '#22c55e' }]}>
        <Text style={[styles.planBadgeText, { color: '#22c55e' }]}>{label}</Text>
      </View>
    );
  }
  if (status === 'cancelled') {
    return (
      <View style={[styles.planBadge, { backgroundColor: colours.surface, borderColor: colours.border }]}>
        <Text style={[styles.planBadgeText, { color: colours.textSecondary }]}>Cancelled</Text>
      </View>
    );
  }
  return null;
}

function PricingScreen() {
  const colours = useColours();
  const venueId = useVenueId();
  const { subscription, isPilot, plan } = useSubscription();

  const status = subscription?.status ?? null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colours.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Current Plan */}
      <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
        <Text style={[styles.sectionTitle, { color: colours.text }]}>Current Plan</Text>
        <PlanLabel status={status} plan={plan} />
        {isPilot && (
          <Text style={[styles.hint, { color: colours.textSecondary }]}>
            Your access is complimentary during the pilot period. Pricing activates when the pilot ends.
          </Text>
        )}
        {!isPilot && subscription?.currentPeriodEnd && (
          <Text style={[styles.hint, { color: colours.textSecondary }]}>
            Current period ends {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </Text>
        )}
      </View>

      {/* Plans */}
      <Text style={[styles.heading, { color: colours.text }]}>Available Plans</Text>
      <Text style={[styles.subheading, { color: colours.textSecondary }]}>Pricing activates after pilot period.</Text>

      <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
        <View style={styles.planRow}>
          <Text style={[styles.planName, { color: colours.text }]}>Core</Text>
          <Text style={[styles.planPrice, { color: colours.text }]}>$99<Text style={[styles.planPer, { color: colours.textSecondary }]}>/mo annual</Text></Text>
        </View>
        <Text style={[styles.planDesc, { color: colours.textSecondary }]}>
          Stock takes, variance tracking, order management, and AI suggested orders. Everything a venue needs to run tight inventory.
        </Text>
      </View>

      <Text style={[styles.heading, { color: colours.text, marginTop: 8 }]}>Add-on Modules</Text>

      {MODULES.map((mod) => (
        <View key={mod.id} style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
          <View style={styles.planRow}>
            <Text style={[styles.planName, { color: colours.text }]}>{mod.name}</Text>
            <Text style={[styles.planPrice, { color: colours.text }]}>{mod.price}<Text style={[styles.planPer, { color: colours.textSecondary }]}>/mo</Text></Text>
          </View>
          <Text style={[styles.planDesc, { color: colours.textSecondary }]}>{mod.desc}</Text>
        </View>
      ))}

      <View style={[styles.card, { backgroundColor: colours.surface, borderColor: '#22c55e' }]}>
        <View style={styles.planRow}>
          <View>
            <Text style={[styles.planName, { color: colours.text }]}>Pro Ops Bundle</Text>
            <Text style={[styles.bundleTag, { color: '#22c55e' }]}>Includes all modules</Text>
          </View>
          <Text style={[styles.planPrice, { color: colours.text }]}>$179<Text style={[styles.planPer, { color: colours.textSecondary }]}>/mo annual</Text></Text>
        </View>
        <Text style={[styles.planDesc, { color: colours.textSecondary }]}>
          Core plan plus all add-on modules. Best value for venues running at full capacity.
        </Text>
      </View>

      <Text style={[styles.footnote, { color: colours.textSecondary }]}>
        All prices in NZD, excl. GST. Annual billing. Contact us to discuss multi-venue or enterprise pricing.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  planBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 8,
  },
  planBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  heading: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 8,
  },
  subheading: {
    fontSize: 13,
    marginBottom: 12,
    marginTop: -6,
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  planName: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  planPrice: {
    fontSize: 18,
    fontWeight: '800',
  },
  planPer: {
    fontSize: 13,
    fontWeight: '400',
  },
  planDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  bundleTag: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
});

export default withErrorBoundary(PricingScreen, 'Pricing');
