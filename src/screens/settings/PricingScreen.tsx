import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Linking,
} from 'react-native';
import { getAuth } from 'firebase/auth';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useVenueId, useSubscription } from '../../context/VenueProvider';
import { MODULES } from '../../services/billing/modules';
import { createCheckout, addSubscriptionItem, openBillingPortal } from '../../services/payments';
import { useToast } from '../../components/common/Toast';
import { withErrorBoundary } from '../../components/ErrorCatcher';

const SUCCESS_URL = 'tallyup://billing-success';
const CANCEL_URL  = 'tallyup://billing-cancel';

type BillingPeriod = 'monthly' | 'annual';

function PricingScreen() {
  const c = useColours();
  const { theme } = useTheme();
  const venueId = useVenueId();
  const { isPilot, isActive, hasModule } = useSubscription();
  const { showSuccess, showError } = useToast();
  const uid = getAuth().currentUser?.uid ?? '';

  const [billing, setBilling] = useState<BillingPeriod>('annual');
  const [busy, setBusy] = useState<string | null>(null);
  const [venueCount, setVenueCount] = useState(1);

  // Selects the lookup key for the active billing period
  const lk = (monthly: string, annual: string) =>
    billing === 'annual' ? annual : monthly;

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleCore() {
    if (!uid || !venueId) return;
    setBusy('core');
    try {
      const result = await createCheckout({
        uid, venueId,
        lookupKey: lk('core_monthly_rolling', 'core_annual'),
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      });
      if (result.url) await Linking.openURL(result.url);
    } catch (e: any) {
      showError(e?.message || 'Could not start checkout. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handleModule(key: string, monthlyLk: string, annualLk: string, qty?: number) {
    if (!uid || !venueId) return;
    setBusy(key);
    try {
      await addSubscriptionItem({
        uid, venueId,
        lookupKey: lk(monthlyLk, annualLk),
        ...(qty !== undefined && { quantity: qty }),
      });
      showSuccess('✓ Module added. Your subscription has been updated.');
    } catch (e: any) {
      showError(e?.message || 'Could not add module. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handlePortal() {
    if (!uid || !venueId) return;
    setBusy('portal');
    try {
      const result = await openBillingPortal({ uid, venueId, returnUrl: SUCCESS_URL });
      if (result.url) await Linking.openURL(result.url);
    } catch (e: any) {
      showError(e?.message || 'Could not open billing portal. Please try again.');
    } finally {
      setBusy(null);
    }
  }

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

  // ── Module button renderer ───────────────────────────────────────────────
  // Plain function (not a component) so it doesn't trigger React's
  // component-in-component reconciliation warning.

  function renderModuleBtn(
    id: string,
    isModActive: boolean,
    monthlyLk: string,
    annualLk: string,
    qty?: number,
  ) {
    if (isModActive) {
      return (
        <View style={[styles.btn, { backgroundColor: c.positiveSoft || '#e6f3ec' }]}>
          <Text style={[styles.btnText, { color: c.positiveStrong || '#2f9e5d', fontFamily: theme.fontBodySemiBold }]}>
            ✓ Active
          </Text>
        </View>
      );
    }
    if (!isActive) {
      return (
        <View style={[styles.btn, { backgroundColor: c.primaryLight || '#ece8de' }]}>
          <Text style={[styles.btnText, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBodySemiBold }]}>
            Requires Core
          </Text>
        </View>
      );
    }
    const isBusy = busy === id;
    return (
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: c.deepBlue || '#1b4f72', opacity: isBusy ? 0.7 : 1 }]}
        onPress={() => handleModule(id, monthlyLk, annualLk, qty)}
        disabled={!!busy}
      >
        {isBusy
          ? <ActivityIndicator color="#fff" size="small" />
          : <Text style={[styles.btnText, { color: '#fff', fontFamily: theme.fontBodySemiBold }]}>Add</Text>
        }
      </TouchableOpacity>
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
        Choose your plan
      </Text>
      <Text style={[styles.subheading, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
        Start with Core, add what you need as you grow.
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
            'Invoice scanning and automatic variance detection',
            'Variance reporting and full stocktake history',
            'Product catalogue and supplier management',
          ].map((feature, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={styles.heroCheck}>✓</Text>
              <Text style={[styles.heroFeatureText, { fontFamily: theme.fontBody }]}>{feature}</Text>
            </View>
          ))}
        </View>
        {coreActive ? (
          <View style={styles.heroActiveBtn}>
            <Text style={[styles.heroActiveBtnText, { fontFamily: theme.fontBodySemiBold }]}>
              ✓ Active
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.heroBtn, { opacity: busy === 'core' ? 0.7 : 1 }]}
            onPress={handleCore}
            disabled={!!busy}
          >
            {busy === 'core'
              ? <ActivityIndicator color={c.deepBlue || '#1b4f72'} />
              : <Text style={[styles.heroBtnText, { color: c.deepBlue || '#1b4f72', fontFamily: theme.fontBodySemiBold }]}>
                  Subscribe to Core
                </Text>
            }
          </TouchableOpacity>
        )}
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
          AI-driven order suggestions and supplier performance tracking.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$79.00' : '$87.78'}<Text style={styles.modulePriceMo}>/mo</Text>
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            $948.00/yr
          </Text>
        )}
        {renderModuleBtn(
          'supplier',
          hasModule(MODULES.SUPPLIER_OPTIMISATION),
          'supplier_optimisation_monthly_rolling',
          'supplier_optimisation_annual',
        )}
      </View>

      {/* Ops Intelligence */}
      <View style={[styles.moduleCard, { backgroundColor: c.surface || '#fbfaf6' }]}>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
          Ops Intelligence
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Hosti Health scores, KPI dashboards, and operational insights.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$69.00' : '$76.67'}<Text style={styles.modulePriceMo}>/mo</Text>
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            $828.00/yr
          </Text>
        )}
        {renderModuleBtn(
          'ops',
          hasModule(MODULES.OPS_INTELLIGENCE),
          'ops_intelligence_monthly_rolling',
          'ops_intelligence_annual',
        )}
      </View>

      {/* Performance & Incentives */}
      <View style={[styles.moduleCard, { backgroundColor: c.surface || '#fbfaf6' }]}>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
          Performance & Incentives
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Staff leaderboards, gamified targets, and performance reward tracking.
        </Text>
        <Text style={[styles.modulePrice, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitleBold }]}>
          {billing === 'annual' ? '$39.00' : '$43.33'}<Text style={styles.modulePriceMo}>/mo</Text>
        </Text>
        {billing === 'annual' && (
          <Text style={[styles.moduleAnnualNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            $468.00/yr
          </Text>
        )}
        {renderModuleBtn(
          'perf',
          hasModule(MODULES.PERFORMANCE_INCENTIVES),
          'performance_incentives_monthly_rolling',
          'performance_incentives_annual',
        )}
      </View>

      {/* Multi-Venue Command Centre */}
      <View style={[styles.moduleCard, { backgroundColor: c.surface || '#fbfaf6' }]}>
        <Text style={[styles.moduleName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
          Multi-Venue Command Centre
        </Text>
        <Text style={[styles.moduleDesc, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Consolidated dashboards, cross-venue reporting, and group management.
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
        {/* Venue count stepper */}
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
        {renderModuleBtn(
          'multivenue',
          hasModule(MODULES.MULTI_VENUE),
          'multi_venue_monthly_rolling',
          'multi_venue_annual',
          venueCount,
        )}
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
          Supplier Optimisation + Ops Intelligence + Performance & Incentives, bundled.
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
        {renderModuleBtn(
          'bundle',
          bundleActive,
          'pro_ops_bundle_monthly_rolling',
          'pro_ops_bundle_annual',
        )}
      </View>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handlePortal}
          disabled={!!busy}
          style={{ opacity: busy === 'portal' ? 0.6 : 1 }}
        >
          {busy === 'portal'
            ? <ActivityIndicator size="small" color={c.deepBlue || '#1b4f72'} />
            : <Text style={[styles.portalLink, { color: c.deepBlue || '#1b4f72', fontFamily: theme.fontBodySemiBold }]}>
                Manage or cancel anytime →
              </Text>
          }
        </TouchableOpacity>
        <Text style={[styles.footerNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          AI usage beyond plan limits can be purchased as an extension when needed.
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
  heroBtn: { backgroundColor: '#fff', height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heroBtnText: { fontSize: 15 },
  heroActiveBtn: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  heroActiveBtnText: { fontSize: 15, color: 'rgba(255,255,255,0.85)' },

  // Section heading
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 10 },

  // Module cards (shared)
  moduleCard: { borderRadius: 16, padding: 18, marginBottom: 12 },
  moduleName: { fontSize: 16, marginBottom: 4 },
  moduleDesc: { fontSize: 13, lineHeight: 19, marginBottom: 10 },
  modulePrice: { fontSize: 28, marginBottom: 2 },
  modulePriceMo: { fontSize: 14, fontWeight: '400' },
  moduleAnnualNote: { fontSize: 12, marginBottom: 12 },

  // Quantity stepper (Multi-Venue)
  stepperRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  stepperLabel: { fontSize: 14, marginRight: 10 },
  stepperBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 20, lineHeight: 24 },
  stepperCount: { fontSize: 16, minWidth: 36, textAlign: 'center' },

  // Module button states
  btn: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnText: { fontSize: 14 },

  // Pro Ops Bundle card
  bundleCard: { borderRadius: 16, borderWidth: 1.5, padding: 18, marginBottom: 20 },
  bundleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  bundleBadgeText: { fontSize: 11, color: '#fff', letterSpacing: 0.3 },
  bundleSavingText: { fontSize: 13, marginBottom: 4 },

  // Footer
  footer: { alignItems: 'center', gap: 10, paddingTop: 4 },
  portalLink: { fontSize: 14 },
  footerNote: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
