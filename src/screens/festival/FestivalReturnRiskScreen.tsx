// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

type SupplierRisk = {
  supplierId: string;
  supplierName: string;
  returnAllowancePercent: number;
  totalReceived: number;
  remaining: number;
  maxReturnable: number;
  projectedSurplus: number;
  withinAllowance: boolean;
  products: { name: string; remaining: number; totalReceived: number }[];
};

export default function FestivalReturnRiskScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [risks, setRisks] = useState<SupplierRisk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    loadRisks();
  }, [venueId]);

  async function loadRisks() {
    if (!venueId) return;
    try {
      // Load event details for supplierConfigs
      const eventSnap = await getDoc(doc(db, 'venues', venueId, 'event', 'details'));
      const supplierConfigs: Record<string, any> = eventSnap.exists() ? (eventSnap.data() as any).supplierConfigs || {} : {};

      // Build name→config map
      const nameToConfig: Record<string, { supplierId: string; returnAllowancePercent: number }> = {};
      Object.entries(supplierConfigs).forEach(([suppId, cfg]: [string, any]) => {
        if (cfg.supplierName) {
          nameToConfig[cfg.supplierName] = { supplierId: suppId, returnAllowancePercent: cfg.returnAllowancePercent ?? 5 };
        }
      });

      // Load products
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const productMap: Record<string, any> = {};
      productsSnap.docs.forEach(d => { productMap[d.id] = d.data(); });

      // Load bar stock totals (remaining)
      const barStockRemaining: Record<string, number> = {};
      const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      for (const deptDoc of deptsSnap.docs.filter(d => (d.data() as any).isFestivalBar === true)) {
        const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas', 'back-of-house', 'items'));
        itemsSnap.docs.forEach(d => {
          const data = d.data() as any;
          const pid = d.id;
          barStockRemaining[pid] = (barStockRemaining[pid] || 0) + (data.lastCount ?? 0);
        });
      }

      // Load HQ storage stock
      const hqAreasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', 'hq', 'areas'));
      for (const areaDoc of hqAreasSnap.docs) {
        const itemsSnap = await getDocs(collection(db, 'venues', venueId, 'departments', 'hq', 'areas', areaDoc.id, 'items'));
        itemsSnap.docs.forEach(d => {
          const data = d.data() as any;
          const pid = d.id;
          barStockRemaining[pid] = (barStockRemaining[pid] || 0) + (data.lastCount ?? 0);
        });
      }

      // Load sold quantities from sessions
      const sold: Record<string, number> = {};
      const sessionsSnap = await getDocs(collection(db, 'venues', venueId, 'sessions'));
      sessionsSnap.docs.forEach(s => {
        const data = s.data() as any;
        (data.counts || []).forEach((c: any) => {
          sold[c.productId] = (sold[c.productId] || 0) + Math.abs(c.variance || 0);
        });
      });

      // Group by supplier
      const bySupplier: Record<string, SupplierRisk> = {};

      Object.entries(productMap).forEach(([productId, prod]: [string, any]) => {
        const remaining = barStockRemaining[productId] ?? 0;
        const soldQty = sold[productId] ?? 0;
        if (remaining <= 0 && soldQty <= 0) return;

        const supplierName = prod.supplierName || prod.primarySupplierName || 'Other / Unknown';
        const cfgEntry = nameToConfig[supplierName];
        const allowance = cfgEntry?.returnAllowancePercent ?? 5;

        if (!bySupplier[supplierName]) {
          bySupplier[supplierName] = {
            supplierId: cfgEntry?.supplierId || supplierName,
            supplierName,
            returnAllowancePercent: allowance,
            totalReceived: 0,
            remaining: 0,
            maxReturnable: 0,
            projectedSurplus: 0,
            withinAllowance: true,
            products: [],
          };
        }

        const totalReceived = soldQty + remaining;
        bySupplier[supplierName].totalReceived += totalReceived;
        bySupplier[supplierName].remaining += remaining;
        bySupplier[supplierName].products.push({
          name: prod.name || prod.productName || productId,
          remaining,
          totalReceived,
        });
      });

      // Calculate risk per supplier
      const result = Object.values(bySupplier).map(s => {
        const maxReturnable = Math.floor(s.totalReceived * s.returnAllowancePercent / 100);
        const projectedSurplus = Math.max(0, s.remaining - maxReturnable);
        return {
          ...s,
          maxReturnable,
          projectedSurplus,
          withinAllowance: s.remaining <= maxReturnable,
        };
      });

      result.sort((a, b) => b.projectedSurplus - a.projectedSurplus);
      setRisks(result);
    } catch (e: any) {
      console.log('[ReturnRisk] load error', e?.message);
    } finally {
      setLoading(false);
    }
  }

  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.empty}>Festival mode is not enabled.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  const riskCount = risks.filter(r => !r.withinAllowance).length;

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={S.heading}>Return Risk</Text>
        <Text style={S.sub}>Per-supplier return allowance and projected surplus</Text>

        {riskCount > 0 && (
          <View style={S.alertBanner}>
            <Text style={S.alertTitle}>⚠ {riskCount} supplier{riskCount !== 1 ? 's' : ''} exceeding return allowance</Text>
            <Text style={S.alertBody}>Review the suppliers below and consider redistributing or accelerating sales.</Text>
          </View>
        )}

        {risks.length === 0 && (
          <View style={S.card}>
            <Text style={S.empty}>No stock data yet.</Text>
          </View>
        )}

        {risks.map(s => (
          <View key={s.supplierName} style={[S.card, !s.withinAllowance && S.cardRisk]}>
            <View style={S.cardHeader}>
              <Text style={S.supplierName}>{s.supplierName}</Text>
              <View style={[S.badge, s.withinAllowance ? S.badgeOk : S.badgeRisk]}>
                <Text style={[S.badgeText, s.withinAllowance ? S.badgeTextOk : S.badgeTextRisk]}>
                  {s.withinAllowance ? '✓ Within allowance' : '⚠ Exceeds allowance'}
                </Text>
              </View>
            </View>

            <View style={S.statGrid}>
              <StatCell label="Allowance" value={`${s.returnAllowancePercent}%`} />
              <StatCell label="Max returnable" value={`${s.maxReturnable} units`} />
              <StatCell label="Projected return" value={`${s.remaining} units`} color={s.withinAllowance ? '#0B132B' : '#dc2626'} />
              {!s.withinAllowance && (
                <StatCell label="Surplus" value={`+${s.projectedSurplus} units`} color="#dc2626" />
              )}
            </View>

            {!s.withinAllowance && (
              <View style={S.actionBox}>
                <Text style={S.actionTitle}>Suggested actions</Text>
                <Text style={S.actionItem}>• Transfer surplus from slow bars to busier bars</Text>
                <Text style={S.actionItem}>• Prioritise this supplier's products in upcoming sessions</Text>
                <Text style={S.actionItem}>• Contact supplier to negotiate an increased allowance</Text>
                <Text style={S.actionItem}>• Identify if any units are damaged and eligible for write-off</Text>
              </View>
            )}

            {s.products.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={S.productHeading}>PRODUCTS</Text>
                {s.products
                  .sort((a, b) => b.remaining - a.remaining)
                  .map(p => (
                    <View key={p.name} style={S.productRow}>
                      <Text style={S.productName}>{p.name}</Text>
                      <Text style={S.productStats}>
                        {p.remaining} rem / {p.totalReceived} recv
                      </Text>
                    </View>
                  ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, minWidth: '45%', marginBottom: 8 }}>
      <Text style={{ fontSize: 11, color: '#9ca3af', fontWeight: '600', marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: '800', color: color || '#0B132B' }}>{value}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },

  alertBanner: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fca5a5' },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#dc2626', marginBottom: 4 },
  alertBody: { fontSize: 13, color: '#dc2626' },

  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e1d8', padding: 14, marginBottom: 12 },
  cardRisk: { borderColor: '#fca5a5', backgroundColor: '#fffbfb' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  supplierName: { fontSize: 16, fontWeight: '800', color: '#0B132B', flex: 1 },

  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOk: { backgroundColor: '#dcfce7' },
  badgeRisk: { backgroundColor: '#fef2f2' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextOk: { color: '#16a34a' },
  badgeTextRisk: { color: '#dc2626' },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },

  actionBox: { backgroundColor: '#fffbeb', borderRadius: 8, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#fde68a' },
  actionTitle: { fontSize: 12, fontWeight: '700', color: '#92400e', marginBottom: 6 },
  actionItem: { fontSize: 12, color: '#78350f', lineHeight: 20 },

  productHeading: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 0.8, marginBottom: 6 },
  productRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#f0ede8' },
  productName: { fontSize: 13, color: '#374151', flex: 1 },
  productStats: { fontSize: 12, color: '#6b7280' },
});
