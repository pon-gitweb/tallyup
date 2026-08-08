import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet,
} from 'react-native';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useSubscription } from '../../context/VenueProvider';
import { MODULES } from '../../services/billing/modules';
import { withErrorBoundary } from '../../components/ErrorCatcher';

type BillingPeriod = 'monthly' | 'annual';

function PricingScreen() {
  const c = useColours();
  const { theme } = useTheme();
  const { isPilot, isActive, hasModule } = useSubscription();

  const [billing, setBilling] = useState<BillingPeriod>('annual');
  const [venueCount, setVenueCount] = useState(1);

  // ── Computed values ──────────────────────────────────────────────────────

  const coreActive = !isPilot && isActive;

  const bundleActive =
    hasModule(MODULES.SUPPLIER_OPTIMISATION) &&
    hasModule(MODULES.OPS_INTELLIGENCE) &&
    hasModule(MODULES.PERFORMANCE_INCENTIVES);

  // Display price for Multi-Venue based on count and billing period.
  // Stripe applies the real tiered amount server-side; this is display-only.
  function multiVenueDisplayPrice(): string {
    if (billing === 'annual') {
      const total = 299.00 + Math.max(0, venueCount - 3) * 18;
      return `$${total.toFixed(2)}/mo`;
    }
    const total = 332.22 + Math.max(0, venueCount - 3) * 20;
    return `$${total.toFixed(2)}/mo`;
  }

  // Saving for Pro Ops Bundle vs. the three modules purchased separately
  const bundleSaving = billing === 'annual' ? '$18.00/mo' : '$20.00/mo';

  // ── Status indicator ─────────────────────────────────────────────────────
  // Non-tappable text showing inclusion status. No purchase mechanism.

  function moduleStatus(included: boolean) {
    if (included) {
      return (
        <View style={styles.statusRow}>
          <Text style={[styles.statusIncluded, { color: c.positiveStrong || '#2f9e5d', fontFamily: theme.fontBodySemiBold }]}>
            ✓ Included in your plan
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.statusRow}>
        <Text style={[styles.statusNot, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Not included in your current plan
        </Text>
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.oat || '#f5f3ee' }]}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Text style={[styles.heading, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
        Plans & Pricing
      </Text>
      <Text style={[styles.subheading, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
        Everything your venue needs to run tighter, order smarter, and perform better.
      </Text>

      {/* ── Billing period toggle ────────────────────────────────────────── */}
      <View style={[styles.toggle, { backgroundColor: c.surface || '#fbfaf6' }]}>
        {(['monthly', 'annual'] as const).map((period) => (
          <TouchableOpacity
            key={period}
            style={[
              styles.toggleOption,
              billing === period && { backgroundColor: c.missionSlate || '#3b3f4a' },
            ]}
            onPress={() => setBilling(period)}
          >
            <Text style={[
              styles.toggleText,
              { fontFamily: theme.fontBodySemiBold },
              billing === period ? { color: '#fff' } : { color: c.slateMid || '#6b7280' },
            ]}>
              {period === 'monthly' ? 'Monthly' : 'Annual'}
            </Text>
            {period === 'annual' && (
              <Text style={[
                styles.toggleSavePill,
                { color: billing === 'annual' ? 'rgba(255,255,255,0.7)' : (c.positiveStrong || '#2f9e5d') },
              ]}>
                save ~10%
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Core hero card ──────────────────────────────────────────────── */}
      <View style={[styles.heroCard, { backgroundColor: c.deepBlue || '#1b4f72' }]}>
        <Text style={[styles.heroLabel, { fontFamily: theme.fontBodySemiBold }]}>CORE</Text>
        <Text style={[styles.heroPrice, { fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$199.00' : '$221.11'}
          <Text style={styles.heroPriceMo}>/mo</Text>
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.heroBillingNote, { fontFamily: theme.fontBody }]}>
            $2,388.00 billed annually
          </Text>
        )}
        <View style={styles.heroFeatures}>
          {[
            'Real-time stock control for a single venue',
            'Invoice scanning with automatic variance detection',
            'Full stocktake history and reporting',
            'Product catalogue and supplier management',
          ].map((feature, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={styles.heroCheck}>✓</Text>
              <Text style={[styles.heroFeatureText, { fontFamily: theme.fontBody }]}>{feature}</Text>
            </View>
          ))}
        </View>
        {/* Plain status text — not styled as a button, no onPress */}
        <View style={styles.heroStatus}>
          {coreActive ? (
            <Text style={[styles.heroStatusText, { color: 'rgba(255,255,255,0.9)', fontFamily: theme.fontBodySemiBold }]}>
              ✓ Included in your plan
            </Text>
          ) : (
            <Text style={[styles.heroStatusText, { color: 'rgba(255,255,255,0.5)', fontFamily: theme.fontBody }]}>
              Not currently included in your plan
            </Text>
          )}
        </View>
      </View>

      {/* ── Add-on modules ──────────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBodySemiBold }]}>
        ADD-ON MODULES
      </Text>

      {/* Supplier Optimisation */}
      <View style={[styles.moduleCard, { backgroundColor: c.surface || '#fbfaf6' }]}>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
          Supplier Optimisation
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Take the guesswork out of ordering. AI-driven suggestions and supplier performance tracking keep your stock lean and your supplier relationships sharper.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$79.00' : '$87.78'}<Text style={styles.modulePriceMo}>/mo</Text>
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            $948.00/yr
          </Text>
        )}
        {moduleStatus(hasModule(MODULES.SUPPLIER_OPTIMISATION))}
      </View>

      {/* Ops Intelligence */}
      <View style={[styles.moduleCard, { backgroundColor: c.surface || '#fbfaf6' }]}>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
          Ops Intelligence
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Know exactly how your venue is really performing. Hosti Health scores, KPI dashboards, and operational insights give you a single source of truth for what's working and what isn't.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$69.00' : '$76.67'}<Text style={styles.modulePriceMo}>/mo</Text>
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            $828.00/yr
          </Text>
        )}
        {moduleStatus(hasModule(MODULES.OPS_INTELLIGENCE))}
      </View>

      {/* Performance & Incentives */}
      <View style={[styles.moduleCard, { backgroundColor: c.surface || '#fbfaf6' }]}>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
          Performance & Incentives
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Turn stocktake accuracy into team motivation. Staff leaderboards, gamified targets, and performance reward tracking make counting something your team actually cares about.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$39.00' : '$43.33'}<Text style={styles.modulePriceMo}>/mo</Text>
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            $468.00/yr
          </Text>
        )}
        {moduleStatus(hasModule(MODULES.PERFORMANCE_INCENTIVES))}
      </View>

      {/* Multi-Venue Command Centre */}
      <View style={[styles.moduleCard, { backgroundColor: c.surface || '#fbfaf6' }]}>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
          Multi-Venue Command Centre
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Run many venues like one. Consolidated dashboards, cross-venue reporting, and group management give operators a single view across their entire group.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {multiVenueDisplayPrice()}
        </Text>
        <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          {billing === 'annual'
            ? 'Base ≤3 venues ($3,588/yr) · +~$18/mo per venue above 3'
            : 'Base ≤3 venues · +$20/mo per venue above 3'
          }
        </Text>
        {/* Venue count stepper — display-only price preview, updates local state only */}
        <View style={styles.stepperRow}>
          <Text style={[styles.stepperLabel, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBody }]}>
            Venues:
          </Text>
          <TouchableOpacity
            style={[styles.stepperBtn, { borderColor: c.oatMuted || '#c9c5bd' }]}
            onPress={() => setVenueCount(n => Math.max(1, n - 1))}
          >
            <Text style={[styles.stepperBtnText, { color: c.missionSlate || '#3b3f4a' }]}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.stepperCount, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
            {venueCount}
          </Text>
          <TouchableOpacity
            style={[styles.stepperBtn, { borderColor: c.oatMuted || '#c9c5bd' }]}
            onPress={() => setVenueCount(n => n + 1)}
          >
            <Text style={[styles.stepperBtnText, { color: c.missionSlate || '#3b3f4a' }]}>+</Text>
          </TouchableOpacity>
        </View>
        {moduleStatus(hasModule(MODULES.MULTI_VENUE))}
      </View>

      {/* ── Pro Ops Bundle ──────────────────────────────────────────────── */}
      <View style={[styles.bundleCard, { backgroundColor: c.surface || '#fbfaf6', borderColor: c.deepBlue || '#1b4f72' }]}>
        <View style={[styles.bundleBadge, { backgroundColor: c.deepBlue || '#1b4f72' }]}>
          <Text style={[styles.bundleBadgeText, { fontFamily: theme.fontBodySemiBold }]}>Best value</Text>
        </View>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold, marginTop: 10 }]}>
          Pro Ops Bundle
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          The complete operational upgrade. Supplier Optimisation, Ops Intelligence, and Performance &amp; Incentives — everything needed to run a tighter, smarter, more motivated operation, bundled together.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$169.00' : '$187.78'}<Text style={styles.modulePriceMo}>/mo</Text>
        </Text>
        <Text style={[styles.bundleSavingText, { color: c.positiveStrong || '#2f9e5d', fontFamily: theme.fontBodySemiBold }]}>
          Save {bundleSaving} vs. modules separately
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            $2,028.00/yr
          </Text>
        )}
        {moduleStatus(bundleActive)}
      </View>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        <Text style={[styles.footerNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Additional AI capacity is available for high-usage venues.
        </Text>
      </View>

    </ScrollView>
  );
}

