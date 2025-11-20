// @ts-nocheck
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { buildVariance } from '../../services/reports/variance';
import VarianceExplainButton from './components/VarianceExplainButton';
import IdentityBadge from '../../components/IdentityBadge';
import { exportPdf } from '../../utils/exporters';
import { db } from '../../services/firebase';
import { doc, getDoc } from 'firebase/firestore';

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

  const onToggleMinor = React.useCallback(() => setShowMinor((v) => !v), []);

  const onCycleSort = React.useCallback(() => {
    const order = ['value', 'qty', 'name', 'supplier'] as const;
    const nextIdx = (order.indexOf(sortBy) + 1) % order.length;
    if (nextIdx === 0) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    setSortBy(order[nextIdx]);
  }, [sortBy]);

  const onExportPdf = React.useCallback(async () => {
    if (!venueId) {
      Alert.alert('Not ready', 'Select a venue first.');
      return;
    }
    const hasRows = (rows && rows.length) || (minor && minor.length);
    if (!hasRows) {
      Alert.alert(
        'Nothing to export',
        'There are no material variances to export yet. Run a stock take first.',
      );
      return;
    }
    try {
      const venueName = await fetchVenueName(venueId);
      const html = buildDepartmentVarianceHtml(
        venueName,
        rows,
        minor,
        summary,
        showMinor,
      );
      const out = await exportPdf('Department Variance', html);
      if (!out.ok) {
        Alert.alert(
          'PDF generated',
          'Sharing may be unavailable on this device, but the PDF was written to storage if supported.',
        );
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not export department variance.');
    }
  }, [venueId, rows, minor, summary, showMinor]);

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
    [rows, minor, showMinor],
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
          {Number.isFinite(r.varianceValue)
            ? ` · $${Number(r.varianceValue).toFixed(2)}`
            : ''}
          {Number.isFinite(r.variancePct)
            ? ` · ${Number(r.variancePct).toFixed(1)}%`
            : ''}
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

      <TouchableOpacity onPress={onExportPdf} style={S.exportBtn}>
        <Text style={S.exportText}>Export Department Variance (PDF)</Text>
      </TouchableOpacity>

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
  toolChip: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  toolText: { fontSize: 12, fontWeight: '700', color: '#111827' },
  exportBtn: {
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#1D4ED8',
    alignItems: 'center',
  },
  exportText: { color: 'white', fontWeight: '800', fontSize: 13 },
  empty: { paddingTop: 48, paddingHorizontal: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyText: { fontSize: 13, color: '#6b7280' },
});

async function fetchVenueName(venueId: string | null | undefined) {
  if (!venueId) return 'Venue';
  try {
    const snap = await getDoc(doc(db, 'venues', venueId));
    if (snap.exists()) {
      const d: any = snap.data() || {};
      return d.name || d.venueName || 'Venue';
    }
  } catch (e) {
    // best-effort only
  }
  return 'Venue';
}

function buildDepartmentVarianceHtml(
  venueName: string,
  materialRows: any[],
  minorRows: any[],
  summary: any,
  includeMinor: boolean,
) {
  const allRows = includeMinor ? [...(materialRows || []), ...(minorRows || [])] : (materialRows || []);

  const message = summary?.message || 'Latest variance summary is not available yet.';
  const bandPct =
    typeof summary?.bandPct === 'number' ? `${summary.bandPct.toFixed(1)}%` : '—';
  const withinBand = summary?.withinBand === true;

  const rowsHtml =
    allRows.length > 0
      ? allRows
          .map((r: any) => {
            const name = r.name || '—';
            const sup = r.supplierName || '';
            const qty = Number.isFinite(r.varianceQty) ? r.varianceQty : null;
            const pct = Number.isFinite(r.variancePct) ? r.variancePct : null;
            const val = Number.isFinite(r.varianceValue) ? r.varianceValue : null;
            let status =
              qty != null && qty > 0
                ? 'Excess'
                : qty != null && qty < 0
                ? 'Short'
                : 'No variance';
            if (!r.material) status += ' (minor)';

            return `
        <tr>
          <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(
            name,
          )}</td>
          <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(
            sup,
          )}</td>
          <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(
            status,
          )}</td>
          <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${
            qty != null ? escapeHtml(qty) : '—'
          }</td>
          <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${
            pct != null ? escapeHtml(pct.toFixed(1) + '%') : '—'
          }</td>
          <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${
            val != null ? '$' + Number(val).toFixed(2) : '—'
          }</td>
        </tr>
      `;
          })
          .join('')
      : `
      <tr>
        <td colspan="6" style="padding:8px;text-align:center;color:#6B7280;">
          No material variances recorded in this snapshot.
        </td>
      </tr>
    `;

  return `
    <html>
      <body style="font-family:-apple-system,Roboto,sans-serif;padding:16px;">
        <h2>${escapeHtml(venueName)} — Department Variance</h2>
        <p style="color:#4B5563;margin:0 0 12px 0;">
          Variance by product across departments, based on your latest stock take.
        </p>

        <h3>Summary</h3>
        <p style="margin:0 0 8px 0;">${escapeHtml(message)}</p>
        <p style="margin:0 0 12px 0;">
          Band: ${escapeHtml(bandPct)} · Status:
          <strong> ${withinBand ? 'Within band' : 'Outside band'} </strong>
        </p>

        <h3>Lines${includeMinor ? ' (including minor variances)' : ''}</h3>
        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:13px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Product</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Supplier</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Status</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Variance (qty)</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Variance %</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Variance value</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function escapeHtml(str: any) {
  const s = String(str ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
