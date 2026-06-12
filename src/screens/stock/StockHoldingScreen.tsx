// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVenueId } from '../../context/VenueProvider';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import OfflineBanner from '../../components/OfflineBanner';
import { useNetworkState } from '../../hooks/useNetworkState';
import { db } from '../../services/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const SORT_KEY = 'tallyup_stock_holding_sort_v1';

type HoldingRow = {
  name: string;
  category: string;
  count: number;
  unit?: string;
  costPrice?: number;
  value?: number;
};

type CategoryGroup = {
  category: string;
  rows: HoldingRow[];
  totalCount: number;
  totalValue?: number;
  hasValue: boolean;
};

function buildGroups(rows: HoldingRow[], sortAZ: boolean): CategoryGroup[] {
  const map: Record<string, HoldingRow[]> = {};
  for (const r of rows) {
    const cat = r.category || 'Uncategorised';
    if (!map[cat]) map[cat] = [];
    map[cat].push(r);
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => {
      const sorted = sortAZ
        ? [...items].sort((a, b) => a.name.localeCompare(b.name))
        : items;
      const hasValue = sorted.some(r => r.value != null);
      const totalCount = sorted.reduce((s, r) => s + r.count, 0);
      const totalValue = hasValue
        ? sorted.reduce((s, r) => s + (r.value ?? 0), 0)
        : undefined;
      return { category, rows: sorted, totalCount, totalValue, hasValue };
    });
}

function fmtVal(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
}

