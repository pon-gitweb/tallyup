// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query } from 'firebase/firestore';
import { writeWeeklySnapshot } from '../../services/festival/weeklySnapshot';
import { apiBase } from '../../services/apiBase';
import {
  registerForPushNotifications,
  setupNotificationResponseHandler,
  setupForegroundHandler,
} from '../../services/notifications';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { VenueSwitcher } from '../../components/common/VenueSwitcher';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

const SECTIONS = [
  { key: 'basics',         label: 'Event basics' },
  { key: 'bars',           label: 'Bar configuration' },
  { key: 'sourceLocations',label: 'Source locations' },
  { key: 'productPlanning',label: 'Product planning' },
  { key: 'suppliers',      label: 'Supplier setup' },
  { key: 'historicalData', label: 'Historical data' },
];

export default function FestivalDashboardScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);
  const uid = auth.currentUser?.uid;
  const [event, setEvent] = useState<any>(null);
  const [role, setRole] = useState<string | null>(null);
  const [productCount, setProductCount] = useState(0);
  const [hasOrders, setHasOrders] = useState(false);
  // Only show loading spinner when beta mode is active
  const [loading, setLoading] = useState(FESTIVAL_BETA);

  // Register device for push notifications and set up handlers
  useEffect(() => {
    registerForPushNotifications();
    const cleanupForeground = setupForegroundHandler();
    const cleanupResponse = setupNotificationResponseHandler(nav);
    return () => {
      cleanupForeground();
      cleanupResponse();
    };
  }, []);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(
      doc(db, 'venues', venueId, 'event', 'details'),
      snap => { setLoading(false); setEvent(snap.exists() ? snap.data() : null); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venueId]);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !uid) return;
    const unsub = onSnapshot(
      doc(db, 'venues', venueId, 'members', uid),
      snap => { setRole(snap.exists() ? (snap.data() as any).role ?? null : null); },
    );
    return () => unsub();
  }, [venueId, uid]);

  // Load product count + orders existence for prediction tile
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    getDocs(collection(db, 'venues', venueId, 'products'))
      .then(snap => setProductCount(snap.size))
      .catch(() => {});
    getDocs(query(collection(db, 'venues', venueId, 'orders'), limit(1)))
      .then(snap => setHasOrders(!snap.empty))
      .catch(() => {});
  }, [venueId]);

  // ── Coming-soon gate ────────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.container}>
        {modal}
        <Text style={S.emoji}>🎪</Text>
        <Text style={S.title}>Festival mode</Text>
        <Text style={S.body}>
          We're building something great for festival and event operators.
        </Text>
        <Text style={S.body}>
          This feature is coming soon — we'll let you know when it's live.
        </Text>
        <Text style={S.contact}>Questions? Email us at{'\n'}office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.container}>
        {modal}
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  // ── No event set up yet ─────────────────────────────────────────────────────
  if (!event) {
    return (
      <View style={S.container}>
        {modal}
        <Text style={S.emoji}>🎪</Text>
        <Text style={S.title}>Welcome to Hosti Festival</Text>
        <Text style={S.body}>
          Let's set up your event.{'\n'}
          This takes about 5 minutes and you can add more detail any time.
        </Text>
        <TouchableOpacity style={S.cta} onPress={() => nav.navigate('FestivalEventSetup')}>
          <Text style={S.ctaText}>Set up your event →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.settingsLink} onPress={() => nav.navigate('Settings')}>
          <Text style={S.settingsLinkText}>Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Event exists — show dashboard ───────────────────────────────────────────
  const progress = event.setupProgress || {};
  const doneCount = SECTIONS.filter(s => progress[s.key]).length;
  const allDone = doneCount === SECTIONS.length;

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={S.emoji}>🎪</Text>
          <VenueSwitcher />
        </View>
        <Text style={[S.title, { textAlign: 'left', marginBottom: 4 }]}>
          {event.eventName || 'Your event'}
        </Text>
        {(event.startDate || event.endDate) && (
          <Text style={S.dates}>
            {event.startDate}
            {event.endDate && event.endDate !== event.startDate ? ` → ${event.endDate}` : ''}
          </Text>
        )}

        <View style={S.progressCard}>
          <Text style={S.progressHeading}>
            Setup progress · {doneCount}/{SECTIONS.length}
          </Text>
          {SECTIONS.map(sec => (
            <View key={sec.key} style={S.progressRow}>
              <Text style={progress[sec.key] ? S.dotDone : S.dotPending}>
                {progress[sec.key] ? '●' : '○'}
              </Text>
              <Text style={[S.progressLabel, progress[sec.key] && S.progressLabelDone]}>
                {sec.label}
              </Text>
              {progress[sec.key] && <Text style={S.check}>✓</Text>}
            </View>
          ))}
        </View>

        {doneCount >= 4 && !hasOrders && (
          <TouchableOpacity
            style={S.generateOrderCTA}
            onPress={() => nav.navigate('FestivalPurchasingPrediction')}
          >
            <Text style={S.generateOrderCTAText}>
              ✓ Setup ready — generate your suggested order →
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={S.cta} onPress={() => nav.navigate('FestivalEventSetup')}>
          <Text style={S.ctaText}>
            {allDone ? 'View event setup' : 'Continue setup →'}
          </Text>
        </TouchableOpacity>

        {/* Week close nudge (FIX 4) */}
        {event?.cycleLength === 'weekly' && event?.status !== 'closed' && (() => {
          const getWeekNum = () => {
            if (!event?.startDate) return null;
            try {
              const [ds, ms, ys] = event.startDate.split('/');
              const start = new Date(parseInt(ys), parseInt(ms) - 1, parseInt(ds));
              const now = new Date();
              return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000 / 7));
            } catch { return null; }
          };
          const weekNum = getWeekNum();
          if (!weekNum) return null;
          return (
            <View style={S.weekNudge}>
              <Text style={S.weekNudgeTitle}>Week {weekNum} — ready to review</Text>
              <Text style={S.weekNudgeBody}>Snapshot this week's activity before moving on.</Text>
              <View style={S.weekNudgeBtns}>
                <TouchableOpacity
                  style={S.weekNudgeBtn}
                  onPress={() => nav.navigate('FestivalWeekReview', { weekNumber: weekNum })}
                >
                  <Text style={S.weekNudgeBtnText}>Review Week {weekNum} →</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.weekNudgeBtn, { backgroundColor: c.success }]}
                  onPress={() => {
                    confirm({
                      title: `Close Week ${weekNum}?`,
                      message: `This locks Week ${weekNum}'s data and updates the velocity model for ordering accuracy.`,
                      confirmLabel: 'Close week',
                      onConfirm: async () => {
                        try {
                          await writeWeeklySnapshot(venueId!, weekNum);
                          showSuccess(`✓ Week ${weekNum} closed and snapshot saved.`);
                        } catch (e: any) {
                          showError(e?.message || 'Could not close week.');
                        }
                      },
                    });
                  }}
                >
                  <Text style={S.weekNudgeBtnText}>Close Week {weekNum} ✓</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}

        {/* Closed event banner */}
        {event?.status === 'closed' && (
          <View style={S.closedBanner}>
            <Text style={S.closedBannerText}>✓ Event closed — view history for details</Text>
            <TouchableOpacity onPress={() => nav.navigate('FestivalEventHistory')}>
              <Text style={S.closedBannerLink}>View history →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Phase 5 — role-based quick access tiles */}
        {role === 'owner' && (
          <>
            <Text style={S.tilesHeading}>COUNTS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalBarSelection')}>
                <Text style={S.tileEmoji}>📦</Text>
                <Text style={S.tileLabel}>Load-in count</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalBarSelection')}>
                <Text style={S.tileEmoji}>📊</Text>
                <Text style={S.tileLabel}>Session count</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalEndOfEventCount')}>
                <Text style={S.tileEmoji}>🔒</Text>
                <Text style={S.tileLabel}>Close-out count</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>ORDERS & RECEIVING</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity
                style={[S.tile, doneCount >= 4 && !hasOrders && S.tilePredictionHighlight]}
                onPress={() => nav.navigate('FestivalPurchasingPrediction')}
              >
                <Text style={S.tileEmoji}>📋</Text>
                <Text style={S.tileLabel}>Suggested order</Text>
                {productCount > 0 && (
                  <Text style={S.tileSub}>{productCount} products</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('Orders')}>
                <Text style={S.tileEmoji}>🛒</Text>
                <Text style={S.tileLabel}>Orders</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalGoodsIn')}>
                <Text style={S.tileEmoji}>🚚</Text>
                <Text style={S.tileLabel}>Goods in</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalStockOverview')}>
                <Text style={S.tileEmoji}>🗺</Text>
                <Text style={S.tileLabel}>Stock overview</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalSalesUpload')}>
                <Text style={S.tileEmoji}>📊</Text>
                <Text style={S.tileLabel}>Upload sales data</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('CraftUp')}>
                <Text style={S.tileEmoji}>🍹</Text>
                <Text style={S.tileLabel}>Recipes</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalOpeningStock')}>
                <Text style={S.tileEmoji}>📦</Text>
                <Text style={S.tileLabel}>Opening stock</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>CONTRACTS & COMPLIANCE</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalContracts')}>
                <Text style={S.tileEmoji}>📋</Text>
                <Text style={S.tileLabel}>Contracts</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalObligations')}>
                <Text style={S.tileEmoji}>🎯</Text>
                <Text style={S.tileLabel}>Obligations</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>OPERATIONS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalRiders')}>
                <Text style={S.tileEmoji}>🎸</Text>
                <Text style={S.tileLabel}>Riders</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalActivations')}>
                <Text style={S.tileEmoji}>⚡</Text>
                <Text style={S.tileLabel}>Activations</Text>
              </TouchableOpacity>
            </View>
            {event?.status !== 'closed' && (
              <>
                <Text style={S.tilesHeading}>CLOSE EVENT</Text>
                <View style={S.tilesRow}>
                  <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalEndOfEventCount')}>
                    <Text style={S.tileEmoji}>🔒</Text>
                    <Text style={S.tileLabel}>Close event</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalEventHistory')}>
                    <Text style={S.tileEmoji}>📜</Text>
                    <Text style={S.tileLabel}>Event history</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            <Text style={S.tilesHeading}>SETTINGS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('Settings')}>
                <Text style={S.tileEmoji}>⚙️</Text>
                <Text style={S.tileLabel}>Settings</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {role === 'manager' && (
          <>
            <Text style={S.tilesHeading}>COUNTS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalBarSelection')}>
                <Text style={S.tileEmoji}>📦</Text>
                <Text style={S.tileLabel}>Load-in count</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalBarSelection')}>
                <Text style={S.tileEmoji}>📊</Text>
                <Text style={S.tileLabel}>Session count</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalEndOfEventCount')}>
                <Text style={S.tileEmoji}>🔒</Text>
                <Text style={S.tileLabel}>Close-out count</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>ORDERS & RECEIVING</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity
                style={[S.tile, doneCount >= 4 && !hasOrders && S.tilePredictionHighlight]}
                onPress={() => nav.navigate('FestivalPurchasingPrediction')}
              >
                <Text style={S.tileEmoji}>📋</Text>
                <Text style={S.tileLabel}>Suggested order</Text>
                {productCount > 0 && (
                  <Text style={S.tileSub}>{productCount} products</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('Orders')}>
                <Text style={S.tileEmoji}>🛒</Text>
                <Text style={S.tileLabel}>Orders</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalGoodsIn')}>
                <Text style={S.tileEmoji}>🚚</Text>
                <Text style={S.tileLabel}>Goods in</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalStockOverview')}>
                <Text style={S.tileEmoji}>🗺</Text>
                <Text style={S.tileLabel}>Stock overview</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalSalesUpload')}>
                <Text style={S.tileEmoji}>📊</Text>
                <Text style={S.tileLabel}>Upload sales data</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('CraftUp')}>
                <Text style={S.tileEmoji}>🍹</Text>
                <Text style={S.tileLabel}>Recipes</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalOpeningStock')}>
                <Text style={S.tileEmoji}>📦</Text>
                <Text style={S.tileLabel}>Opening stock</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>COMPLIANCE</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalObligations')}>
                <Text style={S.tileEmoji}>🎯</Text>
                <Text style={S.tileLabel}>Obligations</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>OPERATIONS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalRiders')}>
                <Text style={S.tileEmoji}>🎸</Text>
                <Text style={S.tileLabel}>Riders</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalActivations')}>
                <Text style={S.tileEmoji}>⚡</Text>
                <Text style={S.tileLabel}>Activations</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>SETTINGS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('Settings')}>
                <Text style={S.tileEmoji}>⚙️</Text>
                <Text style={S.tileLabel}>Settings</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {role === 'staff' && (
          <>
            <Text style={S.tilesHeading}>COUNTS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalBarSelection')}>
                <Text style={S.tileEmoji}>📦</Text>
                <Text style={S.tileLabel}>Load-in count</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalBarSelection')}>
                <Text style={S.tileEmoji}>📊</Text>
                <Text style={S.tileLabel}>Session count</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalEndOfEventCount')}>
                <Text style={S.tileEmoji}>🔒</Text>
                <Text style={S.tileLabel}>Close-out count</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>TODAY</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalRiders')}>
                <Text style={S.tileEmoji}>🎸</Text>
                <Text style={S.tileLabel}>Rider tasks</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('FestivalActivations')}>
                <Text style={S.tileEmoji}>⚡</Text>
                <Text style={S.tileLabel}>Today's activations</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.tilesHeading}>SETTINGS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('Settings')}>
                <Text style={S.tileEmoji}>⚙️</Text>
                <Text style={S.tileLabel}>Settings</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Safety net — always show Settings if role hasn't loaded */}
        {!role && (
          <>
            <Text style={S.tilesHeading}>SETTINGS</Text>
            <View style={S.tilesRow}>
              <TouchableOpacity style={S.tile} onPress={() => nav.navigate('Settings')}>
                <Text style={S.tileEmoji}>⚙️</Text>
                <Text style={S.tileLabel}>Settings</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

      </ScrollView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.oat,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 36,
    },
    emoji: { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    title: {
      fontSize: 26, fontWeight: '800', color: c.navy,
      textAlign: 'center', marginBottom: 16, letterSpacing: -0.3,
    },
    body: {
      fontSize: 16, color: c.slateMid, textAlign: 'center',
      lineHeight: 24, marginBottom: 12,
    },
    contact: {
      marginTop: 20, fontSize: 14, color: c.slateMid,
      textAlign: 'center', lineHeight: 22,
    },
    dates: { fontSize: 14, color: c.slateMid, marginBottom: 20 },
    cta: {
      backgroundColor: c.deepBlue, borderRadius: 999,
      paddingVertical: 15, paddingHorizontal: 28,
      alignItems: 'center', marginTop: 8,
    },
    ctaText: { color: c.surface, fontWeight: '700', fontSize: 16 },

    progressCard: {
      backgroundColor: c.surface, borderRadius: 14, padding: 16,
      marginBottom: 16, borderWidth: 1, borderColor: c.border,
    },
    progressHeading: {
      fontSize: 13, fontWeight: '700', color: c.navy,
      marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5,
    },
    progressRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
    dotDone: { fontSize: 14, color: c.deepBlue, marginRight: 10 },
    dotPending: { fontSize: 14, color: c.border, marginRight: 10 },
    progressLabel: { flex: 1, fontSize: 14, color: c.slateMid },
    progressLabelDone: { color: c.navy, fontWeight: '600' },
    check: { fontSize: 13, color: c.deepBlue, fontWeight: '700' },

    closedBanner:     { backgroundColor: c.positiveSoft, borderRadius: 10, padding: 12, marginTop: 12, marginBottom: 4 },
    closedBannerText: { fontSize: 13, fontWeight: '700', color: c.success, marginBottom: 2 },
    closedBannerLink: { fontSize: 13, color: c.deepBlue, fontWeight: '700' },

    weekNudge:     { backgroundColor: c.primaryLight, borderRadius: 12, padding: 14, marginTop: 12, marginBottom: 4, borderWidth: 1, borderColor: c.deepBlue },
    weekNudgeTitle:{ fontSize: 14, fontWeight: '800', color: c.deepBlue, marginBottom: 4 },
    weekNudgeBody: { fontSize: 13, color: c.text, marginBottom: 10 },
    weekNudgeBtns: { flexDirection: 'row', gap: 8 },
    weekNudgeBtn:  { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
    weekNudgeBtnText: { color: c.surface, fontWeight: '700', fontSize: 13 },

    tilesHeading: {
      fontSize: 11, fontWeight: '800', color: c.slateMid,
      letterSpacing: 1, marginTop: 24, marginBottom: 10,
    },
    tilesRow: { flexDirection: 'row', gap: 12 },
    tile: {
      flex: 1, backgroundColor: c.surface, borderRadius: 14,
      padding: 16, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border, minHeight: 90,
    },
    tileEmoji: { fontSize: 28, marginBottom: 8 },
    tileLabel: { fontSize: 13, fontWeight: '700', color: c.navy, textAlign: 'center' },

    settingsLink: { marginTop: 20, paddingVertical: 8, paddingHorizontal: 20 },
    settingsLinkText: { fontSize: 14, color: c.slateMid, textDecorationLine: 'underline' },

    generateOrderCTA: { backgroundColor: c.primaryLight, borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1.5, borderColor: c.deepBlue },
    generateOrderCTAText: { color: c.deepBlue, fontWeight: '700', fontSize: 14, textAlign: 'center' },
    tilePredictionHighlight: { borderColor: c.stellarAmber, borderWidth: 2 },
    tileSub: { fontSize: 11, color: c.slateMid, marginTop: 2, textAlign: 'center' },
  });
}
