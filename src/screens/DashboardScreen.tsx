// @ts-nocheck
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../context/VenueProvider';
import IdentityBadge from '../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../hooks/useIdentityLabels';
import { canStartStocktakeTrial } from '../services/trialStocktake';

export default function DashboardScreen() {
  const nav = useNavigation<any>();

  // identity (friendly + badge)
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();
  const { name: venueName } = useVenueInfo(venueId);
  const friendly = useMemo(() => {
    return friendlyIdentity(
      { displayName: user?.displayName ?? null, email: user?.email ?? null, uid: user?.uid ?? null },
      { name: venueName ?? null, venueId: venueId ?? null }
    );
  }, [user?.displayName, user?.email, user?.uid, venueName, venueId]);

  const [busy, setBusy] = useState(false);

  const onOpenStockTake = async () => {
    if (busy) return;
    try {
      setBusy(true);

      // Trial gate (TEMP): block once 2 full stocktakes have been submitted
      const gate = await canStartStocktakeTrial();
      if (!gate.ok) {
        Alert.alert(
          'Trial ended',
          'You’ve used your 2 free full stock takes. Please subscribe to continue.',
        );
        return;
      }

      nav.navigate('DepartmentSelection');
    } finally {
      setBusy(false);
    }
  };

  const onOpenSuggestedOrders = () => {
    nav.navigate('SuggestedOrders');
  };

  const onOpenOrders = () => {
    nav.navigate('Orders');
  };

  const onOpenStockControl = () => {
    nav.navigate('StockControl');
  };

  const onOpenReports = () => {
    nav.navigate('Reports');
  };

  const onOpenSettings = () => {
    nav.navigate('Settings');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header with badge */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Dashboard</Text>
            <Text style={styles.headerSub}>Hi {friendly}</Text>
            <Text style={styles.headerHint}>
              This is your BETA home base. Start a stocktake, manage orders, and check reports from here.
            </Text>
          </View>
          <IdentityBadge />
        </View>

        {/* Stocktake focus */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Run your stocktake</Text>
          <Text style={styles.cardSub}>
            Stocktake by department and area with expected quantities and full history. You can return to an
            in-progress stocktake at any time.
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.primary]}
            onPress={onOpenStockTake}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.buttonText}>Start / Return Stock Take</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Orders + invoices */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ordering & invoices</Text>
          <Text style={styles.cardSub}>
            Use suggested orders to build supplier orders from your stock and sales, and manage open orders and
            deliveries. Invoice upload and receiving flows live under Orders.
          </Text>
          <View style={styles.rowButtons}>
            <TouchableOpacity
              style={[styles.buttonSmall, styles.dark]}
              onPress={onOpenSuggestedOrders}
            >
              <Text style={styles.buttonSmallText}>Suggested Orders</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonSmall, styles.dark]}
              onPress={onOpenOrders}
            >
              <Text style={styles.buttonSmallText}>Orders</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Control & reports */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Control & reports</Text>
          <Text style={styles.cardSub}>
            Keep your products and suppliers organised, and review variance and performance reports. Use Settings
            for venue-level controls and BETA options.
          </Text>
          <View style={styles.rowButtons}>
            <TouchableOpacity
              style={[styles.buttonSmall, styles.muted]}
              onPress={onOpenStockControl}
            >
              <Text style={styles.buttonSmallTextDark}>Stock Control</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonSmall, styles.muted]}
              onPress={onOpenReports}
            >
              <Text style={styles.buttonSmallTextDark}>Reports</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buttonSmall, styles.muted]}
              onPress={onOpenSettings}
            >
              <Text style={styles.buttonSmallTextDark}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tiny BETA hint about revisiting the overview */}
        <Text style={styles.footerHint}>
          You can revisit the BETA overview from Settings → About (coming soon for pilot venues).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const PRIMARY = '#0B132B';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'white' },
  container: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  headerSub: { color: '#6B7280', marginTop: 2, fontSize: 14 },
  headerHint: {
    color: '#9CA3AF',
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 260,
  },

  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
    color: PRIMARY,
  },
  cardSub: {
    color: '#4B5563',
    marginBottom: 12,
    lineHeight: 18,
  },

  button: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: '#0A84FF',
  },
  buttonText: {
    color: 'white',
    fontWeight: '800',
  },

  rowButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonSmall: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  dark: {
    backgroundColor: '#111827',
  },
  muted: {
    backgroundColor: '#EEF2FF',
  },
  buttonSmallText: {
    color: 'white',
    fontWeight: '800',
  },
  buttonSmallTextDark: {
    color: '#111827',
    fontWeight: '800',
  },

  footerHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
