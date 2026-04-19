// @ts-nocheck
import React, { useMemo, useState } from 'react';
import SetupGuideBanner from '../components/guide/SetupGuideBanner';
import OfflineBanner from '../components/OfflineBanner';
import { useTheme, useColours } from '../context/ThemeContext';
import { Image } from 'react-native';
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
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { useVenueId } from '../context/VenueProvider';
import { resetAllDepartmentsStockTake } from '../services/reset';
import IdentityBadge from '../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../hooks/useIdentityLabels';
import { updateDoc } from 'firebase/firestore';

export default function DashboardScreen() {
  const nav = useNavigation<any>();
  const colours = useColours();
  const { theme } = useTheme();

  const auth = getAuth();
  const currentUid = auth.currentUser?.uid ?? null;
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
  const [lastArea, setLastArea] = React.useState<{deptId:string;areaId:string;areaName:string;deptName:string;startedAt?:number;lockedBy?:string|null} | null>(null);
  const [allComplete, setAllComplete] = React.useState(false);
  const [resettingCycle, setResettingCycle] = React.useState(false);

  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
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
                best = { deptId: deptDoc.id, areaId: areaDoc.id, areaName: data.name || 'Area', deptName: deptDoc.data().name || 'Department', startedAt: data.startedAt.toMillis(), lockedBy: data.currentLock?.uid || null };
              }
            }
          }
        }
        if (best) {
          setLastArea(best);
          setAllComplete(false);
        } else if (deptSnap.docs.length > 0) {
          let hasAny = false;
          for (const deptDoc2 of deptSnap.docs) {
            const a2 = await getDocs(query(collection(db, 'venues', venueId, 'departments', deptDoc2.id, 'areas'), limit(1)));
            if (!a2.empty) { hasAny = true; break; }
          }
          setAllComplete(hasAny);
        }
    }).catch(() => {});
  }, [venueId]);

  const [stocktakeCount, setStocktakeCount] = React.useState(0);
  const [onboardingRoad, setOnboardingRoad] = React.useState<string | null | undefined>(undefined);
  const [onboardingDismissed, setOnboardingDismissed] = React.useState(false);
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    getDoc(doc(db, 'venues', venueId)).then(snap => {
      if (snap.exists()) {
        const data = snap.data() as any;
        setStocktakeCount(data?.totalStocktakesCompleted || 0);
        setOnboardingRoad(data?.onboardingRoad ?? null);
        setOnboardingDismissed(!!(data?.onboardingDismissedAt));
      }
    }).catch(() => {});
  }, [venueId]);

  async function dismissOnboarding() {
    setOnboardingDismissed(true);
    if (venueId) {
      const db = getFirestore();
      updateDoc(doc(db, 'venues', venueId), { onboardingDismissedAt: serverTimestamp() }).catch(() => {});
    }
  }

  const onOpenStockTake = async () => {
    if (busy) return;
    try {
      setBusy(true);
      nav.navigate('DepartmentSelection');
    } finally {
      setBusy(false);
    }
  };

  const onOpenSuggestedOrders = () => nav.navigate('SuggestedOrders');
  const onOpenOrders = () => nav.navigate('Orders');
  const onOpenStockControl = () => nav.navigate('StockControl');
  const onOpenReports = () => nav.navigate('Reports');
  const onOpenSettings = () => nav.navigate('Settings');

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.background },
    container: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
    headerTitle: { fontSize: 22, fontWeight: '800', color: colours.navy },
    headerSub: { color: colours.textSecondary, marginTop: 2, fontSize: 14 },
    headerHint: { color: colours.textSecondary, marginTop: 6, fontSize: 12, lineHeight: 16, maxWidth: 260 },
    card: { backgroundColor: colours.surface, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colours.border },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colours.navy, marginBottom: 4 },
    cardSub: { fontSize: 13, color: colours.textSecondary, marginBottom: 12, lineHeight: 18 },
    button: { paddingVertical: 14, borderRadius: 999, alignItems: 'center' },
    primary: { backgroundColor: colours.primary },
    buttonText: { color: colours.primaryText, fontWeight: '700', fontSize: 15 },
    rowButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    buttonSmall: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    dark: { backgroundColor: colours.navy },
    muted: { backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.border },
    buttonSmallText: { color: colours.primaryText, fontWeight: '600', fontSize: 13 },
    buttonSmallTextDark: { color: colours.navy, fontWeight: '600', fontSize: 13 },
    footerHint: { fontSize: 11, color: colours.textSecondary, marginBottom: 8 },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
            style={{ marginHorizontal: 12, marginBottom: 4, backgroundColor: colours.navy, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 20 }}>▶️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colours.primaryText, fontWeight: '900', fontSize: 15 }}>
                {lastArea.lockedBy && lastArea.lockedBy !== currentUid ? 'Stocktake in progress' : 'Continue stocktake'}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{lastArea.lockedBy && lastArea.lockedBy !== currentUid ? 'Another user is counting — ' : ''}{lastArea.deptName} → {lastArea.areaName}{lastArea.startedAt ? ' · Started ' + new Date(lastArea.startedAt).toLocaleString('en-NZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 20 }}>›</Text>
          </TouchableOpacity>)
        }
        {allComplete && !lastArea && (
          <TouchableOpacity
            onPress={async () => {
              const { Alert } = require('react-native');
              try {
                const db2 = getFirestore();
                const depsSnap2 = await getDocs(collection(db2, 'venues', venueId, 'departments'));
                let inProgressUser = null;
                for (const dep2 of depsSnap2.docs) {
                  const areas2 = await getDocs(collection(db2, 'venues', venueId, 'departments', dep2.id, 'areas'));
                  for (const area2 of areas2.docs) {
                    const d = area2.data();
                    if (d.startedAt && !d.completedAt && d.currentLock?.uid && d.currentLock.uid !== currentUid) {
                      inProgressUser = d.currentLock.displayName || 'Another user';
                      break;
                    }
                  }
                  if (inProgressUser) break;
                }
                const message = inProgressUser
                  ? `${inProgressUser} is currently counting. Resetting now will discard their in-progress count. Are you sure?`
                  : 'This resets all areas for a fresh count. Completed data is saved.';
                Alert.alert('Start new stocktake?', message, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: inProgressUser ? 'Reset anyway' : 'Start new cycle', style: inProgressUser ? 'destructive' : 'default', onPress: async () => {
                    setResettingCycle(true);
                    try { await resetAllDepartmentsStockTake(venueId); setAllComplete(false); }
                    catch (e: any) { console.error('[Reset] failed:', e?.code, e?.message); Alert.alert('Error', 'Could not reset: ' + (e?.message || e?.code || 'unknown')); }
                    finally { setResettingCycle(false); }
                  }},
                ]);
              } catch {
                Alert.alert('Start new stocktake?', 'This resets all areas for a fresh count.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Start new cycle', onPress: async () => {
                    setResettingCycle(true);
                    try { await resetAllDepartmentsStockTake(venueId); setAllComplete(false); }
                    catch (e: any) { console.error('[Reset] failed:', e?.code, e?.message); Alert.alert('Error', 'Could not reset: ' + (e?.message || e?.code || 'unknown')); }
                    finally { setResettingCycle(false); }
                  }},
                ]);
              }
            }}
            style={{ marginHorizontal: 12, marginBottom: 4, backgroundColor: colours.success, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: resettingCycle ? 0.5 : 1 }}>
            <Text style={{ fontSize: 20 }}>🔄</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colours.primaryText, fontWeight: '900', fontSize: 15 }}>{resettingCycle ? 'Resetting...' : 'Start new stocktake cycle'}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>All areas complete — begin a fresh count</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        )}
        {onboardingRoad === null && !onboardingDismissed && (
          <View style={{
            marginHorizontal: 12, marginBottom: 12,
            backgroundColor: '#FFF8F0', borderRadius: 14, padding: 14,
            borderWidth: 1.5, borderColor: colours.amber,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: colours.navy, marginBottom: 4 }}>
                  Ready to set up your venue?
                </Text>
                <Text style={{ fontSize: 13, color: colours.textSecondary, lineHeight: 18, marginBottom: 12 }}>
                  Two minutes now sets up your stock structure, PAR levels, and suppliers. Pick your path:
                </Text>
              </View>
              <TouchableOpacity onPress={dismissOnboarding} style={{ padding: 4, marginLeft: 8 }}>
                <Text style={{ fontSize: 18, color: colours.textSecondary }}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{
                  flex: 1, backgroundColor: colours.primary, borderRadius: 999,
                  paddingVertical: 10, alignItems: 'center',
                }}
                onPress={() => nav.navigate('OnboardingFreshStart')}
              >
                <Text style={{ color: colours.primaryText, fontWeight: '700', fontSize: 13 }}>Fresh start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1, backgroundColor: colours.surface, borderRadius: 999,
                  paddingVertical: 10, alignItems: 'center',
                  borderWidth: 1, borderColor: colours.border,
                }}
                onPress={() => nav.navigate('OnboardingBringData')}
              >
                <Text style={{ color: colours.navy, fontWeight: '700', fontSize: 13 }}>Bring my data</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <SetupGuideBanner onNavigate={(route, params) => nav.navigate(route as never, params as never)} />
        {stocktakeCount > 0 && (
          <View style={{ marginHorizontal: 12, marginBottom: 4, backgroundColor: colours.primaryLight, borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colours.border }}>
            <Text style={{ fontSize: 16 }}>🧠</Text>
            <Text style={{ color: colours.primary, fontSize: 12, flex: 1, fontWeight: '600' }}>
              Your AI has learned from {stocktakeCount} stocktake{stocktakeCount > 1 ? 's' : ''} — suggestions improve over time
            </Text>
          </View>
        )}

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
              <ActivityIndicator color={colours.primaryText} />
            ) : (
              <Text style={styles.buttonText}>Start / Return Stock Take</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ordering & invoices</Text>
          <Text style={styles.cardSub}>
            Use suggested orders to build supplier orders from your stock and sales, and manage open orders and
            deliveries. Invoice upload and receiving flows live under Orders.
          </Text>
          <View style={styles.rowButtons}>
            <TouchableOpacity style={[styles.buttonSmall, styles.dark]} onPress={onOpenSuggestedOrders}>
              <Text style={styles.buttonSmallText}>Suggested Orders</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.buttonSmall, styles.dark]} onPress={onOpenOrders}>
              <Text style={styles.buttonSmallText}>Orders</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Control & reports</Text>
          <Text style={styles.cardSub}>
            Keep your products and suppliers organised, and review variance and performance reports. Use Settings
            for venue-level controls and BETA options.
          </Text>
          <View style={styles.rowButtons}>
            <TouchableOpacity style={[styles.buttonSmall, styles.muted]} onPress={onOpenStockControl}>
              <Text style={styles.buttonSmallTextDark}>Stock Control</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.buttonSmall, styles.muted]} onPress={onOpenReports}>
              <Text style={styles.buttonSmallTextDark}>Reports</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.buttonSmall, styles.muted]} onPress={onOpenSettings}>
              <Text style={styles.buttonSmallTextDark}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.footerHint}>
          You can revisit the BETA overview from Settings → About (coming soon for pilot venues).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
