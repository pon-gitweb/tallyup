// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, SafeAreaView, StyleSheet, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SETUP_WIZARD_KEY = 'setup_wizard_seen';

const STEPS = [
  {
    emoji: '📦',
    title: 'Welcome to Hosti',
    body:
      'A stocktake is a count of everything you have in your venue right now.\n\n' +
      'Done regularly it helps you:\n' +
      '✓ Know exactly what stock you have\n' +
      '✓ Spot missing or wasted stock\n' +
      '✓ Make smarter ordering decisions\n' +
      '✓ Understand what your stock is worth\n\n' +
      'Most venues count weekly or fortnightly.\n' +
      'It takes about 20 minutes once you\'re set up.',
    cta: 'Next →',
  },
  {
    emoji: '🔄',
    title: "Here's the flow",
    body:
      '1️⃣  Add your products to areas\n' +
      '   Bar, Cellar, Kitchen — wherever things live\n\n' +
      '2️⃣  Count what you have\n' +
      '   Scan barcodes or search your inventory\n\n' +
      '3️⃣  Submit when done\n' +
      '   We calculate your stock value and variance\n\n' +
      '4️⃣  Compare over time\n' +
      '   See what\'s changing and why\n\n' +
      'Your departments are already set up. You just need to add products and count.',
    cta: 'Next →',
  },
  {
    emoji: '✓',
    title: "You're ready to start",
    body:
      'Three ways to add products:\n\n' +
      '📷  Scan a barcode\n' +
      '   Point at any bottle — instant identification\n\n' +
      '📄  Scan an invoice\n' +
      '   Add your whole order at once\n\n' +
      '🔍  Search and add\n' +
      '   Find products already in your venue\n\n' +
      'Head to the Stock tab and tap any department to begin your first stocktake.',
    cta: 'Go to dashboard →',
  },
];

export default function SetupWizardScreen() {
  const nav = useNavigation<any>();
  const [step, setStep] = useState(0);

  const dismiss = async () => {
    await AsyncStorage.setItem(SETUP_WIZARD_KEY, '1').catch(() => {});
    nav.reset({
      index: 0,
      routes: [{ name: 'Dashboard' }],
    });
  };

  const next = async () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      await dismiss();
    }
  };

  const current = STEPS[step];

  return (
    <SafeAreaView style={S.safe}>
      <TouchableOpacity style={S.skip} onPress={dismiss}>
        <Text style={S.skipText}>Skip</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
        <View style={S.hero}>
          <Text style={S.heroEmoji}>{current.emoji}</Text>
          <Text style={S.heroTitle}>{current.title}</Text>
        </View>
        <Text style={S.body}>{current.body}</Text>
      </ScrollView>

      <View style={S.dots}>
        {STEPS.map((_, i) => (
          <View key={i} style={[S.dot, i === step && S.dotActive]} />
        ))}
      </View>

      <TouchableOpacity style={S.cta} onPress={next} activeOpacity={0.85}>
        <Text style={S.ctaText}>{current.cta}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f3ee' },
  skip: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8 },
  skipText: { color: '#9ca3af', fontSize: 15, fontWeight: '600' },
  content: { padding: 24, paddingTop: 72, paddingBottom: 24, flexGrow: 1 },
  hero: {
    backgroundColor: '#0D9488', borderRadius: 20, padding: 24,
    marginBottom: 20, alignItems: 'flex-start',
  },
  heroEmoji: { fontSize: 44, marginBottom: 8 },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#fff' },
  body: {
    fontSize: 15, color: '#374151', lineHeight: 26,
    backgroundColor: '#fff', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#e5e1d8',
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#d1d5db' },
  dotActive: { backgroundColor: '#0D9488', width: 24 },
  cta: {
    backgroundColor: '#065f46', marginHorizontal: 24, marginBottom: 24,
    borderRadius: 999, paddingVertical: 16, alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
