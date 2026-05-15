// @ts-nocheck
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, SafeAreaView, StyleSheet, Alert, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type SnapshotEntry = {
  id: string;           // 'cycle-4'
  deptId: string;
  departmentName: string;
  cycleNumber: number;
  completedAt: Date;
  durationMinutes: number;
  completedByName: string | null;
  totalItems: number;
  totalStockValue: number | null;
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true });
}
function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' }).toUpperCase();
}
function fmtVal(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}
function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function StocktakeHistoryScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<SnapshotEntry[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<string | null>(null);  // null = all
  const [timeFilter, setTimeFilter] = useState<'all' | 'month' | '3months' | 'year'>('all');
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);   // "deptId|snapshotId"
  const [exporting, setExporting] = useState<string | null>(null);  // snapshotId being exported

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    load();
  }, [venueId]);

  async function load() {
    setLoading(true);
    try {
      const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      const depts: { id: string; name: string }[] = deptsSnap.docs.map(d => ({
        id: d.id,
        name: (d.data() as any).name || d.id,
      }));
      setDepartments(depts);

      const allEntries: SnapshotEntry[] = [];
      await Promise.all(deptsSnap.docs.map(async deptDoc => {
        try {
          const snapsSnap = await getDocs(
            query(
              collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
              orderBy('completedAt', 'desc'),
              limit(50),
            ),
          );
          snapsSnap.forEach(snapDoc => {
            const d = snapDoc.data() as any;
            const completedAtDate: Date | null = d.completedAt?.toDate?.() ?? null;
            if (!completedAtDate) return;
            allEntries.push({
              id: snapDoc.id,
              deptId: deptDoc.id,
              departmentName: d.departmentName || (deptDoc.data() as any).name || deptDoc.id,
              cycleNumber: d.cycleNumber ?? 0,
              completedAt: completedAtDate,
              durationMinutes: d.durationMinutes ?? 0,
              completedByName: d.completedByName || null,
              totalItems: d.summary?.totalItemsCounted ?? 0,
              totalStockValue: d.summary?.totalStockValue ?? null,
            });
          });
        } catch {}
      }));

      allEntries.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
      setEntries(allEntries);
    } catch (e: any) {
      console.error('[StocktakeHistory] load error', e?.message);
    } finally {
      setLoading(false);
    }
  }

  const now = useMemo(() => Date.now(), []);
  const filtered = useMemo(() => {
    let result = entries;

    if (deptFilter) result = result.filter(e => e.deptId === deptFilter);

    if (timeFilter === 'month') {
      const cutoff = now - 30 * 24 * 60 * 60 * 1000;
      result = result.filter(e => e.completedAt.getTime() >= cutoff);
    } else if (timeFilter === '3months') {
      const cutoff = now - 90 * 24 * 60 * 60 * 1000;
      result = result.filter(e => e.completedAt.getTime() >= cutoff);
    } else if (timeFilter === 'year') {
      const cutoff = now - 365 * 24 * 60 * 60 * 1000;
      result = result.filter(e => e.completedAt.getTime() >= cutoff);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(e =>
        e.departmentName.toLowerCase().includes(q) ||
        fmtDate(e.completedAt).toLowerCase().includes(q) ||
        String(e.cycleNumber).includes(q),
      );
    }

    return result;
  }, [entries, deptFilter, timeFilter, search, now]);

  // Group by month
  const grouped = useMemo(() => {
    const map: Record<string, SnapshotEntry[]> = {};
    filtered.forEach(e => {
      const key = fmtMonthYear(e.completedAt);
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    return Object.entries(map);
  }, [filtered]);

  function toggleCompareSelect(e: SnapshotEntry) {
    const key = `${e.deptId}|${e.id}`;
    setSelectedIds(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= 2) return prev;
      return [...prev, key];
    });
  }

  function navigateCompare() {
    if (selectedIds.length !== 2) return;
    const [a, b] = selectedIds.map(k => {
      const [deptId, snapshotId] = k.split('|');
      return { deptId, snapshotId };
    });
    nav.navigate('CycleComparison', {
      venueId,
      deptIdA: a.deptId,
      snapshotIdA: a.snapshotId,
      deptIdB: b.deptId,
      snapshotIdB: b.snapshotId,
    });
    setCompareMode(false);
    setSelectedIds([]);
  }

  async function handleExportPdf(e: SnapshotEntry) {
    const exportKey = `${e.deptId}|${e.id}|pdf`;
    setExporting(exportKey);
    try {
      // Load snapshot items for this cycle
      const { doc: _doc, getDoc: _getDoc } = await import('firebase/firestore');
      const snapRef = _doc(db, 'venues', venueId, 'departments', e.deptId, 'snapshots', e.id);
      const snapDoc = await _getDoc(snapRef);
      const snapData = snapDoc.exists() ? (snapDoc.data() as any) : {};
      const items: any[] = snapData.items || [];

      const dateStr = fmtDate(e.completedAt) + ' ' + fmtTime(e.completedAt);
      const safeDept = e.departmentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      const isoDate = e.completedAt.toISOString().slice(0, 10);
      const filename = `${safeDept}-cycle${e.cycleNumber}-${isoDate}.pdf`;

      const rowsHtml = items.map(it => `
        <tr>
          <td>${it.name || ''}</td>
          <td>${it.areaName || ''}</td>
          <td style="text-align:right">${it.openingCount ?? '–'}</td>
          <td style="text-align:right">${it.actualClosing}</td>
          <td style="text-align:right;color:${it.totalVarianceQty < 0 ? '#dc2626' : it.totalVarianceQty > 0 ? '#059669' : '#374151'}">${it.totalVarianceQty > 0 ? '+' : ''}${it.totalVarianceQty}</td>
          <td style="text-align:right">${it.totalVarianceDollars != null ? (it.totalVarianceDollars < 0 ? '-' : '+') + '$' + Math.abs(it.totalVarianceDollars).toFixed(0) : '–'}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html><head><style>
body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 24px; }
h1 { font-size: 18px; margin: 0 0 2px; }
.sub { color: #666; font-size: 12px; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th { background: #0B132B; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; }
td { padding: 5px 8px; border-bottom: 1px solid #eee; }
.footer { margin-top: 24px; font-size: 10px; color: #9ca3af; text-align: center; }
</style></head><body>
<div style="background:#0B132B;color:#fff;padding:16px;border-radius:8px;margin-bottom:16px;">
  <div style="font-size:10px;color:#64748b;letter-spacing:1px;text-transform:uppercase;">HOSTI STOCK — STOCKTAKE RECORD</div>
  <h1>${e.departmentName} — Cycle ${e.cycleNumber}</h1>
  <div class="sub" style="color:#94a3b8;">Completed: ${dateStr}${e.completedByName ? ' · By: ' + e.completedByName : ''}${e.durationMinutes ? ' · Duration: ' + fmtDuration(e.durationMinutes) : ''}</div>
</div>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:16px;">
  <strong>Summary</strong><br/>
  Products counted: ${e.totalItems}${e.totalStockValue != null ? ' · Stock value: ' + fmtVal(e.totalStockValue) : ''}
</div>
<table>
  <tr><th>Product</th><th>Area</th><th style="text-align:right">Prev</th><th style="text-align:right">Count</th><th style="text-align:right">Var</th><th style="text-align:right">Value</th></tr>
  ${rowsHtml}
</table>
<div class="footer">Generated by Hosti · office@hosti.co.nz</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const dest = (FileSystem.cacheDirectory ?? '') + filename;
      await FileSystem.moveAsync({ from: uri, to: dest }).catch(() => {});
      await Sharing.shareAsync(dest.startsWith('file') ? dest : uri, {
        mimeType: 'application/pdf',
        dialogTitle: `${e.departmentName} Cycle ${e.cycleNumber}`,
      });
    } catch (err: any) {
      Alert.alert('Export failed', err?.message ?? 'Could not generate PDF');
    } finally {
      setExporting(null);
    }
  }

  async function handleExportCsv(e: SnapshotEntry) {
    const exportKey = `${e.deptId}|${e.id}|csv`;
    setExporting(exportKey);
    try {
      const { doc: _doc, getDoc: _getDoc } = await import('firebase/firestore');
      const snapRef = _doc(db, 'venues', venueId, 'departments', e.deptId, 'snapshots', e.id);
      const snapDoc = await _getDoc(snapRef);
      const items: any[] = snapDoc.exists() ? (snapDoc.data() as any).items ?? [] : [];

      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const dateStr = e.completedAt.toISOString().slice(0, 10);
      let csv = 'Product Name,Category,Area,Previous Count,Current Count,Variance Qty,Cost Price,Variance Value,Counted By,Counted At,Cycle Number,Cycle Date,Department\n';
      items.forEach(it => {
        const countedAt = it.lastCountAt?.toDate?.()?.toISOString?.() ?? '';
        csv += [
          esc(it.name), esc(it.categoryName), esc(it.areaName),
          it.openingCount ?? '', it.actualClosing, it.totalVarianceQty,
          it.costPrice ?? '', it.totalVarianceDollars != null ? it.totalVarianceDollars.toFixed(2) : '',
          esc(it.lastCountByName), esc(countedAt),
          e.cycleNumber, dateStr, esc(e.departmentName),
        ].join(',') + '\n';
      });

      const safeDept = e.departmentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      const path = FileSystem.cacheDirectory + `${safeDept}-cycle${e.cycleNumber}-${dateStr}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: `${e.departmentName} Cycle ${e.cycleNumber}` });
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

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Stocktake History</Text>
          <Text style={s.subtitle}>{entries.length} cycle{entries.length !== 1 ? 's' : ''} recorded</Text>
        </View>
        <TouchableOpacity
          style={[s.compareBtn, compareMode && s.compareBtnActive]}
          onPress={() => { setCompareMode(v => !v); setSelectedIds([]); }}
        >
          <Text style={[s.compareBtnText, compareMode && s.compareBtnTextActive]}>
            {compareMode ? 'Cancel' : '⚖️ Compare'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder="Search by department or date…"
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Department filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillScroll} contentContainerStyle={s.pillRow}>
        {[null, ...departments.map(d => d.id)].map(deptId => {
          const label = deptId ? (departments.find(d => d.id === deptId)?.name ?? deptId) : 'All';
          const active = deptFilter === deptId;
          return (
            <TouchableOpacity key={deptId ?? '__all'} onPress={() => setDeptFilter(deptId)} style={[s.pill, active && s.pillActive]}>
              <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
        {/* Time filter pills */}
        {([['all','All time'],['month','This month'],['3months','3 months'],['year','This year']] as const).map(([val, label]) => {
          const active = timeFilter === val;
          return (
            <TouchableOpacity key={val} onPress={() => setTimeFilter(val)} style={[s.pill, active && s.pillActive]}>
              <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Compare action bar */}
      {compareMode && (
        <View style={s.compareBar}>
          <Text style={s.compareBarText}>
            {selectedIds.length === 0 ? 'Select 2 cycles to compare' : selectedIds.length === 1 ? 'Select 1 more' : 'Ready to compare'}
          </Text>
          {selectedIds.length === 2 && (
            <TouchableOpacity style={s.compareGoBtn} onPress={navigateCompare}>
              <Text style={s.compareGoBtnText}>Compare selected (2)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView contentContainerStyle={s.scroll}>
        {grouped.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>No stocktakes recorded yet</Text>
            <Text style={s.emptyBody}>Complete a stocktake and it will appear here.</Text>
          </View>
        ) : (
          grouped.map(([monthYear, monthEntries]) => (
            <View key={monthYear}>
              <Text style={s.monthHeader}>{monthYear}</Text>
              {monthEntries.map(entry => {
                const key = `${entry.deptId}|${entry.id}`;
                const isSelected = selectedIds.includes(key);
                const pdfKey = `${entry.deptId}|${entry.id}|pdf`;
                const csvKey = `${entry.deptId}|${entry.id}|csv`;
                return (
                  <View key={key} style={[s.card, isSelected && s.cardSelected]}>
                    {compareMode && (
                      <TouchableOpacity style={s.checkbox} onPress={() => toggleCompareSelect(entry)}>
                        <View style={[s.checkboxBox, isSelected && s.checkboxBoxChecked]}>
                          {isSelected && <Text style={s.checkmark}>✓</Text>}
                        </View>
                      </TouchableOpacity>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardDept}>{entry.departmentName} — Cycle {entry.cycleNumber}</Text>
                      <Text style={s.cardDate}>{fmtDate(entry.completedAt)} · {fmtTime(entry.completedAt)}</Text>
                      <Text style={s.cardMeta}>
                        {entry.totalItems} product{entry.totalItems !== 1 ? 's' : ''}
                        {entry.totalStockValue != null ? ` · ${fmtVal(entry.totalStockValue)} value` : ''}
                        {entry.durationMinutes ? ` · ${fmtDuration(entry.durationMinutes)}` : ''}
                        {entry.completedByName ? ` · ${entry.completedByName}` : ''}
                      </Text>
                      <View style={s.cardActions}>
                        <TouchableOpacity
                          style={s.actionBtn}
                          onPress={() => nav.navigate('StocktakeCycleDetail', { venueId, departmentId: entry.deptId, snapshotId: entry.id })}
                        >
                          <Text style={s.actionBtnText}>View details</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.actionBtn, s.actionBtnOutline]}
                          onPress={() => handleExportPdf(entry)}
                          disabled={!!exporting}
                        >
                          {exporting === pdfKey
                            ? <ActivityIndicator size="small" color="#1b4f72" />
                            : <Text style={[s.actionBtnText, s.actionBtnOutlineText]}>PDF</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.actionBtn, s.actionBtnOutline]}
                          onPress={() => handleExportCsv(entry)}
                          disabled={!!exporting}
                        >
                          {exporting === csvKey
                            ? <ActivityIndicator size="small" color="#1b4f72" />
                            : <Text style={[s.actionBtnText, s.actionBtnOutlineText]}>CSV</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f3ee' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  compareBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#1b4f72', backgroundColor: '#fff', marginTop: 2 },
  compareBtnActive: { backgroundColor: '#1b4f72' },
  compareBtnText: { fontSize: 13, fontWeight: '700', color: '#1b4f72' },
  compareBtnTextActive: { color: '#fff' },
  searchRow: { paddingHorizontal: 16, paddingBottom: 6 },
  searchInput: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111', borderWidth: 1, borderColor: '#e5e1d8' },
  pillScroll: { maxHeight: 44 },
  pillRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e1d8' },
  pillActive: { backgroundColor: '#1b4f72', borderColor: '#1b4f72' },
  pillText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  pillTextActive: { color: '#fff' },
  compareBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#eff6ff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#bfdbfe' },
  compareBarText: { fontSize: 13, color: '#1e40af', fontWeight: '600' },
  compareGoBtn: { backgroundColor: '#1b4f72', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  compareGoBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  scroll: { padding: 16 },
  monthHeader: { fontSize: 11, fontWeight: '800', color: '#6b7280', letterSpacing: 1, marginTop: 8, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e5e1d8', paddingBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8', flexDirection: 'row' },
  cardSelected: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  checkbox: { justifyContent: 'center', paddingRight: 12 },
  checkboxBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  checkboxBoxChecked: { backgroundColor: '#1b4f72', borderColor: '#1b4f72' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '900' },
  cardDept: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  cardDate: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  cardMeta: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { backgroundColor: '#1b4f72', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, minWidth: 44, alignItems: 'center' },
  actionBtnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e1d8' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  actionBtnOutlineText: { color: '#374151' },
  emptyBox: { padding: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#374151', marginBottom: 8 },
  emptyBody: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 20 },
});
