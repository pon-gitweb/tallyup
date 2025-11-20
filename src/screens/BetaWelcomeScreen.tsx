// @ts-nocheck
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

// Uses your app icon from /assets/icon.png
const appIcon = require('../assets/icon.png');

export default function BetaWelcomeScreen() {
  const navigation = useNavigation<any>();

  const goDashboard = () => navigation.navigate('Dashboard');
  const goStockTake = () => navigation.navigate('DepartmentSelection');
  const goStockControl = () => navigation.navigate('StockControl');
  const goSuggestedOrders = () => navigation.navigate('SuggestedOrders');
  const goOrders = () => navigation.navigate('Orders');

  return (
    <View style={S.wrap}>
      <ScrollView contentContainerStyle={S.scroll} bounces={false}>
        <View style={S.heroCard}>
          <Image source={appIcon} style={S.icon} />
          <Text style={S.betaPill}>BETA</Text>
          <Text style={S.title}>Welcome to TallyUp</Text>
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
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    marginBottom: 8,
  },
  betaPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#38bdf8',
    color: '#e0f2fe',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F9FAFB',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  section: {
    marginTop: 12,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E5E7EB',
    marginBottom: 4,
  },
  card: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: 'rgba(55,65,81,0.9)',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F9FAFB',
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 13,
    color: '#D1D5DB',
  },
  cardHint: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 6,
  },
  cardBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#22c55e',
    alignItems: 'center',
  },
  cardBtnText: {
    color: '#022c22',
    fontWeight: '800',
    fontSize: 13,
  },
  cardBtnSecondary: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4B5563',
    alignItems: 'center',
  },
  cardBtnSecondaryText: {
    color: '#E5E7EB',
    fontWeight: '700',
    fontSize: 13,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  chipText: {
    fontSize: 11,
    color: '#e5e7eb',
    fontWeight: '600',
  },
  footer: {
    marginTop: 16,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
    backgroundColor: '#020617',
  },
  footerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E7EB',
    marginBottom: 4,
  },
  footerText: {
    fontSize: 12,
    color: '#D1D5DB',
  },
  footerTextDim: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
  },
});
