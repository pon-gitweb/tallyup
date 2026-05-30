// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

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

function stockColor(hrs: number | null): string {
  if (hrs === null) return '#16a34a';
  if (hrs < 2)  return '#dc2626';
  if (hrs < 4)  return '#d97706';
  return '#16a34a';
}

function stockBg(hrs: number | null): string {
  if (hrs === null) return '#f0fdf4';
  if (hrs < 2)  return '#fef2f2';
  if (hrs < 4)  return '#fef3c7';
  return '#f0fdf4';
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

  const [stock,   setStock]   = useState<StockItem[]>([]);
  const [bar,     setBar]     = useState<any>(null);
  const [loading, setLoading] = useState(FESTIVAL_BETA);
  const [role,    setRole]    = useState<string>('staff');

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
        <ActivityIndicator color="#1b4f72" size="large" />
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
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
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
            const col  = stockColor(hrs);
            const bg   = stockBg(hrs);

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
                  <Text style={S.stockQty}>Stock: {item.currentStock} units</Text>
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
              </View>
            );
          })
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
            </>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll: { padding: 16, paddingBottom: 40 },

  header:      { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20, gap: 12 },
  barName:     { fontSize: 22, fontWeight: '800', color: '#0B132B' },
  barLocation: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  lastCount:   { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  countBtn:    { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, marginTop: 4 },
  countBtnText:{ color: '#fff', fontWeight: '700', fontSize: 13 },

  stockCard:    { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  stockCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  productName:  { flex: 1, fontSize: 15, fontWeight: '700', color: '#0B132B' },
  alertPill:    { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  alertPillText:{ fontSize: 11, fontWeight: '700' },

  fillTrack: { height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, marginBottom: 8, overflow: 'hidden' },
  fillBar:   { height: 8, borderRadius: 4 },

  stockMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stockQty:    { fontSize: 13, color: '#374151', fontWeight: '600' },
  stockDetail: { fontSize: 13, color: '#6b7280' },

  emptyCard:  { backgroundColor: '#fff', borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 12 },
  emptyText:  { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22 },

  actions:              { gap: 8, marginTop: 4 },
  actionBtn:            { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  actionBtnSecondary:   { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#1b4f72' },
  actionBtnText:        { color: '#fff', fontWeight: '700', fontSize: 15 },
  actionBtnTextSecondary: { color: '#1b4f72' },
});