export default function StockHoldingScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const s = styles(c);

  const { isOnline } = useNetworkState();
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [allRows, setAllRows] = useState<HoldingRow[]>([]);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [sortAZ, setSortAZ] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [grandCount, setGrandCount] = useState(0);
  const [grandValue, setGrandValue] = useState<number | null>(null);
  const [venueName, setVenueName] = useState('');
  const [showingPriorCycle, setShowingPriorCycle] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SORT_KEY)
      .then(v => { if (v === '1') setSortAZ(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) { setLoadingTimeout(false); return; }
    const t = setTimeout(() => setLoadingTimeout(true), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    load();
  }, [venueId]);

  useEffect(() => {
    const g = buildGroups(allRows, sortAZ);
    setGroups(g);
  }, [allRows, sortAZ]);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      // Venue name for export headers
      const venueSnap = await getDoc(doc(db, 'venues', venueId));
      setVenueName(venueSnap.data()?.name ?? '');

      // Products → category + costPrice by name key
      const prodSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const prodByName: Record<string, { category: string; costPrice?: number }> = {};
      prodSnap.forEach(d => {
        const p = d.data() as any;
        const key = (p.name ?? '').toLowerCase().trim();
        if (key) {
          prodByName[key] = {
            category: p.category ?? p.categorySuggested ?? 'Uncategorised',
            costPrice: typeof p.costPrice === 'number' ? p.costPrice : undefined,
          };
        }
      });

      // Aggregate counts from all area items — completedAt not required
      // After a reset, lastCount is restored from confirmedCount so data still exists
      const rowMap: Record<string, HoldingRow> = {};
      let hasAnyIncomplete = false;
      const deptSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));

      await Promise.all(deptSnap.docs.map(async deptDoc => {
        const areaSnap = await getDocs(
          collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas')
        );
        await Promise.all(areaSnap.docs.map(async areaDoc => {
          const areaData = areaDoc.data() as any;
          if (!areaData.completedAt) hasAnyIncomplete = true;
          const itemSnap = await getDocs(
            collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas', areaDoc.id, 'items')
          );
          itemSnap.forEach(itemDoc => {
            const item = itemDoc.data() as any;
            if (typeof item.lastCount !== 'number' || item.lastCount <= 0) return;
            const nameRaw = (item.name ?? '').trim();
            if (!nameRaw) return;
            const key = nameRaw.toLowerCase();
            const prod = prodByName[key];
            const category = item.category ?? item.categorySuggested ?? prod?.category ?? 'Uncategorised';
            const costPrice = typeof item.costPrice === 'number' ? item.costPrice : prod?.costPrice;
            if (rowMap[key]) {
              rowMap[key].count += item.lastCount;
              if (costPrice != null) {
                rowMap[key].costPrice = costPrice;
                rowMap[key].value = rowMap[key].count * costPrice;
              }
            } else {
              rowMap[key] = {
                name: nameRaw,
                category,
                count: item.lastCount,
                unit: item.unit,
                costPrice,
                value: costPrice != null ? item.lastCount * costPrice : undefined,
              };
            }
          });
        }));
      }));

      const rows = Object.values(rowMap);
      setAllRows(rows);
      setShowingPriorCycle(hasAnyIncomplete && rows.length > 0);
      setGrandCount(rows.reduce((s, r) => s + r.count, 0));
      const totalVal = rows.reduce((s, r) => s + (r.value ?? 0), 0);
      setGrandValue(rows.some(r => r.value != null) ? totalVal : null);
    } catch (e: any) {
      console.error('[StockHolding] load error', e?.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggleSort() {
    const next = !sortAZ;
    setSortAZ(next);
    AsyncStorage.setItem(SORT_KEY, next ? '1' : '0').catch(() => {});
  }

  // ── PDF export ────────────────────────────────────────────────────────────

  async function exportPdf() {
    setExporting(true);
    try {
      const dateStr = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
      let html = `
        <html><head><style>
          body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 24px; }
          h1 { font-size: 18px; margin-bottom: 2px; }
          .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #0B132B; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; }
          td { padding: 5px 8px; border-bottom: 1px solid #eee; }
          .cat { font-weight: bold; font-size: 12px; padding: 8px 0 2px; color: #0B132B; }
          .subtotal td { background: #f5f5f5; font-weight: bold; }
          .grand td { background: #0B132B; color: #fff; font-weight: bold; }
          .right { text-align: right; }
        </style></head><body>
        <h1>Stock Holding Report</h1>
        <div class="sub">${venueName ? venueName + ' · ' : ''}${dateStr}</div>
        <table>
          <tr><th>Product</th><th class="right">Count</th><th class="right">Unit</th><th class="right">Cost Price</th><th class="right">Value</th></tr>`;

      for (const g of groups) {
        html += `<tr><td colspan="5" class="cat">${g.category}</td></tr>`;
        for (const r of g.rows) {
          html += `<tr>
            <td>${r.name}</td>
            <td class="right">${r.count}</td>
            <td class="right">${r.unit ?? '–'}</td>
            <td class="right">${r.costPrice != null ? '$' + r.costPrice.toFixed(2) : '–'}</td>
            <td class="right">${r.value != null ? fmtVal(r.value) : '–'}</td>
          </tr>`;
        }
        html += `<tr class="subtotal">
          <td>${g.category} subtotal</td>
          <td class="right">${g.totalCount}</td>
          <td></td><td></td>
          <td class="right">${g.totalValue != null ? fmtVal(g.totalValue) : '–'}</td>
        </tr>`;
      }

      html += `<tr class="grand">
        <td>TOTAL</td>
        <td class="right">${grandCount}</td>
        <td></td><td></td>
        <td class="right">${grandValue != null ? fmtVal(grandValue) : '–'}</td>
      </tr>`;
      html += `</table></body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const safeName = (venueName || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const isoDate = new Date().toISOString().slice(0, 10);
      const pdfDest = (FileSystem.cacheDirectory ?? '') + `${safeName}-stocktake-${isoDate}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: pdfDest }).catch(() => {});
      await Sharing.shareAsync(pdfDest.startsWith('file') ? pdfDest : uri, { mimeType: 'application/pdf', dialogTitle: 'Stock Holding Report' });
    } catch (e: any) {
      showError(e?.message ?? 'Could not generate PDF');
    } finally {
      setExporting(false);
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  async function exportCsv() {
    setExporting(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      let csv = 'Category,Product,Count,Unit,Cost Price,Value\n';
      for (const g of groups) {
        for (const r of g.rows) {
          const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
          csv += [
            esc(g.category),
            esc(r.name),
            r.count,
            r.unit ?? '',
            r.costPrice != null ? r.costPrice.toFixed(2) : '',
            r.value != null ? r.value.toFixed(2) : '',
          ].join(',') + '\n';
        }
      }
      const safeName = (venueName || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const path = FileSystem.cacheDirectory + `${safeName}-stocktake-${dateStr}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Stock Holding CSV' });
    } catch (e: any) {
      showError(e?.message ?? 'Could not generate CSV');
    } finally {
      setExporting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        {modal}
        <OfflineBanner />
        <View style={s.centred}>
          {loadingTimeout && !isOnline ? (
            <Text style={{ color: c.stellarAmber, textAlign: 'center', fontWeight: '700' }}>
              📵 No connection — showing cached data
            </Text>
          ) : (
            <>
              <ActivityIndicator color={c.primary} size="large" />
              <Text style={s.loadingText}>Building stock report…</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.safe}>
        {modal}
        <View style={s.header}>
          <Text style={s.title}>Stock Holding</Text>
        </View>
        <View style={s.centred}>
          <Text style={s.emptyTitle}>Couldn't load report</Text>
          <Text style={s.emptyBody}>Check your connection and try again.</Text>
          <TouchableOpacity style={s.ctaBtn} onPress={load}>
            <Text style={s.ctaBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!allRows.length) {
    return (
      <SafeAreaView style={s.safe}>
        {modal}
        <View style={s.header}>
          <Text style={s.title}>Stock Holding</Text>
        </View>
        <View style={s.centred}>
          <Text style={s.emptyTitle}>No counted stock yet</Text>
          <Text style={s.emptyBody}>Complete a stocktake to see your stock holding report.</Text>
          <TouchableOpacity style={s.ctaBtn} onPress={() => nav.navigate('DepartmentSelection')}>
            <Text style={s.ctaBtnText}>Start stocktake</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {modal}
      <OfflineBanner />
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Stock Holding</Text>
          <Text style={s.subtitle}>
            {grandCount} units
            {grandValue != null ? ` · ${fmtVal(grandValue)} total value` : ''}
          </Text>
        </View>
        <TouchableOpacity style={s.sortBtn} onPress={toggleSort}>
          <Text style={s.sortBtnText}>{sortAZ ? 'A–Z ✓' : 'A–Z'}</Text>
        </TouchableOpacity>
      </View>

      {/* Prior-cycle note */}
      {showingPriorCycle && (
        <View style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: c.stellarAmber + '18', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.stellarAmber }}>
          <Text style={{ fontSize: 12, color: c.stellarAmber }}>
            Showing counts from last completed stocktake. Counts will update as you complete this cycle.
          </Text>
        </View>
      )}

      {/* Export buttons */}
      <View style={s.exportRow}>
        <TouchableOpacity style={s.exportBtn} onPress={exportPdf} disabled={exporting}>
          {exporting
            ? <ActivityIndicator color={c.primaryText} size="small" />
            : <Text style={s.exportBtnText}>Export PDF</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[s.exportBtn, s.exportBtnOutline]} onPress={exportCsv} disabled={exporting}>
          <Text style={[s.exportBtnText, s.exportBtnTextOutline]}>Export CSV</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {groups.map(g => (
          <View key={g.category} style={s.group}>
            {/* Category header */}
            <View style={s.catHeader}>
              <Text style={s.catName}>{g.category}</Text>
              <Text style={s.catMeta}>
                {g.totalCount} units
                {g.totalValue != null ? ` · ${fmtVal(g.totalValue)}` : ''}
              </Text>
            </View>

            {/* Column headers */}
            <View style={s.colHeader}>
              <Text style={[s.colText, { flex: 1 }]}>Product</Text>
              <Text style={[s.colText, s.colRight, { width: 60 }]}>Count</Text>
              {g.hasValue && <Text style={[s.colText, s.colRight, { width: 72 }]}>Value</Text>}
            </View>

            {/* Rows */}
            {g.rows.map((r, i) => (
              <View key={r.name} style={[s.row, i === g.rows.length - 1 && s.rowLast]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{r.name}</Text>
                  {r.unit ? <Text style={s.rowUnit}>{r.unit}</Text> : null}
                </View>
                <Text style={[s.rowCount, { width: 60 }]}>{r.count}</Text>
                {g.hasValue && (
                  <Text style={[s.rowValue, { width: 72 }]}>
                    {r.value != null ? fmtVal(r.value) : '–'}
                  </Text>
                )}
              </View>
            ))}

            {/* Subtotal */}
            <View style={s.subtotal}>
              <Text style={s.subtotalLabel}>Subtotal</Text>
              <Text style={s.subtotalCount}>{g.totalCount}</Text>
              {g.hasValue && (
                <Text style={s.subtotalValue}>
                  {g.totalValue != null ? fmtVal(g.totalValue) : '–'}
                </Text>
              )}
            </View>
          </View>
        ))}

        {/* Grand total */}
        <View style={s.grandTotal}>
          <Text style={s.grandLabel}>TOTAL</Text>
          <Text style={s.grandCount}>{grandCount} units</Text>
          {grandValue != null && <Text style={s.grandValue}>{fmtVal(grandValue)}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (c: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { marginTop: 12, color: c.textSecondary, fontSize: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: c.navy, marginBottom: 8 },
  emptyBody: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  ctaBtn: { backgroundColor: c.primary, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28 },
  ctaBtnText: { color: c.primaryText, fontWeight: '700', fontSize: 15 },

  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '800', color: c.navy },
  subtitle: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  sortBtn: {
    backgroundColor: c.surface, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14,
    borderWidth: 1, borderColor: c.border, marginTop: 2,
  },
  sortBtnText: { fontSize: 13, fontWeight: '600', color: c.navy },

  exportRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  exportBtn: {
    flex: 1, backgroundColor: c.primary, borderRadius: 999,
    paddingVertical: 10, alignItems: 'center',
  },
  exportBtnOutline: {
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
  },
  exportBtnText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
  exportBtnTextOutline: { color: c.navy },

  scroll: { paddingHorizontal: 12, paddingBottom: 40 },

  group: {
    backgroundColor: c.surface, borderRadius: 12,
    borderWidth: 1, borderColor: c.border, marginBottom: 12, overflow: 'hidden',
  },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.navy, paddingHorizontal: 12, paddingVertical: 8,
  },
  catName: { color: c.surface, fontWeight: '700', fontSize: 13 },
  catMeta: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },

  colHeader: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: c.primaryLight, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  colText: { fontSize: 11, fontWeight: '600', color: c.textSecondary, textTransform: 'uppercase' },
  colRight: { textAlign: 'right' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowName: { fontSize: 14, color: c.navy, fontWeight: '500' },
  rowUnit: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  rowCount: { fontSize: 14, color: c.navy, fontWeight: '700', textAlign: 'right' },
  rowValue: { fontSize: 14, color: c.textSecondary, textAlign: 'right' },

  subtotal: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.primaryLight,
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: c.border,
  },
  subtotalLabel: { flex: 1, fontSize: 12, fontWeight: '700', color: c.navy },
  subtotalCount: { width: 60, fontSize: 12, fontWeight: '700', color: c.navy, textAlign: 'right' },
  subtotalValue: { width: 72, fontSize: 12, fontWeight: '700', color: c.navy, textAlign: 'right' },

  grandTotal: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.navy, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
  },
  grandLabel: { flex: 1, color: c.surface, fontSize: 14, fontWeight: '800' },
  grandCount: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '700' },
  grandValue: { color: c.surface, fontSize: 14, fontWeight: '800', marginLeft: 12 },
});
