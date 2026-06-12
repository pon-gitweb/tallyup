// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, getDocs, doc, getDoc, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { resetDepartment } from '../../services/reset';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

type RouteParams = {
  departmentId: string;
  departmentName: string;
  cycleNumber: number;
  totalItems: number;
  stockValue: number;
  areaCount: number;
  durationMinutes: number;
  submittedAt: string;
};

type OtherDept = {
  id: string;
  name: string;
  lastCycleAt: any;
  status: 'idle' | 'inprog' | 'done';
  areasTotal: number;
  areasCompleted: number;
};

function fmtRelative(ms: number | null): string {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function DepartmentSummaryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();

  const {
    departmentId, departmentName, cycleNumber,
    totalItems, stockValue, areaCount, durationMinutes, submittedAt,
  } = route.params as RouteParams;

  const [otherDepts, setOtherDepts] = useState<OtherDept[]>([]);
  const [resetting, setResetting] = useState(false);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [noSupplierCount, setNoSupplierCount] = useState(0);
  const [supplierNudgeDismissed, setSupplierNudgeDismissed] = useState(false);

  // Load snapshot (written async after completion — retry a few times if not yet available)
  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    const snapshotId = `cycle-${cycleNumber}`;
    const tryLoad = async (attemptsLeft: number) => {
      try {
        const snapRef = doc(db, 'venues', venueId, 'departments', departmentId, 'snapshots', snapshotId);
        const snapDoc = await getDoc(snapRef);
        if (!cancelled) {
          if (snapDoc.exists()) {
            setSnapshot(snapDoc.data());
            setSnapshotLoading(false);
          } else if (attemptsLeft > 0) {
            setTimeout(() => tryLoad(attemptsLeft - 1), 2000);
          } else {
            setSnapshotLoading(false);
          }
        }
      } catch {
        if (!cancelled) setSnapshotLoading(false);
      }
    };
    tryLoad(4);
    return () => { cancelled = true; };
  }, [venueId, departmentId, cycleNumber]);

  useEffect(() => {
    if (!venueId || !departmentId) return;
    (async () => {
      try {
        const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'areas'));
        let noSupp = 0;
        for (const areaDoc of areasSnap.docs) {
          const itemsSnap = await getDocs(
            collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaDoc.id, 'items')
          );
          itemsSnap.forEach(d => {
            const item = d.data() as any;
            if (!item.supplierId && item.name) noSupp++;
          });
        }
        setNoSupplierCount(noSupp);
      } catch {}
    })();
  }, [venueId, departmentId]);

  useEffect(() => {
    if (!venueId) return;
    (async () => {
      try {
        const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        const others: OtherDept[] = [];
        for (const d of deptsSnap.docs) {
          if (d.id === departmentId) continue;
          const data = d.data() as any;
          const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
          let areasTotal = 0, areasCompleted = 0, anyStarted = false;
          areasSnap.forEach(a => {
            const ad = a.data() as any;
            areasTotal++;
            if (ad.completedAt) areasCompleted++;
            else if (ad.startedAt) anyStarted = true;
          });
          const status: 'idle' | 'inprog' | 'done' =
            areasTotal > 0 && areasCompleted === areasTotal ? 'done' :
            anyStarted || areasCompleted > 0 ? 'inprog' : 'idle';
          others.push({ id: d.id, name: data.name || d.id, lastCycleAt: data.lastCycleAt, status, areasTotal, areasCompleted });
        }
        setOtherDepts(others);
      } catch {}
    })();
  }, [venueId, departmentId]);

  const handleStartNext = async () => {
    if (!venueId || resetting) return;
    confirm({
      title: `Start next ${departmentName} stocktake?`,
      message: 'This resets all areas in this department so you can begin a fresh count. Your completed data is saved.',
      confirmLabel: 'Reset & start',
      onConfirm: async () => {
        setResetting(true);
        try {
          await resetDepartment(venueId, departmentId);
          nav.navigate('DepartmentSelection' as never);
        } catch (e: any) {
          showError(e?.message || 'Reset failed.');
        } finally {
          setResetting(false);
        }
      },
    });
  };

  const submittedDate = new Date(submittedAt).toLocaleString('en-NZ', {
    dateStyle: 'medium', timeStyle: 'short',
  });

  const statsRows = [
    { label: 'Products counted', value: String(totalItems) },
    { label: `Area${areaCount !== 1 ? 's' : ''} completed`, value: String(areaCount) },
    { label: 'Duration', value: fmtDuration(durationMinutes) },
    ...(stockValue > 0 ? [{ label: 'Stock value', value: `$${stockValue.toFixed(2)}` }] : []),
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.oat }}
      contentContainerStyle={{ padding: 16, gap: 14 }}
    >
      {modal}
      {/* Hero */}
      <View style={{ backgroundColor: c.success, borderRadius: 16, padding: 24, gap: 6 }}>
        <Text style={{ fontSize: 40 }}>✓</Text>
        <Text style={{ fontSize: 22, fontWeight: '900', color: c.surface }}>
          {departmentName} complete
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
          Cycle {cycleNumber} · {submittedDate}
        </Text>
      </View>

      {/* Stats */}
      <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border }}>
        {statsRows.map((row, i) => (
          <View key={i} style={{
            flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
            borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border,
          }}>
            <Text style={{ color: c.text, fontSize: 14 }}>{row.label}</Text>
            <Text style={{ color: c.success, fontSize: 14, fontWeight: '800' }}>{row.value}</Text>
          </View>
        ))}
      </View>

      {/* Snapshot intelligence card */}
      {snapshotLoading ? (
        <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={c.success} />
          <Text style={{ color: c.slateMid, fontSize: 12, marginTop: 6 }}>Building cycle analysis…</Text>
        </View>
      ) : snapshot ? (
        <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border, gap: 10 }}>
          <Text style={{ fontWeight: '800', color: c.text, fontSize: 14 }}>Cycle {cycleNumber} Analysis</Text>

          {/* Data completeness tier */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ backgroundColor: c.success + '18', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: c.success }}>
                Tier {snapshot.dataCompleteness?.tier ?? 1} of 4
                {snapshot.dataCompleteness?.hasInvoices ? '  ✓ Invoices' : '  ✗ No invoices'}
              </Text>
            </View>
            {snapshot.summary?.itemsWithNoPrice > 0 && (
              <Text style={{ fontSize: 11, color: c.slateMid }}>
                {snapshot.summary.itemsWithNoPrice} unpriced
              </Text>
            )}
          </View>

          {/* Top losses / below-PAR items (label differs by cycle) */}
          {(() => {
            const losses = (snapshot.items || [])
              .filter((i: any) => i.totalVarianceQty < 0)
              .sort((a: any, b: any) => a.totalVarianceQty - b.totalVarianceQty)
              .slice(0, 3);
            if (!losses.length) return null;
            const isFirstCycle = !snapshot.cycleNumber || snapshot.cycleNumber === 1;
            const lossLabel = isFirstCycle ? 'Items below PAR' : 'Top losses';
            const lossSubtitle = isFirstCycle ? 'Stock below minimum levels' : 'Largest drops since last stocktake';
            return (
              <View>
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.slateMid, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lossLabel}</Text>
                <Text style={{ fontSize: 11, color: c.slateMid, marginBottom: 4 }}>{lossSubtitle}</Text>
                {losses.map((item: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ fontSize: 13, color: c.text, flex: 1 }}>{item.name}</Text>
                    <Text style={{ fontSize: 13, color: c.error, fontWeight: '700' }}>
                      {item.totalVarianceQty}
                      {item.totalVarianceDollars != null ? `  –$${Math.abs(item.totalVarianceDollars).toFixed(0)}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })()}

          {/* Top gains */}
          {(() => {
            const gains = (snapshot.items || [])
              .filter((i: any) => i.totalVarianceQty > 0)
              .sort((a: any, b: any) => b.totalVarianceQty - a.totalVarianceQty)
              .slice(0, 3);
            if (!gains.length) return null;
            return (
              <View>
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.slateMid, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Gains</Text>
                {gains.map((item: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ fontSize: 13, color: c.text, flex: 1 }}>{item.name}</Text>
                    <Text style={{ fontSize: 13, color: c.success, fontWeight: '700' }}>+{item.totalVarianceQty}</Text>
                  </View>
                ))}
              </View>
            );
          })()}

          {/* Below PAR */}
          {snapshot.summary?.itemsBelowPAR > 0 && (
            <View style={{ backgroundColor: c.stellarAmber + '18', borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13, color: c.stellarAmber, fontWeight: '600' }}>
                {snapshot.summary.itemsBelowPAR} item{snapshot.summary.itemsBelowPAR !== 1 ? 's' : ''} below PAR — check suggested orders
              </Text>
            </View>
          )}

          {/* Missing invoice alert */}
          {snapshot.findings?.likelyMissingInvoices?.length > 0 && (
            <View style={{ backgroundColor: c.stellarAmber + '18', borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13, color: c.stellarAmber, fontWeight: '700' }}>⚠ Possible missing invoices</Text>
              {snapshot.findings.likelyMissingInvoices.slice(0, 2).map((f: any, i: number) => (
                <Text key={i} style={{ fontSize: 12, color: c.stellarAmber, marginTop: 2 }}>
                  {f.productName}: +{f.unexplainedGainQty} units with no delivery recorded
                </Text>
              ))}
            </View>
          )}

          {/* Top recommendation */}
          {snapshot.recommendations?.length > 0 && (
            <View style={{ backgroundColor: c.primaryLight, borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 12, color: c.deepBlue, fontWeight: '700' }}>Recommended action</Text>
              <Text style={{ fontSize: 12, color: c.deepBlue, marginTop: 2 }}>
                {snapshot.recommendations[0].message}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Supplier nudge */}
      {noSupplierCount > 0 && !supplierNudgeDismissed && (
        <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: c.deepBlue }}>
          <Text style={{ fontWeight: '800', color: c.text, fontSize: 14, marginBottom: 4 }}>
            🚚 {noSupplierCount} product{noSupplierCount !== 1 ? 's' : ''} {noSupplierCount !== 1 ? 'have' : 'has'} no supplier
          </Text>
          <Text style={{ color: c.slateMid, fontSize: 13, lineHeight: 18, marginBottom: 12 }}>
            Scan an invoice and we'll automatically link products to their supplier. Or assign suppliers manually in Products.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity
              onPress={() => nav.navigate('Orders' as never)}
              style={{ backgroundColor: c.success, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}
            >
              <Text style={{ color: c.surface, fontWeight: '700', fontSize: 13 }}>Scan invoice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => nav.navigate('Products', { filterNoSupplier: true } as never)}
              style={{ backgroundColor: c.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: c.border }}
            >
              <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>Assign manually</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSupplierNudgeDismissed(true)}
              style={{ paddingVertical: 7, paddingHorizontal: 4 }}
            >
              <Text style={{ color: c.slateMid, fontSize: 13 }}>Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* CTAs */}
      <TouchableOpacity
        style={{ backgroundColor: c.deepBlue, borderRadius: 12, padding: 16, alignItems: 'center' }}
        onPress={() => nav.navigate('Reports' as never)}
      >
        <Text style={{ color: c.surface, fontWeight: '800', fontSize: 15 }}>View department report →</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{ backgroundColor: c.surface, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: c.border, opacity: resetting ? 0.5 : 1 }}
        onPress={handleStartNext}
        disabled={resetting}
      >
        <Text style={{ color: c.text, fontWeight: '700', fontSize: 15 }}>
          {resetting ? 'Resetting…' : `Start next ${departmentName} stocktake`}
        </Text>
      </TouchableOpacity>

      {/* Other departments status */}
      {otherDepts.length > 0 && (
        <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontWeight: '800', color: c.text, marginBottom: 8 }}>Other departments</Text>
          {otherDepts.map((dept, i) => {
            const lastMs = dept.lastCycleAt?.toMillis?.() ?? dept.lastCycleAt?.toDate?.()?.getTime?.() ?? null;
            const statusText =
              dept.status === 'inprog'
                ? `In progress · ${dept.areasCompleted}/${dept.areasTotal} areas`
                : dept.status === 'done'
                ? `✓ Complete · ${fmtRelative(lastMs)}`
                : lastMs
                ? `Last counted ${fmtRelative(lastMs)}`
                : 'Not started';
            const statusColor =
              dept.status === 'done' ? c.success :
              dept.status === 'inprog' ? c.stellarAmber : c.slateMid;
            return (
              <View key={dept.id} style={{ paddingVertical: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border }}>
                <Text style={{ fontWeight: '700', color: c.navy }}>{dept.name}</Text>
                <Text style={{ color: statusColor, fontSize: 12, marginTop: 2 }}>{statusText}</Text>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={{ paddingVertical: 10, alignItems: 'center' }}
        onPress={() => nav.navigate('DepartmentSelection' as never)}
      >
        <Text style={{ color: c.slateMid, fontSize: 13 }}>Back to departments</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(DepartmentSummaryScreen, 'DepartmentSummary');
