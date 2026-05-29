// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  collection, getDocs, doc, getDoc, onSnapshot, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { getSalesSummary } from '../../services/festival/salesData';

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItem = {
  productId: string;
  productName: string;
  supplierName: string;
  unitCost: number;
  remaining: number;
  remainingValue: number;
  sold: number;
  soldValue: number;
  soldSource: 'POS sales data' | 'Estimated from session counts';
};

type ReconciliationSummary = {
  totalReturnValue: number;
  totalSoldValue: number;
  lineItems: LineItem[];
  savedAt: any;
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalReconciliationScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const { isHistorical, eventId } = route.params ?? {};
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;

  const [event,           setEvent]           = useState<any>(null);
  const [role,            setRole]            = useState<string | null>(null);
  const [summary,         setSummary]         = useState<ReconciliationSummary | null>(null);
  const [saved,           setSaved]           = useState<ReconciliationSummary | null>(null);
  const [supplierConfigs, setSupplierConfigs] = useState<Record<string, any>>({});
  const [loading,         setLoading]         = useState(FESTIVAL_BETA);
  const [saving,          setSaving]          = useState(false);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>Coming soon — we'll let you know when it's live.</Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }

    // Role
    if (uid) {
      onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
        setRole(snap.exists() ? (snap.data() as any).role ?? null : null);
      });
    }

    if (isHistorical && eventId) {
      Promise.all([
        getDoc(doc(db, 'venues', venueId, 'eventHistory', eventId)),
        getDoc(doc(db, 'venues', venueId, 'eventHistory', eventId, 'reconciliation', 'summary')),
      ]).then(([evSnap, recSnap]) => {
        setEvent(evSnap.exists() ? evSnap.data() : null);
        if (recSnap.exists()) setSummary(recSnap.data() as ReconciliationSummary);
        setLoading(false);
      }).catch(() => setLoading(false));
      return;
    }

    // Load supplier configs for return allowance
    getDoc(doc(db, 'venues', venueId, 'event', 'details')).then(snap => {
      if (snap.exists()) {
        const cfgs = (snap.data() as any).supplierConfigs || {};
        // Build name→allowance map
        const nameMap: Record<string, any> = {};
        Object.values(cfgs).forEach((cfg: any) => {
          if (cfg.supplierName) nameMap[cfg.supplierName] = cfg;
        });
        setSupplierConfigs(nameMap);
      }
    }).catch(() => {});

    // Event details (current event)
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), async snap => {
      const ev = snap.exists() ? snap.data() : null;
      setEvent(ev);
      await buildSummary(ev);
      setLoading(false);
    }, () => setLoading(false));

    // Previously saved reconciliation
    onSnapshot(doc(db, 'venues', venueId, 'returns', 'eventReconciliation'), snap => {
      if (snap.exists()) setSaved(snap.data() as ReconciliationSummary);
    });

    return () => unsub();
  }, [venueId]);

  async function buildSummary(ev: any) {
    if (!venueId) return;
    try {
      // Bar counts → remaining per product
      const barCountsSnap = await getDocs(
        collection(db, 'venues', venueId, 'returns', 'eventClose', 'barCounts')
      );
      const remaining: Record<string, { name: string; count: number; unit: string }> = {};
      for (const bc of barCountsSnap.docs) {
        for (const c of ((bc.data() as any).counts || [])) {
          if (!remaining[c.productId]) {
            remaining[c.productId] = { name: c.productName, count: 0, unit: c.unit || 'units' };
          }
          remaining[c.productId].count += c.finalCount || 0;
        }
      }

      // Products for cost + supplier
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const productMap: Record<string, any> = {};
      productsSnap.docs.forEach(d => { productMap[d.id] = d.data(); });

      // Sessions → sold quantities (fallback when no sales data)
      const sessionsSnap = await getDocs(collection(db, 'venues', venueId, 'sessions'));
      const soldFromSessions: Record<string, number> = {};
      for (const s of sessionsSnap.docs) {
        const data = s.data() as any;
        for (const c of (data.counts || [])) {
          soldFromSessions[c.productId] = (soldFromSessions[c.productId] || 0) + (c.variance || 0);
        }
      }

      // Sales data (POS upload takes priority when available)
      let salesSummary: any = null;
      try {
        const evSnap2 = await getDoc(doc(db, 'venues', venueId, 'event', 'details'));
        const evData = evSnap2.exists() ? evSnap2.data() : null;
        if (evData?.startDate && evData?.endDate) {
          const parseDate = (s: string) => {
            const p = s.split('/');
            return p.length === 3 ? new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])) : new Date(s);
          };
          salesSummary = await getSalesSummary(
            venueId,
            parseDate(evData.startDate),
            parseDate(evData.endDate),
          );
        }
      } catch {}

      const lineItems: LineItem[] = [];
      let totalReturnValue = 0;
      let totalSoldValue = 0;

      for (const [productId, prod] of Object.entries(productMap)) {
        const rem = remaining[productId]?.count ?? 0;
        const salesQty = salesSummary?.hasActualSales ? (salesSummary.byProduct[productId] ?? null) : null;
        const soldQty = salesQty !== null ? salesQty : (soldFromSessions[productId] ?? 0);
        const soldSource: LineItem['soldSource'] = salesQty !== null
          ? 'POS sales data'
          : 'Estimated from session counts';
        const unitCost = prod.costPrice ?? 0;
        const supplierName = prod.supplierName || prod.primarySupplierName || 'Other / Unknown';

        if (rem <= 0 && soldQty <= 0) continue;

        const remVal  = rem * unitCost;
        const soldVal = soldQty * unitCost;
        totalReturnValue += remVal;
        totalSoldValue   += soldVal;

        lineItems.push({
          productId,
          productName: prod.name || prod.productName || productId,
          supplierName,
          unitCost,
          remaining: rem,
          remainingValue: remVal,
          sold: soldQty,
          soldValue: soldVal,
          soldSource,
        });
      }

      lineItems.sort((a, b) => b.remainingValue - a.remainingValue);
      setSummary({ totalReturnValue, totalSoldValue, lineItems, savedAt: null });
    } catch (e: any) {
      console.log('[Reconciliation] build error', e?.message);
    }
  }

  async function saveReconciliation() {
    if (!venueId || !summary || saving) return;
    setSaving(true);
    try {
      const data = {
        ...summary,
        savedAt:  serverTimestamp(),
        savedBy:  uid ?? 'unknown',
        eventName: event?.eventName || null,
      };
      await setDoc(doc(db, 'venues', venueId, 'returns', 'eventReconciliation'), data);
      Alert.alert('Saved', 'Reconciliation report saved.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save report.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={S.center}><ActivityIndicator color="#1b4f72" size="large" /></View>;

  if (role !== 'owner' && role !== 'manager') {
    return (
      <View style={S.center}>
        <Text style={S.csTitle}>Access restricted</Text>
        <Text style={S.csBody}>Reconciliation is only available to owners and managers.</Text>
      </View>
    );
  }

  const display = summary;

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.screenTitle}>Reconciliation</Text>
        {event?.eventName && <Text style={S.sub}>{event.eventName}</Text>}

        {saved?.savedAt && (
          <View style={S.savedBanner}>
            <Text style={S.savedBannerText}>✓ Last saved reconciliation on record</Text>
          </View>
        )}

        {isHistorical && (
          <View style={[S.savedBanner, { backgroundColor: '#f0f9ff' }]}>
            <Text style={[S.savedBannerText, { color: '#1b4f72' }]}>Historical record — read only</Text>
          </View>
        )}

        {!display ? (
          <View style={S.emptyCard}>
            <Text style={S.emptyText}>
              {isHistorical ? 'No reconciliation data found for this event.' : 'No count data found. Complete the end-of-event count first.'}
            </Text>
            {!isHistorical && (
              <TouchableOpacity style={S.secondaryBtn} onPress={() => nav.navigate('FestivalEndOfEventCount')}>
                <Text style={S.secondaryBtnText}>Go to end-of-event count</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {/* Summary totals */}
            <View style={S.totalsCard}>
              <View style={S.totalRow}>
                <Text style={S.totalLabel}>Total return value (cost)</Text>
                <Text style={S.totalValue}>${display.totalReturnValue.toFixed(2)}</Text>
              </View>
              <View style={[S.totalRow, { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 10 }]}>
                <Text style={S.totalLabel}>Total sold (cost)</Text>
                <Text style={S.totalValue}>${display.totalSoldValue.toFixed(2)}</Text>
              </View>
            </View>

            {/* Line items by supplier */}
            {(() => {
              const bySupplier: Record<string, LineItem[]> = {};
              for (const li of display.lineItems) {
                if (!bySupplier[li.supplierName]) bySupplier[li.supplierName] = [];
                bySupplier[li.supplierName].push(li);
              }
              return Object.entries(bySupplier).map(([supplier, items]) => {
                const cfg = supplierConfigs[supplier];
                const allowancePct = cfg?.returnAllowancePercent ?? 5;
                const totalReceived = items.reduce((s, li) => s + li.sold + li.remaining, 0);
                const totalRemaining = items.reduce((s, li) => s + li.remaining, 0);
                const maxReturnable = Math.floor(totalReceived * allowancePct / 100);
                const withinAllowance = totalRemaining <= maxReturnable;
                return (
                <View key={supplier} style={S.supplierCard}>
                  <Text style={S.supplierName}>{supplier}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
                    <AllowanceStat label={`Return allowance`} value={`${allowancePct}%`} />
                    <AllowanceStat label="Max returnable" value={`${maxReturnable} units`} />
                    <AllowanceStat label="Projected return" value={`${totalRemaining} units`} color={withinAllowance ? '#16a34a' : '#dc2626'} />
                    <AllowanceStat label="Status" value={withinAllowance ? '✓ Within' : '⚠ Exceeds'} color={withinAllowance ? '#16a34a' : '#dc2626'} />
                  </View>
                  {items.map(li => (
                    <View key={li.productId} style={S.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={S.lineName}>{li.productName}</Text>
                        <Text style={S.lineMeta}>
                          Sold: {li.sold} · Remaining: {li.remaining}
                        </Text>
                        <Text style={[S.lineMeta, { fontSize: 10, color: li.soldSource === 'POS sales data' ? '#16a34a' : '#9ca3af' }]}>
                          {li.soldSource}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {li.remainingValue > 0 && (
                          <Text style={S.lineReturn}>Return: ${li.remainingValue.toFixed(2)}</Text>
                        )}
                        {li.soldValue > 0 && (
                          <Text style={S.lineSold}>Sold: ${li.soldValue.toFixed(2)}</Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              );
              });
            })()}

            {!isHistorical && (
              <TouchableOpacity
                style={[S.primaryBtn, saving && S.btnDisabled]}
                disabled={saving}
                onPress={saveReconciliation}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={S.primaryBtnText}>Save reconciliation report</Text>}
              </TouchableOpacity>
            )}

            {!isHistorical && role === 'owner' && (
              <TouchableOpacity
                style={[S.primaryBtn, { marginTop: 10, backgroundColor: '#0B132B' }]}
                onPress={() => nav.navigate('FestivalEventClose')}
              >
                <Text style={S.primaryBtnText}>Proceed to close event →</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AllowanceStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View>
      <Text style={{ fontSize: 10, color: '#9ca3af', fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: color || '#0B132B' }}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  center:     { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 22, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 12 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  sub:         { fontSize: 14, color: '#6b7280', marginBottom: 16 },

  savedBanner:     { backgroundColor: '#dcfce7', borderRadius: 10, padding: 10, marginBottom: 12 },
  savedBannerText: { fontSize: 13, fontWeight: '700', color: '#16a34a', textAlign: 'center' },

  totalsCard:  { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e5e1d8' },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel:  { fontSize: 14, color: '#374151', fontWeight: '600' },
  totalValue:  { fontSize: 16, fontWeight: '800', color: '#0B132B' },

  supplierCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e5e1d8' },
  supplierName: { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 10 },

  lineRow:     { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  lineName:    { fontSize: 13, fontWeight: '600', color: '#0B132B', marginBottom: 2 },
  lineMeta:    { fontSize: 12, color: '#6b7280' },
  lineReturn:  { fontSize: 12, fontWeight: '700', color: '#1b4f72' },
  lineSold:    { fontSize: 12, color: '#6b7280' },

  emptyCard:   { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 12 },
  emptyText:   { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 12 },

  primaryBtn:     { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn:   { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  secondaryBtnText:{ color: '#1b4f72', fontWeight: '700', fontSize: 14 },
  btnDisabled:    { opacity: 0.5 },
});
