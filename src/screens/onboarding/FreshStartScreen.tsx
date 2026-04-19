// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  SafeAreaView, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { seedDefaultDepartmentsAndAreas } from '../../services/onboarding/defaultDepartments';
import { seedDefaultVenueSuppliers } from '../../services/onboarding/defaultSuppliers';

const PAR_TABLE = [
  { category: 'Beer & Cider', level: 24, unit: 'units', why: "A case a night on a good week" },
  { category: 'Wine', level: 6, unit: 'bottles', why: 'Roughly a bottle a day across the week' },
  { category: 'Spirits', level: 2, unit: 'bottles', why: 'Most spirits rotate slowly at bar' },
  { category: 'Dry Goods', level: 2, unit: 'units', why: 'Low turnover, easy to restock' },
  { category: 'Perishables', level: 1, unit: 'units', why: 'Short shelf life — order little and often' },
];

export default function FreshStartScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const colours = useColours();
  const [busy, setBusy] = useState(false);
  const S = makeStyles(colours);

  async function onSetUp() {
    if (!venueId || busy) return;
    setBusy(true);
    try {
      await Promise.all([
        seedDefaultDepartmentsAndAreas(venueId),
        seedDefaultVenueSuppliers(venueId),
      ]);
      await updateDoc(doc(db, 'venues', venueId), {
        onboardingRoad: 'fresh',
        onboardingCompletedAt: serverTimestamp(),
      });
      nav.navigate('Dashboard');
    } catch (e: any) {
      Alert.alert('Setup failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.content}>
        <Text style={S.eyebrow}>Road 1 — Fresh start</Text>
        <Text style={S.h1}>Your next stocktake is going to be a doozy — in the best way</Text>

        <View style={S.revealCard}>
          <Text style={S.revealTitle}>Here's what your first stocktake reveals</Text>
          {[
            'What you actually have — not what you think you have',
            'Which areas are running hot (overstocked and tying up cash)',
            "What's about to run out before your next order arrives",
            'Your baseline for every report, variance, and reorder from now on',
          ].map((item, i) => (
            <View key={i} style={S.revealRow}>
              <Text style={S.bullet}>✓</Text>
              <Text style={S.revealText}>{item}</Text>
            </View>
          ))}
        </View>

        <Text style={S.sectionTitle}>Smart starting PAR levels — by category</Text>
        <Text style={S.sectionHint}>
          PAR is the minimum you want on hand before you reorder. These are sensible defaults based on typical
          hospitality turnover — you'll dial them in after your first count.
        </Text>

        <View style={S.parTable}>
          {PAR_TABLE.map((row, i) => (
            <View
              key={row.category}
              style={[S.parRow, i === PAR_TABLE.length - 1 && { borderBottomWidth: 0 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={S.parCategory}>{row.category}</Text>
                <Text style={S.parWhy}>{row.why}</Text>
              </View>
              <View style={S.parBadge}>
                <Text style={S.parLevel}>{row.level}</Text>
                <Text style={S.parUnit}>{row.unit}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={S.structureCard}>
          <Text style={S.structureTitle}>Your venue structure — ready instantly</Text>
          <Text style={S.structureHint}>
            We'll load standard bar, kitchen, and cellar areas plus common NZ suppliers — so you can start
            counting in minutes:
          </Text>
          <View style={S.pillWrap}>
            {['Bar', 'Kitchen', 'Bottle Store', 'Lounge'].map((d) => (
              <View key={d} style={S.pill}>
                <Text style={S.pillText}>{d}</Text>
              </View>
            ))}
          </View>
          <Text style={S.structureNote}>
            Add, rename, or remove anything from Settings after setup.
          </Text>
        </View>

        <TouchableOpacity
          style={[S.cta, busy && { opacity: 0.6 }]}
          onPress={onSetUp}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={S.ctaText}>Set up my venue</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => nav.goBack()} style={S.backBtn}>
          <Text style={S.backText}>Back to road selection</Text>
        </TouchableOpacity>
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
    h1: { fontSize: 24, fontWeight: '900', color: c.navy, marginBottom: 20, lineHeight: 32 },

    revealCard: {
      backgroundColor: '#FFF8F0', borderRadius: 14, padding: 16, marginBottom: 24,
      borderWidth: 1, borderColor: '#F0D4A8',
    },
    revealTitle: { fontSize: 15, fontWeight: '800', color: c.navy, marginBottom: 12 },
    revealRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
    bullet: { color: c.amber, fontWeight: '900', fontSize: 14, marginTop: 1 },
    revealText: { flex: 1, fontSize: 14, color: c.text, lineHeight: 20 },

    sectionTitle: { fontSize: 16, fontWeight: '800', color: c.navy, marginBottom: 6 },
    sectionHint: { fontSize: 13, color: c.textSecondary, marginBottom: 14, lineHeight: 19 },

    parTable: {
      borderRadius: 12, overflow: 'hidden', borderWidth: 1,
      borderColor: c.border, marginBottom: 24,
    },
    parRow: {
      flexDirection: 'row', alignItems: 'center', padding: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border,
      backgroundColor: c.surface,
    },
    parCategory: { fontSize: 14, fontWeight: '700', color: c.navy },
    parWhy: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    parBadge: { alignItems: 'center', marginLeft: 12, minWidth: 40 },
    parLevel: { fontSize: 20, fontWeight: '900', color: c.primary },
    parUnit: { fontSize: 10, color: c.textSecondary, textAlign: 'center' },

    structureCard: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16,
      marginBottom: 24, borderWidth: 1, borderColor: c.border,
    },
    structureTitle: { fontSize: 15, fontWeight: '800', color: c.navy, marginBottom: 4 },
    structureHint: { fontSize: 13, color: c.textSecondary, marginBottom: 12, lineHeight: 19 },
    pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    pill: {
      backgroundColor: c.primaryLight, borderRadius: 999,
      paddingHorizontal: 12, paddingVertical: 6,
      borderWidth: 1, borderColor: c.primary,
    },
    pillText: { fontSize: 12, fontWeight: '700', color: c.primary },
    structureNote: { fontSize: 11, color: c.textSecondary },

    cta: {
      backgroundColor: c.primary, borderRadius: 999,
      paddingVertical: 16, alignItems: 'center', marginBottom: 12,
    },
    ctaText: { color: c.primaryText, fontSize: 16, fontWeight: '800' },
    backBtn: { alignItems: 'center', paddingVertical: 12 },
    backText: { fontSize: 13, color: c.textSecondary, textDecorationLine: 'underline' },
  });
}
