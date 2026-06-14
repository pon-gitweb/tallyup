import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getFirestore, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useVenueId } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';

export default function FestivalPaywallScreen({ navigation, route }: any) {
  const c = useColours();
  const { theme } = useTheme();
  const venueId = useVenueId();
  const { showSuccess, showError } = useToast();
  const [activating, setActivating] = useState(false);

  const venueName = route?.params?.venueName || 'this festival';

  const FEATURES = [
    'Full predicted order revealed',
    'Order quantity adjustment',
    'Generate purchase orders',
    'Live stock counting across all bars',
    'Real-time ops dashboard',
    'Top-up requests and transfers',
    'Suitee AI intelligence',
    'Returns and reconciliation',
    'Event close and debrief',
    'Year-on-year data preserved'
  ];

  // STUB: Manual activation for pilots
  // Replace with Stripe payment intent when billing is built
  async function handleActivate() {
    if (!venueId) return;
    setActivating(true);

    try {
      const db = getFirestore();
      await updateDoc(doc(db, 'venues', venueId), {
        activated: true,
        activatedAt: serverTimestamp(),
        activationPrice: 349,
        // Stripe fields added later:
        // stripePaymentIntentId: null,
        // stripeCustomerId: null
      });

      showSuccess('✓ Festival activated. All features unlocked.');
      navigation.goBack();
    } catch (e: any) {
      showError('Could not activate. Please try again.');
    } finally {
      setActivating(false);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.oat || '#f5f3ee' }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.emoji}>🎪</Text>
          <Text style={[styles.title, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitle }]}>
            Activate {venueName}
          </Text>
          <Text style={[styles.subtitle, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            Everything you need to run your festival bar operation.
          </Text>
        </View>

        {/* Price card */}
        <View style={[styles.priceCard, { backgroundColor: c.deepBlue || '#1b4f72' }]}>
          <Text style={[styles.price, { fontFamily: theme.fontTitle }]}>$349</Text>
          <Text style={[styles.priceNote, { fontFamily: theme.fontBody }]}>
            One-time payment per event. No subscription. No recurring charges.
          </Text>
        </View>

        {/* Features */}
        <View style={[styles.featuresCard, { backgroundColor: c.surface || '#ffffff' }]}>
          <Text style={[styles.featuresTitle, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
            What's included
          </Text>
          {FEATURES.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Text style={[styles.featureCheck, { color: c.deepBlue || '#1b4f72' }]}>✓</Text>
              <Text style={[styles.featureText, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBody }]}>
                {f}
              </Text>
            </View>
          ))}
        </View>

        {/* Custom pricing note */}
        <Text style={[styles.customNote, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Events longer than 7 days? Contact us for custom pricing.{'\n'}
          hello@hosti.co.nz
        </Text>

        {/* Activate button */}
        <TouchableOpacity
          style={[styles.activateBtn, { backgroundColor: c.deepBlue || '#1b4f72', opacity: activating ? 0.7 : 1 }]}
          onPress={handleActivate}
          disabled={activating}
        >
          {activating
            ? <ActivityIndicator color="#ffffff" />
            : <Text style={[styles.activateBtnText, { fontFamily: theme.fontBodySemiBold }]}>
                Activate for $349 →
              </Text>
          }
        </TouchableOpacity>

        {/* Back link */}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={[styles.backBtnText, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            Not yet — continue planning
          </Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: 24 },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 26, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  priceCard: { borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16 },
  price: { fontSize: 48, color: '#ffffff', marginBottom: 8 },
  priceNote: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  featuresCard: { borderRadius: 16, padding: 20, marginBottom: 16 },
  featuresTitle: { fontSize: 15, marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  featureCheck: { fontSize: 15, marginRight: 10, marginTop: 1 },
  featureText: { fontSize: 14, lineHeight: 20, flex: 1 },
  customNote: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  activateBtn: { height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  activateBtnText: { color: '#ffffff', fontSize: 16 },
  backBtn: { paddingVertical: 12, alignItems: 'center' },
  backBtnText: { fontSize: 14 }
});
