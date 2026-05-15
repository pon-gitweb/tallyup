// @ts-nocheck
import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, SafeAreaView, StyleSheet, Alert,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type RouteParams = {
  venueId: string;
  deptIdA: string;
  snapshotIdA: string;
  deptIdB: string;
  snapshotIdB: string;
};

type ProductFilter = 'all' | 'changed' | 'loss' | 'gain' | 'new' | 'removed';

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtVal(v: number): string {
  if (Math.abs(v) >= 1000) return (v < 0 ? '-' : '+') + `$${(Math.abs(v) / 1000).toFixed(1)}k`;
  return (v < 0 ? '-' : '+') + `$${Math.abs(v).toFixed(0)}`;
}

export default function CycleComparisonScreen() {
  const route = useRoute<any>();
  const { venueId, deptIdA, snapshotIdA, deptIdB, snapshotIdB } = route.params as RouteParams;

  const [loading, setLoading] = useState(true);
  const [snapA, setSnapA] = useState<any>(null);
  const [snapB, setSnapB] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [sort, setSort] = useState<'az' | 'change' | 'value'>('change');
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [docA, docB] = await Promise.all([
        getDoc(doc(db, 'venues', venueId, 'departments', deptIdA, 'snapshots', snapshotIdA)),
        getDoc(doc(db, 'venues', venueId, 'departments', deptIdB, 'snapshots', snapshotIdB)),
      ]);
      if (docA.exists()) setSnapA(docA.data());
      if (docB.exists()) setSnapB(docB.data());
    } catch (e: any) {
      console.error('[CycleComparison] load error', e?.message);
    } finally {
      setLoading(false);
    }
  }

  // Build product comparison map
  const comparedProducts = useMemo(() => {
    if (!snapA || !snapB) return [];
    const mapA: Record<string, any> = {};
    const mapB: Record<string, any> = {};
    (snapA.items || []).forEach((it: any) => { mapA[it.name?.toLowerCase().trim()] = it; });
    (snapB.items || []).forEach((it: any) => { mapB[it.name?.toLowerCase().trim()] = it; });

    const allKeys = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
    const result: any[] = [];

    allKeys.forEach(key => {
      const a = mapA[key];
      const b = mapB[key];
      const isNew = !a && !!b;
      const isRemoved = !!a && !b;
      const countA = a?.actualClosing ?? null;
      const countB = b?.actualClosing ?? null;
      const change = countA != null && countB != null ? countB - countA : null;
      const valA = a?.totalVarianceDollars ?? null;
      const valB = b?.totalVarianceDollars ?? null;
      const valChange = valA != null && valB != null ? valB - valA : null;
      result.push({
        name: (a || b)?.name,
        areaA: a?.areaName ?? null,
        areaB: b?.areaName ?? null,
        countA,
        countB,
        change,
        valChange,
        isNew,
        isRemoved,
        status: isNew ? 'NEW' : isRemoved ? 'REMOVED' : change == null ? 'SAME' : change < 0 ? 'LOSS' : change > 0 ? 'GAIN' : 'SAME',
      });
    });

    return result;
  }, [snapA, snapB]);

  const filteredProducts = useMemo(() => {
    let result = comparedProducts;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(p => (p.name || '').toLowerCase().includes(q));
    }
    if (filter === 'changed') result = result.filter(p => p.change !== 0 && p.change != null);
    else if (filter === 'loss') result = result.filter(p => p.status === 'LOSS');
    else if (filter === 'gain') result = result.filter(p => p.status === 'GAIN');
    else if (filter === 'new') result = result.filter(p => p.isNew);
    else if (filter === 'removed') result = result.filter(p => p.isRemoved);

    return [...result].sort((a, b) => {
      if (sort === 'az') return (a.name || '').localeCompare(b.name || '');
      if (sort === 'change') return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0);
      if (sort === 'value') return Math.abs(b.valChange ?? 0) - Math.abs(a.valChange ?? 0);
      return 0;
    });
  }, [comparedProducts, search, filter, sort]);

  const stats = useMemo(() => {
    if (!snapA || !snapB) return null;
    const dateA: Date | null = snapA.completedAt?.toDate?.() ?? null;
    const dateB: Date | null = snapB.completedAt?.toDate?.() ?? null;
    const daysBetween = dateA && dateB
      ? Math.abs(Math.round((dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24)))
      : null;
    const losses = comparedProducts.filter(p => p.status === 'LOSS');
    const gains = comparedProducts.filter(p => p.status === 'GAIN');
    const added = comparedProducts.filter(p => p.isNew);
    const removed = comparedProducts.filter(p => p.isRemoved);
    const biggestLoss = losses.sort((a, b) => a.change - b.change)[0];
    const biggestGain = gains.sort((a, b) => b.change - a.change)[0];
    const valATotal = snapA.summary?.totalStockValue ?? null;
    const valBTotal = snapB.summary?.totalStockValue ?? null;
    const valChange = valATotal != null && valBTotal != null ? valBTotal - valATotal : null;
    return { dateA, dateB, daysBetween, losses, gains, added, removed, biggestLoss, biggestGain, valATotal, valBTotal, valChange };
  }, [snapA, snapB, comparedProducts]);

  async function exportPdf() {
    if (!snapA || !snapB || !stats) return;
    setExporting('pdf');
    try {
      const rowsHtml = comparedProducts.map(p => {
        const color = p.status === 'LOSS' ? '#dc2626' : p.status === 'GAIN' ? '#059669' : p.isNew ? '#1d4ed8' : p.isRemoved ? '#9ca3af' : '#374151';
        return `<tr>
          <td>${p.name || ''}</td>
          <td style="text-align:right">${p.countA ?? '–'}</td>
          <td style="text-align:right">${p.countB ?? '–'}</td>
          <td style="text-align:right;color:${color}">${p.change != null ? (p.change > 0 ? '+' : '') + p.change : '–'}</td>
          <td style="text-align:right;font-weight:700;color:${color}">${p.status}</td>
        </tr>`;
      }).join('');

      const html = `<!DOCTYPE html><html><head><style>
body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px;}
h1{font-size:18px;margin:0 0 4px;}
.sub{color:#666;font-size:12px;margin-bottom:16px;}
table{width:100%;border-collapse:collapse;margin-top:12px;}
th{background:#0B132B;color:#fff;padding:6px 8px;text-align:left;font-size:11px;}
td{padding:5px 8px;border-bottom:1px solid #eee;}
.footer{margin-top:24px;font-size:10px;color:#9ca3af;text-align:center;}
</style></head><body>
<div style="background:#0B132B;color:#fff;padding:16px;border-radius:8px;margin-bottom:16px;">
  <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">HOSTI STOCK — CYCLE COMPARISON</div>
  <h1>Comparing ${snapA.departmentName} C${snapA.cycleNumber} vs ${snapB.departmentName} C${snapB.cycleNumber}</h1>
  <div class="sub" style="color:#94a3b8;">${stats.dateA ? fmtDate(stats.dateA) : ''} vs ${stats.dateB ? fmtDate(stats.dateB) : ''}${stats.daysBetween != null ? ' · ' + stats.daysBetween + ' days apart' : ''}</div>
</div>
<table>
  <tr><th>Product</th><th style="text-align:right">Cycle A</th><th style="text-align:right">Cycle B</th><th style="text-align:right">Change</th><th style="text-align:right">Status</th></tr>
  ${rowsHtml}
</table>
<div class="footer">Generated by Hosti · office@hosti.co.nz</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const isoDate = new Date().toISOString().slice(0, 10);
      const dest = (FileSystem.cacheDirectory ?? '') + `comparison-c${snapA.cycleNumber}-vs-c${snapB.cycleNumber}-${isoDate}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: dest }).catch(() => {});
      await Sharing.shareAsync(dest.startsWith('file') ? dest : uri, { mimeType: 'application/pdf', dialogTitle: 'Comparison PDF' });
    } catch (err: any) {
      Alert.alert('Export failed', err?.message ?? 'Could not generate PDF');
    } finally {
      setExporting(null);
    }
  }

  async function exportCsv() {
    if (!snapA || !snapB) return;
    setExporting('csv');
    try {
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const isoDate = new Date().toISOString().slice(0, 10);
      let csv = `Product Name,Cycle A (${snapA.cycleNumber}) Count,Cycle B (${snapB.cycleNumber}) Count,Change,Status,Value Change\n`;
      comparedProducts.forEach(p => {
        csv += [
          esc(p.name), p.countA ?? '', p.countB ?? '',
          p.change != null ? p.change : '', p.status,
          p.valChange != null ? p.valChange.toFixed(2) : '',
        ].join(',') + '\n';
      });
      const path = FileSystem.cacheDirectory + `comparison-c${snapA.cycleNumber}-vs-c${snapB.cycleNumber}-${isoDate}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Comparison CSV' });
    } catch (err: any) {
      Alert.alert('Export failed', err?.message ?? 'Could not generate CSV');
    } finally {
      setExporting(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centred}><ActivityIndicator color="#1b4f72" size="large" /></View>
      </SafeAreaView>
    );
  }

  if (!snapA || !snapB) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centred}><Text style={s.emptyTitle}>Could not load one or both cycles</Text></View>
      </SafeAreaView>
    );
  }

  const dateA: Date | null = snapA.completedAt?.toDate?.() ?? null;
  const dateB: Date | null = snapB.completedAt?.toDate?.() ?? null;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.heroCard}>
          <Text style={s.heroTitle}>Comparing stocktakes</Text>
          <Text style={s.heroSub}>
            {snapA.departmentName} — Cycle {snapA.cycleNumber}
            {dateA ? `  ·  ${fmtDate(dateA)}` : ''}
          </Text>
          <Text style={s.heroSub}>
            {snapB.departmentName} — Cycle {snapB.cycleNumber}
            {dateB ? `  ·  ${fmtDate(dateB)}` : ''}
          </Text>
          {stats?.daysBetween != null && (
            <Text style={s.heroMeta}>{stats.daysBetween} days between these stocktakes</Text>
          )}
        </View>

        {/* Summary comparison */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Summary</Text>
          {[
            ['Products counted', String(snapA.summary?.totalItemsCounted ?? '–'), String(snapB.summary?.totalItemsCounted ?? '–')],
            ['Stock value',
              snapA.summary?.totalStockValue != null ? `$${snapA.summary.totalStockValue.toFixed(0)}` : '–',
              snapB.summary?.totalStockValue != null ? `$${snapB.summary.totalStockValue.toFixed(0)}` : '–',
            ],
            ['Total variance qty', String(snapA.summary?.totalVarianceQty ?? '–'), String(snapB.summary?.totalVarianceQty ?? '–')],
          ].map(([label, valA, valB], i) => (
            <View key={i} style={[s.compareRow, i > 0 && s.compareRowBorder]}>
              <Text style={s.compareLabel}>{label}</Text>
              <Text style={s.compareA}>{valA}</Text>
              <Text style={s.compareB}>{valB}</Text>
              {stats?.valChange != null && label === 'Stock value' && (
                <Text style={[s.compareDiff, { color: stats.valChange < 0 ? '#dc2626' : '#059669' }]}>
                  {fmtVal(stats.valChange)}
                </Text>
              )}
            </View>
          ))}
        </View>

        {/* Search + filter */}
        <View style={s.card}>
          <TextInput
            style={s.searchInput}
            placeholder="Search products…"
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>
            {([
              ['all','All'],
              ['changed','Changed'],
              ['loss','Losses'],
              ['gain','Gains'],
              ['new','New'],
              ['removed','Removed'],
            ] as const).map(([val, label]) => (
              <TouchableOpacity key={val} onPress={() => setFilter(val)} style={[s.pill, filter === val && s.pillActive]}>
                <Text style={[s.pillText, filter === val && s.pillTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>
            {([['change','Biggest change'],['az','A–Z'],['value','Value']] as const).map(([val, label]) => (
              <TouchableOpacity key={val} onPress={() => setSort(val)} style={[s.pill, s.pillSmall, sort === val && s.pillActive]}>
                <Text style={[s.pillText, sort === val && s.pillTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Product rows */}
          {filteredProducts.map((p, i) => {
            const statusColors: Record<string, string> = {
              LOSS: '#dc2626', GAIN: '#059669', NEW: '#1d4ed8', REMOVED: '#9ca3af', SAME: '#6b7280',
            };
            const col = statusColors[p.status] || '#6b7280';
            return (
              <View key={p.name + i} style={[s.productRow, i > 0 && s.productRowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.productName}>{p.name}</Text>
                  {(p.areaA || p.areaB) && (
                    <Text style={s.productArea}>{p.areaA || p.areaB}</Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end', minWidth: 120 }}>
                  <Text style={s.productCounts}>
                    {p.countA ?? '–'} → {p.countB ?? '–'}
                  </Text>
                  {p.change != null && p.change !== 0 && (
                    <Text style={[s.productChange, { color: col }]}>
                      {p.change > 0 ? '+' : ''}{p.change}
                    </Text>
                  )}
                  <View style={[s.statusBadge, { backgroundColor: col + '20' }]}>
                    <Text style={[s.statusBadgeText, { color: col }]}>{p.status}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* Auto-generated text summary */}
        {stats && (
          <View style={[s.card, { backgroundColor: '#f8fafc' }]}>
            <Text style={s.sectionTitle}>Summary</Text>
            <Text style={s.summaryText}>
              {dateA && dateB ? `Between ${fmtDate(dateA)} and ${fmtDate(dateB)}:\n\n` : ''}
              {stats.losses.length} product{stats.losses.length !== 1 ? 's' : ''} decreased{'\n'}
              {stats.gains.length} product{stats.gains.length !== 1 ? 's' : ''} increased{'\n'}
              {stats.added.length} product{stats.added.length !== 1 ? 's' : ''} added{'\n'}
              {stats.removed.length} product{stats.removed.length !== 1 ? 's' : ''} removed
              {stats.biggestLoss ? `\n\nBiggest loss: ${stats.biggestLoss.name} ${stats.biggestLoss.change} units` : ''}
              {stats.biggestGain ? `\nBiggest gain: ${stats.biggestGain.name} +${stats.biggestGain.change} units` : ''}
              {stats.valChange != null ? `\n\nStock value changed by ${fmtVal(stats.valChange)}` : ''}
              {stats.daysBetween != null ? `\n${stats.daysBetween} days between these stocktakes.` : ''}
            </Text>
          </View>
        )}

        {/* Export */}
        <View style={s.exportRow}>
          <TouchableOpacity style={s.exportBtn} onPress={exportPdf} disabled={!!exporting}>
            {exporting === 'pdf'
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.exportBtnText}>Export comparison PDF</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[s.exportBtn, s.exportBtnOutline]} onPress={exportCsv} disabled={!!exporting}>
            {exporting === 'csv'
              ? <ActivityIndicator color="#1b4f72" size="small" />
              : <Text style={[s.exportBtnText, { color: '#1b4f72' }]}>CSV</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f3ee' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16 },
  heroCard: { backgroundColor: '#1b4f72', borderRadius: 14, padding: 20, marginBottom: 12 },
  heroTitle: { fontSize: 18, fontWeight: '900', color: '#fff', marginBottom: 6 },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  heroMeta: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  compareRowBorder: { borderTopWidth: 1, borderTopColor: '#f0ede8' },
  compareLabel: { flex: 1, fontSize: 13, color: '#374151' },
  compareA: { width: 64, textAlign: 'right', fontSize: 13, fontWeight: '600', color: '#0f172a' },
  compareB: { width: 64, textAlign: 'right', fontSize: 13, fontWeight: '600', color: '#0f172a' },
  compareDiff: { width: 64, textAlign: 'right', fontSize: 13, fontWeight: '700' },
  searchInput: { backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: '#111', borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 10 },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  pillSmall: { paddingHorizontal: 10, paddingVertical: 4 },
  pillActive: { backgroundColor: '#1b4f72', borderColor: '#1b4f72' },
  pillText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  pillTextActive: { color: '#fff' },
  productRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  productRowBorder: { borderTopWidth: 1, borderTopColor: '#f0ede8' },
  productName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  productArea: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  productCounts: { fontSize: 13, color: '#374151', fontWeight: '600' },
  productChange: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  statusBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3 },
  statusBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  summaryText: { fontSize: 14, color: '#374151', lineHeight: 22 },
  exportRow: { flexDirection: 'row', gap: 10 },
  exportBtn: { flex: 1, backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  exportBtnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#1b4f72', flex: 0, paddingHorizontal: 20 },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#374151' },
});
