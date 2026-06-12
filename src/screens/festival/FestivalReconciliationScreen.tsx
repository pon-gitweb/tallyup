// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  collection, getDocs, doc, getDoc, onSnapshot, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { getSalesSummary } from '../../services/festival/salesData';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

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
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);

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

  async function doSaveReconciliation() {
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
      showSuccess('✓ Reconciliation report saved');
    } catch (e: any) {
      showError(e?.message || 'Could not save report.');
    } finally {
      setSaving(false);
    }
  }

  function saveReconciliation() {
    if (!venueId || !summary || saving) return;
    confirm({
      title: 'Save reconciliation report?',
      message: 'This will lock the event and cannot be undone.',
      confirmLabel: 'Finalise event',
      destructive: true,
      onConfirm: doSaveReconciliation,
    });
  }

  if (loading) return <View style={S.center}><ActivityIndicator color={c.deepBlue} size="large" /></View>;

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
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.screenTitle}>Reconciliation</Text>
        {event?.eventName && <Text style={S.sub}>{event.eventName}</Text>}

        {saved?.savedAt && (
          <View style={S.savedBanner}>
            <Text style={S.savedBannerText}>✓ Last saved reconciliation on record</Text>
          </View>
        )}

        {isHistorical && (
          <View style={[S.savedBanner, { backgroundColor: c.primaryLight }]}>
            <Text style={[S.savedBannerText, { color: c.deepBlue }]}>Historical record — read only</Text>
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
              <View style={[S.totalRow, { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }]}>
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
                    <AllowanceStat label={`Return allowance`} value={`${allowancePct}%`} c={c} />
                    <AllowanceStat label="Max returnable" value={`${maxReturnable} units`} c={c} />
                    <AllowanceStat label="Projected return" value={`${totalRemaining} units`} color={withinAllowance ? c.success : c.error} c={c} />
                    <AllowanceStat label="Status" value={withinAllowance ? '✓ Within' : '⚠ Exceeds'} color={withinAllowance ? c.success : c.error} c={c} />
                  </View>
                  {items.map(li => (
                    <View key={li.productId} style={S.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={S.lineName}>{li.productName}</Text>
                        <Text style={S.lineMeta}>
                          Sold: {li.sold} · Remaining: {li.remaining}
                        </Text>
                        <Text style={[S.lineMeta, { fontSize: 10, color: li.soldSource === 'POS sales data' ? c.success : c.slateMid }]}>
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
                  ? <ActivityIndicator color={c.surface} size="small" />
                  : <Text style={S.primaryBtnText}>Save reconciliation report</Text>}
              </TouchableOpacity>
            )}

            {!isHistorical && role === 'owner' && (
              <TouchableOpacity
                style={[S.primaryBtn, { marginTop: 10, backgroundColor: c.navy }]}
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

function AllowanceStat({ label, value, color, c }: { label: string; value: string; color?: string; c: any }) {
  return (
    <View>
      <Text style={{ fontSize: 10, color: c.slateMid, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: color || c.navy }}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: any) {
  return StyleSheet.create({
    center:     { flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 36 },
    csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    csTitle:    { fontSize: 22, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 12 },
    csBody:     { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24 },
    csContact:  { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center' },

    scroll:      { padding: 16, paddingBottom: 40 },
    screenTitle: { fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 4 },
    sub:         { fontSize: 14, color: c.slateMid, marginBottom: 16 },

    savedBanner:     { backgroundColor: c.positiveSoft, borderRadius: 10, padding: 10, marginBottom: 12 },
    savedBannerText: { fontSize: 13, fontWeight: '700', color: c.success, textAlign: 'center' },

    totalsCard:  { backgroundColor: c.surface, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    totalRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    totalLabel:  { fontSize: 14, color: c.text, fontWeight: '600' },
    totalValue:  { fontSize: 16, fontWeight: '800', color: c.navy },

    supplierCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: c.border },
    supplierName: { fontSize: 15, fontWeight: '800', color: c.navy, marginBottom: 10 },

    lineRow:     { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.border },
    lineName:    { fontSize: 13, fontWeight: '600', color: c.navy, marginBottom: 2 },
    lineMeta:    { fontSize: 12, color: c.slateMid },
    lineReturn:  { fontSize: 12, fontWeight: '700', color: c.deepBlue },
    lineSold:    { fontSize: 12, color: c.slateMid },

    emptyCard:   { backgroundColor: c.surface, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    emptyText:   { fontSize: 14, color: c.slateMid, textAlign: 'center', marginBottom: 12 },

    primaryBtn:     { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
    primaryBtnText: { color: c.surface, fontWeight: '700', fontSize: 15 },
    secondaryBtn:   { borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
    secondaryBtnText:{ color: c.deepBlue, fontWeight: '700', fontSize: 14 },
    btnDisabled:    { opacity: 0.5 },
  });
}
