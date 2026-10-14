import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { loadSupplierSpendRows, SupplierSpendRow } from '../../services/reports/supplierSpendService';
import { listBudgets } from '../../services/budgets';

function fmtDollars(n: number) { return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`; }
function fmtPct(n: number) { return (n >= 0 ? '+' : '') + n + '%'; }

const PERIOD_OPTIONS = [
  { id: 'cycle', label: 'This cycle' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 3 months' },
  { id: '180', label: 'Last 6 months' },
];

function getPeriodDates(id: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  const days = id === 'cycle' ? 30 : parseInt(id, 10) || 30;
  start.setDate(start.getDate() - days);
  return { start, end };
}

export default function SupplierSpendScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = useVenueId();
  const focusedSupplierId: string | null = route.params?.supplierId ?? null;

  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30');
  const [supplierData, setSupplierData] = useState<SupplierSpendRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(focusedSupplierId);
  const [exporting, setExporting] = useState(false);

  const { start, end } = useMemo(() => getPeriodDates(period), [period]);

  const load = useCallback(async () => {
    if (!venueId) { setLoading(false); return; }
    setLoading(true);
    try {
      let budgets: any[] = [];
      try { budgets = await listBudgets(venueId); } catch {}

      let rows = await loadSupplierSpendRows(venueId, start, end, budgets);

      // If focused on a specific supplier, filter to that one
      if (focusedSupplierId) {
        rows = rows.filter(r => r.supplierId === focusedSupplierId);
      }

      setSupplierData(rows);
    } catch {}
    finally { setLoading(false); }
  }, [venueId, start, end, focusedSupplierId]);

  useEffect(() => { load(); }, [load]);

  const totalSpend = useMemo(
    () => supplierData.reduce((s, d) => s + d.totalSpend, 0),
    [supplierData],
  );

  async function handleExportCSV(data: SupplierSpendRow) {
    try {
      setExporting(true);
      const csv = `Supplier,Total Spend,Invoices,GST\n"${data.supplierName}",${data.totalSpend.toFixed(2)},${data.invoiceCount},"${data.gstNote}"\n`;
      const safeName = data.supplierName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
      const path = FileSystem.documentDirectory + `${safeName}-spend-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch {}
    finally { setExporting(false); }
  }

  if (loading) {
    return (
      <View style={S.centred}>
        <ActivityIndicator color="#1b4f72" size="large" />
        <Text style={{ marginTop: 12, color: '#6B7280' }}>Loading supplier data…</Text>
      </View>
    );
  }

  return (
    <View style={S.root}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Header / period */}
        <View style={{ marginBottom: 12 }}>
          <Text style={S.pageTitle}>Supplier Spend</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 8, flexDirection: 'row' }}>
            {PERIOD_OPTIONS.map(o => (
              <TouchableOpacity
                key={o.id}
                onPress={() => setPeriod(o.id)}
                style={[S.pill, period === o.id && S.pillActive]}
              >
                <Text style={[S.pillText, period === o.id && S.pillTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Total summary */}
        {supplierData.length > 0 && (
          <View style={S.summaryCard}>
            <Text style={S.summaryVal}>{fmtDollars(totalSpend)}</Text>
            <Text style={S.summaryLabel}>Total spend — {supplierData.length} supplier{supplierData.length !== 1 ? 's' : ''}</Text>
            <Text style={S.summaryDate}>
              {start.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} – {end.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>
        )}

        {/* Supplier cards */}
        {supplierData.length === 0 && (
          <View style={S.emptyCard}>
            <Text style={S.emptyTitle}>No spend data</Text>
            <Text style={S.emptyBody}>No invoices found for this period. Make sure invoices are recorded with a supplier ID.</Text>
          </View>
        )}
        {supplierData.map(data => {
          const rowKey = data.supplierId ?? data.supplierName;
          return (
            <SupplierCard
              key={rowKey}
              data={data}
              expanded={expanded === rowKey}
              onToggle={() => setExpanded(prev => prev === rowKey ? null : rowKey)}
              onExportCSV={() => handleExportCSV(data)}
              exporting={exporting}
            />
          );
        })}

        {/* Footnote */}
        <Text style={S.footnote}>
          Totals come from invoices scanned into Hosti. Invoices that weren't scanned aren't included.
        </Text>
      </ScrollView>
    </View>
  );
}

function ProgressBar({ pct, overBudget }: { pct: number; overBudget: boolean }) {
  const clamped = Math.min(pct, 100);
  const color = overBudget ? '#F87171' : pct >= 80 ? '#F59E0B' : '#4ADE80';
  return (
    <View style={{ height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, marginVertical: 6 }}>
      <View style={{ height: 6, width: `${clamped}%` as any, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

function AssessmentBadge({ data }: { data: SupplierSpendRow }) {
  if (data.budgetAmount == null) {
    return (
      <Text style={{ fontSize: 12, color: '#6B7280' }}>
        {fmtDollars(data.totalSpend)} spent · {data.gstNote}
      </Text>
    );
  }
  const gap = Math.abs(data.budgetVariance ?? 0);
  if (data.overBudget) {
    return (
      <Text style={{ fontSize: 12, color: '#B91C1C', fontWeight: '600' }}>
        {fmtDollars(gap)} over budget
      </Text>
    );
  }
  return (
    <Text style={{ fontSize: 12, color: '#065f46', fontWeight: '600' }}>
      ✓ {fmtDollars(gap)} under budget
    </Text>
  );
}

function SupplierCard({
  data, expanded, onToggle, onExportCSV, exporting,
}: {
  data: SupplierSpendRow;
  expanded: boolean;
  onToggle: () => void;
  onExportCSV: () => void;
  exporting: boolean;
}) {
  const budgetPct = data.budgetAmount && data.budgetAmount > 0
    ? Math.round((data.totalSpend / data.budgetAmount) * 100)
    : null;

  return (
    <View style={S.supplierCard}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.8}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={S.supplierName}>{data.supplierName}</Text>
            <Text style={S.supplierMeta}>
              {fmtDollars(data.totalSpend)} · {data.invoiceCount} invoice{data.invoiceCount !== 1 ? 's' : ''}
            </Text>
            {data.budgetAmount != null && (
              <Text style={S.supplierMeta}>Budget: {fmtDollars(data.budgetAmount)}{budgetPct != null ? ` (${fmtPct(budgetPct - 100)})` : ''}</Text>
            )}
          </View>
          <Text style={{ color: '#6B7280', fontSize: 20 }}>{expanded ? '−' : '›'}</Text>
        </View>

        {budgetPct != null && (
          <ProgressBar pct={budgetPct} overBudget={data.overBudget} />
        )}

        <AssessmentBadge data={data} />
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 12 }}>
          <View style={S.justificationCard}>
            <Text style={S.justLabel}>DETAILS</Text>
            <Text style={S.justText}>{data.invoiceCount} invoice{data.invoiceCount !== 1 ? 's' : ''} · {data.gstNote}</Text>
            {data.budgetVariance != null && (
              <Text style={[S.justText, { marginTop: 4 }]}>
                {data.overBudget ? 'Over' : 'Under'} budget by {fmtDollars(Math.abs(data.budgetVariance))}
                {data.budgetVariancePercent != null ? ` (${fmtPct(data.budgetVariancePercent)})` : ''}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={[S.exportBtn, { marginTop: 10 }]}
            onPress={onExportCSV}
            disabled={exporting}
          >
            <Text style={S.exportBtnText}>{exporting ? '…' : '📊 Export CSV'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },

  pageTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A' },

  pill: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 999, backgroundColor: '#F1F5F9',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  pillActive: { backgroundColor: '#1b4f72', borderColor: '#1b4f72' },
  pillText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  pillTextActive: { color: '#fff' },

  summaryCard: {
    backgroundColor: '#0B132B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  summaryVal: { color: '#F9FAFB', fontSize: 32, fontWeight: '800' },
  summaryLabel: { color: '#64748B', fontSize: 13, marginTop: 4 },
  summaryDate: { color: '#475569', fontSize: 12, marginTop: 2 },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#374151', marginBottom: 8 },
  emptyBody: { fontSize: 13, color: '#6B7280', lineHeight: 20 },

  supplierCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  supplierName: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  supplierMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  footnote: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  justificationCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  justLabel: { fontSize: 10, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.8, marginBottom: 4 },
  justText: { fontSize: 12, color: '#374151', lineHeight: 18 },

  exportBtn: {
    backgroundColor: '#1b4f72',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
