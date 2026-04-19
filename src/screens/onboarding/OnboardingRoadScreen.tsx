// @ts-nocheck
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { FEATURES } from '../../config/features';

export default function OnboardingRoadScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const colours = useColours();
  const S = makeStyles(colours);

  async function dismiss() {
    if (venueId) {
      updateDoc(doc(db, 'venues', venueId), {
        onboardingDismissedAt: serverTimestamp(),
      }).catch(() => {});
    }
    nav.navigate('Dashboard');
  }

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content}>
        <Text style={S.eyebrow}>Welcome to TallyUp</Text>
        <Text style={S.h1}>Let's set up your venue your way</Text>
        <Text style={S.lead}>
          Two minutes now saves you hours later. Pick the path that fits where you are today.
        </Text>

        <TouchableOpacity style={[S.card, S.cardFresh]} onPress={() => nav.navigate('OnboardingFreshStart')}>
          <Text style={S.cardIcon}>🌱</Text>
          <Text style={S.cardTitle}>Starting fresh</Text>
          <Text style={S.cardDesc}>
            New to proper stocktakes, or want a clean slate? We'll load smart starting PAR levels, set up
            your venue structure, and show you exactly what your first count will reveal.
          </Text>
          <Text style={S.cardCta}>Let's go →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[S.card, S.cardData]} onPress={() => nav.navigate('OnboardingBringData')}>
          <Text style={S.cardIcon}>📦</Text>
          <Text style={S.cardTitle}>Bringing your data</Text>
          <Text style={S.cardDesc}>
            Already doing stocktakes and want to carry over your products, counts, and invoices? We'll import
            what you have and flag what's missing.
          </Text>
          <Text style={S.cardCta}>Import my data →</Text>
        </TouchableOpacity>

        {!FEATURES.ONBOARDING_HARD_GATE && (
          <TouchableOpacity onPress={dismiss} style={S.skipBtn}>
            <Text style={S.skipText}>Skip for now — take me to the dashboard</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useColours>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    content: { padding: 24, paddingBottom: 40 },
    eyebrow: {
      fontSize: 12, fontWeight: '700', color: c.primary,
      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
    },
    h1: { fontSize: 26, fontWeight: '900', color: c.navy, marginBottom: 10, lineHeight: 32 },
    lead: { fontSize: 15, color: c.textSecondary, marginBottom: 28, lineHeight: 22 },
    card: { borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1.5 },
    cardFresh: { backgroundColor: c.surface, borderColor: c.primary },
    cardData: { backgroundColor: c.surface, borderColor: c.border },
    cardIcon: { fontSize: 28, marginBottom: 10 },
    cardTitle: { fontSize: 18, fontWeight: '800', color: c.navy, marginBottom: 6 },
    cardDesc: { fontSize: 14, color: c.textSecondary, lineHeight: 20, marginBottom: 14 },
    cardCta: { fontSize: 14, fontWeight: '700', color: c.primary },
    skipBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 14 },
    skipText: { fontSize: 13, color: c.textSecondary, textDecorationLine: 'underline' },
  });
}
