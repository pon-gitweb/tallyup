// @ts-nocheck
import React, { useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SetupGuideBanner from '../components/guide/SetupGuideBanner';
import OfflineBanner from '../components/OfflineBanner';
import { useTheme, useColours } from '../context/ThemeContext';
import { useToast } from '../components/common/Toast';
import { useConfirmModal } from '../components/common/useConfirmModal';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, onSnapshot, collection, getDocs, query, orderBy, limit, serverTimestamp, where, Timestamp } from 'firebase/firestore';
import { useVenueId, useVenueType, useVenue } from '../context/VenueProvider';
import { VenueSwitcher } from '../components/common/VenueSwitcher';
import { updateDoc } from 'firebase/firestore';

const NUDGE_KEYS = {
  invoiceFirst:       'tallyup_nudge_invoice_first_v1',
  noProducts:         'tallyup_nudge_no_products_v1',
  noSuppliers:        'tallyup_nudge_no_suppliers_v1',
  unassigned:         'tallyup_nudge_unassigned_v1',
  noStocktake:        'tallyup_nudge_no_stocktake_v1',
  firstStocktakeDone: 'tallyup_nudge_first_stocktake_done_v1',
};

function ContextNudge({ message, cta, onCta, onDismiss, c }) {
  return (
    <View style={{
      marginHorizontal: 12, marginBottom: 8,
      backgroundColor: c.surface, borderRadius: 12, padding: 12,
      borderWidth: 1, borderColor: c.border,
      flexDirection: 'row', alignItems: 'center', gap: 8,
    }}>
      <Text style={{ flex: 1, fontSize: 13, color: c.navy, lineHeight: 18 }}>{message}</Text>
      {cta && onCta && (
        <TouchableOpacity
          onPress={onCta}
          style={{ backgroundColor: c.primary, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}
        >
          <Text style={{ color: c.primaryText, fontWeight: '700', fontSize: 12 }}>{cta}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={onDismiss} style={{ padding: 4 }}>
        <Text style={{ fontSize: 16, color: c.textSecondary }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-NZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTimeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

export default function DashboardScreen() {
  const nav = useNavigation<any>();
  const colours = useColours();
  const { theme, fontsLoaded } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();

  const auth = getAuth();
  const currentUid = auth.currentUser?.uid ?? null;
  const user = auth.currentUser;
  const venueId = useVenueId();
  const venueType = useVenueType();
  const { venueIds, refresh } = useVenue();
  const hasMultipleProjects = (venueIds?.length || 0) > 1;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    refresh();
    await new Promise(resolve => setTimeout(resolve, 1000));
    setRefreshing(false);
  };

  // Live display name — read from users/{uid} so updates in Settings reflect immediately
  const [liveDisplayName, setLiveDisplayName] = React.useState<string>(
    user?.displayName || ''
  );
  React.useEffect(() => {
    if (!user?.uid) return;
    const db = getFirestore();
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const dn = snap.data()?.displayName || user?.displayName || '';
          setLiveDisplayName(dn);
        }
      },
      (error) => {
        console.error('[Dashboard] user listener failed:', error.code, error.message);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  // Live venue name — read from venues/{venueId}
  const [liveVenueName, setLiveVenueName] = React.useState<string>('');
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    const unsub = onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => {
        if (snap.exists()) setLiveVenueName(snap.data()?.name || '');
      },
      (error) => {
        console.error('[Dashboard] venue listener failed:', error.code, error.message);
      }
    );
    return () => unsub();
  }, [venueId]);

  const venueName = liveVenueName;

  const [busy, setBusy] = useState(false);
  const [lastArea, setLastArea] = React.useState<{deptId:string;areaId:string;areaName:string;deptName:string;startedAt?:number;lockedBy?:string|null} | null>(null);

  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    getDocs(collection(db, 'venues', venueId, 'departments')).then(async deptSnap => {
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
        }
    }).catch(() => {});
  }, [venueId]);

  const [stocktakeCount, setStocktakeCount] = React.useState(0);
  const [stockValue, setStockValue] = useState<number | null>(null);
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState<Date | null>(null);
  const [onboardingRoad, setOnboardingRoad] = React.useState<string | null | undefined>(undefined);
  const [onboardingDismissed, setOnboardingDismissed] = React.useState(false);
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    const unsubVenue = onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as any;
        setStocktakeCount(data?.totalStocktakesCompleted || 0);
        setOnboardingRoad(data?.onboardingRoad ?? null);
        setOnboardingDismissed(!!(data?.onboardingDismissedAt));
      },
      () => {} // silent error — counts stay at last known value
    );
    getDoc(doc(db, 'venues', venueId, 'latestSnapshot', 'current')).then(latestSnap => {
      if (latestSnap.exists()) {
        const snapData = latestSnap.data() as any;
        const depts = snapData?.departments ?? [];
        const total = depts.reduce(
          (sum: number, d: any) => sum + (d?.summary?.totalStockValue ?? 0),
          0
        );
        setStockValue(total);
        const ts = snapData?.updatedAt;
        if (ts?.toDate) setSnapshotUpdatedAt(ts.toDate());
        else if (ts?._seconds) setSnapshotUpdatedAt(new Date(ts._seconds * 1000));
      }
    }).catch(() => {});
    return () => unsubVenue();
  }, [venueId]);

  // ── Setup wizard (show once for new users with 0 stocktakes) ────────────────
  React.useEffect(() => {
    if (stocktakeCount !== 0) return; // already done stocktakes
    AsyncStorage.getItem('setup_wizard_seen').then(v => {
      if (v === null) nav.navigate('SetupWizard');
    }).catch(() => {});
  }, [stocktakeCount]);

  // ── Contextual nudge data ──────────────────────────────────────────────────
  const [productCount, setProductCount] = React.useState<number | null>(null);
  const [unassignedCount, setUnassignedCount] = React.useState(0);
  const [supplierCount, setSupplierCount] = React.useState<number | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = React.useState<Record<string, boolean>>({});

  // Live counts — these are the numbers users see immediately on the
  // dashboard, so they subscribe rather than fetch once per focus. The
  // products listener also derives unassignedCount (used by the
  // "products not in a stocktake area" nudge below) from the same snapshot.
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    const unsubProducts = onSnapshot(
      collection(db, 'venues', venueId, 'products'),
      (snap) => {
        let unassigned = 0;
        snap.forEach(d => {
          const data = d.data();
          if (!data.supplierId || data.supplierId === 'unassigned') unassigned++;
        });
        setProductCount(snap.size);
        setUnassignedCount(unassigned);
      },
      () => {} // silent error — count stays at last known value
    );
    const unsubSuppliers = onSnapshot(
      collection(db, 'venues', venueId, 'suppliers'),
      (snap) => {
        let count = 0;
        snap.forEach(d => { if (!d.data().isHoldingSupplier) count++; });
        setSupplierCount(count);
      },
      () => {}
    );
    return () => { unsubProducts(); unsubSuppliers(); };
  }, [venueId]);

  const [deptNames, setDeptNames] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    getDocs(collection(db, 'venues', venueId, 'departments')).then(snap => {
      setDeptNames(snap.docs.map(d => d.data().name as string).filter(Boolean).slice(0, 3));
    }).catch(() => {});
  }, [venueId]);

  // Role gate — manager/owner only, for price change alert card
  const [isManager, setIsManager] = React.useState(false);
  React.useEffect(() => {
    if (!venueId || !currentUid) return;
    const db = getFirestore();
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        const ownerUid = (venueSnap.data() as any)?.ownerUid;
        if (ownerUid === currentUid) { setIsManager(true); return; }
        const memberSnap = await getDoc(doc(db, 'venues', venueId, 'members', currentUid));
        const role = (memberSnap.data() as any)?.role;
        setIsManager(role === 'manager' || role === 'owner');
      } catch {}
    })();
  }, [venueId, currentUid]);

  // Pending price change flags (from invoice scans) — manager review
  const [priceFlags, setPriceFlags] = React.useState(0);
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    const unsub = onSnapshot(
      query(collection(db, 'venues', venueId, 'priceChangeFlags'), where('status', '==', 'pending')),
      snap => setPriceFlags(snap.size),
      () => setPriceFlags(0)
    );
    return () => unsub();
  }, [venueId]);

  // Price-cascade notifications — recipes auto-updated after a product price change
  const [priceCascadeNotifs, setPriceCascadeNotifs] = React.useState<Array<{ id: string; recipesAffected: number }>>([]);
  const [priceCascadeDismissing, setPriceCascadeDismissing] = React.useState(false);
  React.useEffect(() => {
    if (!venueId || !isManager) { setPriceCascadeNotifs([]); return; }
    const db = getFirestore();
    const sevenDaysAgo = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const unsub = onSnapshot(
      query(
        collection(db, 'venues', venueId, 'notifications'),
        where('type', '==', 'price_cascade'),
        where('read', '==', false),
        where('createdAt', '>=', sevenDaysAgo)
      ),
      snap => setPriceCascadeNotifs(snap.docs.map(d => ({
        id: d.id,
        recipesAffected: Number((d.data() as any)?.recipesAffected) || 0,
      }))),
      () => setPriceCascadeNotifs([])
    );
    return () => unsub();
  }, [venueId, isManager]);

  const priceCascadeSummary = React.useMemo(() => {
    if (priceCascadeNotifs.length === 0) return null;
    return {
      priceChangesCount: priceCascadeNotifs.length,
      recipesUpdatedTotal: priceCascadeNotifs.reduce((sum, n) => sum + n.recipesAffected, 0),
    };
  }, [priceCascadeNotifs]);

  async function dismissPriceCascadeCard() {
    if (!venueId || priceCascadeNotifs.length === 0) return;
    setPriceCascadeDismissing(true);
    try {
      const db = getFirestore();
      await Promise.all(priceCascadeNotifs.map(n =>
        updateDoc(doc(db, 'venues', venueId, 'notifications', n.id), { read: true })
      ));
    } catch (e) {
      if (__DEV__) console.log('[Dashboard] dismiss price cascade failed', e);
    } finally {
      setPriceCascadeDismissing(false);
    }
  }

  // Pending deliveries awaiting invoice confirmation (packing slips / delivery notes)
  const [pendingDeliveriesCount, setPendingDeliveriesCount] = React.useState(0);
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    const unsub = onSnapshot(
      query(collection(db, 'venues', venueId, 'pendingDeliveries'), where('status', '==', 'awaiting_invoice')),
      snap => setPendingDeliveriesCount(snap.size),
      () => setPendingDeliveriesCount(0)
    );
    return () => unsub();
  }, [venueId]);

  const [priceChangeCount, setPriceChangeCount] = React.useState(0);
  const [openDisputeCount, setOpenDisputeCount] = React.useState(0);
  React.useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    getDocs(query(collection(db, 'venues', venueId, 'products'), where('priceChanged', '==', true)))
      .then(snap => setPriceChangeCount(snap.size))
      .catch(() => {});
    if (venueType === 'festival') {
      getDocs(query(collection(db, 'venues', venueId, 'priceDisputes'), where('status', '==', 'open')))
        .then(snap => setOpenDisputeCount(snap.size))
        .catch(() => {});
    }
  }, [venueId, venueType]);

  React.useEffect(() => {
    Promise.all(
      Object.entries(NUDGE_KEYS).map(([k, sk]) =>
        AsyncStorage.getItem(sk).then(v => [k, v !== null])
      )
    ).then(pairs => {
      const m: Record<string, boolean> = {};
      pairs.forEach(([k, v]) => { m[k as string] = v as boolean; });
      setNudgeDismissed(m);
    }).catch(() => {});
  }, []);

  function dismissNudge(key: string) {
    setNudgeDismissed(prev => ({ ...prev, [key]: true }));
    AsyncStorage.setItem(NUDGE_KEYS[key], '1').catch(() => {});
  }
  // ──────────────────────────────────────────────────────────────────────────

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

  // Time-based greeting
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const firstName = (() => {
    if (liveDisplayName) return liveDisplayName.split(' ')[0];
    if (user?.email) {
      const username = user.email.split('@')[0];
      return username.charAt(0).toUpperCase() + username.slice(1);
    }
    return 'there';
  })();

  // Primary action card state
  const primaryState: 'none' | 'inProgress' | 'done' =
    lastArea ? 'inProgress' :
    stocktakeCount === 0 ? 'none' : 'done';

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colours.background },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
    greeting: { fontSize: 22, fontWeight: '800', color: colours.navy },
    venueName: { color: colours.textSecondary, marginTop: 2, fontSize: 14, fontWeight: '500' },
    primaryCard: { backgroundColor: colours.navy, borderRadius: 16, padding: 16, marginBottom: 16 },
    primaryIcon: { fontSize: 28, marginBottom: 8 },
    primaryTitle: { fontSize: 18, fontWeight: '800', color: colours.surface, marginBottom: 4 },
    primarySub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 14, lineHeight: 18 },
    primaryBtn: { backgroundColor: colours.surface, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
    primaryBtnText: { color: colours.navy, fontWeight: '800', fontSize: 14 },
    primarySecBtn: { borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    primarySecBtnText: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 13 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    gridCard: { backgroundColor: colours.surface, borderRadius: 14, padding: 14, flex: 1, minWidth: '45%', borderWidth: 1, borderColor: colours.border },
    gridIcon: { fontSize: 22, marginBottom: 6 },
    gridLabel: { fontSize: 13, fontWeight: '700', color: colours.navy },
    gridCount: { fontSize: 22, fontWeight: '800', color: colours.primary, marginTop: 2 },
    gridSub: { fontSize: 11, color: colours.textSecondary, marginTop: 1 },
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
      {modal}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colours.deepBlue} />
        }
      >

        {/* ── Header ────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 8 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colours.stellarAmber, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colours.oat, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>
              {venueName ? venueName.slice(0, 3).toUpperCase() : '◆'}
            </Text>
          </View>
          <VenueSwitcher />
          <TouchableOpacity
            onPress={() => { /* TODO: navigate to Izzy screen when available */ }}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colours.positiveSoft, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: colours.stellarAmber, fontSize: 18 }}>✦</Text>
          </TouchableOpacity>
        </View>

        {/* ── Greeting ──────────────────────────────────────────────────── */}
        <View style={{ paddingTop: 14, paddingBottom: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: colours.text, letterSpacing: -0.22 }}>
            {timeGreeting}{firstName ? `, ${firstName}` : ''}
          </Text>
          {venueName ? <Text style={{ fontSize: 14, color: colours.textSecondary, marginTop: 3 }}>{venueName}</Text> : null}
          {hasMultipleProjects && (
            <TouchableOpacity
              onPress={() => nav.navigate('VenueList')}
              style={{ marginTop: 4 }}
            >
              <Text style={{
                color: colours.deepBlue || '#1b4f72',
                fontSize: 12,
                fontFamily: theme.fontBody,
                opacity: 0.8
              }}>
                My Projects →
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <OfflineBanner />

        {/* ── Primary action card ───────────────────────────────────────── */}
        <View style={{
          backgroundColor: colours.missionSlate,
          borderRadius: 18,
          padding: 22,
          paddingHorizontal: 24,
          marginBottom: 12,
          shadowColor: colours.missionSlate,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}>
          <Text style={{ fontSize: 11, fontWeight: '500', color: 'rgba(245,243,238,0.55)', textTransform: 'uppercase', letterSpacing: 0.88, marginBottom: 8 }}>
            {primaryState === 'none'
              ? 'Your first stocktake'
              : primaryState === 'inProgress'
              ? 'Stocktake in progress'
              : 'Stock on hand at your last count'}
          </Text>

          {primaryState === 'none' && (
            <>
              <Text style={{ fontSize: 18, fontWeight: '600', color: colours.oat }}>
                Takes about 20 minutes.
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(245,243,238,0.55)', marginTop: 6, lineHeight: 19.5 }}>
                We'll show you exactly what to do.
              </Text>
            </>
          )}

          {primaryState === 'inProgress' && lastArea && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colours.stellarAmber }} />
                <Text style={{ fontSize: 18, fontWeight: '600', color: colours.oat }}>
                  {lastArea.deptName} · {lastArea.areaName}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: 'rgba(245,243,238,0.55)', marginTop: 6, lineHeight: 19.5 }}>
                {lastArea.startedAt
                  ? `Started ${new Date(lastArea.startedAt).toLocaleString('en-NZ', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : 'In progress'}
              </Text>
            </>
          )}

          {primaryState === 'done' && (
            <>
              <Text style={{
                fontSize: 52,
                color: colours.oat,
                fontFamily: theme.fontTitleBold,
                fontWeight: fontsLoaded ? '700' : '600',
                letterSpacing: -0.78,
                marginTop: 14,
                lineHeight: 60,
                fontVariant: ['tabular-nums'],
              }}>
                {stockValue !== null && stockValue > 0
                  ? formatCurrency(stockValue)
                  : `${stocktakeCount} stocktakes`}
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(245,243,238,0.55)', marginTop: 10, lineHeight: 19.5 }}>
                {stockValue !== null && stockValue > 0
                  ? `${stocktakeCount} count${stocktakeCount !== 1 ? 's' : ''} completed`
                  : 'Add product costs to see stock value'}
              </Text>
              {stockValue !== null && stockValue > 0 && snapshotUpdatedAt && (
                <Text style={{ fontSize: 11, color: 'rgba(245,243,238,0.3)', marginTop: 3 }}>
                  {'Updated ' + formatTimeAgo(snapshotUpdatedAt)}
                </Text>
              )}
            </>
          )}
        </View>

        {/* ── CTA button ───────────────────────────────────────────────── */}
        {primaryState === 'none' && (
          <>
            <TouchableOpacity
              style={{ height: 54, borderRadius: 999, backgroundColor: colours.missionSlate, alignItems: 'center', justifyContent: 'center', marginBottom: deptNames.length > 0 ? 6 : 16 }}
              onPress={onOpenStockTake}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color={colours.oat} /> : <Text style={{ color: colours.oat, fontWeight: '600', fontSize: 15, letterSpacing: -0.075 }}>Start now →</Text>}
            </TouchableOpacity>
            {deptNames.length > 0 && (
              <Text style={{ fontSize: 12, color: colours.textSecondary, textAlign: 'center', marginBottom: 16 }}>
                {deptNames.join(' · ')}
              </Text>
            )}
          </>
        )}
        {primaryState === 'inProgress' && lastArea && (
          <TouchableOpacity
            style={{ height: 54, borderRadius: 999, backgroundColor: colours.missionSlate, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}
            onPress={() => nav.navigate('AreaInventory' as never, { venueId, departmentId: lastArea.deptId, areaId: lastArea.areaId } as never)}
          >
            <Text style={{ color: colours.oat, fontWeight: '600', fontSize: 15, letterSpacing: -0.075 }}>Continue →</Text>
          </TouchableOpacity>
        )}
        {primaryState === 'done' && (
          <>
            <TouchableOpacity
              style={{ height: 54, borderRadius: 999, backgroundColor: colours.missionSlate, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}
              onPress={onOpenStockTake}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color={colours.oat} /> : <Text style={{ color: colours.oat, fontWeight: '600', fontSize: 15, letterSpacing: -0.075 }}>Start new stocktake →</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 10, marginBottom: 8 }} onPress={onOpenReports}>
              <Text style={{ color: colours.textSecondary, fontWeight: '600', fontSize: 14 }}>View reports</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Onboarding (no venue set up yet) ─────────────────────────── */}
        {onboardingRoad === null && !onboardingDismissed && (
          <View style={{
            backgroundColor: colours.oat, borderRadius: 14, padding: 14, marginBottom: 12,
            borderWidth: 1.5, borderColor: colours.amber,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: colours.navy, marginBottom: 4 }}>Ready to set up your venue?</Text>
                <Text style={{ fontSize: 13, color: colours.textSecondary, lineHeight: 18, marginBottom: 12 }}>
                  Two minutes now sets up your stock structure, PAR levels, and suppliers.
                </Text>
              </View>
              <TouchableOpacity onPress={dismissOnboarding} style={{ padding: 4, marginLeft: 8 }}>
                <Text style={{ fontSize: 18, color: colours.textSecondary }}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colours.primary, borderRadius: 999, paddingVertical: 10, alignItems: 'center' }} onPress={() => nav.navigate('OnboardingFreshStart')}>
                <Text style={{ color: colours.primaryText, fontWeight: '700', fontSize: 13 }}>Fresh start</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colours.surface, borderRadius: 999, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colours.border }} onPress={() => nav.navigate('OnboardingBringData')}>
                <Text style={{ color: colours.navy, fontWeight: '700', fontSize: 13 }}>Bring my data</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Price change alert (managers/owners) ─────────────────────── */}
        {isManager && priceFlags > 0 && (
          <TouchableOpacity
            style={{
              backgroundColor: '#fef3cd',
              borderColor: colours.stellarAmber || '#c47b2b',
              borderWidth: 1.5,
              borderRadius: 12,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 12,
            }}
            onPress={() => nav.navigate('PriceChangeFlags')}
          >
            <Text style={{ fontSize: 18, marginRight: 10 }}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colours.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold, fontSize: 14 }}>
                {priceFlags} price change{priceFlags !== 1 ? 's' : ''} to review
              </Text>
              <Text style={{ color: colours.slateMid || '#6b7280', fontFamily: theme.fontBody, fontSize: 12 }}>
                Tap to review and acknowledge
              </Text>
            </View>
            <Text style={{ color: colours.stellarAmber || '#c47b2b', fontSize: 16 }}>→</Text>
          </TouchableOpacity>
        )}

        {/* ── Price cascade notification (managers/owners) ─────────────── */}
        {isManager && priceCascadeSummary && (
          <View style={{
            backgroundColor: colours.primaryLight,
            borderColor: colours.deepBlue,
            borderWidth: 1.5,
            borderRadius: 12,
            padding: 14,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 12,
          }}>
            <TouchableOpacity
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
              onPress={() => nav.navigate('CraftUp')}
            >
              <Text style={{ fontSize: 18, marginRight: 10 }}>💲</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colours.deepBlue, fontFamily: theme.fontBodySemiBold, fontSize: 14 }}>
                  {priceCascadeSummary.priceChangesCount} price change{priceCascadeSummary.priceChangesCount !== 1 ? 's' : ''} updated {priceCascadeSummary.recipesUpdatedTotal} recipe{priceCascadeSummary.recipesUpdatedTotal !== 1 ? 's' : ''} in the last 7 days.
                </Text>
                <Text style={{ color: colours.deepBlue, fontFamily: theme.fontBody, fontSize: 12, marginTop: 2, opacity: 0.8 }}>
                  Tap to review
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={dismissPriceCascadeCard}
              disabled={priceCascadeDismissing}
              style={{ padding: 4, marginLeft: 8 }}
            >
              <Text style={{ fontSize: 16, color: colours.textSecondary }}>×</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Pending deliveries (stock received, awaiting invoice) ────── */}
        {pendingDeliveriesCount > 0 && (
          <TouchableOpacity
            style={{
              backgroundColor: colours.primaryLight || '#eef2ff',
              borderColor: colours.deepBlue || '#1b4f72',
              borderWidth: 1.5,
              borderRadius: 12,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 12,
            }}
            onPress={() => nav.navigate('PendingDeliveries')}
          >
            <Text style={{ fontSize: 18, marginRight: 10 }}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colours.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold, fontSize: 14 }}>
                {pendingDeliveriesCount} {pendingDeliveriesCount === 1 ? 'delivery' : 'deliveries'} awaiting invoice
              </Text>
              <Text style={{ color: colours.slateMid || '#6b7280', fontFamily: theme.fontBody, fontSize: 12 }}>
                Stock received — costs are provisional until invoiced
              </Text>
            </View>
            <Text style={{ color: colours.deepBlue || '#1b4f72', fontSize: 16 }}>→</Text>
          </TouchableOpacity>
        )}

        {/* ── 2×2 quick access grid ─────────────────────────────────────── */}
        <View style={styles.grid}>
          <TouchableOpacity style={styles.gridCard} onPress={onOpenOrders} activeOpacity={0.75}>
            <Text style={styles.gridIcon}>📋</Text>
            <Text style={styles.gridLabel}>Orders</Text>
            <Text style={styles.gridSub}>Manage deliveries</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gridCard} onPress={onOpenReports} activeOpacity={0.75}>
            <Text style={styles.gridIcon}>📊</Text>
            <Text style={styles.gridLabel}>Reports</Text>
            <Text style={styles.gridSub}>Variance & trends</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gridCard} onPress={() => nav.navigate('Products')} activeOpacity={0.75}>
            <Text style={styles.gridIcon}>🏪</Text>
            <Text style={styles.gridLabel}>Products</Text>
            {productCount !== null ? <Text style={styles.gridCount}>{productCount}</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.gridCard} onPress={() => nav.navigate('Suppliers')} activeOpacity={0.75}>
            <Text style={styles.gridIcon}>🚚</Text>
            <Text style={styles.gridLabel}>Suppliers</Text>
            {supplierCount !== null ? <Text style={styles.gridCount}>{supplierCount}</Text> : null}
          </TouchableOpacity>
        </View>

        {/* ── Recipes quick tile ────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.gridCard, { marginBottom: 16, flexDirection: 'row', alignItems: 'center', minWidth: '100%', gap: 10 }]}
          onPress={() => nav.navigate('CraftUp')}
          activeOpacity={0.75}
        >
          <Text style={{ fontSize: 22 }}>🍹</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.gridLabel}>CraftIt — Recipes</Text>
            <Text style={styles.gridSub}>Calculate COGS, set selling prices</Text>
          </View>
          <Text style={{ fontSize: 20, color: colours.deepBlue, fontWeight: '300' }}>›</Text>
        </TouchableOpacity>

        {/* ── Contextual nudges ─────────────────────────────────────────── */}
        {supplierCount === 0 && productCount === 0 && !nudgeDismissed.invoiceFirst && (
          <>
            <ContextNudge c={colours} message="💡 Tip: Scan an invoice to set up suppliers and products in one step — before your first stocktake." cta="Scan invoice →" onCta={() => nav.navigate('Orders')} onDismiss={() => dismissNudge('invoiceFirst')} />
            <TouchableOpacity
              onPress={() => nav.navigate('ProductsCsvImport' as never)}
              style={{ paddingHorizontal: 16, paddingBottom: 8, marginTop: -4 }}
            >
              <Text style={{ fontSize: 12, color: colours.textSecondary }}>Or import from a spreadsheet →</Text>
            </TouchableOpacity>
          </>
        )}
        {supplierCount > 0 && productCount === 0 && !nudgeDismissed.noProducts && (
          <ContextNudge c={colours} message="Add products to run your first stocktake and unlock AI reorder suggestions." cta="Add products →" onCta={() => nav.navigate('Products')} onDismiss={() => dismissNudge('noProducts')} />
        )}
        {productCount > 0 && supplierCount === 0 && !nudgeDismissed.noSuppliers && (
          <ContextNudge c={colours} message="Add a supplier to unlock ordering, AI suggestions, and invoice matching." cta="Add supplier →" onCta={() => nav.navigate('Suppliers')} onDismiss={() => dismissNudge('noSuppliers')} />
        )}
        {productCount > 0 && supplierCount > 0 && unassignedCount > 0 && !nudgeDismissed.unassigned && (
          <ContextNudge c={colours} message={`${unassignedCount} product${unassignedCount !== 1 ? 's have' : ' has'} no supplier — assign one to improve ordering accuracy.`} cta="Review →" onCta={() => nav.navigate('Products', { filterNoSupplier: true })} onDismiss={() => dismissNudge('unassigned')} />
        )}
        {productCount > 0 && stocktakeCount === 0 && !nudgeDismissed.noStocktake && (
          <ContextNudge c={colours} message="Complete your first stocktake to unlock variance reports, usage trends, and smart reorder levels." cta="Start →" onCta={() => nav.navigate('DepartmentSelection')} onDismiss={() => dismissNudge('noStocktake')} />
        )}
        {stocktakeCount === 1 && !nudgeDismissed.firstStocktakeDone && (
          <ContextNudge c={colours} message="First stocktake done! View your Stock Holding Report to see what you have on hand by category." cta="View report →" onCta={() => nav.navigate('StockHolding')} onDismiss={() => dismissNudge('firstStocktakeDone')} />
        )}

        {venueType === 'festival' && (priceChangeCount > 0 || openDisputeCount > 0) && (
          <ContextNudge
            c={colours}
            message={`⚠️ ${priceChangeCount} invoice price${priceChangeCount !== 1 ? 's' : ''} differ from agreed rates${openDisputeCount > 0 ? ` · ${openDisputeCount} open dispute${openDisputeCount !== 1 ? 's' : ''}` : ''}`}
            cta="Review discrepancies →"
            onCta={() => nav.navigate('Reports')}
            onDismiss={() => {}}
          />
        )}
        {venueType !== 'festival' && priceChangeCount > 0 && (
          <ContextNudge
            c={colours}
            message={`📊 ${priceChangeCount} product price change${priceChangeCount !== 1 ? 's' : ''} detected since last stocktake`}
            cta="Review →"
            onCta={() => nav.navigate('Reports')}
            onDismiss={() => {}}
          />
        )}

        <SetupGuideBanner onNavigate={(route, params) => nav.navigate(route as never, params as never)} />

        {stocktakeCount > 0 && (
          <View style={{ backgroundColor: colours.primaryLight, borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colours.border, marginTop: 4 }}>
            <Text style={{ fontSize: 16 }}>🧠</Text>
            <Text style={{ color: colours.primary, fontSize: 12, flex: 1, fontWeight: '600' }}>
              AI has learned from {stocktakeCount} stocktake{stocktakeCount > 1 ? 's' : ''} — suggestions improve over time
            </Text>
          </View>
        )}

        <Text style={styles.footerHint}>
          You can find app info from Settings → About.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
