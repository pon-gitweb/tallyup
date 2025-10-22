// @ts-nocheck
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { buildVariance } from '../../services/reports/variance';
import VarianceExplainButton from './components/VarianceExplainButton';
import IdentityBadge from '../../components/IdentityBadge';

export default function DepartmentVarianceScreen() {
  const venueId = useVenueId();

  const [refreshing, setRefreshing] = React.useState(false);
  const [rows, setRows] = React.useState<any[]>([]);
  const [minor, setMinor] = React.useState<any[]>([]);
  const [showMinor, setShowMinor] = React.useState(false);
  const [summary, setSummary] = React.useState<any>(null);

  const [sortBy, setSortBy] = React.useState<'value' | 'qty' | 'name' | 'supplier'>('value');
  const [dir, setDir] = React.useState<'asc' | 'desc'>('desc');

  const load = React.useCallback(async () => {
    if (!venueId) {
      setRows([]);
      setMinor([]);
      setSummary(null);
      return;
    }
    setRefreshing(true);
    try {
      const res = await buildVariance(venueId, { sortBy, dir });
      setRows(res.rowsMaterial || []);
      setMinor(res.rowsMinor || []);
      setSummary(res.summary || null);
    } catch (e) {
      setRows([]);
      setMinor([]);
      setSummary({
        withinBand: true,
        bandPct: 1.5,
        message: 'Could not calculate variance right now.',
      });
    } finally {
      setRefreshing(false);
    }
  }, [venueId, sortBy, dir]);

  React.useEffect(() => {
    load();
  }, [load]);

  const onToggleMinor = React.useCallback(() => setShowMinor(v => !v), []);

  const onCycleSort = React.useCallback(() => {
    const order = ['value', 'qty', 'name', 'supplier'] as const;
    const nextIdx = (order.indexOf(sortBy) + 1) % order.length;
    if (nextIdx === 0) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    setSortBy(order[nextIdx]);
  }, [sortBy]);

  const header = (
    <View style={S.header}>
      <View style={{ flex: 1 }}>
        <Text style={S.title}>Department Variance</Text>
        {summary ? (
          <Text style={[S.rowSub, summary.withinBand ? S.subOk : S.subWarn]}>
            {summary.message}
          </Text>
        ) : (
          <Text style={S.rowSub}>Calculating latest variance…</Text>
        )}
      </View>
      <IdentityBadge />
    </View>
  );

  const tools = (
    <View style={S.tools}>
      <TouchableOpacity onPress={onCycleSort} style={S.toolChip}>
        <Text style={S.toolText}>
          Sort: {sortBy} · {dir}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onToggleMinor} style={S.toolChip}>
        <Text style={S.toolText}>
          {showMinor ? 'Hide minor' : 'Show minor'} (±{summary?.bandPct ?? 1.5}%)
        </Text>
      </TouchableOpacity>
    </View>
  );

  const data = React.useMemo(
    () => (showMinor ? [...rows, ...minor] : rows),
    [rows, minor, showMinor]
  );

  const renderRow = ({ item: r }: { item: any }) => (
    <View style={S.row}>
      <View style={{ flex: 1 }}>
        <Text style={S.rowTitle}>{r.name}</Text>
        <Text style={S.rowSub}>
          {r.supplierName ? `${r.supplierName} · ` : ''}
          {Number.isFinite(r.par) ? `PAR ${r.par} · ` : ''}
          {Number(r.varianceQty) > 0
            ? `Excess ${r.varianceQty}`
            : Number(r.varianceQty) < 0
            ? `Short ${Math.abs(r.varianceQty)}`
            : 'No variance'}
          {Number.isFinite(r.varianceValue) ? ` · $${Number(r.varianceValue).toFixed(2)}` : ''}
          {Number.isFinite(r.variancePct) ? ` · ${Number(r.variancePct).toFixed(1)}%` : ''}
          {!r.material ? ' · minor' : ''}
        </Text>
      </View>
      <VarianceExplainButton venueId={venueId} departmentId={null} row={r} />
    </View>
  );

  return (
    <View style={S.wrap}>
      {header}
      {tools}
      <FlatList
        data={data}
        keyExtractor={(r) => String(r.productId)}
        renderItem={renderRow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListEmptyComponent={
          !refreshing ? (
            <View style={S.empty}>
              <Text style={S.emptyTitle}>No material variances</Text>
              <Text style={S.emptyText}>
                Your latest stock take is within the accepted range. You can still view minor
                variances by tapping “Show minor”.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '800' },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  subOk: { color: '#065f46' },
  subWarn: { color: '#7f1d1d' },
  tools: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  toolChip: { backgroundColor: '#f3f4f6', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  toolText: { fontSize: 12, fontWeight: '700', color: '#111827' },
  empty: { paddingTop: 48, paddingHorizontal: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyText: { fontSize: 13, color: '#6b7280' },
});

