// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { listSuppliers } from '../../services/suppliers';
import { calculateSupplierSpend, SupplierSpendData } from '../../services/reports/supplierSpendService';
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
  const [supplierData, setSupplierData] = useState<SupplierSpendData[]>([]);
  const [expanded, setExpanded] = useState<string | null>(focusedSupplierId);
  const [exporting, setExporting] = useState(false);

  const { start, end } = useMemo(() => getPeriodDates(period), [period]);

  const load = useCallback(async () => {
    if (!venueId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Get all snapshots for velocity
      const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      const allSnapshots: any[] = [];
      for (const deptDoc of deptsSnap.docs) {
        try {
          const snapSnap = await getDocs(
            query(
              collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
              orderBy('completedAt', 'desc'),
              limit(6),
            ),
          );
          snapSnap.docs.forEach(d => allSnapshots.push(d.data()));
        } catch {}
      }

      // Get budgets (per-supplier, current month)
      let budgets: any[] = [];
      try { budgets = await listBudgets(venueId); } catch {}

      // Get suppliers
      const suppliers = await listSuppliers(venueId);
      const activeSuppliers = suppliers.filter((s: any) => !s.isHoldingSupplier && s.name);

      // If a specific supplier is focused, only load that one; otherwise load all
      const suppliersToLoad = focusedSupplierId
        ? activeSuppliers.filter((s: any) => s.id === focusedSupplierId)
        : activeSuppliers;

      const results: SupplierSpendData[] = [];
      for (const sup of suppliersToLoad) {
        try {
          // Find budget for this supplier
          const relevantBudget = budgets.find((b: any) => b.supplierId === sup.id);
          const budgetAmount = relevantBudget ? relevantBudget.amount : null;

          const data = await calculateSupplierSpend(
            venueId,
            sup.id!,
            sup.name,
            start,
            end,
            budgetAmount,
            allSnapshots,
          );
          // Only include suppliers with any spend or a budget
          if (data.totalSpend > 0 || budgetAmount != null) {
            results.push(data);
          }
        } catch {}
      }

      // Sort by spend descending
      results.sort((a, b) => b.totalSpend - a.totalSpend);
      setSupplierData(results);
    } catch {}
    finally { setLoading(false); }
  }, [venueId, start, end, focusedSupplierId]);

  useEffect(() => { load(); }, [load]);

  const totalSpend = useMemo(
    () => supplierData.reduce((s, d) => s + d.totalSpend, 0),
    [supplierData],
  );

  async function handleExportCSV(data: SupplierSpendData) {
    try {
      setExporting(true);
      const header = 'Supplier,Product,Units Received,Unit Cost,Total Cost,% of Spend,Velocity/Week,Performance\n';
      const rows = data.productBreakdown.map(p => [
        `"${data.supplierName}"`,
        `"${p.productName}"`,
        p.unitsReceived,
        p.unitCost.toFixed(2),
        p.totalCost.toFixed(2),
        p.percentOfSpend + '%',
        p.velocity != null ? p.velocity.toFixed(1) : '',
        p.performanceStatus ?? '',
      ].join(',')).join('\n');
      const csv = header + rows;
      const safeName = data.supplierName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
      const path = FileSystem.documentDirectory + `${safeName}-spend-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch {}
    finally { setExporting(false); }
  }

  async function handleExportPDF(data: SupplierSpendData) {
    try {
      setExporting(true);
      const dateStr = new Date().toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' });
      const rows = data.productBreakdown.map(p => `
        <tr>
          <td>${p.productName}</td>
          <td>${p.unitsReceived}</td>
          <td>$${p.unitCost.toFixed(2)}</td>
          <td>$${p.totalCost.toFixed(2)}</td>
          <td>${p.percentOfSpend}%</td>
          <td>${p.velocity != null ? p.velocity.toFixed(1) + '/wk' : '–'}</td>
          <td>${p.performanceStatus ?? '–'}</td>
        </tr>`).join('');
      const html = `<html><head><style>
        body{font-family:sans-serif;font-size:11px;padding:16px}
        h1{font-size:18px}h2{font-size:13px;color:#6b7280;font-weight:normal;margin:0 0 4px}
        .summary{display:flex;gap:16px;background:#f1f5f9;border-radius:8px;padding:12px;margin-bottom:16px}
        .sm-item{flex:1} .sm-val{font-size:16px;font-weight:800} .sm-lbl{font-size:10px;color:#6b7280}
        table{width:100%;border-collapse:collapse}
        th{background:#1b4f72;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
        td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:10px}
      </style></head><body>
        <h1>${data.supplierName}</h1>
        <h2>${dateStr} · ${data.invoiceCount} invoice${data.invoiceCount !== 1 ? 's' : ''}</h2>
        <div class="summary">
          <div class="sm-item"><div class="sm-val">$${data.totalSpend.toFixed(2)}</div><div class="sm-lbl">Total spend</div></div>
          ${data.budgetAmount != null ? `<div class="sm-item"><div class="sm-val" style="color:${data.overBudget ? '#b91c1c' : '#065f46'}">$${data.budgetAmount.toFixed(2)}</div><div class="sm-lbl">Budget</div></div>` : ''}
          <div class="sm-item"><div class="sm-val">${data.fastMovers}</div><div class="sm-lbl">Fast movers</div></div>
          <div class="sm-item"><div class="sm-val">${data.stagnantProducts}</div><div class="sm-lbl">Stagnant</div></div>
        </div>
        <table>
          <tr><th>Product</th><th>Units</th><th>Unit $</th><th>Total</th><th>%</th><th>Velocity</th><th>Status</th></tr>
          ${rows}
        </table>
        <p style="margin-top:12px;color:#94a3b8;font-size:9px">
          Assessment: ${data.justificationReason}${data.spendJustified === true ? ' ✓' : data.spendJustified === false ? ' ✗' : ''}
        </p>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const safeName = data.supplierName.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
      const dest = FileSystem.documentDirectory + `${safeName}-spend-${Date.now()}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
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
        {supplierData.map(data => (
          <SupplierCard
            key={data.supplierId}
            data={data}
            expanded={expanded === data.supplierId}
            onToggle={() => setExpanded(prev => prev === data.supplierId ? null : data.supplierId)}
            onExportCSV={() => handleExportCSV(data)}
            onExportPDF={() => handleExportPDF(data)}
            exporting={exporting}
            onViewSpend={() => setExpanded(data.supplierId)}
          />
        ))}
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

function AssessmentBadge({ data }: { data: SupplierSpendData }) {
  if (!data.budgetAmount) {
    return (
      <Text style={{ fontSize: 12, color: '#6B7280' }}>
        ℹ {fmtDollars(data.totalSpend)} spent — no budget set
      </Text>
    );
  }
  const gap = Math.abs(data.budgetVariance ?? 0);
  if (data.overBudget) {
    const justified = data.spendJustified;
    const color = justified ? '#D97706' : '#B91C1C';
    const icon = justified ? '⚠️' : '🔴';
    return (
      <Text style={{ fontSize: 12, color, fontWeight: '600' }}>
        {icon} {fmtDollars(gap)} over{justified ? ' — justified by velocity' : ' — review ordering'}
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
  data, expanded, onToggle, onExportCSV, onExportPDF, exporting, onViewSpend,
}: {
  data: SupplierSpendData;
  expanded: boolean;
  onToggle: () => void;
  onExportCSV: () => void;
  onExportPDF: () => void;
  exporting: boolean;
  onViewSpend: () => void;
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
              {fmtDollars(data.totalSpend)} · {data.invoiceCount} invoice{data.invoiceCount !== 1 ? 's' : ''} · {data.productCount} product{data.productCount !== 1 ? 's' : ''}
            </Text>
            {data.budgetAmount != null && (
              <Text style={S.supplierMeta}>Budget: {fmtDollars(data.budgetAmount)}{budgetPct != null ? ` (${fmtPct(budgetPct - 100)})` : ''}</Text>
            )}
          </View>
          <Text style={{ color: '#6B7280', fontSize: 20 }}>{expanded ? '−' : '›'}</Text>
        </View>

        {/* Progress bar */}
        {budgetPct != null && (
          <ProgressBar pct={budgetPct} overBudget={data.overBudget} />
        )}

        <AssessmentBadge data={data} />

        {/* Mover counts */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <Text style={{ fontSize: 11, color: '#4ADE80' }}>Fast: {data.fastMovers}</Text>
          <Text style={{ fontSize: 11, color: '#F59E0B' }}>Slow: {data.slowMovers}</Text>
          <Text style={{ fontSize: 11, color: '#F87171' }}>Stagnant: {data.stagnantProducts}</Text>
          {data.spendTrendPercent != null && (
            <Text style={{ fontSize: 11, color: data.spendTrendPercent >= 0 ? '#F87171' : '#4ADE80' }}>
              Trend: {fmtPct(data.spendTrendPercent)} vs prev
            </Text>
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 12 }}>
          {/* Product breakdown */}
          {data.productBreakdown.length > 0 && (
            <View style={S.breakdown}>
              <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                <Text style={[S.breakdownHeader, { flex: 2 }]}>Product</Text>
                <Text style={[S.breakdownHeader, { width: 50, textAlign: 'right' }]}>Units</Text>
                <Text style={[S.breakdownHeader, { width: 70, textAlign: 'right' }]}>Total</Text>
                <Text style={[S.breakdownHeader, { width: 40, textAlign: 'right' }]}>%</Text>
              </View>
              {data.productBreakdown.slice(0, 12).map((p, i) => (
                <View key={p.productId + i} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
                  <View style={{ flex: 2 }}>
                    <Text style={{ fontWeight: '600', fontSize: 12 }}>{p.productName}</Text>
                    {p.velocity != null && (
                      <Text style={{ fontSize: 11, color: '#6B7280' }}>
                        {p.velocity.toFixed(1)}/wk · {p.performanceStatus ?? ''}
                      </Text>
                    )}
                  </View>
                  <Text style={[S.breakdownCell, { width: 50 }]}>{p.unitsReceived}</Text>
                  <Text style={[S.breakdownCell, { width: 70 }]}>${p.totalCost.toFixed(0)}</Text>
                  <Text style={[S.breakdownCell, { width: 40 }]}>{p.percentOfSpend}%</Text>
                </View>
              ))}
              {data.productBreakdown.length > 12 && (
                <Text style={{ color: '#6B7280', fontSize: 11, marginTop: 4 }}>
                  +{data.productBreakdown.length - 12} more products (export CSV for full list)
                </Text>
              )}
            </View>
          )}

          {/* Justification text */}
          <View style={S.justificationCard}>
            <Text style={S.justLabel}>ASSESSMENT</Text>
            <Text style={S.justText}>{data.justificationReason}</Text>
            {data.previousPeriodSpend != null && (
              <Text style={[S.justText, { marginTop: 4 }]}>
                Previous period: {fmtDollars(data.previousPeriodSpend)}
                {data.spendTrendPercent != null ? ` (${fmtPct(data.spendTrendPercent)} vs current)` : ''}
              </Text>
            )}
          </View>

          {/* Export buttons */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              style={[S.exportBtn, { flex: 1 }]}
              onPress={onExportPDF}
              disabled={exporting}
            >
              <Text style={S.exportBtnText}>{exporting ? '…' : '📄 PDF'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.exportBtn, { flex: 1, backgroundColor: '#065f46' }]}
              onPress={onExportCSV}
              disabled={exporting}
            >
              <Text style={S.exportBtnText}>{exporting ? '…' : '📊 CSV'}</Text>
            </TouchableOpacity>
          </View>
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

  breakdown: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  breakdownHeader: { fontSize: 10, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.5, textTransform: 'uppercase' },
  breakdownCell: { textAlign: 'right', fontSize: 12, color: '#374151' },

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
