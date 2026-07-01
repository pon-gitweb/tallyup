// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  PanResponder,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import LocalThemeGate from '../../theme/LocalThemeGate';
import IdentityBadge from '../../components/IdentityBadge';
import OfflineBanner from '../../components/OfflineBanner';
import { useNetworkState } from '../../hooks/useNetworkState';
import { db } from '../../services/firebase';
import { collection, query, where, limit, getDocs, orderBy, doc, updateDoc, Timestamp, getDoc } from 'firebase/firestore';
import { fetchBriefing, BriefingData } from '../../services/reports/briefing';
import { writeDepartmentSnapshot } from '../../services/reports/snapshotWriter';
import { explainVariance } from '../../services/aiVariance';
import { fetchAiInsights, AiInsight } from '../../services/reports/aiInsights';
import { AI_BASE_URL } from '../../config/ai';
import { handleAiLimitError } from '../../utils/aiLimitError';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Tiny helpers ────────────────────────────────────────────────────────────

function fmtDollars(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtMins(mins: number | null): string {
  if (mins == null) return '–';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ─── Lane section wrapper ────────────────────────────────────────────────────

function Lane({
  S,
  label,
  children,
}: {
  S: any;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={S.lane}>
      <Text style={S.laneLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Secondary nav tile ──────────────────────────────────────────────────────

function NavTile({
  S,
  title,
  onPress,
}: {
  S: any;
  title: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={S.navTile} onPress={onPress} activeOpacity={0.75}>
      <Text style={S.navTileText}>{title}</Text>
      <Text style={S.navTileChev}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ReportsIndexScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const insets = useSafeAreaInsets();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);
  const SS = makeSStyles(c);

  const { isOnline } = useNetworkState();
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [data, setData] = useState<BriefingData | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [availableDepts, setAvailableDepts] = useState<{ id: string; name: string; lastCycleAt: any }[]>([]);
  const [insightsModalVisible, setInsightsModalVisible] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsList, setInsightsList] = useState<AiInsight[]>([]);
  const [insightsError, setInsightsError] = useState(false);

  const [suiteeOpen, setSuiteeOpen] = useState(false);
  const [suiteeMessages, setSuiteeMessages] = useState<{ role: string; text: string }[]>([]);
  const [suiteeInput, setSuiteeInput] = useState('');
  const [suiteeLoading, setSuiteeLoading] = useState(false);

  const [priceChanges, setPriceChanges] = useState<any[]>([]);
  const [priceHistoryItem, setPriceHistoryItem] = useState<any>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);

  const [slowMovers, setSlowMovers] = useState<any[]>([]);

  const [latestSnapshots, setLatestSnapshots] = useState<any[]>([]);
  const [totalStocktakesCompleted, setTotalStocktakesCompleted] = useState(0);
  const [reportsIntroSeen, setReportsIntroSeen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcDismissed, setRecalcDismissed] = useState(false);
  const autoRecalcFiredRef = useRef(false);

  const isManager = data?.role === 'owner' || data?.role === 'manager';

  useEffect(() => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    setAiInsight(null);

    fetchBriefing(venueId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setLoading(false); setError(true); }
      });

    return () => {
      cancelled = true;
    };
  }, [venueId]);

  useEffect(() => {
    if (!loading) { setLoadingTimeout(false); return; }
    const t = setTimeout(() => setLoadingTimeout(true), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  // ── Reports intro (shown once) ──────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('tallyup_intro_reports_v1')
      .then(v => { setReportsIntroSeen(v === '1'); })
      .catch(() => { setReportsIntroSeen(false); }); // fail-safe: show intro rather than hide it
  }, []);

  // ── Price changes ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    async function loadPriceChanges() {
      try {
        const q = query(
          collection(db, 'venues', venueId, 'products'),
          where('priceChanged', '==', true),
          limit(10)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const changed = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const withHistory = await Promise.all(changed.map(async (prod: any) => {
          try {
            const hq = query(
              collection(db, 'venues', venueId, 'products', prod.id, 'priceHistory'),
              orderBy('date', 'desc'),
              limit(1)
            );
            const hs = await getDocs(hq);
            const latest = hs.empty ? null : { id: hs.docs[0].id, ...hs.docs[0].data() };
            return { ...prod, latestChange: latest };
          } catch { return { ...prod, latestChange: null }; }
        }));
        if (!cancelled) setPriceChanges(withHistory.filter((p: any) => p.latestChange));
      } catch {}
    }
    loadPriceChanges();
    return () => { cancelled = true; };
  }, [venueId]);

  // ── Slow movers ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    async function loadSlowMovers() {
      try {
        const q = query(
          collection(db, 'venues', venueId, 'slowMovers'),
          orderBy('daysSinceMovement', 'desc'),
          limit(20)
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const now = new Date();
        const visible = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((sm: any) => {
          if (!sm.dismissedUntil) return true;
          const du: Date | null = sm.dismissedUntil?.toDate?.() ?? null;
          return !du || du < now;
        });
        setSlowMovers(visible);
      } catch {}
    }
    loadSlowMovers();
    return () => { cancelled = true; };
  }, [venueId]);

  // ── Latest snapshots (for findings + recommendations) ───────────────────
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    (async () => {
      try {
        const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        const snaps: any[] = [];
        await Promise.all(deptsSnap.docs.map(async deptDoc => {
          try {
            const latestSnap = await getDocs(
              query(
                collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
                orderBy('completedAt', 'desc'),
                limit(1),
              ),
            );
            if (!latestSnap.empty) snaps.push({ deptId: deptDoc.id, ...latestSnap.docs[0].data() });
          } catch {}
        }));
        if (!cancelled) setLatestSnapshots(snaps);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  // ── Total stocktakes completed (venue doc) — fallback signal for trend unlock.
  // totalStocktakesCompleted only increments when ALL departments finish at once,
  // which may never happen for single-department venues or staggered submissions —
  // so this is OR'd with hasPrevCycleData and per-department cycleNumber below. ──
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    getDoc(doc(db, 'venues', venueId))
      .then(snap => {
        if (cancelled) return;
        setTotalStocktakesCompleted((snap.data() as any)?.totalStocktakesCompleted ?? 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [venueId]);

  // ── Department list for selector ─────────────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        if (cancelled) return;
        const depts = snap.docs.map(d => ({
          id: d.id,
          name: (d.data() as any).name || d.id,
          lastCycleAt: (d.data() as any).lastCycleAt ?? null,
        }));
        setAvailableDepts(depts);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  async function handleSlowMoverAction(item: any, action: 'promotion' | 'delist' | 'dismiss') {
    try {
      const ref = doc(db, 'venues', venueId, 'slowMovers', item.productId);
      if (action === 'dismiss') {
        await updateDoc(ref, {
          dismissedUntil: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
        });
        setSlowMovers(prev => prev.filter((sm: any) => sm.productId !== item.productId));
      } else {
        await updateDoc(ref, { status: action, updatedAt: Timestamp.now() });
        setSlowMovers(prev => prev.map((sm: any) =>
          sm.productId === item.productId ? { ...sm, status: action } : sm
        ));
      }
    } catch {}
  }

  async function handleOpenPriceHistory(product: any) {
    setPriceHistoryItem(product);
    setPriceHistory([]);
    try {
      const hq = query(
        collection(db, 'venues', venueId, 'products', product.id, 'priceHistory'),
        orderBy('date', 'desc'),
        limit(10)
      );
      const hs = await getDocs(hq);
      setPriceHistory(hs.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {}
  }

  // ── On-demand AI insights ────────────────────────────────────────────────

  async function handleGetInsights() {
    if (!venueId || !data || insightsLoading) return;
    setInsightsLoading(true);
    setInsightsError(false);
    setInsightsList([]);
    try {
      const insights = await fetchAiInsights(venueId, data);
      if (insights.length === 0) {
        setInsightsError(true);
      } else {
        setInsightsList(insights);
      }
    } catch {
      setInsightsError(true);
    } finally {
      setInsightsLoading(false);
      setInsightsModalVisible(true);
    }
  }

  // ── Suitee chat ──────────────────────────────────────────────────────────

  async function handleSuiteeSend() {
    const text = suiteeInput.trim();
    if (!text || suiteeLoading || !venueId) return;
    setSuiteeInput('');
    const newMessages = [...suiteeMessages, { role: 'user', text }];
    setSuiteeMessages(newMessages);
    setSuiteeLoading(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const resp = await fetchWithTimeout(`${AI_BASE_URL}/api/suitee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: text, venueId, history: suiteeMessages }),
      }, 30000);
      const json = await resp.json().catch(() => ({}));
      if (handleAiLimitError(json)) { setSuiteeLoading(false); return; }
      const answer = json?.answer || "I'm having trouble accessing your data right now. Please try again.";
      setSuiteeMessages([...newMessages, { role: 'assistant', text: answer }]);
    } catch {
      setSuiteeMessages([...newMessages, { role: 'assistant', text: "I'm having trouble accessing your data right now. Please try again." }]);
    } finally {
      setSuiteeLoading(false);
    }
  }

  async function handleRecalculate() {
    if (!venueId || recalculating) return;
    setRecalculating(true);
    try {
      const staleSnaps = latestSnapshots.filter(s => s.requiresRecalculation && s.deptId && s.cycleNumber);
      await Promise.all(staleSnaps.map(s => writeDepartmentSnapshot(venueId, s.deptId, s.cycleNumber)));
      // Reload briefing
      setLoading(true);
      setData(null);
      const d = await fetchBriefing(venueId);
      setData(d);
      setLoading(false);
      setRecalcDismissed(true);
    } catch {}
    setRecalculating(false);
  }

  // Auto-trigger recalculation silently when stale snapshots are detected on load
  useEffect(() => {
    if (autoRecalcFiredRef.current || recalculating || latestSnapshots.length === 0) return;
    const stale = latestSnapshots.filter(s => s.requiresRecalculation && s.deptId && s.cycleNumber);
    if (stale.length === 0) return;
    autoRecalcFiredRef.current = true;
    handleRecalculate();
  }, [latestSnapshots]);

  function handleSuiteeClose() {
    setSuiteeOpen(false);
    setSuiteeMessages([]);
    setSuiteeInput('');
  }

  // ── Empty / loading states ────────────────────────────────────────────────

  if (!venueId) {
    return (
      <LocalThemeGate>
        <View style={[S.root, { backgroundColor: c.background }]}>
          {modal}
          <ScreenHeader S={S} insetsTop={insets.top || 0} />
          <View style={S.centred}>
            <Text style={S.emptyTitle}>No venue selected</Text>
            <Text style={S.emptyBody}>Select a venue to see your briefing.</Text>
          </View>
        </View>
      </LocalThemeGate>
    );
  }

  if (loading) {
    return (
      <LocalThemeGate>
        <View style={[S.root, { backgroundColor: c.background }]}>
          {modal}
          <OfflineBanner />
          <ScreenHeader S={S} insetsTop={insets.top || 0} />
          <View style={S.centred}>
            {loadingTimeout && !isOnline ? (
              <Text style={{ color: c.stellarAmber, textAlign: 'center', fontWeight: '700' }}>
                📵 No connection — showing cached data
              </Text>
            ) : (
              <>
                <ActivityIndicator color={c.deepBlue} size="large" />
                <Text style={[S.emptyBody, { marginTop: 12 }]}>Building your briefing…</Text>
              </>
            )}
          </View>
        </View>
      </LocalThemeGate>
    );
  }

  if (error) {
    return (
      <LocalThemeGate>
        <View style={[S.root, { backgroundColor: c.background }]}>
          {modal}
          <ScreenHeader S={S} insetsTop={insets.top || 0} />
          <View style={S.centred}>
            <Text style={S.emptyTitle}>Couldn't load briefing</Text>
            <Text style={[S.emptyBody, { marginTop: 8 }]}>Check your connection and try again.</Text>
            <TouchableOpacity
              style={[S.ctaBtn, { marginTop: 16 }]}
              onPress={() => { setError(false); setLoading(true); setData(null); fetchBriefing(venueId).then(d => { setData(d); setLoading(false); }).catch(() => { setLoading(false); setError(true); }); }}
            >
              <Text style={S.ctaBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LocalThemeGate>
    );
  }

  if (!data?.hasCountData) {
    return (
      <LocalThemeGate>
        <View style={[S.root, { backgroundColor: c.background }]}>
          {modal}
          <ScreenHeader S={S} insetsTop={insets.top || 0} />
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <View style={S.emptyCard}>
              <Text style={S.emptyTitle}>Nothing to brief yet</Text>
              <Text style={S.emptyBody}>
                Complete a stocktake to see your first briefing — variance, trends, and what to act
                on.
              </Text>
              <TouchableOpacity
                style={S.ctaBtn}
                onPress={() => nav.navigate('DepartmentSelection')}
              >
                <Text style={S.ctaBtnText}>Start a stocktake</Text>
              </TouchableOpacity>
            </View>
            {isManager && (
              <TouchableOpacity
                style={S.suiteeBtn}
                onPress={() => setSuiteeOpen(true)}
                activeOpacity={0.8}
              >
                <View style={S.suiteeBtnTop}>
                  <Text style={S.suiteeBtnTitle}>📊 Ask Suitee</Text>
                </View>
                <Text style={S.suiteeBtnSub}>Ask anything about your venue data</Text>
              </TouchableOpacity>
            )}
            {isManager && <SecondaryNav S={S} nav={nav} hasPrevCycleData={data?.hasPrevCycleData} />}
          </ScrollView>
          <SuiteeModal
            SS={SS}
            c={c}
            visible={suiteeOpen}
            messages={suiteeMessages}
            input={suiteeInput}
            loading={suiteeLoading}
            hasData={false}
            onInputChange={setSuiteeInput}
            onSend={handleSuiteeSend}
            onClose={handleSuiteeClose}
          />
        </View>
      </LocalThemeGate>
    );
  }

  // ── Full briefing view ────────────────────────────────────────────────────

  const netVariance = data.shortfallDollars - data.excessDollars;
  const hasDollarData = data.dollarItemCount > 0;
  // Trend lane unlock: hasPrevCycleData (per-item baseline) OR'd with two fallbacks —
  // a full-venue stocktake count, or any single department on its 2nd+ cycle. Either
  // fallback alone is enough; this only ever widens when the lane unlocks, never narrows it.
  const hasEnoughForTrend = data.hasPrevCycleData
    || totalStocktakesCompleted >= 2
    || latestSnapshots.some((s: any) => (s.cycleNumber ?? 0) >= 2);

  return (
    <LocalThemeGate>
      <View style={[S.root, { backgroundColor: c.background }]}>
        {modal}
        <OfflineBanner />
        <ScreenHeader S={S} insetsTop={insets.top || 0} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom }}>

          {/* ── REPORTS INTRO CARD (shown once, first visit after stocktake) ── */}
          {!reportsIntroSeen && data.hasCountData && (
            <View style={{ backgroundColor: c.oat, borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1.5, borderColor: c.deepBlue }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: c.navy, marginBottom: 8 }}>📊 Your first report</Text>
              <Text style={{ fontSize: 14, color: c.text, lineHeight: 20, marginBottom: 8 }}>
                This is your stock briefing — a summary of what changed since your last count.
              </Text>
              <Text style={{ fontSize: 13, color: c.slateMid, lineHeight: 19, marginBottom: 12 }}>
                {'After your second stocktake you\'ll see:\n✓ What went missing (variance)\n✓ What you need to reorder\n✓ Where your money is going'}
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, alignSelf: 'flex-start' }}
                onPress={() => {
                  setReportsIntroSeen(true);
                  AsyncStorage.setItem('tallyup_intro_reports_v1', '1').catch(() => {});
                }}
              >
                <Text style={{ color: c.surface, fontWeight: '700', fontSize: 14 }}>Got it</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── RECALCULATION NOTE (counts edited after submission) ── */}
          {!recalcDismissed && latestSnapshots.some(s => s.requiresRecalculation) && (
            <View style={{ backgroundColor: c.stellarAmber + '18', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: c.stellarAmber, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: c.stellarAmber, fontWeight: '700' }}>
                  ⚠️ Some counts were corrected after submission
                </Text>
                <Text style={{ fontSize: 12, color: c.stellarAmber, marginTop: 2, lineHeight: 17 }}>
                  Figures may have changed since this snapshot was generated.
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <TouchableOpacity
                  onPress={handleRecalculate}
                  disabled={recalculating}
                  style={{ backgroundColor: c.stellarAmber, borderRadius: 6, paddingVertical: 5, paddingHorizontal: 10 }}
                >
                  <Text style={{ color: c.surface, fontSize: 12, fontWeight: '700' }}>
                    {recalculating ? 'Updating…' : 'Recalculate'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRecalcDismissed(true)} style={{ alignItems: 'center' }}>
                  <Text style={{ color: c.stellarAmber, fontSize: 11 }}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── ANCHOR METRIC (owner/manager only) ── */}
          {isManager && (
            <View style={S.anchorCard}>
              <Text style={S.anchorLabel}>VARIANCE THIS STOCKTAKE</Text>
              {hasDollarData ? (
                <>
                  <Text style={[S.anchorValue, { color: data.shortfallDollars > 0 ? c.error : c.success }]}>
                    {data.shortfallDollars > 0 ? `–${fmtDollars(data.shortfallDollars)}` : 'On track'}
                  </Text>
                  {data.excessDollars > 0 && (
                    <Text style={S.anchorSub}>
                      +{fmtDollars(data.excessDollars)} excess
                    </Text>
                  )}
                  <Text style={S.anchorMeta}>
                    {data.dollarItemCount} of {data.totalItemsCounted} items have cost prices ·{' '}
                    {data.totalAreasCompleted}/{data.totalAreas} areas done
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[S.anchorValue, { fontSize: 30, color: c.surface }]}>
                    {data.totalItemsCounted} items counted
                  </Text>
                  <Text style={S.anchorMeta}>
                    Add cost prices to see stock value · {data.totalAreasCompleted}/{data.totalAreas} areas done
                  </Text>
                  <TouchableOpacity
                    style={{ marginTop: 10, backgroundColor: c.deepBlue, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start' }}
                    onPress={() => nav.navigate('BatchPriceEntry')}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: c.surface, fontWeight: '700', fontSize: 13 }}>Add cost prices →</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* ── STAFF ANCHOR ── */}
          {!isManager && (
            <View style={S.anchorCard}>
              <Text style={S.anchorLabel}>STOCKTAKE PROGRESS</Text>
              <Text style={[S.anchorValue, { fontSize: 30, color: c.surface }]}>
                {data.totalAreasCompleted}/{data.totalAreas} areas done
              </Text>
              <Text style={S.anchorMeta}>
                {data.totalItemsCounted} items counted this stocktake
              </Text>
            </View>
          )}

          {/* ── Stock Holding CTA — first cycle only ── */}
          {isManager && !data.hasPrevCycleData && (
            <TouchableOpacity
              style={[S.anchorCard, { borderWidth: 1.5, borderColor: c.deepBlue, marginBottom: 12 }]}
              onPress={() => nav.navigate('StockHolding')}
              activeOpacity={0.8}
            >
              <Text style={S.anchorLabel}>STOCK HOLDING REPORT</Text>
              <Text style={[S.anchorValue, { color: c.deepBlue, fontSize: 22 }]}>View your stock on hand</Text>
              <Text style={S.anchorMeta}>Products by category with quantities and value →</Text>
            </TouchableOpacity>
          )}

          {/* ── COST PRICE NUDGE ── */}
          {isManager && !hasDollarData && data.totalItemsCounted > 0 && (
            <TouchableOpacity
              style={{ borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1.5, borderColor: c.deepBlue, backgroundColor: c.navy }}
              onPress={() => nav.navigate('BatchPriceEntry')}
              activeOpacity={0.85}
            >
              <Text style={{ color: c.deepBlue, fontSize: 15, fontWeight: '800', marginBottom: 6 }}>💰 Add prices for dollar variance</Text>
              <Text style={{ color: c.slateMid, fontSize: 13, lineHeight: 19, marginBottom: 10 }}>
                {data.totalItemsCounted} products counted — add cost prices to unlock:
              </Text>
              <View style={{ gap: 3, marginBottom: 10 }}>
                {['✓ Dollar variance in reports','✓ Stock holding value','✓ Supplier spend analysis','✓ Suggested order costs'].map(b => (
                  <Text key={b} style={{ color: c.slateMid, fontSize: 13 }}>{b}</Text>
                ))}
              </View>
              <Text style={{ color: c.deepBlue, fontWeight: '700', fontSize: 14 }}>Add prices to products →</Text>
            </TouchableOpacity>
          )}

          {/* ── LANE 1: WHERE IT LEAKED ── */}
          {isManager && (
            <Lane S={S} label="WHERE IT LEAKED">
              {data.topShortages.length === 0 ? (
                <Text style={S.laneEmpty}>
                  {data.hasPrevCycleData
                    ? 'No shortages detected this stocktake.'
                    : 'Nothing to compare yet — par levels used as baseline.'}
                </Text>
              ) : (
                <>
                  {data.topShortages.map((item) => (
                    <View key={item.itemId} style={S.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={S.lineRowName}>{item.name}</Text>
                        <Text style={S.lineRowSub}>
                          {item.areaName} · {item.deptName}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={S.lineRowNeg}>
                          {item.varianceUnits}
                        </Text>
                        {item.dollarVariance != null && item.dollarVariance > 0 ? (
                          <Text style={S.lineRowDollar}>
                            –{fmtDollars(item.dollarVariance)}
                          </Text>
                        ) : item.dollarVariance == null ? (
                          <Text style={[S.lineRowDollar, { color: c.slateMid }]}>
                            no price set
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={S.laneLink}
                    onPress={() => nav.navigate('DepartmentVariance')}
                  >
                    <Text style={S.laneLinkText}>See full breakdown →</Text>
                  </TouchableOpacity>
                </>
              )}
            </Lane>
          )}

          {/* ── LANE 2: WHAT THE TREND SAYS ── */}
          {isManager && (
            <Lane S={S} label="WHAT THE TREND SAYS">
              {!hasEnoughForTrend ? (
                <View style={S.unlockBox}>
                  <Text style={S.unlockTitle}>Complete one more stocktake to unlock</Text>
                  <Text style={S.unlockBody}>
                    Complete another full stocktake and trend detection will activate — showing you
                    items that are consistently short stocktake after stocktake.
                  </Text>
                </View>
              ) : data.trendItems.length === 0 ? (
                <Text style={S.laneEmpty}>No items short in two consecutive stocktakes.</Text>
              ) : (
                <>
                  <Text style={S.trendIntro}>
                    Short in the last two stocktakes — these aren't one-offs:
                  </Text>
                  {data.trendItems.map((item) => (
                    <View key={item.itemId} style={S.trendRow}>
                      <View style={S.trendDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={S.trendName}>{item.name}</Text>
                        <Text style={S.trendSub}>{item.deptName}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </Lane>
          )}

          {/* ── LANE 3: WHAT TO DO ABOUT IT ── */}
          {isManager && (
            <Lane S={S} label="WHAT TO DO ABOUT IT">
              {aiLoading ? (
                <View style={S.aiLoading}>
                  <ActivityIndicator color={c.deepBlue} size="small" />
                  <Text style={S.aiLoadingText}>Analysing…</Text>
                </View>
              ) : aiInsight ? (
                <Text style={S.aiText}>{aiInsight}</Text>
              ) : (
                <TouchableOpacity
                  style={S.explainBtn}
                  disabled={aiLoading}
                  onPress={() => {
                    if (!data) return;
                    setAiLoading(true);
                    const isFirstCycle = !data.hasPrevCycleData;
                    explainVariance({
                      venueId,
                      shortages: data.topShortages.map((s) => ({
                        name: s.name,
                        dollarVariance: s.dollarVariance,
                        varianceUnits: s.varianceUnits,
                      })),
                      totalVarianceDollars: data.shortfallDollars,
                      trendItems: data.trendItems.map((t) => t.name),
                      totalItemsCounted: data.totalItemsCounted,
                      mode: isFirstCycle ? 'first-cycle' : 'briefing',
                      isFirstCycle,
                      firstCycleNote: isFirstCycle
                        ? 'This is the first stocktake. There is no prior cycle to compare to. Explain current stock levels relative to PAR levels only. Do not mention variance or losses — this is an opening baseline count.'
                        : undefined,
                    })
                      .then((res) => setAiInsight(res.summary || null))
                      .catch(() => showError('Could not generate explanation.'))
                      .finally(() => setAiLoading(false));
                  }}
                >
                  <Text style={S.explainBtnText}>
                    {data.hasPrevCycleData ? 'Explain variance' : 'Explain below-PAR items'}
                  </Text>
                </TouchableOpacity>
              )}
            </Lane>
          )}

          {/* ── AREA STATS (all roles) ── */}
          <Lane S={S} label={isManager ? 'AREA BREAKDOWN' : 'YOUR AREAS THIS STOCKTAKE'}>
            {data.areaStats.length === 0 ? (
              <Text style={S.laneEmpty}>No areas counted yet.</Text>
            ) : (
              data.areaStats.map((area) => (
                <View key={area.areaId} style={S.areaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.areaName}>{area.areaName}</Text>
                    <Text style={S.areaSub}>{area.deptName}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={S.areaDuration}>{fmtMins(area.durationMins)}</Text>
                    {area.itemsCounted > 0 && (
                      <Text style={S.areaMeta}>
                        {area.itemsCounted}/{area.totalItems} items
                        {area.shortItems > 0 ? ` · ${area.shortItems} short` : ''}
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </Lane>

          {/* ── PRICE CHANGES LANE (owner/manager only) ── */}
          {isManager && priceChanges.length > 0 && (
            <Lane S={S} label="⚠️ PRICE CHANGES DETECTED">
              {priceChanges.map((product: any) => {
                const h = product.latestChange;
                if (!h) return null;
                const dateStr = h.date?.toDate
                  ? h.date.toDate().toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
                  : '–';
                const sign = (h.changePercent ?? 0) >= 0 ? '+' : '';
                const color = h.direction === 'increase' ? c.error : c.success;
                return (
                  <TouchableOpacity
                    key={product.id}
                    style={S.lineRow}
                    onPress={() => handleOpenPriceHistory(product)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={S.lineRowName}>{product.name}</Text>
                      <Text style={S.lineRowSub}>
                        ${(h.oldPrice ?? 0).toFixed(2)} → ${(h.newPrice ?? 0).toFixed(2)} · {h.supplierName || 'unknown supplier'} · {dateStr}
                      </Text>
                    </View>
                    <Text style={[S.lineRowNeg, { color }]}>
                      {sign}{(h.changePercent ?? 0).toFixed(1)}%
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </Lane>
          )}

          {/* ── SLOW MOVING STOCK LANE (owner/manager only) ── */}
          {isManager && slowMovers.length > 0 && (
            <Lane S={S} label="🐌 SLOW MOVING STOCK">
              {slowMovers.map((item: any) => (
                <View key={item.productId} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <Text style={S.lineRowName}>{item.productName}</Text>
                  <Text style={S.lineRowSub}>
                    {item.areaName} · {item.daysSinceMovement} days no movement · {item.currentCount} on hand
                    {item.expiryRisk ? '  ⚠ expiry risk' : ''}
                  </Text>
                  {item.status === 'promotion' && (
                    <Text style={{ fontSize: 11, color: c.deepBlue, marginTop: 2 }}>📢 Flagged for promotion</Text>
                  )}
                  {item.status === 'delist' && (
                    <Text style={{ fontSize: 11, color: c.stellarAmber, marginTop: 2 }}>🗑 Consider delisting</Text>
                  )}
                  <View style={{ flexDirection: 'row', marginTop: 8, gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => handleSlowMoverAction(item, 'promotion')}
                      style={{ backgroundColor: c.deepBlue + '18', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: c.deepBlue }}
                    >
                      <Text style={{ color: c.deepBlue, fontSize: 11, fontWeight: '600' }}>Flag for promotion</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleSlowMoverAction(item, 'delist')}
                      style={{ backgroundColor: c.stellarAmber + '18', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: c.stellarAmber }}
                    >
                      <Text style={{ color: c.stellarAmber, fontSize: 11, fontWeight: '600' }}>Consider delisting</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleSlowMoverAction(item, 'dismiss')}
                      style={{ backgroundColor: c.surface, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: c.border }}
                    >
                      <Text style={{ color: c.slateMid, fontSize: 11, fontWeight: '600' }}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </Lane>
          )}

          {/* ── CYCLE INTELLIGENCE (from snapshots) ── */}
          {isManager && latestSnapshots.length > 0 && (() => {
            const allFindings = latestSnapshots.flatMap(s =>
              (s.findings?.likelyMissingInvoices || []).map((f: any) => ({ ...f, deptName: s.departmentName }))
            );
            const allPODisc = latestSnapshots.flatMap(s =>
              (s.findings?.poDiscrepancies || []).map((f: any) => ({ ...f, deptName: s.departmentName }))
            );
            const allRecs = latestSnapshots.flatMap(s => (s.recommendations || []).slice(0, 3));
            const tierMin = Math.min(...latestSnapshots.map(s => s.dataCompleteness?.tier ?? 1));
            const unpricedTotal = latestSnapshots.reduce((sum, s) => sum + (s.summary?.itemsWithNoPrice ?? 0), 0);
            if (!allFindings.length && !allPODisc.length && !allRecs.length) return null;
            return (
              <>
                {(allFindings.length > 0 || allPODisc.length > 0) && (
                  <Lane S={S} label="⚠️ NEEDS ATTENTION">
                    {allFindings.slice(0, 4).map((f: any, i: number) => (
                      <View key={i} style={S.lineRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={S.lineRowName}>{f.productName}</Text>
                          <Text style={S.lineRowSub}>
                            +{f.unexplainedGainQty} units — no invoice recorded · {f.deptName}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 12, color: c.stellarAmber, fontWeight: '700' }}>Missing invoice</Text>
                      </View>
                    ))}
                    {allPODisc.slice(0, 2).map((f: any, i: number) => (
                      <View key={`po-${i}`} style={S.lineRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={S.lineRowName}>{f.productName}</Text>
                          <Text style={S.lineRowSub}>
                            Ordered {f.orderedQty}, received {f.receivedQty} · {f.deptName}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 12, color: c.error, fontWeight: '700' }}>Shortfall</Text>
                      </View>
                    ))}
                  </Lane>
                )}

                <Lane S={S} label="📊 DATA COMPLETENESS">
                  <Text style={[S.laneEmpty, { color: c.slateMid, marginBottom: 8 }]}>
                    Stocktake intelligence: Tier {tierMin} of 4
                    {tierMin === 1 ? ' · Counts only' : tierMin === 2 ? ' · Counts + invoices' : tierMin >= 3 ? ' · Counts + invoices + sales' : ''}
                  </Text>
                  {unpricedTotal > 0 && (
                    <Text style={[S.laneEmpty, { color: c.slateMid }]}>
                      {unpricedTotal} product{unpricedTotal !== 1 ? 's' : ''} have no cost price — add prices to unlock dollar variance
                    </Text>
                  )}
                </Lane>
              </>
            );
          })()}

          {/* ── SUGGESTED ORDERS CTA ── */}
          {isManager && data.hasCountData && (
            <TouchableOpacity
              style={[S.insightsBtn, { backgroundColor: c.success, marginBottom: 8 }]}
              onPress={() => nav.navigate('SuggestedOrders')}
              activeOpacity={0.8}
            >
              <Text style={S.insightsBtnTitle}>📦 Suggested Orders</Text>
              <Text style={S.insightsBtnSub}>Generate an order based on current stock levels</Text>
            </TouchableOpacity>
          )}

          {/* ── GET AI INSIGHTS button (owner/manager only, after stocktake) ── */}
          {isManager && data.hasCountData && (
            <TouchableOpacity
              style={S.insightsBtn}
              onPress={handleGetInsights}
              activeOpacity={0.8}
              disabled={insightsLoading}
            >
              {insightsLoading ? (
                <ActivityIndicator color={c.surface} size="small" />
              ) : (
                <>
                  <Text style={S.insightsBtnTitle}>✨ Get AI Insights</Text>
                  <Text style={S.insightsBtnSub}>Analyse this stocktake with AI</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* ── SUITEE button (owner/manager only) ── */}
          {isManager && (
            <TouchableOpacity
              style={S.suiteeBtn}
              onPress={() => setSuiteeOpen(true)}
              activeOpacity={0.8}
            >
              <View style={S.suiteeBtnTop}>
                <Text style={S.suiteeBtnTitle}>📊 Ask Suitee</Text>
              </View>
              <Text style={S.suiteeBtnSub}>Ask anything about your venue data</Text>
            </TouchableOpacity>
          )}

          {/* ── Secondary nav (owner/manager only) ── */}
          {isManager && <SecondaryNav S={S} nav={nav} hasPrevCycleData={data?.hasPrevCycleData} />}
        </ScrollView>

        {/* ── AI Insights modal ── */}
        <InsightsModal
          S={S}
          c={c}
          visible={insightsModalVisible}
          loading={insightsLoading}
          insights={insightsList}
          error={insightsError}
          onClose={() => setInsightsModalVisible(false)}
          onRetry={handleGetInsights}
        />

        {/* ── Suitee chat modal ── */}
        <SuiteeModal
          SS={SS}
          c={c}
          visible={suiteeOpen}
          messages={suiteeMessages}
          input={suiteeInput}
          loading={suiteeLoading}
          hasData={data?.hasCountData ?? false}
          onInputChange={setSuiteeInput}
          onSend={handleSuiteeSend}
          onClose={handleSuiteeClose}
        />

        {/* ── Price history modal ── */}
        <Modal
          visible={!!priceHistoryItem}
          transparent
          animationType="slide"
          onRequestClose={() => setPriceHistoryItem(null)}
        >
          <View style={S.modalContainer}>
            <TouchableOpacity style={S.modalBackdrop} activeOpacity={1} onPress={() => setPriceHistoryItem(null)} />
            <View style={S.modalSheet}>
              <View style={S.modalHeader}>
                <Text style={S.modalTitle}>Price History — {priceHistoryItem?.name}</Text>
                <TouchableOpacity onPress={() => setPriceHistoryItem(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={S.modalCloseIcon}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={S.modalBody}>
                {priceHistory.length === 0 ? (
                  <View style={S.modalCenter}>
                    <ActivityIndicator color={c.deepBlue} />
                  </View>
                ) : priceHistory.map((h: any, idx: number) => {
                  const dateStr = h.date?.toDate
                    ? h.date.toDate().toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '–';
                  const sign = (h.changePercent ?? 0) >= 0 ? '+' : '';
                  const color = h.direction === 'increase' ? c.error : c.success;
                  return (
                    <View key={h.id || idx} style={[S.lineRow, { paddingVertical: 12 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={S.lineRowName}>
                          ${(h.oldPrice ?? 0).toFixed(2)} → ${(h.newPrice ?? 0).toFixed(2)}
                        </Text>
                        <Text style={S.lineRowSub}>{h.supplierName || 'Unknown supplier'} · {dateStr}</Text>
                      </View>
                      <Text style={[S.lineRowNeg, { color }]}>
                        {sign}{(h.changePercent ?? 0).toFixed(1)}%
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </LocalThemeGate>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScreenHeader({ S, insetsTop }: { S: any; insetsTop: number }) {
  return (
    <View style={[S.header, { paddingTop: insetsTop + 12 }]}>
      <View>
        <Text style={S.headerTitle}>Briefing</Text>
        <Text style={S.headerSub}>What happened. What it means. What to do.</Text>
      </View>
    </View>
  );
}

function SecondaryNav({ S, nav, hasPrevCycleData }: { S: any; nav: any; hasPrevCycleData?: boolean }) {
  return (
    <View style={S.secondaryNav}>
      <Text style={S.secondaryNavLabel}>DETAILED REPORTS</Text>
      <NavTile S={S} title="📈 Product Performance" onPress={() => nav.navigate('ProductPerformance')} />
      <NavTile S={S} title="🚚 Supplier Spend" onPress={() => nav.navigate('SupplierSpend')} />
      <NavTile S={S} title="🍹 Recipe Costs (CraftIt)" onPress={() => nav.navigate('CraftUp')} />
      <NavTile S={S} title="Stock Holding Report" onPress={() => nav.navigate('StockHolding')} />
      <NavTile S={S} title="Stocktake History" onPress={() => nav.navigate('StocktakeHistory')} />
      <NavTile S={S} title="Suggested Orders" onPress={() => nav.navigate('SuggestedOrders')} />
      <NavTile S={S} title="Variance Snapshot" onPress={() => nav.navigate('VarianceSnapshot')} />
      <NavTile S={S} title="Department Variance" onPress={() => nav.navigate('DepartmentVariance')} />
      <NavTile S={S} title="Weekly Performance" onPress={() => nav.navigate('LastCycleSummary')} />
      <NavTile S={S} title="Budgets" onPress={() => nav.navigate('Budgets')} />
      <NavTile S={S} title="Invoice Reconciliations" onPress={() => nav.navigate('Reconciliations')} />
    </View>
  );
}

function InsightCard({
  S,
  insight,
  isLast,
}: {
  S: any;
  insight: { headline: string; observation: string; action: string | null };
  isLast: boolean;
}) {
  return (
    <View style={[S.insightCard, !isLast && S.insightCardBorder]}>
      <Text style={S.insightHeadline}>{insight.headline}</Text>
      <Text style={S.insightObservation}>{insight.observation}</Text>
      {insight.action ? (
        <Text style={S.insightAction}>{insight.action}</Text>
      ) : null}
    </View>
  );
}

function InsightsModal({
  S,
  c,
  visible,
  loading,
  insights,
  error,
  onClose,
  onRetry,
}: {
  S: any;
  c: any;
  visible: boolean;
  loading: boolean;
  insights: AiInsight[];
  error: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const dragPan = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 5 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80) onClose();
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={S.modalContainer}>
        <TouchableOpacity
          style={S.modalBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={S.modalSheet}>
          <View {...dragPan.panHandlers} style={S.modalDragArea}>
            <View style={S.modalDragHandle} />
          </View>
          <View style={S.modalHeader}>
            <Text style={S.modalTitle}>✨ AI Insights</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={S.modalCloseIcon}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={S.modalBody}>
            {loading ? (
              <View style={S.modalCenter}>
                <ActivityIndicator color={c.deepBlue} size="large" />
                <Text style={S.modalLoadingText}>Analysing your stocktake…</Text>
              </View>
            ) : error ? (
              <View style={S.modalCenter}>
                <Text style={S.modalErrorText}>
                  Unable to generate insights right now. Please try again.
                </Text>
                <TouchableOpacity style={S.modalRetryBtn} onPress={onRetry}>
                  <Text style={S.modalRetryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              insights.map((insight, idx) => (
                <InsightCard
                  key={idx}
                  S={S}
                  insight={insight}
                  isLast={idx === insights.length - 1}
                />
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SuiteeModal({
  SS,
  c,
  visible,
  messages,
  input,
  loading,
  hasData,
  onInputChange,
  onSend,
  onClose,
}: {
  SS: any;
  c: any;
  visible: boolean;
  messages: { role: string; text: string }[];
  input: string;
  loading: boolean;
  hasData: boolean;
  onInputChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const flatRef = React.useRef<FlatList>(null);
  const noDataMessage = "I don't have any stocktake data to work with yet.\n\nComplete your first stocktake and I'll be able to answer questions about your venue — variance, stock value, slow movers, price changes and more.\n\nOnce you have data I'm here to help you understand it.";
  const displayMessages = messages.length
    ? messages
    : [{ role: 'assistant', text: hasData ? 'I have access to your venue data. Ask me anything about stocktake variance, stock holding value, slow movers, or supplier performance.' : noDataMessage }];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={SS.wrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={SS.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={SS.sheet}>
          <View style={SS.header}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={SS.title}>📊 Suitee</Text>
              </View>
              <Text style={SS.subtitle}>Your venue intelligence</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
              <Text style={{ color: c.slateMid, fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            keyboardShouldPersistTaps="handled"
            ref={flatRef}
            data={displayMessages}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={SS.messageList}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => (
              <View style={[SS.bubble, item.role === 'user' ? SS.bubbleUser : SS.bubbleAssistant]}>
                <Text style={item.role === 'user' ? SS.bubbleTextUser : SS.bubbleTextAssistant}>
                  {item.text}
                </Text>
              </View>
            )}
          />

          {loading && (
            <View style={SS.loadingRow}>
              <ActivityIndicator size="small" color={c.deepBlue} />
              <Text style={SS.loadingText}>Suitee is thinking…</Text>
            </View>
          )}

          <View style={SS.inputRow}>
            <TextInput
              style={SS.input}
              placeholder="Ask about your venue data…"
              placeholderTextColor={c.text}
              value={input}
              onChangeText={onInputChange}
              onSubmitEditing={onSend}
              returnKeyType="send"
              multiline={false}
            />
            <TouchableOpacity
              onPress={onSend}
              style={[SS.sendBtn, (!input.trim() || loading) && SS.sendBtnDisabled]}
              disabled={!input.trim() || loading}
            >
              <Text style={SS.sendText}>→</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: any) {
  return StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: c.surface,
    fontSize: 20,
    fontWeight: '700',
  },
  headerSub: {
    color: c.slateMid,
    fontSize: 13,
    marginTop: 2,
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyCard: {
    backgroundColor: c.border,
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
  },
  emptyTitle: {
    color: c.surface,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyBody: {
    color: c.slateMid,
    fontSize: 14,
    lineHeight: 20,
  },
  ctaBtn: {
    marginTop: 20,
    backgroundColor: c.deepBlue,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  ctaBtnText: {
    color: c.surface,
    fontWeight: '600',
    fontSize: 14,
  },

  // Anchor card
  anchorCard: {
    backgroundColor: c.navy,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border,
  },
  anchorLabel: {
    color: c.slateMid,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  anchorValue: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  anchorSub: {
    color: c.success,
    fontSize: 15,
    marginTop: 4,
  },
  anchorMeta: {
    color: c.slateMid,
    fontSize: 12,
    marginTop: 8,
  },

  // Lane
  lane: {
    marginBottom: 16,
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border,
  },
  laneLabel: {
    color: c.slateMid,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
  },
  laneEmpty: {
    color: c.slateMid,
    fontSize: 14,
    lineHeight: 20,
  },
  laneLink: {
    marginTop: 12,
  },
  laneLinkText: {
    color: c.deepBlue,
    fontSize: 14,
    fontWeight: '600',
  },

  // Variance line rows
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  lineRowName: {
    color: c.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  lineRowSub: {
    color: c.slateMid,
    fontSize: 12,
    marginTop: 2,
  },
  lineRowNeg: {
    color: c.error,
    fontSize: 16,
    fontWeight: '700',
  },
  lineRowDollar: {
    color: c.error,
    fontSize: 12,
    marginTop: 2,
  },

  // Trend rows
  trendIntro: {
    color: c.slateMid,
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  trendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.stellarAmber,
    marginRight: 12,
  },
  trendName: {
    color: c.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  trendSub: {
    color: c.slateMid,
    fontSize: 12,
    marginTop: 2,
  },

  // Unlock box
  unlockBox: {
    backgroundColor: c.navy,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: c.border,
  },
  unlockTitle: {
    color: c.slateMid,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  unlockBody: {
    color: c.slateMid,
    fontSize: 13,
    lineHeight: 19,
  },

  // Explain variance button (LANE 3)
  explainBtn: {
    backgroundColor: c.deepBlue,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  explainBtnText: {
    color: c.surface,
    fontWeight: '600',
    fontSize: 14,
  },

  // AI insight
  aiLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiLoadingText: {
    color: c.slateMid,
    fontSize: 13,
  },
  aiText: {
    color: c.text,
    fontSize: 14,
    lineHeight: 21,
  },

  // Area rows
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  areaName: {
    color: c.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  areaSub: {
    color: c.slateMid,
    fontSize: 12,
    marginTop: 2,
  },
  areaDuration: {
    color: c.slateMid,
    fontSize: 14,
    fontWeight: '600',
  },
  areaMeta: {
    color: c.slateMid,
    fontSize: 12,
    marginTop: 2,
  },

  // AI Insights button
  insightsBtn: {
    backgroundColor: c.deepBlue,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 16,
    alignItems: 'center',
    minHeight: 62,
    justifyContent: 'center',
  },
  insightsBtnTitle: {
    color: c.surface,
    fontSize: 15,
    fontWeight: '700',
  },
  insightsBtnSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 3,
  },

  // Insight cards (used inside modal)
  insightCard: {
    paddingVertical: 14,
  },
  insightCardBorder: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  insightHeadline: {
    color: c.surface,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  insightObservation: {
    color: c.slateMid,
    fontSize: 14,
    lineHeight: 20,
  },
  insightAction: {
    color: c.deepBlue,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    fontStyle: 'italic',
  },

  // Modal
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalSheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalDragArea: {
    paddingTop: 12,
    paddingBottom: 6,
    alignItems: 'center',
  },
  modalDragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  modalTitle: {
    color: c.surface,
    fontSize: 18,
    fontWeight: '700',
  },
  modalCloseIcon: {
    color: c.slateMid,
    fontSize: 18,
  },
  modalBody: {
    paddingHorizontal: 18,
    paddingBottom: 40,
  },
  modalCenter: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  modalLoadingText: {
    color: c.slateMid,
    fontSize: 14,
    marginTop: 14,
  },
  modalErrorText: {
    color: c.slateMid,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalRetryBtn: {
    backgroundColor: c.deepBlue,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  modalRetryText: {
    color: c.surface,
    fontWeight: '600',
    fontSize: 14,
  },

  // Suitee button
  suiteeBtn: {
    backgroundColor: c.navy,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border,
  },
  suiteeBtnTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  suiteeBtnTitle: {
    color: c.surface,
    fontSize: 15,
    fontWeight: '700',
  },
  suiteeBtnSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  suiteeBadge: {
    backgroundColor: c.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  suiteeBadgeText: {
    color: c.deepBlue,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Secondary nav
  secondaryNav: {
    marginTop: 8,
  },
  secondaryNavLabel: {
    color: c.slateMid,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 8,
  },
  navTile: {
    backgroundColor: c.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: c.border,
  },
  navTileText: {
    color: c.text,
    fontSize: 15,
    fontWeight: '500',
  },
  navTileChev: {
    color: c.slateMid,
    fontSize: 20,
    fontWeight: '300',
  },
  });
}

// ─── Suitee modal styles ──────────────────────────────────────────────────────

function makeSStyles(c: any) {
  return StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    shadowColor: c.navy,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: c.surface },
  subtitle: { fontSize: 12, color: c.slateMid, marginTop: 2 },
  badge: {
    backgroundColor: c.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: c.deepBlue, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  messageList: { padding: 12, gap: 8 },
  bubble: {
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxWidth: '85%',
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: c.navy, borderWidth: 1, borderColor: c.border },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: c.surface },
  bubbleTextUser: { color: c.surface, fontSize: 14, lineHeight: 20 },
  bubbleTextAssistant: { color: c.text, fontSize: 14, lineHeight: 20 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  loadingText: { color: c.slateMid, fontSize: 13, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  input: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.navy,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: c.deepBlue, fontSize: 18, fontWeight: '700' },
  });
}
