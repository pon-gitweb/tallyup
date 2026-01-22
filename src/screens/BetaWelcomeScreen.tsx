// @ts-nocheck
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { canStartStocktakeTrial } from '../services/trialStocktake';

// Uses your app icon from /assets/icon.png
const appIcon = require('../assets/icon.png');

export default function BetaWelcomeScreen() {
  const navigation = useNavigation<any>();

  const goDashboard = () => navigation.navigate('Dashboard');
  const goStockTake = async () => {
    const gate = await canStartStocktakeTrial();
    if (!gate.ok) {
      Alert.alert(
        'Trial ended',
        'You’ve used your 2 free full stock takes. Please subscribe to continue.',
      );
      return;
    }
    navigation.navigate('DepartmentSelection');
  };
  const goStockControl = () => navigation.navigate('StockControl');
  const goSuggestedOrders = () => navigation.navigate('SuggestedOrders');
  const goOrders = () => navigation.navigate('Orders');

  return (
    <View style={S.wrap}>
      <ScrollView contentContainerStyle={S.scroll} bounces={false}>
        <View style={S.heroCard}>
          <Image source={appIcon} style={S.icon} />
          <Text style={S.betaPill}>BETA</Text>
          <Text style={S.title}>Welcome to Hosti-Stock</Text>
          <Text style={S.subtitle}>
            Built for real hospitality venues. Load your products, run a full stock take,
            and let the AI help you order smarter.
          </Text>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>First time here?</Text>

          <View style={S.card}>
            <Text style={S.cardTitle}>1. Check your Dashboard</Text>
            <Text style={S.cardBody}>
              See where you are at a glance – recent stock takes, suggested orders,
              and open deliveries for your venue.
            </Text>
            <TouchableOpacity style={S.cardBtn} onPress={goDashboard}>
              <Text style={S.cardBtnText}>Go to Dashboard</Text>
            </TouchableOpacity>
          </View>

          <View style={S.card}>
            <Text style={S.cardTitle}>2. Load products & suppliers</Text>
            <Text style={S.cardBody}>
              Use CSV uploads, global catalog tools and fast price updates so your counts
              and GP are based on real numbers.
            </Text>
            <Text style={S.cardHint}>
              Tip: You can bulk-load price lists on desktop with CSV, then fine-tune on mobile.
            </Text>
          </View>

          <View style={S.card}>
            <Text style={S.cardTitle}>3. Run your first stock take</Text>
            <Text style={S.cardBody}>
              Choose a department, work through areas, and capture counts with expected
              quantities as a guide. You can restart departments after a completed cycle.
            </Text>
            <TouchableOpacity style={S.cardBtnSecondary} onPress={goStockTake}>
              <Text style={S.cardBtnSecondaryText}>Start a stock take</Text>
            </TouchableOpacity>
          </View>

          <View style={S.card}>
            <Text style={S.cardTitle}>4. Turn AI into a barback</Text>
            <Text style={S.cardBody}>
              Once sales and stock history are flowing, AI suggested orders and variances
              give you “don’t miss this” insights without spreadsheets.
            </Text>
            <View style={S.chipRow}>
              <View style={S.chip}>
                <Text style={S.chipText}>Suggested Orders</Text>
              </View>
              <View style={S.chip}>
                <Text style={S.chipText}>Variance insights</Text>
              </View>
              <View style={S.chip}>
                <Text style={S.chipText}>Recipe GP checks</Text>
              </View>
            </View>
            <TouchableOpacity style={S.cardBtn} onPress={goSuggestedOrders}>
              <Text style={S.cardBtnText}>Open Suggested Orders</Text>
            </TouchableOpacity>
          </View>

          <View style={S.card}>
            <Text style={S.cardTitle}>5. Receive like a pro</Text>
            <Text style={S.cardBody}>
              Use manual receive, CSV/PDF upload or Fast Receive snapshots so every
              delivery is matched to a PO and stored for audit.
            </Text>
            <Text style={S.cardHint}>
              You can come back to Pending Fast Receives later and attach them to submitted orders.
            </Text>
            <TouchableOpacity style={S.cardBtnSecondary} onPress={goOrders}>
              <Text style={S.cardBtnSecondaryText}>View Orders</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={S.footer}>
          <Text style={S.footerTitle}>We’re in BETA – and serious</Text>
          <Text style={S.footerText}>
            This build is for real venues. If it saves you time, cuts wastage, or helps
            your GP, we want you to feel confident paying for it.
          </Text>
          <Text style={S.footerTextDim}>
            Feedback from pilots directly shapes what ships next.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#020617',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
  },
  heroCard: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: '#0B1120',
    marginBottom: 14,
  },
  icon: { width: 52, height: 52, borderRadius: 12, marginBottom: 10 },
  betaPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#1D4ED8',
    color: 'white',
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  title: { color: 'white', fontSize: 24, fontWeight: '900', marginBottom: 6 },
  subtitle: { color: '#9CA3AF', lineHeight: 18 },

  section: { marginTop: 10 },
  sectionTitle: { color: 'white', fontWeight: '800', fontSize: 16, marginBottom: 10 },

  card: {
    backgroundColor: '#0B1120',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#111827',
  },
  cardTitle: { color: 'white', fontWeight: '900', marginBottom: 6 },
  cardBody: { color: '#D1D5DB', lineHeight: 18 },
  cardHint: { color: '#9CA3AF', marginTop: 10, lineHeight: 18 },

  cardBtn: {
    marginTop: 12,
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  cardBtnText: { color: 'white', fontWeight: '900' },

  cardBtnSecondary: {
    marginTop: 12,
    backgroundColor: '#111827',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardBtnSecondaryText: { color: 'white', fontWeight: '900' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  chipText: { color: '#E5E7EB', fontWeight: '800', fontSize: 12 },

  footer: { marginTop: 10, padding: 16 },
  footerTitle: { color: 'white', fontWeight: '900', fontSize: 16, marginBottom: 6 },
  footerText: { color: '#D1D5DB', lineHeight: 18 },
  footerTextDim: { color: '#9CA3AF', marginTop: 6, lineHeight: 18 },
});