export default withErrorBoundary(PricingScreen, 'Pricing');

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 48 },

  // Header
  heading: { fontSize: 26, marginBottom: 6 },
  subheading: { fontSize: 15, lineHeight: 22, marginBottom: 20 },

  // Billing period toggle
  toggle: { flexDirection: 'row', borderRadius: 12, padding: 4, marginBottom: 20 },
  toggleOption: { flex: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 9 },
  toggleText: { fontSize: 14 },
  toggleSavePill: { fontSize: 11, marginTop: 2 },

  // Core hero card (deep-blue)
  heroCard: { borderRadius: 16, padding: 24, marginBottom: 20 },
  heroLabel: { fontSize: 11, color: 'rgba(255,255,255,0.65)', letterSpacing: 1.2, marginBottom: 6 },
  heroPrice: { fontSize: 44, color: '#fff', marginBottom: 4 },
  heroPriceMo: { fontSize: 20, fontWeight: '400' },
  heroBillingNote: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 18 },
  heroFeatures: { marginBottom: 22 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  heroCheck: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginRight: 10, marginTop: 2 },
  heroFeatureText: { fontSize: 14, color: 'rgba(255,255,255,0.85)', flex: 1, lineHeight: 20 },

  // Core plan status (plain text, not a button)
  heroStatus: { alignItems: 'center', marginTop: 8 },
  heroStatusText: { fontSize: 14 },

  // Section heading
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 10 },

  // Module cards (shared)
  moduleCard: { borderRadius: 16, padding: 18, marginBottom: 12 },
  moduleName: { fontSize: 16, marginBottom: 4 },
  moduleDesc: { fontSize: 13, lineHeight: 19, marginBottom: 10 },
  modulePrice: { fontSize: 28, marginBottom: 2 },
  modulePriceMo: { fontSize: 14, fontWeight: '400' },
  moduleAnnualNote: { fontSize: 12, marginBottom: 12 },

  // Quantity stepper (Multi-Venue) — display-only price preview
  stepperRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  stepperLabel: { fontSize: 14, marginRight: 10 },
  stepperBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 20, lineHeight: 24 },
  stepperCount: { fontSize: 16, minWidth: 36, textAlign: 'center' },

  // Module inclusion status (plain text, not a button)
  statusRow: { marginTop: 4 },
  statusIncluded: { fontSize: 14 },
  statusNot: { fontSize: 13 },

  // Pro Ops Bundle card
  bundleCard: { borderRadius: 16, borderWidth: 1.5, padding: 18, marginBottom: 20 },
  bundleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  bundleBadgeText: { fontSize: 11, color: '#fff', letterSpacing: 0.3 },
  bundleSavingText: { fontSize: 13, marginBottom: 4 },

  // Footer
  footer: { alignItems: 'center', paddingTop: 4 },
  footerNote: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
