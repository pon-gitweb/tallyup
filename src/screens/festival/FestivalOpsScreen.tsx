// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  collection, doc, onSnapshot, updateDoc, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgencyLabel(u: string, c: any): { icon: string; text: string; color: string } {
  if (u === 'asap')       return { icon: '⚡', text: 'ASAP',      color: c.error };
  if (u === 'next-round') return { icon: '📦', text: '30–60 min', color: c.stellarAmber };
  return                         { icon: '📋', text: 'Planning',   color: c.slateMid };
}

function relTime(ts: any): string {
  if (!ts?.toDate) return '';
  const mins = Math.floor((Date.now() - ts.toDate().getTime()) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function dayOfEvent(startDateStr: string | undefined): string {
  if (!startDateStr) return '';
  // DD/MM/YYYY
  const parts = startDateStr.split('/');
  if (parts.length !== 3) return '';
  const start = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  const today = new Date();
  const diff = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
  return diff > 0 ? `Day ${diff}` : '';
}

function hoursColor(h: number | null, c: any): string {
  if (h === null) return c.slateMid;
  if (h > 4) return c.success;
  if (h > 2) return c.stellarAmber;
  return c.error;
}

function fillPct(current: number, par: number): number {
  if (!par || par <= 0) return 100;
  return Math.min(100, Math.round((current / par) * 100));
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalOpsScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;
  const userName = auth.currentUser?.displayName ?? 'Me';
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const O = makeStyles(c);

  const [event,     setEvent]     = useState<any>(null);
  const [bars,      setBars]      = useState<any[]>([]);
  const [barStock,  setBarStock]  = useState<Record<string, any[]>>({});
  const [requests,  setRequests]  = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [selectedBar, setSelectedBar] = useState<string>('all');
  const [loading,   setLoading]   = useState(FESTIVAL_BETA);
  const [acting,    setActing]    = useState<string | null>(null);

  const liveDot = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(liveDot, { toValue: 0.2, duration: 800, useNativeDriver: true }),
        Animated.timing(liveDot, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Load event doc
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      if (snap.exists()) setEvent(snap.data() as any);
    });
    return () => unsub();
  }, [venueId]);

  // Load departments (HQ first, then bars alphabetically) + their items
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    const unsub = onSnapshot(collection(db, 'venues', venueId, 'departments'), async snap => {
      const hqDoc = snap.docs.find(d => (d.data() as any).isFestivalHQ === true);
      const barDepts = snap.docs
        .filter(d => (d.data() as any).isFestivalBar === true)
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      const allDepts = [
        ...(hqDoc ? [{ id: hqDoc.id, ...(hqDoc.data() as any), isHQ: true }] : []),
        ...barDepts,
      ];
      setBars(allDepts);

      const stockMap: Record<string, any[]> = {};
      await Promise.all(allDepts.map(async dept => {
        try {
          if (dept.isHQ) {
            const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', 'hq', 'areas'));
            const all: any[] = [];
            for (const area of areasSnap.docs) {
              const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', 'hq', 'areas', area.id, 'items'));
              all.push(...itemsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
            }
            stockMap['hq'] = all;
          } else {
            const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', dept.id, 'areas', 'back-of-house', 'items'));
            stockMap[dept.id] = itemsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          }
        } catch { stockMap[dept.isHQ ? 'hq' : dept.id] = []; }
      }));
      setBarStock(stockMap);
      setLoading(false);
    });
    return () => unsub();
  }, [venueId]);

  // Live listeners for requests + transfers
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;

    const unsubReq = onSnapshot(
      collection(db, 'venues', venueId, 'requests'),
      snap => {
        setRequests(snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(r => r.status !== 'cancelled' && r.status !== 'delivered')
          .sort((a, b) => {
            const order = { asap: 0, 'next-round': 1, planning: 2 };
            const ud = (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
            if (ud !== 0) return ud;
            return (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0);
          }));
      },
      () => {},
    );

    const unsubXfr = onSnapshot(
      collection(db, 'venues', venueId, 'transfers'),
      snap => {
        const today = new Date();
        setTransfers(snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(x => {
            if (!x.createdAt?.toDate) return false;
            const d = x.createdAt.toDate();
            return d.getFullYear() === today.getFullYear()
              && d.getMonth() === today.getMonth()
              && d.getDate() === today.getDate();
          })
          .sort((a, b) =>
            (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0)
          ));
      },
    );

    return () => { unsubReq(); unsubXfr(); };
  }, [venueId]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={O.comingSoon}>
        <Text style={O.csEmoji}>🎪</Text>
        <Text style={O.csTitle}>Festival mode</Text>
        <Text style={O.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={O.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={O.comingSoon}>
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  async function assignToMe(reqId: string) {
    if (!venueId || acting) return;
    setActing(reqId);
    try {
      await updateDoc(doc(db, 'venues', venueId, 'requests', reqId), {
        status:         'accepted',
        assignedTo:     uid,
        assignedToName: userName,
        updatedAt:      serverTimestamp(),
      });
      showSuccess('✓ Request assigned to you');
    } catch (e: any) {
      showError(e?.message || 'Could not assign request.');
    } finally {
      setActing(null);
    }
  }

  function cancelRequest(reqId: string) {
    if (!venueId || acting) return;
    confirm({
      title: 'Cancel request',
      message: 'Are you sure?',
      confirmLabel: 'Yes, cancel',
      cancelLabel: 'No',
      destructive: true,
      onConfirm: async () => {
        setActing(reqId);
        try {
          await updateDoc(doc(db, 'venues', venueId, 'requests', reqId), {
            status:      'cancelled',
            cancelledBy: uid ?? 'unknown',
            updatedAt:   serverTimestamp(),
          });
          showSuccess('✓ Request cancelled');
        } catch (e: any) {
          showError(e?.message || 'Could not cancel request.');
        } finally {
          setActing(null);
        }
      },
    });
  }

  const pending  = requests.filter(r => r.status === 'pending');
  const accepted = requests.filter(r => r.status === 'accepted' || r.status === 'collected');
  const criticalAlerts = requests.filter(r => r.urgency === 'asap' && r.status === 'pending');

  // Filter by selected bar
  const visibleBars = selectedBar === 'all' ? bars : bars.filter(b => b.id === selectedBar);

  // Staleness threshold: ≤3 day event = 2hr, longer = 8hr
  const stalenessThresholdMs = (() => {
    if (!event?.startDate || !event?.endDate) return 8 * 3600000;
    try {
      const [sd, sm, sy] = event.startDate.split('/').map(Number);
      const [ed, em, ey] = event.endDate.split('/').map(Number);
      const start = new Date(sy, sm - 1, sd);
      const end   = new Date(ey, em - 1, ed);
      const days  = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
      return days <= 3 ? 2 * 3600000 : 8 * 3600000;
    } catch { return 8 * 3600000; }
  })();

  function barLastCountMs(barId: string): number {
    const items = barStock[barId] ?? [];
    return items.reduce((latest, item) => {
      const ts = item.lastCountAt?.toDate?.()?.getTime() ?? 0;
      return ts > latest ? ts : latest;
    }, 0);
  }

  // Stock alerts: bars with any product < 2hr remaining (critical < 1hr, warning 1–2hr)
  const hoursUntilEventClose = (() => {
    if (!event?.endDate) return null;
    try {
      const [d, m, y] = event.endDate.split('/').map(Number);
      const close = new Date(y, m - 1, d, 23, 59, 59);
      return Math.max(0, (close.getTime() - Date.now()) / 3_600_000);
    } catch { return null; }
  })();

  const stockAlerts: { barId: string; barName: string; productId: string; productName: string; hours: number; level: 'critical' | 'warning'; lostRevenue: string | null }[] = [];
  for (const bar of bars) {
    if (bar.isHQ) continue;
    const stock = barStock[bar.id] ?? [];
    for (const item of stock) {
      if (item.velocity > 0 && item.lastCount != null) {
        const hrs = item.lastCount / item.velocity;
        if (hrs < 2) {
          // Lost sales estimate if selling price available and event hours remain
          let lostRevenue: string | null = null;
          if (item.sellingPrice > 0 && hoursUntilEventClose != null) {
            const hoursShort = Math.max(0, hoursUntilEventClose - hrs);
            const projectedShortageDrinks = Math.ceil(item.velocity * hoursShort);
            if (projectedShortageDrinks > 0) {
              const revenue = projectedShortageDrinks * item.sellingPrice;
              lostRevenue = `~${projectedShortageDrinks} drinks · ~$${Math.round(revenue).toLocaleString()} potential revenue`;
            }
          }
          stockAlerts.push({
            barId: bar.id,
            barName: bar.name || bar.id,
            productId: item.id,
            productName: item.name || item.id,
            hours: hrs,
            level: hrs < 1 ? 'critical' : 'warning',
            lostRevenue,
          });
        }
      }
    }
  }

  const dayLabel = dayOfEvent(event?.startDate);

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={O.scroll}>

        {/* ── Event header ──────────────────────────────────────────────── */}
        <View style={O.eventHeader}>
          <View>
            <Text style={O.eventName} numberOfLines={1}>{event?.eventName || 'Ops Overview'}</Text>
            {dayLabel ? <Text style={O.dayLabel}>{dayLabel}</Text> : null}
          </View>
          <View style={O.liveRow}>
            <Animated.View style={[O.liveDot, { opacity: liveDot }]} />
            <Text style={O.liveText}>LIVE</Text>
          </View>
        </View>

        {/* ── Stock alerts (critical < 1hr, warning < 2hr) ─────────────── */}
        {stockAlerts.length > 0 && (
          <View style={O.alertBanner}>
            <Text style={O.alertBannerText}>
              🚨 {stockAlerts.filter(a => a.level === 'critical').length > 0 ? 'CRITICAL' : '⚠️ WARNING'} — {stockAlerts.length} product{stockAlerts.length !== 1 ? 's' : ''} running low
            </Text>
            {stockAlerts.map((a, i) => (
              <View key={i} style={{ marginTop: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[O.alertBannerSub, { flex: 1 }]}>
                  {a.level === 'critical' ? '🔴' : '🟡'} {a.barName} — {a.productName} (~{Math.round(a.hours * 60)}min)
                </Text>
                <TouchableOpacity
                  onPress={() => nav.navigate('FestivalDeliveryTasks', { prefilledBarId: a.barId, prefilledProductId: a.productId, urgency: a.level === 'critical' ? 'asap' : 'next-round' })}
                  style={{ backgroundColor: a.level === 'critical' ? c.error : c.stellarAmber, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, marginLeft: 8 }}
                >
                  <Text style={{ color: c.surface, fontSize: 11, fontWeight: '800' }}>Send top-up →</Text>
                </TouchableOpacity>
                </View>
                {a.lostRevenue && (
                  <Text style={{ fontSize: 11, color: c.error, marginTop: 2, marginLeft: 16 }}>
                    If not restocked: {a.lostRevenue}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* ── ASAP request alerts ───────────────────────────────────────── */}
        {criticalAlerts.length > 0 && (
          <View style={[O.alertBanner, { borderColor: c.stellarAmber, backgroundColor: c.stellarAmber + '15' }]}>
            <Text style={[O.alertBannerText, { color: c.stellarAmber }]}>
              ⚡ {criticalAlerts.length} ASAP request{criticalAlerts.length !== 1 ? 's' : ''} pending
            </Text>
          </View>
        )}

        {/* ── Bar switcher ──────────────────────────────────────────────── */}
        {bars.length > 0 && (
          <>
            <Text style={O.sectionLabel}>BARS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={O.barScroll}>
              <TouchableOpacity
                style={[O.barChip, selectedBar === 'all' && O.barChipOn]}
                onPress={() => setSelectedBar('all')}
              >
                <Text style={[O.barChipText, selectedBar === 'all' && O.barChipTextOn]}>All</Text>
              </TouchableOpacity>
              {bars.map(bar => (
                <TouchableOpacity
                  key={bar.id}
                  style={[O.barChip, selectedBar === bar.id && O.barChipOn]}
                  onPress={() => setSelectedBar(bar.id)}
                >
                  <Text style={[O.barChipText, selectedBar === bar.id && O.barChipTextOn]}>
                    {bar.name || bar.id}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* ── Per-bar stock cards ───────────────────────────────────────── */}
        {visibleBars.length > 0 && (
          <>
            <Text style={[O.sectionLabel, { marginTop: 16 }]}>STOCK STATUS</Text>
            {visibleBars.map(bar => {
              const stock = barStock[bar.id] ?? [];
              return (
                <TouchableOpacity
                  key={bar.id}
                  style={O.barCard}
                  onPress={() => nav.navigate('FestivalBarDashboard', { barId: bar.id, barName: bar.name || bar.id })}
                >
                  <Text style={O.barCardName}>{bar.name || bar.id}{bar.isHQ ? ' (HQ)' : ''}</Text>
                  {(() => {
                    if (bar.isHQ) return null;
                    const lastMs = barLastCountMs(bar.id);
                    if (!lastMs) return <Text style={O.staleText}>Not yet counted</Text>;
                    const ageMs = Date.now() - lastMs;
                    if (ageMs > stalenessThresholdMs) {
                      const hrs = Math.floor(ageMs / 3600000);
                      const mins = Math.floor((ageMs % 3600000) / 60000);
                      return (
                        <Text style={O.staleWarning}>
                          ⚠ Last count {hrs > 0 ? `${hrs}h ` : ''}{mins}m ago
                        </Text>
                      );
                    }
                    return null;
                  })()}
                  {stock.length === 0 ? (
                    <Text style={O.emptyText}>No stock data</Text>
                  ) : (
                    stock.slice(0, 4).map(item => {
                      const velocity = item.velocity ?? null;
                      const stockLevel = item.lastCount ?? item.currentStock ?? 0;
                      const hrs = velocity > 0 && stockLevel != null
                        ? stockLevel / velocity : null;
                      const pct = fillPct(stockLevel, item.parLevel ?? stockLevel ?? 0);
                      return (
                        <View key={item.id} style={O.stockRow}>
                          <Text style={O.stockName} numberOfLines={1}>{item.name || item.productName || item.id}</Text>
                          <View style={O.fillBg}>
                            <View style={[O.fillBar, { width: `${pct}%`, backgroundColor: hoursColor(hrs, c) }]} />
                          </View>
                          <Text style={[O.hoursText, { color: hoursColor(hrs, c) }]}>
                            {hrs != null ? `${hrs < 1 ? Math.round(hrs * 60) + 'min' : hrs.toFixed(1) + 'hr'}` : '—'}
                          </Text>
                        </View>
                      );
                    })
                  )}
                  {stock.length > 4 && (
                    <Text style={O.moreText}>+{stock.length - 4} more products</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* ── Pending requests ──────────────────────────────────────────── */}
        <Text style={[O.sectionLabel, { marginTop: 16 }]}>PENDING REQUESTS ({pending.length})</Text>
        {pending.length === 0 ? (
          <Text style={O.emptyText}>No pending requests.</Text>
        ) : (
          pending.map(req => {
            const u = urgencyLabel(req.urgency, c);
            const isActing = acting === req.id;
            return (
              <View key={req.id} style={O.card}>
                <View style={O.cardTop}>
                  <View style={[O.urgencyBadge, { borderColor: u.color, backgroundColor: u.color + '18' }]}>
                    <Text style={[O.urgencyText, { color: u.color }]}>{u.icon} {u.text}</Text>
                  </View>
                  <Text style={O.timeText}>{relTime(req.createdAt)}</Text>
                </View>
                <Text style={O.cardBarName}>{req.barName}</Text>
                {(req.products || []).map((p: any) => (
                  <Text key={p.productId} style={O.productLine}>
                    • {p.productName} × {p.quantity} {p.unit}
                  </Text>
                ))}
                {!!req.note && <Text style={O.noteText}>"{req.note}"</Text>}
                <View style={O.cardActions}>
                  <TouchableOpacity
                    style={[O.approveBtn, isActing && O.btnDisabled]}
                    disabled={!!acting}
                    onPress={() => assignToMe(req.id)}
                  >
                    <Text style={O.approveBtnText}>Assign to me</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[O.viewBtn, isActing && O.btnDisabled]}
                    disabled={!!acting}
                    onPress={() => nav.navigate('FestivalDeliveryTasks')}
                  >
                    <Text style={O.viewBtnText}>View</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[O.cancelBtn, isActing && O.btnDisabled]}
                    disabled={!!acting}
                    onPress={() => cancelRequest(req.id)}
                  >
                    <Text style={O.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        {/* ── Active deliveries ─────────────────────────────────────────── */}
        {accepted.length > 0 && (
          <>
            <Text style={[O.sectionLabel, { marginTop: 16 }]}>ACTIVE DELIVERIES ({accepted.length})</Text>
            {accepted.map(req => (
              <View key={req.id} style={[O.card, O.cardActive]}>
                <Text style={O.cardBarName}>{req.barName}</Text>
                <Text style={O.assignedText}>
                  {req.status === 'collected' ? '📦 Collected —' : '🚶 In progress —'} {req.assignedToName || 'Unassigned'}
                </Text>
                {(req.products || []).map((p: any) => (
                  <Text key={p.productId} style={O.productLine}>
                    • {p.productName} × {p.quantity}
                  </Text>
                ))}
              </View>
            ))}
          </>
        )}

        {/* ── Transfers today ───────────────────────────────────────────── */}
        {transfers.length > 0 && (
          <>
            <Text style={[O.sectionLabel, { marginTop: 16 }]}>TRANSFERS TODAY ({transfers.length})</Text>
            {transfers.map(xfr => {
              const riskIcon = xfr.velocityCheckResult === 'safe' ? '✅'
                : xfr.velocityCheckResult === 'caution' ? '⚠️' : '🚫';
              return (
                <View key={xfr.id} style={O.transferCard}>
                  <Text style={O.transferText}>
                    {riskIcon} {xfr.quantity} × {xfr.productName}
                  </Text>
                  <Text style={O.transferSub}>
                    {xfr.fromBarName} → {xfr.toBarName}  ·  {relTime(xfr.createdAt)}
                  </Text>
                  {xfr.overrideReason && (
                    <Text style={O.overrideText}>Override: {xfr.overrideReason}</Text>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── Quick actions ─────────────────────────────────────────────── */}
        <View style={O.quickActions}>
          <TouchableOpacity style={O.quickBtn} onPress={() => nav.navigate('FestivalTransfer', {})}>
            <Text style={O.quickBtnText}>🔄 New transfer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[O.quickBtn, O.quickBtnSecondary]}
            onPress={() => nav.navigate('FestivalDeliveryTasks')}
          >
            <Text style={[O.quickBtnText, O.quickBtnTextSecondary]}>📋 All tasks</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: any) {
  return StyleSheet.create({
    comingSoon: { flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 36 },
    csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    csTitle:    { fontSize: 26, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 16 },
    csBody:     { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24, marginBottom: 12 },
    csContact:  { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center', lineHeight: 22 },

    scroll:      { padding: 16, paddingBottom: 40 },

    eventHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
    eventName:   { fontSize: 22, fontWeight: '800', color: c.navy, flex: 1, marginRight: 8 },
    dayLabel:    { fontSize: 13, color: c.slateMid, marginTop: 2 },
    liveRow:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
    liveDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: c.success },
    liveText:    { fontSize: 11, fontWeight: '800', color: c.success, letterSpacing: 1 },

    alertBanner:    { backgroundColor: c.negativeSoft, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1.5, borderColor: c.error },
    alertBannerText: { fontSize: 14, fontWeight: '800', color: c.error, marginBottom: 4 },
    alertBannerSub:  { fontSize: 12, color: c.error, marginTop: 2 },

    sectionLabel: { fontSize: 11, fontWeight: '800', color: c.slateMid, letterSpacing: 1, marginBottom: 8 },
    emptyText:    { fontSize: 14, color: c.slateMid, fontStyle: 'italic', marginBottom: 12 },

    barScroll: { marginBottom: 4 },
    barChip:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.oat, marginRight: 8 },
    barChipOn: { borderColor: c.deepBlue, backgroundColor: c.primaryLight },
    barChipText:   { fontSize: 13, color: c.text, fontWeight: '500' },
    barChipTextOn: { color: c.deepBlue, fontWeight: '700' },

    barCard:      { backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    barCardName:  { fontSize: 15, fontWeight: '800', color: c.navy, marginBottom: 4 },
    staleText:    { fontSize: 11, color: c.slateMid, marginBottom: 6, fontStyle: 'italic' },
    staleWarning: { fontSize: 11, color: c.stellarAmber, fontWeight: '700', marginBottom: 6 },
    moreText:     { fontSize: 12, color: c.slateMid, marginTop: 4 },

    stockRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
    stockName: { fontSize: 12, color: c.text, width: 100, fontWeight: '500' },
    fillBg:    { flex: 1, height: 6, backgroundColor: c.border, borderRadius: 3, overflow: 'hidden' },
    fillBar:   { height: 6, borderRadius: 3 },
    hoursText: { fontSize: 11, fontWeight: '700', width: 36, textAlign: 'right' },

    card:       { backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    cardActive: { borderColor: c.deepBlue, borderWidth: 1.5 },
    cardTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },

    urgencyBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
    urgencyText:  { fontSize: 11, fontWeight: '700' },
    timeText:     { fontSize: 11, color: c.slateMid },

    cardBarName:  { fontSize: 16, fontWeight: '800', color: c.navy, marginBottom: 4 },
    productLine:  { fontSize: 13, color: c.text, lineHeight: 20 },
    assignedText: { fontSize: 12, color: c.slateMid, marginTop: 4 },
    noteText:     { fontSize: 12, color: c.slateMid, fontStyle: 'italic', marginTop: 4 },

    cardActions: { flexDirection: 'row', gap: 6, marginTop: 12 },
    approveBtn:  { flex: 1, backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
    approveBtnText: { color: c.surface, fontWeight: '700', fontSize: 12 },
    viewBtn:     { paddingHorizontal: 14, borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
    viewBtnText: { color: c.deepBlue, fontWeight: '700', fontSize: 12 },
    cancelBtn:   { paddingHorizontal: 14, borderWidth: 1.5, borderColor: c.border, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
    cancelBtnText:  { color: c.slateMid, fontWeight: '700', fontSize: 12 },
    btnDisabled: { opacity: 0.5 },

    transferCard: { backgroundColor: c.oat, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    transferText: { fontSize: 14, fontWeight: '700', color: c.navy },
    transferSub:  { fontSize: 12, color: c.slateMid, marginTop: 2 },
    overrideText: { fontSize: 11, color: c.stellarAmber, marginTop: 2, fontStyle: 'italic' },

    quickActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
    quickBtn:     { flex: 1, backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
    quickBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: c.deepBlue },
    quickBtnText: { color: c.surface, fontWeight: '700', fontSize: 14 },
    quickBtnTextSecondary: { color: c.deepBlue },
  });
}
