// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, getDocs, doc, getDoc, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { resetDepartment } from '../../services/reset';
import { withErrorBoundary } from '../../components/ErrorCatcher';

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

  const {
    departmentId, departmentName, cycleNumber,
    totalItems, stockValue, areaCount, durationMinutes, submittedAt,
  } = route.params as RouteParams;

  const [otherDepts, setOtherDepts] = useState<OtherDept[]>([]);
  const [resetting, setResetting] = useState(false);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

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
    Alert.alert(
      `Start next ${departmentName} stocktake?`,
      'This resets all areas in this department so you can begin a fresh count. Your completed data is saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset & start',
          onPress: async () => {
            setResetting(true);
            try {
              await resetDepartment(venueId, departmentId);
              nav.navigate('DepartmentSelection' as never);
            } catch (e: any) {
              Alert.alert('Reset failed', e?.message || 'Unknown error');
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
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
      style={{ flex: 1, backgroundColor: '#f5f3ee' }}
      contentContainerStyle={{ padding: 16, gap: 14 }}
    >
      {/* Hero */}
      <View style={{ backgroundColor: '#065f46', borderRadius: 16, padding: 24, gap: 6 }}>
        <Text style={{ fontSize: 40 }}>✓</Text>
        <Text style={{ fontSize: 22, fontWeight: '900', color: '#fff' }}>
          {departmentName} complete
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
          Cycle {cycleNumber} · {submittedDate}
        </Text>
      </View>

      {/* Stats */}
      <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e1d8' }}>
        {statsRows.map((row, i) => (
          <View key={i} style={{
            flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
            borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#f0ede8',
          }}>
            <Text style={{ color: '#374151', fontSize: 14 }}>{row.label}</Text>
            <Text style={{ color: '#065f46', fontSize: 14, fontWeight: '800' }}>{row.value}</Text>
          </View>
        ))}
      </View>

      {/* Snapshot intelligence card */}
      {snapshotLoading ? (
        <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e1d8', alignItems: 'center' }}>
          <ActivityIndicator size="small" color="#065f46" />
          <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 6 }}>Building cycle analysis…</Text>
        </View>
      ) : snapshot ? (
        <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e1d8', gap: 10 }}>
          <Text style={{ fontWeight: '800', color: '#374151', fontSize: 14 }}>Cycle {cycleNumber} Analysis</Text>

          {/* Data completeness tier */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ backgroundColor: '#ecfdf5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#065f46' }}>
                Tier {snapshot.dataCompleteness?.tier ?? 1} of 4
                {snapshot.dataCompleteness?.hasInvoices ? '  ✓ Invoices' : '  ✗ No invoices'}
              </Text>
            </View>
            {snapshot.summary?.itemsWithNoPrice > 0 && (
              <Text style={{ fontSize: 11, color: '#9ca3af' }}>
                {snapshot.summary.itemsWithNoPrice} unpriced
              </Text>
            )}
          </View>

          {/* Top losses */}
          {(() => {
            const losses = (snapshot.items || [])
              .filter((i: any) => i.totalVarianceQty < 0)
              .sort((a: any, b: any) => a.totalVarianceQty - b.totalVarianceQty)
              .slice(0, 3);
            if (!losses.length) return null;
            return (
              <View>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Losses</Text>
                {losses.map((item: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ fontSize: 13, color: '#374151', flex: 1 }}>{item.name}</Text>
                    <Text style={{ fontSize: 13, color: '#dc2626', fontWeight: '700' }}>
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
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Gains</Text>
                {gains.map((item: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ fontSize: 13, color: '#374151', flex: 1 }}>{item.name}</Text>
                    <Text style={{ fontSize: 13, color: '#059669', fontWeight: '700' }}>+{item.totalVarianceQty}</Text>
                  </View>
                ))}
              </View>
            );
          })()}

          {/* Below PAR */}
          {snapshot.summary?.itemsBelowPAR > 0 && (
            <View style={{ backgroundColor: '#fef3c7', borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13, color: '#92400e', fontWeight: '600' }}>
                {snapshot.summary.itemsBelowPAR} item{snapshot.summary.itemsBelowPAR !== 1 ? 's' : ''} below PAR — check suggested orders
              </Text>
            </View>
          )}

          {/* Missing invoice alert */}
          {snapshot.findings?.likelyMissingInvoices?.length > 0 && (
            <View style={{ backgroundColor: '#fff7ed', borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13, color: '#92400e', fontWeight: '700' }}>⚠ Possible missing invoices</Text>
              {snapshot.findings.likelyMissingInvoices.slice(0, 2).map((f: any, i: number) => (
                <Text key={i} style={{ fontSize: 12, color: '#78350f', marginTop: 2 }}>
                  {f.productName}: +{f.unexplainedGainQty} units with no delivery recorded
                </Text>
              ))}
            </View>
          )}

          {/* Top recommendation */}
          {snapshot.recommendations?.length > 0 && (
            <View style={{ backgroundColor: '#eff6ff', borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 12, color: '#1e40af', fontWeight: '700' }}>Recommended action</Text>
              <Text style={{ fontSize: 12, color: '#1e3a8a', marginTop: 2 }}>
                {snapshot.recommendations[0].message}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {/* CTAs */}
      <TouchableOpacity
        style={{ backgroundColor: '#1b4f72', borderRadius: 12, padding: 16, alignItems: 'center' }}
        onPress={() => nav.navigate('Reports' as never)}
      >
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>View department report →</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8', opacity: resetting ? 0.5 : 1 }}
        onPress={handleStartNext}
        disabled={resetting}
      >
        <Text style={{ color: '#374151', fontWeight: '700', fontSize: 15 }}>
          {resetting ? 'Resetting…' : `Start next ${departmentName} stocktake`}
        </Text>
      </TouchableOpacity>

      {/* Other departments status */}
      {otherDepts.length > 0 && (
        <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e1d8' }}>
          <Text style={{ fontWeight: '800', color: '#374151', marginBottom: 8 }}>Other departments</Text>
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
              dept.status === 'done' ? '#065f46' :
              dept.status === 'inprog' ? '#b45309' : '#6b7280';
            return (
              <View key={dept.id} style={{ paddingVertical: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#f0ede8' }}>
                <Text style={{ fontWeight: '700', color: '#0f172a' }}>{dept.name}</Text>
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
        <Text style={{ color: '#6B7280', fontSize: 13 }}>Back to departments</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(DepartmentSummaryScreen, 'DepartmentSummary');
