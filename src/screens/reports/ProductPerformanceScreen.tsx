import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { calculateVelocity, VelocityData } from '../../services/reports/velocityService';
import { loadSnapshotItems } from '../../utils/snapshotItems';
import {
  buildVelocityRowsFromReports,
  matchDocToMatchData,
  partitionReports,
  toNZDate,
  VelocityRow,
  type MatchData,
} from '../../utils/weeklyLedger';

function fmtNum(n: number, dp = 1) { return n.toFixed(dp); }
function fmtDollars(n: number) { return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`; }

const STATUS_COLOURS: Record<string, string> = {
  fast: '#4ADE80',
  healthy: '#60A5FA',
  slow: '#F59E0B',
  stagnant: '#F87171',
  sold_out: '#94A3B8',
};
const STATUS_LABELS: Record<string, string> = {
  fast: 'FAST',
  healthy: 'HEALTHY',
  slow: 'SLOW',
  stagnant: 'STAGNANT',
  sold_out: 'SOLD OUT',
};

const FILTER_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'fast', label: 'Fast' },
  { id: 'healthy', label: 'Healthy' },
  { id: 'slow', label: 'Slow' },
  { id: 'stagnant', label: 'Stagnant' },
  { id: 'expiry', label: 'Expiry risk' },
  { id: 'below_par', label: 'Below PAR' },
  { id: 'par_high', label: 'PAR too high' },
  { id: 'rising', label: 'Rising' },
  { id: 'falling', label: 'Falling' },
];

const SORT_OPTIONS = [
  { id: 'velocity', label: 'Velocity ↓' },
  { id: 'az', label: 'A–Z' },
  { id: 'shelf', label: 'Days on shelf' },
  { id: 'cost', label: 'Cost impact' },
  { id: 'par', label: 'PAR gap' },
];

type DisplayItem = {
  productId: string;
  productName: string;
  status: string;
  unitsPerWeek: number | null;
  last4Units: number | null;
  categoryName?: string | null;
  areaName?: string | null;
  currentStock?: number | null;
  parLevel?: number | null;
  suggestedPAR?: number | null;
  parAdequacy?: string | null;
  daysToSellThrough?: number | null;
  deadStockCostPerMonth?: number | null;
  expiryRisk?: boolean;
  daysToExpiry?: number | null;
  expiryRiskDays?: number | null;
  trend?: string | null;
  trendPercent?: number | null;
  confidence?: string;
  cyclesAnalysed?: number;
  needsMoreData?: boolean;
  salesLed: boolean;
};

function velocityDataToDisplay(v: VelocityData): DisplayItem {
  return {
    productId: v.productId,
    productName: v.productName,
    status: v.status,
    unitsPerWeek: v.unitsPerWeek,
    last4Units: null,
    categoryName: v.categoryName,
    areaName: v.areaName,
    currentStock: v.currentStock,
    parLevel: v.parLevel,
    suggestedPAR: v.suggestedPAR,
    parAdequacy: v.parAdequacy,
    daysToSellThrough: v.daysToSellThrough,
    deadStockCostPerMonth: v.deadStockCostPerMonth,
    expiryRisk: v.expiryRisk,
    daysToExpiry: v.daysToExpiry,
    expiryRiskDays: v.expiryRiskDays,
    trend: v.trend,
    trendPercent: v.trendPercent,
    confidence: v.confidence,
    cyclesAnalysed: v.cyclesAnalysed,
    needsMoreData: v.needsMoreData,
    salesLed: false,
  };
}

function velocityRowToDisplay(row: VelocityRow, mappedStatus: string): DisplayItem {
  return {
    productId: row.productId,
    productName: row.name,
    status: mappedStatus,
    unitsPerWeek: row.last4Units > 0 ? row.last4Units / 4 : 0,
    last4Units: row.last4Units,
    currentStock: row.latestStock,
    salesLed: true,
  };
}

export default function ProductPerformanceScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [cyclesAnalysed, setCyclesAnalysed] = useState(0);
  const [dateRange, setDateRange] = useState<{ first: string; last: string } | null>(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('velocity');
  const [search, setSearch] = useState('');
  const [recsOpen, setRecsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [salesBanner, setSalesBanner] = useState<{ weeksCovered: number; unitCoveragePct: number } | null>(null);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        // ── Try sales-led path first ───────────────────────────────────────────
        let usedSalesPath = false;
        try {
          const reportsSnap = await getDocs(collection(db, 'venues', venueId, 'salesReports'));
          const { reports: activeReports } = partitionReports(reportsSnap.docs as any);

          if (activeReports.length > 0) {
            // Load match docs for active reports
            const matchesByReport: Record<string, MatchData | null> = {};
            await Promise.all(activeReports.map(async r => {
              try {
                const matchSnap = await getDocs(collection(db, 'venues', venueId, 'salesReportMatches'));
                const doc = matchSnap.docs.find(d => d.id === r.id);
                matchesByReport[r.id] = doc ? matchDocToMatchData(doc.data() as Record<string, any>) : null;
              } catch {
                matchesByReport[r.id] = null;
              }
            }));

            const hasAnyMatch = activeReports.some(r => matchesByReport[r.id] != null);
            if (hasAnyMatch) {
              const todayNZ = toNZDate(new Date()) ?? new Date().toISOString().slice(0, 10);
              const { rows, windowInfo } = buildVelocityRowsFromReports(
                activeReports, matchesByReport, {}, todayNZ,
              );

              if (rows.length > 0) {
                // Remap status: Fast=top 20% by last4Units (Selling), Healthy=other Selling,
                // Slow=Slowing, Stagnant=Stagnant, sold_out=Sold out
                const sellingRows = rows.filter(r => r.status === 'Selling').sort((a, b) => b.last4Units - a.last4Units);
                const top20Cutoff = Math.max(1, Math.ceil(sellingRows.length * 0.2));
                const fastIds = new Set(sellingRows.slice(0, top20Cutoff).map(r => r.productId));

                const displayItems = rows.map(row => {
                  let mapped: string;
                  if (row.status === 'Sold out') mapped = 'sold_out';
                  else if (row.status === 'Stagnant') mapped = 'stagnant';
                  else if (row.status === 'Slowing') mapped = 'slow';
                  else if (row.status === 'Selling') mapped = fastIds.has(row.productId) ? 'fast' : 'healthy';
                  else mapped = 'healthy';
                  return velocityRowToDisplay(row, mapped);
                });

                // Banner: weeks covered + unit match coverage
                const weeksSet = new Set<string>();
                let totalQty = 0, matchedQty = 0;
                for (const r of activeReports) {
                  const md = matchesByReport[r.id];
                  if (!md || !r.startStr || !r.endStr) continue;
                  // Count weeks
                  let cur = new Date(r.startStr + 'T00:00:00Z');
                  const end = new Date(r.endStr + 'T00:00:00Z');
                  while (cur <= end) {
                    weeksSet.add(cur.toISOString().slice(0, 10).slice(0, 7));
                    cur = new Date(cur.getTime() + 86400000 * 7);
                  }
                  // Count units
                  for (const line of r.rawLines) totalQty += line.qtySold ?? 0;
                  matchedQty += md.matchedQty;
                }
                const unitCoveragePct = totalQty > 0 ? Math.round((matchedQty / totalQty) * 100) : 0;
                setSalesBanner({ weeksCovered: weeksSet.size, unitCoveragePct });

                if (!cancelled) {
                  setItems(displayItems);
                  usedSalesPath = true;
                }
              }
            }
          }
        } catch {}

        if (cancelled) return;

        // ── Count-based fallback ───────────────────────────────────────────────
        if (!usedSalesPath) {
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
              for (const snapDoc of snapSnap.docs) {
                const d = snapDoc.data() as any;
                const snapItems = await loadSnapshotItems(d, () =>
                  getDocs(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots', snapDoc.id, 'itemChunks')).then(s =>
                    s.docs.map(dd => dd.data() as { index: number; items: any[] })
                  )
                );
                allSnapshots.push({ ...d, items: snapItems });
              }
            } catch {}
          }
          if (cancelled) return;
          const vMap = calculateVelocity(allSnapshots);
          setItems(Array.from(vMap.values()).map(velocityDataToDisplay));
          const maxCycles = allSnapshots.length > 0
            ? Math.max(...Array.from(vMap.values()).map(v => v.cyclesAnalysed), 0) : 0;
          setCyclesAnalysed(maxCycles);
          if (allSnapshots.length > 0) {
            const dates = allSnapshots
              .map(s => s.completedAt?.toDate?.()?.toISOString?.()?.slice(0, 10))
              .filter(Boolean).sort();
            if (dates.length > 0) setDateRange({ first: dates[0], last: dates[dates.length - 1] });
          }
        }
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  const filtered = useMemo(() => {
    let list = items;
    const needle = search.trim().toLowerCase();
    if (needle) list = list.filter(v => v.productName.toLowerCase().includes(needle));
    switch (filter) {
      case 'fast':      list = list.filter(v => v.status === 'fast'); break;
      case 'healthy':   list = list.filter(v => v.status === 'healthy'); break;
      case 'slow':      list = list.filter(v => v.status === 'slow'); break;
      case 'stagnant':  list = list.filter(v => v.status === 'stagnant'); break;
      case 'expiry':    list = list.filter(v => v.expiryRisk); break;
      case 'below_par': list = list.filter(v => v.parLevel != null && (v.currentStock ?? 0) < (v.parLevel ?? 0)); break;
      case 'par_high':  list = list.filter(v => v.parAdequacy === 'too_high'); break;
      case 'rising':    list = list.filter(v => v.trend === 'rising'); break;
      case 'falling':   list = list.filter(v => v.trend === 'falling'); break;
    }
    switch (sort) {
      case 'velocity': list = [...list].sort((a, b) => (b.unitsPerWeek ?? 0) - (a.unitsPerWeek ?? 0)); break;
      case 'az':       list = [...list].sort((a, b) => a.productName.localeCompare(b.productName)); break;
      case 'shelf':    list = [...list].sort((a, b) => (b.daysToSellThrough ?? 0) - (a.daysToSellThrough ?? 0)); break;
      case 'cost':     list = [...list].sort((a, b) => (b.deadStockCostPerMonth ?? 0) - (a.deadStockCostPerMonth ?? 0)); break;
      case 'par':      list = [...list].sort((a, b) => {
        const ag = Math.abs((a.parLevel ?? 0) - (a.suggestedPAR ?? a.parLevel ?? 0));
        const bg = Math.abs((b.parLevel ?? 0) - (b.suggestedPAR ?? b.parLevel ?? 0));
        return bg - ag;
      }); break;
    }
    return list;
  }, [items, filter, sort, search]);

  // Summary counts
  const counts = useMemo(() => ({
    fast: items.filter(v => v.status === 'fast').length,
    healthy: items.filter(v => v.status === 'healthy').length,
    slow: items.filter(v => v.status === 'slow').length,
    stagnant: items.filter(v => v.status === 'stagnant').length,
    expiry: items.filter(v => v.expiryRisk).length,
    belowPar: items.filter(v => v.parLevel != null && (v.currentStock ?? 0) < (v.parLevel ?? 0)).length,
  }), [items]);

  // Recommendations (count-based path only — sales-led has no PAR/expiry data yet)
  const recommendations = useMemo(() => {
    const recs: string[] = [];
    const parIncrease = items.filter(v => !v.salesLed && v.parAdequacy === 'too_low' && v.suggestedPAR != null)
      .sort((a, b) => (b.unitsPerWeek ?? 0) - (a.unitsPerWeek ?? 0)).slice(0, 3);
    const parDecrease = items.filter(v => !v.salesLed && v.parAdequacy === 'too_high' && v.suggestedPAR != null)
      .sort((a, b) => (a.unitsPerWeek ?? 0) - (b.unitsPerWeek ?? 0)).slice(0, 3);
    const delist = items.filter(v => !v.salesLed && v.status === 'stagnant' && v.deadStockCostPerMonth != null && v.deadStockCostPerMonth > 10)
      .sort((a, b) => (b.deadStockCostPerMonth ?? 0) - (a.deadStockCostPerMonth ?? 0)).slice(0, 3);
    const expiryRisk = items.filter(v => v.expiryRisk);

    if (parIncrease.length > 0) {
      recs.push('INCREASE PAR:');
      parIncrease.forEach(v => recs.push(`  • ${v.productName} — ${fmtNum(v.unitsPerWeek ?? 0)}/week, PAR ${v.parLevel}. Consider increasing to ${v.suggestedPAR}`));
    }
    if (parDecrease.length > 0) {
      recs.push('REDUCE PAR:');
      parDecrease.forEach(v => recs.push(`  • ${v.productName} — ${fmtNum(v.unitsPerWeek ?? 0)}/week, PAR ${v.parLevel}. Consider reducing to ${v.suggestedPAR}`));
    }
    if (delist.length > 0) {
      recs.push('CONSIDER DELISTING:');
      delist.forEach(v => recs.push(`  • ${v.productName} — ${fmtNum(v.unitsPerWeek ?? 0)}/week, ${fmtDollars(v.deadStockCostPerMonth!)}/month dead stock cost`));
    }
    if (expiryRisk.length > 0) {
      recs.push('EXPIRY RISK:');
      expiryRisk.forEach(v => recs.push(`  • ${v.productName} — expires in ${v.daysToExpiry} days, ${v.daysToSellThrough} days to sell through`));
    }
    const rising = items.filter(v => v.trend === 'rising').slice(0, 2);
    if (rising.length > 0) {
      recs.push('REVIEW ORDERING (rising demand):');
      rising.forEach(v => recs.push(`  • ${v.productName} — velocity rising ${v.trendPercent}% over last cycles`));
    }
    return recs;
  }, [items]);

  async function handleExportCSV() {
    try {
      setExporting(true);
      const header = 'Product,Category,Area,Velocity/Week,Trend,Status,Current Stock,Days to Sell,PAR Level,Suggested PAR,Expiry Date,Expiry Risk,Cost Price,Dead Stock Cost/Month,Confidence,Cycles\n';
      const rows = allItems.map(v => [
        `"${v.productName}"`,
        `"${v.categoryName ?? ''}"`,
        `"${v.areaName ?? ''}"`,
        fmtNum(v.unitsPerWeek),
        v.trend,
        v.status,
        v.currentStock,
        v.daysToSellThrough ?? '',
        v.parLevel ?? '',
        v.suggestedPAR ?? '',
        v.expiryDate ? v.expiryDate.toISOString().slice(0, 10) : '',
        v.expiryRisk ? 'YES' : 'NO',
        v.deadStockCostPerMonth != null ? fmtNum(v.deadStockCostPerMonth, 2) : '',
        v.confidence,
        v.cyclesAnalysed,
      ].join(',')).join('\n');
      const csv = header + rows;
      const path = FileSystem.documentDirectory + `product-performance-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch {}
    finally { setExporting(false); }
  }

  async function handleExportPDF() {
    try {
      setExporting(true);
      const rows = allItems.map(v => `
        <tr>
          <td>${v.productName}</td>
          <td>${v.categoryName ?? '–'}</td>
          <td style="color:${STATUS_COLOURS[v.status]}">${STATUS_LABELS[v.status]}</td>
          <td>${fmtNum(v.unitsPerWeek)}/wk</td>
          <td>${v.trend}</td>
          <td>${v.currentStock}</td>
          <td>${v.daysToSellThrough ?? '∞'} d</td>
          <td>${v.parLevel ?? '–'}${v.suggestedPAR ? ` → ${v.suggestedPAR}` : ''}</td>
          <td>${v.expiryRisk ? '⚠' : '–'}</td>
        </tr>`).join('');

      const html = `<html><head><style>
        body{font-family:sans-serif;font-size:11px;padding:16px}
        h1{font-size:18px;margin-bottom:4px}
        h2{font-size:13px;color:#64748b;font-weight:normal;margin:0 0 16px}
        table{width:100%;border-collapse:collapse}
        th{background:#1b4f72;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
        td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:10px}
        tr:nth-child(even){background:#f8fafc}
      </style></head><body>
        <h1>Product Performance Report</h1>
        <h2>Based on ${cyclesAnalysed} cycle(s)${dateRange ? ` · ${dateRange.first} → ${dateRange.last}` : ''}</h2>
        <table>
          <tr><th>Product</th><th>Category</th><th>Status</th><th>Velocity</th><th>Trend</th><th>Stock</th><th>Days to Sell</th><th>PAR</th><th>Expiry</th></tr>
          ${rows}
        </table>
        <p style="color:#94a3b8;font-size:9px;margin-top:12px">Generated ${new Date().toLocaleDateString('en-NZ')}</p>
      </body></html>`;

      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.documentDirectory + `product-performance-${Date.now()}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch {}
    finally { setExporting(false); }
  }

  if (loading) {
    return (
      <View style={S.centred}>
        <ActivityIndicator color="#60A5FA" size="large" />
        <Text style={S.loadingText}>Calculating velocity…</Text>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={S.centred}>
        <Text style={S.emptyTitle}>No data yet</Text>
        <Text style={S.emptyBody}>Complete at least one stocktake to see product performance.</Text>
      </View>
    );
  }

  return (
    <View style={S.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={S.header}>
          <Text style={S.title}>Product Performance</Text>
          {salesBanner ? (
            <View style={S.salesBanner}>
              <Text style={S.salesBannerText}>
                From imported sales reports · {salesBanner.weeksCovered} week{salesBanner.weeksCovered !== 1 ? 's' : ''} covered · {salesBanner.unitCoveragePct}% of sold units linked to products
              </Text>
            </View>
          ) : (
            <Text style={S.subtitle}>
              Based on stocktake counts only
              {cyclesAnalysed > 0 ? ` · ${cyclesAnalysed} cycle${cyclesAnalysed !== 1 ? 's' : ''}` : ''}
              {dateRange ? ` · ${dateRange.first} → ${dateRange.last}` : ''}
            </Text>
          )}
        </View>

        {/* Summary cards */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, flexDirection: 'row' }}>
          {[
            { label: 'Fast movers', value: counts.fast, color: '#4ADE80' },
            { label: 'Healthy', value: counts.healthy, color: '#60A5FA' },
            { label: 'Slow movers', value: counts.slow, color: '#F59E0B' },
            { label: 'Stagnant', value: counts.stagnant, color: '#F87171' },
            { label: 'Expiry risk', value: counts.expiry, color: '#FB923C' },
            { label: 'Below PAR', value: counts.belowPar, color: '#A78BFA' },
          ].map(card => (
            <TouchableOpacity
              key={card.label}
              style={[S.summaryCard, { borderColor: card.color }]}
              onPress={() => {
                const m: Record<string, string> = { 'Fast movers': 'fast', 'Healthy': 'healthy', 'Slow movers': 'slow', 'Stagnant': 'stagnant', 'Expiry risk': 'expiry', 'Below PAR': 'below_par' };
                setFilter(m[card.label] ?? 'all');
              }}
            >
              <Text style={[S.summaryVal, { color: card.color }]}>{card.value}</Text>
              <Text style={S.summaryLabel}>{card.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Search */}
        <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products…"
            placeholderTextColor="#475569"
            style={S.searchInput}
            clearButtonMode="while-editing"
          />
        </View>

        {/* Filter pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, flexDirection: 'row' }}>
          {FILTER_PILLS.map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => setFilter(p.id)}
              style={[S.pill, filter === p.id && S.pillActive]}
            >
              <Text style={[S.pillText, filter === p.id && S.pillTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Sort options */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, flexDirection: 'row' }}>
          {SORT_OPTIONS.map(o => (
            <TouchableOpacity
              key={o.id}
              onPress={() => setSort(o.id)}
              style={[S.sortPill, sort === o.id && S.sortPillActive]}
            >
              <Text style={[S.sortText, sort === o.id && S.sortTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Product list */}
        <View style={{ paddingHorizontal: 16 }}>
          {filtered.map((v, idx) => (
            <ProductRow key={v.productId + idx} v={v} />
          ))}
          {filtered.length === 0 && (
            <Text style={{ color: '#64748B', textAlign: 'center', paddingVertical: 24 }}>
              No products match this filter.
            </Text>
          )}
        </View>

        {/* Recommendations panel */}
        {recommendations.length > 0 && (
          <View style={[S.card, { marginHorizontal: 16, marginTop: 16 }]}>
            <TouchableOpacity
              onPress={() => setRecsOpen(v => !v)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Text style={S.cardLabel}>SUGGESTED ACTIONS</Text>
              <Text style={{ color: '#60A5FA', fontSize: 20 }}>{recsOpen ? '−' : '+'}</Text>
            </TouchableOpacity>
            {recsOpen && recommendations.map((r, i) => (
              <Text key={i} style={[S.recLine, r.startsWith(' ') ? S.recItem : S.recHeader]}>{r}</Text>
            ))}
          </View>
        )}

        {/* Export */}
        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 16 }}>
          <TouchableOpacity
            style={[S.exportBtn, { flex: 1 }]}
            onPress={handleExportPDF}
            disabled={exporting}
          >
            <Text style={S.exportBtnText}>{exporting ? '…' : '📄 Export PDF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.exportBtn, { flex: 1, backgroundColor: '#065f46' }]}
            onPress={handleExportCSV}
            disabled={exporting}
          >
            <Text style={S.exportBtnText}>{exporting ? '…' : '📊 Export CSV'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function ProductRow({ v }: { v: DisplayItem }) {
  const statusColor = STATUS_COLOURS[v.status] ?? '#94A3B8';
  const belowPar = v.parLevel != null && (v.currentStock ?? 0) < v.parLevel;

  return (
    <View style={S.productCard}>
      {/* Name + category/area */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={S.productName}>{v.productName}</Text>
          {(v.categoryName || v.areaName) && (
            <Text style={S.productSub}>
              {[v.categoryName, v.areaName].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        <View style={[S.statusBadge, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
          <Text style={[S.statusText, { color: statusColor }]}>{STATUS_LABELS[v.status] ?? v.status.toUpperCase()}</Text>
        </View>
      </View>

      {/* Velocity row */}
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <Text style={S.metricText}>
          {v.needsMoreData ? 'Need more data'
            : (v.unitsPerWeek ?? 0) > 0 ? `${fmtNum(v.unitsPerWeek ?? 0)}/week`
            : 'No movement'}
          {!v.salesLed && !v.needsMoreData && v.trend && v.trend !== 'stable'
            ? ` ${v.trend === 'rising' ? '↑' : '↓'} ${Math.abs(v.trendPercent ?? 0)}%` : ''}
        </Text>
        {v.currentStock != null && <Text style={S.metricText}>Stock: {v.currentStock}</Text>}
        {v.daysToSellThrough != null && (
          <Text style={S.metricText}>{v.daysToSellThrough}d to sell</Text>
        )}
        {!v.salesLed && v.confidence && (
          <Text style={[S.metricText, { color: '#475569' }]}>
            {v.confidence.charAt(0).toUpperCase() + v.confidence.slice(1)} ({v.cyclesAnalysed} cycles)
          </Text>
        )}
      </View>

      {/* PAR */}
      {v.parLevel != null && (
        <Text style={[S.subText, { color: belowPar ? '#F87171' : '#64748B' }]}>
          PAR: {v.parLevel}{belowPar ? ' ⚠ below PAR' : ''}
          {v.parAdequacy && v.suggestedPAR != null && v.parAdequacy !== 'appropriate'
            ? ` · Suggested: ${v.suggestedPAR}` : ''}
        </Text>
      )}

      {/* Slow mover extra */}
      {(v.status === 'slow' || v.status === 'stagnant') && v.deadStockCostPerMonth != null && v.deadStockCostPerMonth > 0 && (
        <Text style={[S.subText, { color: '#F59E0B' }]}>
          Dead stock: {fmtDollars(v.deadStockCostPerMonth)}/month
        </Text>
      )}

      {/* Expiry risk */}
      {v.expiryRisk && v.daysToExpiry != null && (
        <View style={S.expiryBanner}>
          <Text style={S.expiryText}>
            ⚠ Expiry risk — expires in {v.daysToExpiry}d, {v.daysToSellThrough}d to sell
            {v.expiryRiskDays != null && v.expiryRiskDays > 0
              ? ` (${v.expiryRiskDays}d surplus after expiry)` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1115' },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0F1115', padding: 32 },
  loadingText: { color: '#64748B', marginTop: 12, fontSize: 14 },
  emptyTitle: { color: '#F9FAFB', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyBody: { color: '#64748B', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  header: { padding: 16, paddingBottom: 8 },
  title: { color: '#F9FAFB', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#64748B', fontSize: 12, marginTop: 2 },
  salesBanner: {
    marginTop: 6,
    backgroundColor: '#0F2A1E',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#166534',
  },
  salesBannerText: { color: '#4ADE80', fontSize: 12 },

  summaryCard: {
    backgroundColor: '#161B2A',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    minWidth: 100,
    alignItems: 'center',
  },
  summaryVal: { fontSize: 22, fontWeight: '800' },
  summaryLabel: { color: '#64748B', fontSize: 11, marginTop: 2, textAlign: 'center' },

  searchInput: {
    backgroundColor: '#161B2A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#1E293B',
  },

  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#161B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  pillActive: { backgroundColor: '#1b4f72', borderColor: '#1b4f72' },
  pillText: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  pillTextActive: { color: '#fff' },

  sortPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#0F1115',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  sortPillActive: { borderColor: '#60A5FA' },
  sortText: { color: '#475569', fontSize: 12 },
  sortTextActive: { color: '#60A5FA', fontWeight: '700' },

  productCard: {
    backgroundColor: '#161B2A',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  productName: { color: '#F9FAFB', fontSize: 14, fontWeight: '700' },
  productSub: { color: '#64748B', fontSize: 12, marginTop: 2 },

  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  metricText: { color: '#CBD5E1', fontSize: 12 },
  subText: { fontSize: 12, marginTop: 2 },

  expiryBanner: {
    marginTop: 6,
    backgroundColor: '#431407',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#92400E',
  },
  expiryText: { color: '#FDBA74', fontSize: 12, fontWeight: '600' },

  card: {
    backgroundColor: '#161B2A',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  cardLabel: { color: '#64748B', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  recHeader: { color: '#60A5FA', fontWeight: '700', fontSize: 13, marginTop: 10 },
  recLine: { color: '#CBD5E1', fontSize: 13, lineHeight: 20 },
  recItem: { color: '#94A3B8', fontSize: 12 },

  exportBtn: {
    backgroundColor: '#1b4f72',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
