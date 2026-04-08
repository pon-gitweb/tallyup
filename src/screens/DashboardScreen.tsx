import SetupGuideBanner from '../components/guide/SetupGuideBanner';
import OfflineBanner from '../components/OfflineBanner';
import { useTheme, useColours } from '../context/ThemeContext';
import { Image } from 'react-native';
// @ts-nocheck
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useVenueId } from '../context/VenueProvider';
import IdentityBadge from '../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../hooks/useIdentityLabels';

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
  const [lastArea, setLastArea] = React.useState<{deptId:string;areaId:string;areaName:string;deptName:string} | null>(null);

  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    // Find the most recently started area that isn't completed
    const db2 = getFirestore();
    getDocs(collection(db2, 'venues', venueId, 'departments')).then(async deptSnap => {
        let best: any = null;
        for (const deptDoc of deptSnap.docs) {
          const areasSnap = await getDocs(
            query(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'),
              orderBy('startedAt', 'desc'), limit(3))
          );
          for (const areaDoc of areasSnap.docs) {
            const data = areaDoc.data();
            if (data.startedAt && !data.completedAt) {
              if (!best || data.startedAt.toMillis() > best.startedAt) {
                best = { deptId: deptDoc.id, areaId: areaDoc.id, areaName: data.name || 'Area', deptName: deptDoc.data().name || 'Department', startedAt: data.startedAt.toMillis() };
              }
            }
          }
        }
        if (best) setLastArea(best);
    }).catch(() => {});
  }, [venueId]);
  const [stocktakeCount, setStocktakeCount] = React.useState(0);
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    getDoc(doc(db, 'venues', venueId)).then(snap => {
      if (snap.exists()) {
        const data = snap.data() as any;
        setStocktakeCount(data?.totalStocktakesCompleted || 0);
      }
    }).catch(() => {});
  }, [venueId]);
  const { theme } = useTheme();
  const colours = useColours();

  const onOpenStockTake = async () => {
    if (busy) return;
    try {
      setBusy(true);
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
{theme.logoUri ? <Image source={{ uri: theme.logoUri }} style={{ width: 80, height: 32, resizeMode: 'contain' }} /> : null}
          <IdentityBadge />
        </View>
        <OfflineBanner />
        {lastArea && (
          <TouchableOpacity
            onPress={() => nav.navigate('StockTakeAreaInventory' as never, { venueId, departmentId: lastArea.deptId, areaId: lastArea.areaId } as never)}
            style={{ marginHorizontal: 12, marginBottom: 4, backgroundColor: '#0F172A', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 20 }}>▶️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>Continue stocktake</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{lastArea.deptName} → {lastArea.areaName}</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        )}
        <SetupGuideBanner onNavigate={(route, params) => nav.navigate(route as never, params as never)} />
        {stocktakeCount > 0 && (
          <View style={{ marginHorizontal: 12, marginBottom: 4, backgroundColor: '#F0FDF4', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#BBF7D0' }}>
            <Text style={{ fontSize: 16 }}>🧠</Text>
            <Text style={{ color: '#166534', fontSize: 12, flex: 1, fontWeight: '600' }}>
              Your AI has learned from {stocktakeCount} stocktake{stocktakeCount > 1 ? 's' : ''} — suggestions improve over time
            </Text>
          </View>
        )}

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
const ACCENT = '#3B82F6';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'white' },
  container: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32, // extra bottom padding so last card is reachable
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
    backgroundColor: colours.background,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 12,
    lineHeight: 18,
  },

  button: {
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  primary: { backgroundColor: ACCENT },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 15 },

  rowButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  buttonSmall: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dark: {
    backgroundColor: colours.primary,
  },
  muted: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  buttonSmallText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 13,
  },
  buttonSmallTextDark: {
    color: PRIMARY,
    fontWeight: '600', 
    fontSize: 13,
  },
  footerHint: {
    fontSize: 11,
    color: '#9CA3AF',
    marginBottom: 8,
  },
});
