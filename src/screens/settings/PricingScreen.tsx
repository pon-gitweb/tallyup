import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useSubscription } from '../../context/VenueProvider';

const MODULES_LIST = [
  {
    id: 'ai_reporting',
    name: 'AI Reporting Pack',
    monthly: '$49',
    annual: '$529',
    trial: '3 report free trial',
    desc: 'Custom AI-driven reporting and insights.',
  },
  {
    id: 'predictive_ordering',
    name: 'Predictive Ordering & Payments',
    monthly: '$29',
    annual: '$319',
    trial: '2 cart free trial',
    desc: 'AI-powered ordering and supplier payment scheduling.',
  },
  {
    id: 'gamification',
    name: 'Gamification Pack',
    monthly: '$9',
    annual: '$99',
    trial: '1 certificate free trial',
    desc: 'Staff engagement via achievements and certificates.',
  },
  {
    id: 'suitee',
    name: 'Suitee Assistant',
    monthly: '$19',
    annual: '$209',
    trial: '1 operational flow free trial',
    desc: 'In-app AI assistant for onboarding and support.',
  },
];

function PricingScreen() {
  const colours = useColours();
  const { subscription, isPilot, plan } = useSubscription();

  const status = subscription?.status ?? null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colours.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Pilot note */}
      {isPilot && (
        <View style={[styles.card, { backgroundColor: '#f0fdf4', borderColor: '#86efac' }]}>
          <Text style={[styles.pilotHeading, { color: '#166534' }]}>Complimentary Pilot Access</Text>
          <Text style={[styles.body, { color: '#166534' }]}>
            You are on complimentary pilot access. Pricing activates after the pilot period.
            Contact office@hosti.co.nz with any questions.
          </Text>
        </View>
      )}

      {/* Core subscription */}
      <Text style={[styles.sectionHeading, { color: colours.text }]}>Core Subscription</Text>
      <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
        <View style={styles.planRow}>
          <Text style={[styles.planName, { color: colours.text }]}>Core</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.planPrice, { color: colours.text }]}>$176<Text style={[styles.planPer, { color: colours.textSecondary }]}>/month</Text></Text>
            <Text style={[styles.planAnnual, { color: colours.textSecondary }]}>$1,889/year — save 10%</Text>
          </View>
        </View>
        <Text style={[styles.body, { color: colours.textSecondary }]}>
          Includes full stocktake functionality, variance reporting, and compliance tools.
        </Text>
      </View>

      {/* Modules */}
      <Text style={[styles.sectionHeading, { color: colours.text, marginTop: 8 }]}>Modules</Text>
      <Text style={[styles.subheading, { color: colours.textSecondary }]}>Optional add-ons. Each module includes a usage-limited free trial.</Text>

      {MODULES_LIST.map((mod) => (
        <View key={mod.id} style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border }]}>
          <View style={styles.planRow}>
            <Text style={[styles.planName, { color: colours.text }]}>{mod.name}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.planPrice, { color: colours.text }]}>{mod.monthly}<Text style={[styles.planPer, { color: colours.textSecondary }]}>/month</Text></Text>
              <Text style={[styles.planAnnual, { color: colours.textSecondary }]}>{mod.annual}/year</Text>
            </View>
          </View>
          <View style={styles.trialBadge}>
            <Text style={styles.trialText}>{mod.trial}</Text>
          </View>
          <Text style={[styles.body, { color: colours.textSecondary, marginTop: 6 }]}>{mod.desc}</Text>
        </View>
      ))}

      {/* HQ Module */}
      <Text style={[styles.sectionHeading, { color: colours.text, marginTop: 8 }]}>HQ Module</Text>
      <Text style={[styles.subheading, { color: colours.textSecondary }]}>For multi-site operators.</Text>
      <View style={[styles.card, { backgroundColor: colours.surface, borderColor: '#38bdf8' }]}>
        <View style={styles.planRow}>
          <Text style={[styles.planName, { color: colours.text }]}>HQ Module</Text>
          <Text style={[styles.planPrice, { color: colours.text }]}>$119<Text style={[styles.planPer, { color: colours.textSecondary }]}>/month</Text></Text>
        </View>
        <Text style={[styles.body, { color: colours.textSecondary }]}>
          Consolidated dashboards and compliance across multiple venues.
        </Text>
      </View>

      {/* Billing note */}
      <View style={[styles.card, { backgroundColor: colours.surface, borderColor: colours.border, marginTop: 8 }]}>
        <Text style={[styles.noteHeading, { color: colours.text }]}>Billing</Text>
        <Text style={[styles.body, { color: colours.textSecondary }]}>
          Failed payment results in read-only mode. Your data is retained for 12 months.{'\n\n'}
          No dark patterns — cancellation is always clear.{'\n\n'}
          All prices in NZD, excl. GST.
        </Text>
      </View>
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
  sectionHeading: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
    marginTop: 4,
  },
  subheading: {
    fontSize: 13,
    marginBottom: 12,
    marginTop: -6,
  },
  pilotHeading: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  noteHeading: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  planAnnual: {
    fontSize: 12,
    marginTop: 2,
  },
  trialBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  trialText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
  },
});

export default withErrorBoundary(PricingScreen, 'Pricing');
