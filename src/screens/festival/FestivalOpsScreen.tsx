// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  collection, doc, onSnapshot, updateDoc, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urgencyLabel(u: string): { icon: string; text: string; color: string } {
  if (u === 'asap')       return { icon: '⚡', text: 'ASAP',      color: '#dc2626' };
  if (u === 'next-round') return { icon: '📦', text: '30–60 min', color: '#d97706' };
  return                         { icon: '📋', text: 'Planning',   color: '#6b7280' };
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

function hoursColor(h: number | null): string {
  if (h === null) return '#6b7280';
  if (h > 4) return '#16a34a';
  if (h > 2) return '#d97706';
  return '#dc2626';
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
        <ActivityIndicator color="#1b4f72" size="large" />
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
    } catch (e: any) {
      Alert.alert('Error', e?.message);
    } finally {
      setActing(null);
    }
  }

  async function cancelRequest(reqId: string) {
    if (!venueId || acting) return;
    Alert.alert('Cancel request', 'Are you sure?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel', style: 'destructive', onPress: async () => {
          setActing(reqId);
          try {
            await updateDoc(doc(db, 'venues', venueId, 'requests', reqId), {
              status:      'cancelled',
              cancelledBy: uid ?? 'unknown',
              updatedAt:   serverTimestamp(),
            });
          } catch (e: any) {
            Alert.alert('Error', e?.message);
          } finally {
            setActing(null);
          }
        },
      },
    ]);
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
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
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
                  style={{ backgroundColor: a.level === 'critical' ? '#dc2626' : '#d97706', borderRadius: 6, paddingVertical: 4, paddingHorizontal: 8, marginLeft: 8 }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>Send top-up →</Text>
                </TouchableOpacity>
                </View>
                {a.lostRevenue && (
                  <Text style={{ fontSize: 11, color: '#dc2626', marginTop: 2, marginLeft: 16 }}>
                    If not restocked: {a.lostRevenue}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* ── ASAP request alerts ───────────────────────────────────────── */}
        {criticalAlerts.length > 0 && (
          <View style={[O.alertBanner, { borderColor: '#d97706', backgroundColor: '#fffbeb' }]}>
            <Text style={[O.alertBannerText, { color: '#d97706' }]}>
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
                            <View style={[O.fillBar, { width: `${pct}%`, backgroundColor: hoursColor(hrs) }]} />
                          </View>
                          <Text style={[O.hoursText, { color: hoursColor(hrs) }]}>
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
            const u = urgencyLabel(req.urgency);
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
const O = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:      { padding: 16, paddingBottom: 40 },

  eventHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  eventName:   { fontSize: 22, fontWeight: '800', color: '#0B132B', flex: 1, marginRight: 8 },
  dayLabel:    { fontSize: 13, color: '#6b7280', marginTop: 2 },
  liveRow:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a' },
  liveText:    { fontSize: 11, fontWeight: '800', color: '#16a34a', letterSpacing: 1 },

  alertBanner:    { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1.5, borderColor: '#dc2626' },
  alertBannerText: { fontSize: 14, fontWeight: '800', color: '#dc2626', marginBottom: 4 },
  alertBannerSub:  { fontSize: 12, color: '#dc2626', marginTop: 2 },

  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },
  emptyText:    { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', marginBottom: 12 },

  barScroll: { marginBottom: 4 },
  barChip:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', marginRight: 8 },
  barChipOn: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  barChipText:   { fontSize: 13, color: '#374151', fontWeight: '500' },
  barChipTextOn: { color: '#1b4f72', fontWeight: '700' },

  barCard:      { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  barCardName:  { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  staleText:    { fontSize: 11, color: '#9ca3af', marginBottom: 6, fontStyle: 'italic' },
  staleWarning: { fontSize: 11, color: '#d97706', fontWeight: '700', marginBottom: 6 },
  moreText:     { fontSize: 12, color: '#9ca3af', marginTop: 4 },

  stockRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  stockName: { fontSize: 12, color: '#374151', width: 100, fontWeight: '500' },
  fillBg:    { flex: 1, height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  fillBar:   { height: 6, borderRadius: 3 },
  hoursText: { fontSize: 11, fontWeight: '700', width: 36, textAlign: 'right' },

  card:       { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  cardActive: { borderColor: '#1b4f72', borderWidth: 1.5 },
  cardTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },

  urgencyBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  urgencyText:  { fontSize: 11, fontWeight: '700' },
  timeText:     { fontSize: 11, color: '#9ca3af' },

  cardBarName:  { fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  productLine:  { fontSize: 13, color: '#374151', lineHeight: 20 },
  assignedText: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  noteText:     { fontSize: 12, color: '#6b7280', fontStyle: 'italic', marginTop: 4 },

  cardActions: { flexDirection: 'row', gap: 6, marginTop: 12 },
  approveBtn:  { flex: 1, backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  viewBtn:     { paddingHorizontal: 14, borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  viewBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 12 },
  cancelBtn:   { paddingHorizontal: 14, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  cancelBtnText:  { color: '#6b7280', fontWeight: '700', fontSize: 12 },
  btnDisabled: { opacity: 0.5 },

  transferCard: { backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  transferText: { fontSize: 14, fontWeight: '700', color: '#0B132B' },
  transferSub:  { fontSize: 12, color: '#6b7280', marginTop: 2 },
  overrideText: { fontSize: 11, color: '#d97706', marginTop: 2, fontStyle: 'italic' },

  quickActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  quickBtn:     { flex: 1, backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 13, alignItems: 'center' },
  quickBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#1b4f72' },
  quickBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  quickBtnTextSecondary: { color: '#1b4f72' },
});
