// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { buildDepletionCurve } from '../../services/festival/depletionCurve';
import { buildHourlyIntelligence, HourlyIntelligence } from '../../services/festival/hourlyIntelligence';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type StockItem = {
  id: string;
  productName: string;
  currentStock: number;
  velocity: number | null;
  lastCountAt: any;
  maxStock: number | null;
  minStock: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursRemaining(stock: number, velocity: number | null): number | null {
  if (!velocity || velocity <= 0) return null;
  return stock / velocity;
}

function stockColor(hrs: number | null, c: any): string {
  if (hrs === null) return c.success;
  if (hrs < 2)  return c.error;
  if (hrs < 4)  return c.stellarAmber;
  return c.success;
}

function stockBg(hrs: number | null, c: any): string {
  if (hrs === null) return c.positiveSoft;
  if (hrs < 2)  return c.negativeSoft;
  if (hrs < 4)  return c.stellarAmber + '22';
  return c.positiveSoft;
}

function fillPct(item: StockItem): number | null {
  if (!item.maxStock) return null;
  return Math.min(1, Math.max(0, item.currentStock / item.maxStock));
}

function fmtHrs(hrs: number): string {
  if (hrs < 1) return `${Math.round(hrs * 60)}min`;
  return `${hrs.toFixed(1)}hr`;
}

function fmtLastCount(ts: any): string {
  if (!ts?.toDate) return 'Not yet counted';
  const d: Date = ts.toDate();
  return `Last count: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalBarDashboardScreen() {
  const nav    = useNavigation<any>();
  const route  = useRoute<any>();
  const { barId, barName, barLocation } = route.params || {};
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);

  const [stock,        setStock]        = useState<StockItem[]>([]);
  const [bar,          setBar]          = useState<any>(null);
  const [loading,      setLoading]      = useState(FESTIVAL_BETA);
  const [role,         setRole]         = useState<string>('staff');
  const [eventDetails, setEventDetails] = useState<any>(null);
  const [inTransit,    setInTransit]    = useState<Record<string, number>>({}); // productId → in-transit qty
  const [depletionMap, setDepletionMap] = useState<Record<string, any>>({}); // productId → DepletionCurve
  const [hourly, setHourly] = useState<HourlyIntelligence | null>(null);

  // Load role
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
      if (snap.exists()) setRole((snap.data() as any).role || 'staff');
    });
    return () => unsub();
  }, [venueId]);

  // Load bar department doc
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'departments', barId), snap => {
      setBar(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [venueId, barId]);

  // Load items from back-of-house area
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'departments', barId, 'areas', 'back-of-house', 'items'),
      snap => {
        setStock(snap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            productName: data.name || d.id,
            currentStock: data.lastCount ?? 0,
            velocity: data.velocity ?? null,
            lastCountAt: data.lastCountAt ?? null,
            maxStock: data.maxStock ?? null,
            minStock: data.minStock ?? null,
          };
        }));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [venueId, barId]);

  // Load event details (for event end time used in depletion curve)
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      setEventDetails(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [venueId]);

  // Load in-transit requests for this bar (pending/accepted) + compute depletion when stock or velocity changes
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId || stock.length === 0) return;
    (async () => {
      // In-transit stock from pending/accepted requests
      try {
        const reqSnap = await getDocs(query(
          collection(db, 'venues', venueId, 'requests'),
          where('barId', '==', barId),
          where('status', 'in', ['pending', 'accepted', 'collected'])
        ));
        const transit: Record<string, number> = {};
        reqSnap.docs.forEach(d => {
          const r = d.data() as any;
          (r.products || []).forEach((p: any) => {
            if (p.productId) transit[p.productId] = (transit[p.productId] || 0) + (p.quantity || 0);
          });
        });
        setInTransit(transit);
      } catch {}

      // Compute depletion curves for items with velocity
      try {
        const sessSnap = await getDocs(query(
          collection(db, 'venues', venueId, 'sessions'),
          where('barId', '==', barId)
        ));
        const sessions = sessSnap.docs.map(d => d.data());

        // Build hourly intelligence
        const intel = buildHourlyIntelligence(sessions, eventDetails?.startDate);
        setHourly(intel);

        const endDate = eventDetails?.endDate;
        const eventCloseTime = endDate ? (() => {
          try {
            const [d, m, y] = endDate.split('/').map(Number);
            const t = new Date(y, m - 1, d, 23, 59, 59);
            return isNaN(t.getTime()) ? null : t;
          } catch { return null; }
        })() : null;
        if (!eventCloseTime) return;
        const newDepletionMap: Record<string, any> = {};
        for (const item of stock) {
          if (!item.velocity || item.velocity <= 0) continue;
          const transitQty = (inTransit[item.id] || 0);
          const effectiveStock = item.currentStock + transitQty;
          const curve = buildDepletionCurve(sessions, item.id, effectiveStock, item.velocity, eventCloseTime);
          newDepletionMap[item.id] = { ...curve, inTransitAdded: transitQty };
        }
        setDepletionMap(newDepletionMap);
      } catch {}
    })();
  }, [venueId, barId, stock, eventDetails]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.comingSoon}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.comingSoon}>
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  const isOpsManager = role === 'owner' || role === 'manager';
  const lastCountTime = stock.reduce((latest, item) => {
    if (!item.lastCountAt?.toDate) return latest;
    const t = item.lastCountAt.toDate().getTime();
    return t > latest ? t : latest;
  }, 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={S.scroll}>

        {/* Header */}
        <View style={S.header}>
          <View style={{ flex: 1 }}>
            <Text style={S.barName}>{barName || bar?.name || 'Bar'}</Text>
            {!!barLocation && <Text style={S.barLocation}>{barLocation}</Text>}
            <Text style={S.lastCount}>
              {lastCountTime > 0
                ? `Last count: ${new Date(lastCountTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Not yet counted'}
            </Text>
          </View>
          <TouchableOpacity
            style={S.countBtn}
            onPress={() => nav.navigate('FestivalSessionCount', { barId, barName: barName || bar?.name })}
          >
            <Text style={S.countBtnText}>Count now</Text>
          </TouchableOpacity>
        </View>

        {/* Stock list */}
        {stock.length === 0 ? (
          <View style={S.emptyCard}>
            <Text style={S.emptyText}>No products assigned to this bar yet.{'\n'}Run a session count to add stock.</Text>
          </View>
        ) : (
          stock.map(item => {
            const hrs  = hoursRemaining(item.currentStock, item.velocity);
            const fill = fillPct(item);
            const col  = stockColor(hrs, c);
            const bg   = stockBg(hrs, c);

            return (
              <View key={item.id} style={[S.stockCard, { backgroundColor: bg }]}>
                <View style={S.stockCardTop}>
                  <Text style={S.productName}>{item.productName}</Text>
                  {hrs !== null && hrs < 4 && (
                    <View style={[S.alertPill, { backgroundColor: col + '22', borderColor: col }]}>
                      <Text style={[S.alertPillText, { color: col }]}>
                        {hrs < 2 ? '🔴 Critical' : '🟡 Low'}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Fill bar */}
                {fill !== null && (
                  <View style={S.fillTrack}>
                    <View style={[S.fillBar, { width: `${Math.round(fill * 100)}%`, backgroundColor: col }]} />
                  </View>
                )}

                <View style={S.stockMeta}>
                  <Text style={S.stockQty}>
                    Stock: {item.currentStock} units
                    {(inTransit[item.id] || 0) > 0 ? ` (+${inTransit[item.id]} in transit)` : ''}
                  </Text>
                  {isOpsManager && item.velocity != null && item.velocity > 0 ? (
                    <>
                      <Text style={S.stockDetail}>Velocity: ~{item.velocity.toFixed(1)}/hr</Text>
                      {hrs !== null && (
                        <Text style={[S.stockDetail, { color: col, fontWeight: '700' }]}>
                          Est. remaining: {fmtHrs(hrs)}
                        </Text>
                      )}
                    </>
                  ) : !isOpsManager ? null : (
                    <Text style={S.stockDetail}>No velocity data yet</Text>
                  )}
                </View>
                {isOpsManager && depletionMap[item.id] && depletionMap[item.id].recommendationType !== 'on_track' && depletionMap[item.id].recommendationType !== 'no_data' && (
                  <Text style={{ fontSize: 11, color: depletionMap[item.id].recommendationType === 'sellout_before_close' ? c.error : c.stellarAmber, marginTop: 4, fontStyle: 'italic' }}>
                    {depletionMap[item.id].recommendation}
                  </Text>
                )}
              </View>
            );
          })
        )}

        {/* Hourly intelligence */}
        {hourly && hourly.buckets.length > 0 && (
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e5e1d8' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: c.navy, marginBottom: 12 }}>
              ⏱ Hourly Activity
            </Text>

            {/* Peak and quiet hour summary */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {hourly.peakHour && (
                <View style={{ flex: 1, backgroundColor: '#fee2e2', borderRadius: 10, padding: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5 }}>Busiest Hour</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: '#dc2626', marginTop: 2 }}>{hourly.peakHour.label}</Text>
                  <Text style={{ fontSize: 12, color: '#dc2626', marginTop: 2 }}>{hourly.peakHour.totalConsumed} units consumed</Text>
                </View>
              )}
              {hourly.peakProduct && (
                <View style={{ flex: 1, backgroundColor: '#eff6ff', borderRadius: 10, padding: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#1b4f72', textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Product</Text>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: '#1b4f72', marginTop: 2 }} numberOfLines={2}>{hourly.peakProduct.productName}</Text>
                  <Text style={{ fontSize: 12, color: '#1b4f72', marginTop: 2 }}>{hourly.peakProduct.consumed} units total</Text>
                </View>
              )}
            </View>

            {/* Hourly bar chart — simple horizontal bars */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 8 }}>
              Units consumed per hour
            </Text>
            {hourly.buckets.map(bucket => {
              const maxConsumed = Math.max(...hourly.buckets.map(b => b.totalConsumed), 1);
              const pct = bucket.totalConsumed / maxConsumed;
              const isPeak = bucket.hour === hourly.peakHour?.hour;
              return (
                <View key={bucket.hour} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                  <Text style={{ fontSize: 12, color: '#6b7280', width: 36, textAlign: 'right' }}>{bucket.label}</Text>
                  <View style={{ flex: 1, height: 20, backgroundColor: '#f5f3ee', borderRadius: 4, overflow: 'hidden' }}>
                    <View style={{
                      width: `${Math.round(pct * 100)}%`,
                      height: '100%',
                      backgroundColor: isPeak ? '#dc2626' : '#1b4f72',
                      borderRadius: 4,
                    }} />
                  </View>
                  <Text style={{ fontSize: 12, color: '#6b7280', width: 28, textAlign: 'right' }}>{bucket.totalConsumed}</Text>
                </View>
              );
            })}

            {/* Average velocity */}
            <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 8, textAlign: 'center' }}>
              Average {hourly.averageHourlyVelocity.toFixed(1)} units/hr across {hourly.buckets.length} hour{hourly.buckets.length > 1 ? 's' : ''}
            </Text>

            {/* Future hook — performance correlation placeholder */}
            <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'center', fontStyle: 'italic' }}>
              Performance correlation coming soon — assign stages and set times to unlock deeper insights
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={S.actions}>
          <TouchableOpacity
            style={S.actionBtn}
            onPress={() => nav.navigate('FestivalTopUpRequest', { barId, barName: barName || bar?.name })}
          >
            <Text style={S.actionBtnText}>📦  Request top-up</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={S.actionBtn}
            onPress={() => nav.navigate('FestivalSessionCount', { barId, barName: barName || bar?.name })}
          >
            <Text style={S.actionBtnText}>📋  Record count</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={S.actionBtn}
            onPress={() => nav.navigate('FestivalWastage', { barId, barName: barName || bar?.name })}
          >
            <Text style={S.actionBtnText}>⚠️  Record wastage</Text>
          </TouchableOpacity>

          {isOpsManager && (
            <>
              <TouchableOpacity
                style={[S.actionBtn, S.actionBtnSecondary]}
                onPress={() => nav.navigate('FestivalTransfer', { fromBarId: barId, fromBarName: barName || bar?.name })}
              >
                <Text style={[S.actionBtnText, S.actionBtnTextSecondary]}>🔄  Suggest transfer</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[S.actionBtn, S.actionBtnSecondary]}
                onPress={() => nav.navigate('FestivalOps')}
              >
                <Text style={[S.actionBtnText, S.actionBtnTextSecondary]}>📊  View session history</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[S.actionBtn, S.actionBtnSecondary]}
                onPress={() => nav.navigate('FestivalCrowdFlow')}
              >
                <Text style={[S.actionBtnText, S.actionBtnTextSecondary]}>🌊  Crowd flow</Text>
              </TouchableOpacity>
            </>
          )}
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

    scroll: { padding: 16, paddingBottom: 40 },

    header:      { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20, gap: 12 },
    barName:     { fontSize: 22, fontWeight: '800', color: c.navy },
    barLocation: { fontSize: 13, color: c.slateMid, marginTop: 2 },
    lastCount:   { fontSize: 12, color: c.slateMid, marginTop: 4 },
    countBtn:    { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, marginTop: 4 },
    countBtnText:{ color: c.primaryText, fontWeight: '700', fontSize: 13 },

    stockCard:    { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    stockCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
    productName:  { flex: 1, fontSize: 15, fontWeight: '700', color: c.navy },
    alertPill:    { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
    alertPillText:{ fontSize: 11, fontWeight: '700' },

    fillTrack: { height: 8, backgroundColor: c.border, borderRadius: 4, marginBottom: 8, overflow: 'hidden' },
    fillBar:   { height: 8, borderRadius: 4 },

    stockMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    stockQty:    { fontSize: 13, color: c.text, fontWeight: '600' },
    stockDetail: { fontSize: 13, color: c.slateMid },

    emptyCard:  { backgroundColor: c.surface, borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    emptyText:  { fontSize: 15, color: c.slateMid, textAlign: 'center', lineHeight: 22 },

    actions:              { gap: 8, marginTop: 4 },
    actionBtn:            { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
    actionBtnSecondary:   { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: c.deepBlue },
    actionBtnText:        { color: c.primaryText, fontWeight: '700', fontSize: 15 },
    actionBtnTextSecondary: { color: c.deepBlue },
  });
}
