// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { calculateVelocity, VelocityData } from '../../services/reports/velocityService';

function fmtNum(n: number, dp = 1) { return n.toFixed(dp); }
function fmtDollars(n: number) { return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`; }

const STATUS_COLOURS: Record<string, string> = {
  fast: '#4ADE80',
  healthy: '#60A5FA',
  slow: '#F59E0B',
  stagnant: '#F87171',
};
const STATUS_LABELS: Record<string, string> = {
  fast: 'FAST',
  healthy: 'HEALTHY',
  slow: 'SLOW',
  stagnant: 'STAGNANT',
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

export default function ProductPerformanceScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [velocityMap, setVelocityMap] = useState<Map<string, VelocityData>>(new Map());
  const [cyclesAnalysed, setCyclesAnalysed] = useState(0);
  const [dateRange, setDateRange] = useState<{ first: string; last: string } | null>(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('velocity');
  const [search, setSearch] = useState('');
  const [recsOpen, setRecsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
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
        if (cancelled) return;
        const vMap = calculateVelocity(allSnapshots);
        setVelocityMap(vMap);
        // Determine cycle count and date range
        const maxCycles = allSnapshots.length > 0
          ? Math.max(...Array.from(vMap.values()).map(v => v.cyclesAnalysed), 0)
          : 0;
        setCyclesAnalysed(maxCycles);
        if (allSnapshots.length > 0) {
          const dates = allSnapshots
            .map(s => s.completedAt?.toDate?.()?.toISOString?.()?.slice(0, 10))
            .filter(Boolean)
            .sort();
          if (dates.length > 0) {
            setDateRange({ first: dates[0], last: dates[dates.length - 1] });
          }
        }
      } catch {}
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  const allItems = useMemo(() => Array.from(velocityMap.values()), [velocityMap]);

  const filtered = useMemo(() => {
    let items = allItems;
    const needle = search.trim().toLowerCase();
    if (needle) items = items.filter(v => v.productName.toLowerCase().includes(needle));
    switch (filter) {
      case 'fast':      items = items.filter(v => v.status === 'fast'); break;
      case 'healthy':   items = items.filter(v => v.status === 'healthy'); break;
      case 'slow':      items = items.filter(v => v.status === 'slow'); break;
      case 'stagnant':  items = items.filter(v => v.status === 'stagnant'); break;
      case 'expiry':    items = items.filter(v => v.expiryRisk); break;
      case 'below_par': items = items.filter(v => v.parLevel != null && v.currentStock < v.parLevel); break;
      case 'par_high':  items = items.filter(v => v.parAdequacy === 'too_high'); break;
      case 'rising':    items = items.filter(v => v.trend === 'rising'); break;
      case 'falling':   items = items.filter(v => v.trend === 'falling'); break;
    }
    switch (sort) {
      case 'velocity': items = [...items].sort((a, b) => b.unitsPerWeek - a.unitsPerWeek); break;
      case 'az':       items = [...items].sort((a, b) => a.productName.localeCompare(b.productName)); break;
      case 'shelf':    items = [...items].sort((a, b) => (b.daysToSellThrough ?? 0) - (a.daysToSellThrough ?? 0)); break;
      case 'cost':     items = [...items].sort((a, b) => (b.deadStockCostPerMonth ?? 0) - (a.deadStockCostPerMonth ?? 0)); break;
      case 'par':      items = [...items].sort((a, b) => {
        const ag = Math.abs((a.parLevel ?? 0) - (a.suggestedPAR ?? a.parLevel ?? 0));
        const bg = Math.abs((b.parLevel ?? 0) - (b.suggestedPAR ?? b.parLevel ?? 0));
        return bg - ag;
      }); break;
    }
    return items;
  }, [allItems, filter, sort, search]);

  // Summary counts
  const counts = useMemo(() => ({
    fast: allItems.filter(v => v.status === 'fast').length,
    healthy: allItems.filter(v => v.status === 'healthy').length,
    slow: allItems.filter(v => v.status === 'slow').length,
    stagnant: allItems.filter(v => v.status === 'stagnant').length,
    expiry: allItems.filter(v => v.expiryRisk).length,
    belowPar: allItems.filter(v => v.parLevel != null && v.currentStock < v.parLevel).length,
  }), [allItems]);

  // Recommendations
  const recommendations = useMemo(() => {
    const recs: string[] = [];
    const parIncrease = allItems.filter(v => v.parAdequacy === 'too_low' && v.suggestedPAR != null)
      .sort((a, b) => b.unitsPerWeek - a.unitsPerWeek).slice(0, 3);
    const parDecrease = allItems.filter(v => v.parAdequacy === 'too_high' && v.suggestedPAR != null)
      .sort((a, b) => a.unitsPerWeek - b.unitsPerWeek).slice(0, 3);
    const delist = allItems.filter(v => v.status === 'stagnant' && v.deadStockCostPerMonth != null && v.deadStockCostPerMonth > 10)
      .sort((a, b) => (b.deadStockCostPerMonth ?? 0) - (a.deadStockCostPerMonth ?? 0)).slice(0, 3);
    const expiryRisk = allItems.filter(v => v.expiryRisk);

    if (parIncrease.length > 0) {
      recs.push('INCREASE PAR:');
      parIncrease.forEach(v => recs.push(`  • ${v.productName} — ${fmtNum(v.unitsPerWeek)}/week, PAR ${v.parLevel}. Consider increasing to ${v.suggestedPAR}`));
    }
    if (parDecrease.length > 0) {
      recs.push('REDUCE PAR:');
      parDecrease.forEach(v => recs.push(`  • ${v.productName} — ${fmtNum(v.unitsPerWeek)}/week, PAR ${v.parLevel}. Consider reducing to ${v.suggestedPAR}`));
    }
    if (delist.length > 0) {
      recs.push('CONSIDER DELISTING:');
      delist.forEach(v => recs.push(`  • ${v.productName} — ${fmtNum(v.unitsPerWeek)}/week, ${fmtDollars(v.deadStockCostPerMonth!)}/month dead stock cost`));
    }
    if (expiryRisk.length > 0) {
      recs.push('EXPIRY RISK:');
      expiryRisk.forEach(v => recs.push(`  • ${v.productName} — expires in ${v.daysToExpiry} days, ${v.daysToSellThrough} days to sell through`));
    }
    const rising = allItems.filter(v => v.trend === 'rising').slice(0, 2);
    if (rising.length > 0) {
      recs.push('REVIEW ORDERING (rising demand):');
      rising.forEach(v => recs.push(`  • ${v.productName} — velocity rising ${v.trendPercent}% over last cycles`));
    }
    return recs;
  }, [allItems]);

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

  if (velocityMap.size === 0) {
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
          <Text style={S.subtitle}>
            Based on {cyclesAnalysed} stocktake cycle{cyclesAnalysed !== 1 ? 's' : ''}
            {dateRange ? ` · ${dateRange.first} → ${dateRange.last}` : ''}
          </Text>
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

function ProductRow({ v }: { v: VelocityData }) {
  const statusColor = STATUS_COLOURS[v.status] ?? '#94A3B8';
  const belowPar = v.parLevel != null && v.currentStock < v.parLevel;

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
          <Text style={[S.statusText, { color: statusColor }]}>{STATUS_LABELS[v.status]}</Text>
        </View>
      </View>

      {/* Velocity row */}
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <Text style={S.metricText}>
          {v.needsMoreData ? 'Need more data' : v.unitsPerWeek > 0 ? `${fmtNum(v.unitsPerWeek)}/week` : 'No movement'}
          {!v.needsMoreData && v.trend !== 'stable' ? ` ${v.trend === 'rising' ? '↑' : '↓'} ${Math.abs(v.trendPercent)}%` : ''}
        </Text>
        <Text style={S.metricText}>Stock: {v.currentStock}</Text>
        {v.daysToSellThrough != null && (
          <Text style={S.metricText}>{v.daysToSellThrough}d to sell</Text>
        )}
        <Text style={[S.metricText, { color: '#475569' }]}>
          {v.confidence.charAt(0).toUpperCase() + v.confidence.slice(1)} ({v.cyclesAnalysed} cycles)
        </Text>
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
