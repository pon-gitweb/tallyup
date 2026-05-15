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
  departmentId: string;
  snapshotId: string;
};

type SortMode = 'az' | 'var_asc' | 'var_desc' | 'value' | 'area';

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function fmtVal(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}
function fmtDuration(mins: number): string {
  if (!mins) return '–';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function StocktakeCycleDetailScreen() {
  const route = useRoute<any>();
  const { venueId, departmentId, snapshotId } = route.params as RouteParams;

  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('area');
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);

  useEffect(() => {
    load();
  }, [venueId, departmentId, snapshotId]);

  async function load() {
    setLoading(true);
    try {
      const snapRef = doc(db, 'venues', venueId, 'departments', departmentId, 'snapshots', snapshotId);
      const snapDoc = await getDoc(snapRef);
      if (snapDoc.exists()) setSnapshot(snapDoc.data());
    } catch (e: any) {
      console.error('[CycleDetail] load error', e?.message);
    } finally {
      setLoading(false);
    }
  }

  const completedAt: Date | null = useMemo(
    () => snapshot?.completedAt?.toDate?.() ?? null,
    [snapshot],
  );

  const items: any[] = useMemo(() => snapshot?.items ?? [], [snapshot]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.areaName || '').toLowerCase().includes(q) ||
        (i.categoryName || '').toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => {
      if (sort === 'az') return (a.name || '').localeCompare(b.name || '');
      if (sort === 'var_asc') return a.totalVarianceQty - b.totalVarianceQty;
      if (sort === 'var_desc') return b.totalVarianceQty - a.totalVarianceQty;
      if (sort === 'value') return (Math.abs(b.totalVarianceDollars ?? 0)) - (Math.abs(a.totalVarianceDollars ?? 0));
      if (sort === 'area') return (a.areaName || '').localeCompare(b.areaName || '');
      return 0;
    });
  }, [items, search, sort]);

  const topLosses = useMemo(() =>
    [...items].filter(i => i.totalVarianceQty < 0).sort((a, b) => a.totalVarianceQty - b.totalVarianceQty).slice(0, 5),
    [items],
  );
  const topGains = useMemo(() =>
    [...items].filter(i => i.totalVarianceQty > 0).sort((a, b) => b.totalVarianceQty - a.totalVarianceQty).slice(0, 5),
    [items],
  );

  async function exportPdf() {
    if (!snapshot) return;
    setExporting('pdf');
    try {
      const dateStr = completedAt ? fmtDate(completedAt) + ' ' + fmtTime(completedAt) : '–';
      const rowsHtml = items.map(it => `
        <tr>
          <td>${it.name || ''}</td>
          <td>${it.areaName || ''}</td>
          <td style="text-align:right">${it.openingCount ?? '–'}</td>
          <td style="text-align:right">${it.actualClosing}</td>
          <td style="text-align:right;color:${it.totalVarianceQty < 0 ? '#dc2626' : it.totalVarianceQty > 0 ? '#059669' : '#374151'}">${it.totalVarianceQty > 0 ? '+' : ''}${it.totalVarianceQty}</td>
          <td style="text-align:right">${it.totalVarianceDollars != null ? (it.totalVarianceDollars < 0 ? '-' : '+') + '$' + Math.abs(it.totalVarianceDollars).toFixed(0) : '–'}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html><html><head><style>
body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px;}
h1{font-size:18px;margin:0 0 2px;}
.sub{color:#666;font-size:12px;margin-bottom:16px;}
table{width:100%;border-collapse:collapse;margin-top:12px;}
th{background:#0B132B;color:#fff;padding:6px 8px;text-align:left;font-size:11px;}
td{padding:5px 8px;border-bottom:1px solid #eee;}
.footer{margin-top:24px;font-size:10px;color:#9ca3af;text-align:center;}
</style></head><body>
<div style="background:#0B132B;color:#fff;padding:16px;border-radius:8px;margin-bottom:16px;">
  <div style="font-size:10px;color:#64748b;letter-spacing:1px;text-transform:uppercase;">HOSTI STOCK — STOCKTAKE RECORD</div>
  <h1>${snapshot.departmentName} — Cycle ${snapshot.cycleNumber}</h1>
  <div class="sub" style="color:#94a3b8;">Completed: ${dateStr}${snapshot.completedByName ? ' · By: ' + snapshot.completedByName : ''}${snapshot.durationMinutes ? ' · Duration: ' + fmtDuration(snapshot.durationMinutes) : ''}</div>
</div>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:16px;">
  <strong>Summary</strong><br/>
  Products: ${snapshot.summary?.totalItemsCounted ?? items.length}${snapshot.summary?.totalStockValue != null ? ' · Stock value: ' + fmtVal(snapshot.summary.totalStockValue) : ''}${snapshot.summary?.totalVarianceDollars != null ? ' · Variance: ' + fmtVal(snapshot.summary.totalVarianceDollars) : ''}
</div>
<table>
  <tr><th>Product</th><th>Area</th><th style="text-align:right">Prev</th><th style="text-align:right">Count</th><th style="text-align:right">Var</th><th style="text-align:right">Value</th></tr>
  ${rowsHtml}
</table>
<div class="footer">Generated by Hosti · office@hosti.co.nz</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const safeDept = (snapshot.departmentName || 'dept').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      const isoDate = completedAt?.toISOString().slice(0, 10) ?? 'unknown';
      const dest = (FileSystem.cacheDirectory ?? '') + `${safeDept}-cycle${snapshot.cycleNumber}-${isoDate}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: dest }).catch(() => {});
      await Sharing.shareAsync(dest.startsWith('file') ? dest : uri, { mimeType: 'application/pdf', dialogTitle: `Cycle ${snapshot.cycleNumber}` });
    } catch (err: any) {
      Alert.alert('Export failed', err?.message ?? 'Could not generate PDF');
    } finally {
      setExporting(null);
    }
  }

  async function exportCsv() {
    if (!snapshot) return;
    setExporting('csv');
    try {
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const isoDate = completedAt?.toISOString().slice(0, 10) ?? 'unknown';
      let csv = 'Product Name,Category,Area,Previous Count,Current Count,Variance Qty,Cost Price,Variance Value,Counted By,Counted At,Cycle Number,Cycle Date,Department\n';
      items.forEach(it => {
        const countedAt = it.lastCountAt?.toDate?.()?.toISOString?.() ?? '';
        csv += [
          esc(it.name), esc(it.categoryName), esc(it.areaName),
          it.openingCount ?? '', it.actualClosing, it.totalVarianceQty,
          it.costPrice ?? '', it.totalVarianceDollars != null ? it.totalVarianceDollars.toFixed(2) : '',
          esc(it.lastCountByName), esc(countedAt),
          snapshot.cycleNumber, isoDate, esc(snapshot.departmentName),
        ].join(',') + '\n';
      });
      const safeDept = (snapshot.departmentName || 'dept').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      const path = FileSystem.cacheDirectory + `${safeDept}-cycle${snapshot.cycleNumber}-${isoDate}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: `Cycle ${snapshot.cycleNumber} CSV` });
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

  if (!snapshot) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centred}><Text style={s.emptyTitle}>Cycle data not found</Text></View>
      </SafeAreaView>
    );
  }

  const sum = snapshot.summary || {};

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header card */}
        <View style={s.heroCard}>
          <Text style={s.heroDept}>{snapshot.departmentName} — Cycle {snapshot.cycleNumber}</Text>
          {completedAt && (
            <Text style={s.heroDate}>{fmtDate(completedAt)} · {fmtTime(completedAt)}</Text>
          )}
          <Text style={s.heroMeta}>
            {fmtDuration(snapshot.durationMinutes)}
            {snapshot.completedByName ? ` · Completed by ${snapshot.completedByName}` : ''}
          </Text>
        </View>

        {/* Summary card */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Summary</Text>
          {[
            ['Products counted', String(sum.totalItemsCounted ?? items.length)],
            ['Stock value', sum.totalStockValue != null ? fmtVal(sum.totalStockValue) : 'No prices set'],
            ['Total variance', sum.totalVarianceQty != null ? `${sum.totalVarianceQty > 0 ? '+' : ''}${sum.totalVarianceQty} units` : '–'],
            ['Dollar variance', sum.totalVarianceDollars != null ? fmtVal(sum.totalVarianceDollars) : 'No prices set'],
            ['Data tier', `Tier ${snapshot.dataCompleteness?.tier ?? 1} of 4`],
          ].map(([label, value], i) => (
            <View key={i} style={[s.statRow, i > 0 && s.statRowBorder]}>
              <Text style={s.statLabel}>{label}</Text>
              <Text style={s.statValue}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Top losses / gains side by side */}
        {(topLosses.length > 0 || topGains.length > 0) && (
          <View style={s.splitRow}>
            {topLosses.length > 0 && (
              <View style={[s.card, { flex: 1 }]}>
                <Text style={s.sectionTitle}>Top Losses</Text>
                {topLosses.map((it, i) => (
                  <View key={i} style={[s.varRow, i > 0 && s.varRowBorder]}>
                    <Text style={s.varName} numberOfLines={1}>{it.name}</Text>
                    <Text style={s.varNeg}>{it.totalVarianceQty}</Text>
                    {it.totalVarianceDollars != null && (
                      <Text style={s.varDollar}>–{fmtVal(Math.abs(it.totalVarianceDollars))}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
            {topGains.length > 0 && (
              <View style={[s.card, { flex: 1 }]}>
                <Text style={s.sectionTitle}>Top Gains</Text>
                {topGains.map((it, i) => (
                  <View key={i} style={[s.varRow, i > 0 && s.varRowBorder]}>
                    <Text style={s.varName} numberOfLines={1}>{it.name}</Text>
                    <Text style={s.varPos}>+{it.totalVarianceQty}</Text>
                    {it.likelyMissingInvoice && <Text style={{ fontSize: 10, color: '#f59e0b' }}>⚠</Text>}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Findings */}
        {(snapshot.findings?.likelyMissingInvoices?.length > 0 || snapshot.findings?.poDiscrepancies?.length > 0) && (
          <View style={[s.card, { borderColor: '#fde68a', backgroundColor: '#fffbeb' }]}>
            <Text style={[s.sectionTitle, { color: '#92400e' }]}>⚠ Findings</Text>
            {(snapshot.findings.likelyMissingInvoices || []).map((f: any, i: number) => (
              <Text key={i} style={{ fontSize: 13, color: '#78350f', marginTop: 4 }}>
                {f.productName}: +{f.unexplainedGainQty} units — no invoice recorded
              </Text>
            ))}
            {(snapshot.findings.poDiscrepancies || []).map((f: any, i: number) => (
              <Text key={`po${i}`} style={{ fontSize: 13, color: '#7f1d1d', marginTop: 4 }}>
                {f.productName}: ordered {f.orderedQty}, received {f.receivedQty}
              </Text>
            ))}
          </View>
        )}

        {/* Product list */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>All Products ({items.length})</Text>

          {/* Search */}
          <TextInput
            style={s.searchInput}
            placeholder="Search products…"
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />

          {/* Sort pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>
            {([['area','Area'],['az','A–Z'],['var_asc','Loss ↑'],['var_desc','Gain ↑'],['value','Value']] as const).map(([val, label]) => (
              <TouchableOpacity key={val} onPress={() => setSort(val)} style={[s.sortPill, sort === val && s.sortPillActive]}>
                <Text style={[s.sortPillText, sort === val && s.sortPillTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {filteredItems.map((it, i) => {
            const countedAtDate: Date | null = it.lastCountAt?.toDate?.() ?? null;
            const varColor = it.totalVarianceQty < 0 ? '#dc2626' : it.totalVarianceQty > 0 ? '#059669' : '#6b7280';
            return (
              <View key={it.productId || i} style={[s.itemRow, i > 0 && s.itemRowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemName}>{it.name}</Text>
                  <Text style={s.itemSub}>
                    {it.areaName}{it.categoryName ? ` · ${it.categoryName}` : ''}
                  </Text>
                  {it.lastCountByName && (
                    <Text style={s.itemCountBy}>
                      Counted by {it.lastCountByName}
                      {countedAtDate ? ` at ${countedAtDate.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.itemCounts}>
                    {it.openingCount ?? '–'} → {it.actualClosing}
                  </Text>
                  <Text style={[s.itemVariance, { color: varColor }]}>
                    {it.totalVarianceQty > 0 ? '+' : ''}{it.totalVarianceQty}
                  </Text>
                  {it.totalVarianceDollars != null && it.totalVarianceDollars !== 0 && (
                    <Text style={[s.itemDollar, { color: varColor }]}>
                      {it.totalVarianceDollars < 0 ? '-' : '+'}${Math.abs(it.totalVarianceDollars).toFixed(0)}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Export buttons */}
        <View style={s.exportRow}>
          <TouchableOpacity style={s.exportBtn} onPress={exportPdf} disabled={!!exporting}>
            {exporting === 'pdf'
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.exportBtnText}>Export PDF</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[s.exportBtn, s.exportBtnOutline]} onPress={exportCsv} disabled={!!exporting}>
            {exporting === 'csv'
              ? <ActivityIndicator color="#1b4f72" size="small" />
              : <Text style={[s.exportBtnText, { color: '#1b4f72' }]}>Export CSV</Text>}
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
  heroCard: { backgroundColor: '#065f46', borderRadius: 14, padding: 20, marginBottom: 12 },
  heroDept: { fontSize: 20, fontWeight: '900', color: '#fff' },
  heroDate: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  heroMeta: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  statRowBorder: { borderTopWidth: 1, borderTopColor: '#f0ede8' },
  statLabel: { fontSize: 14, color: '#374151' },
  statValue: { fontSize: 14, color: '#065f46', fontWeight: '800' },
  splitRow: { flexDirection: 'row', gap: 10, marginBottom: 0 },
  varRow: { paddingVertical: 6 },
  varRowBorder: { borderTopWidth: 1, borderTopColor: '#f0ede8' },
  varName: { fontSize: 13, color: '#0f172a', fontWeight: '600', flex: 1 },
  varNeg: { fontSize: 13, color: '#dc2626', fontWeight: '700' },
  varPos: { fontSize: 13, color: '#059669', fontWeight: '700' },
  varDollar: { fontSize: 11, color: '#dc2626', marginTop: 1 },
  searchInput: { backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: '#111', borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 10 },
  sortPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  sortPillActive: { backgroundColor: '#1b4f72', borderColor: '#1b4f72' },
  sortPillText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  sortPillTextActive: { color: '#fff' },
  itemRow: { paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  itemRowBorder: { borderTopWidth: 1, borderTopColor: '#f0ede8' },
  itemName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  itemSub: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  itemCountBy: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  itemCounts: { fontSize: 13, color: '#374151', fontWeight: '600' },
  itemVariance: { fontSize: 14, fontWeight: '700', marginTop: 2 },
  itemDollar: { fontSize: 11, marginTop: 1 },
  exportRow: { flexDirection: 'row', gap: 10 },
  exportBtn: { flex: 1, backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  exportBtnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#1b4f72' },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#374151' },
});
