import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, FlatList, Alert, Platform, RefreshControl, TextInput, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { useDensity } from '../../hooks/useDensity';
import { usePersistedState } from '../../hooks/usePersistedState';

let FileSystem: any = null, Sharing: any = null, Haptics: any = null, Clipboard: any = null;
try { FileSystem = require('expo-file-system'); } catch {}
try { Sharing = require('expo-sharing'); } catch {}
try { Haptics = require('expo-haptics'); } catch {}
try { Clipboard = require('expo-clipboard'); } catch {}

type RouteParams = { venueId: string; departmentId: string };
type AreaDoc = { name: string; startedAt?: any; completedAt?: any };
type ItemDoc = { name?: string; lastCount?: number; lastCountAt?: any; expectedQty?: number; incomingQty?: number; soldQty?: number; wastageQty?: number; };
type Row = { id: string; areaName: string; expectedSum: number | null; countedSum: number; variance: number | null; items: number; };

const slug = (s?: string) => (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function DepartmentVarianceScreen() {
  dlog('[TallyUp Reports] DepartmentVarianceScreen');
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params ?? {}) as RouteParams;
  const { isCompact } = useDensity();

  const [rows, setRows] = useState<Row[]>([]);
  const [onlyVariance, setOnlyVariance] = usePersistedState<boolean>('ui:reports:deptVar:onlyVariance', false);
  const [sortByMagnitude, setSortByMagnitude] = usePersistedState<boolean>('ui:reports:deptVar:sortByMagnitude', true);
  const [search, setSearch] = usePersistedState<string>('ui:reports:deptVar:search', '');
  const [delimiter, setDelimiter] = usePersistedState<'comma'|'tab'>('ui:reports:csvDelimiter', 'comma');
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  const D = isCompact ? 0.86 : 1;
  const showToast = (msg = 'Export ready') => { setExportToast(msg); setTimeout(()=>setExportToast(null), 1400); };

  const parseTs = (v: any): Date | null =>
    v?.toDate ? v.toDate() : (v?._seconds ? new Date(v._seconds*1000) : (isNaN(new Date(v).getTime()) ? null : new Date(v)));

  const deriveExpected = (it: ItemDoc, startedAt: Date | null): number | null => {
    if (!startedAt) return null;
    if (typeof it.expectedQty === 'number') return it.expectedQty;
    const base = typeof it.lastCount === 'number' ? it.lastCount : null;
    const incoming = typeof it.incomingQty === 'number' ? it.incomingQty : 0;
    const sold = typeof it.soldQty === 'number' ? it.soldQty : 0;
    const wastage = typeof it.wastageQty === 'number' ? it.wastageQty : 0;
    if (base == null) return null;
    return base + incoming - sold - wastage;
  };

  const load = useCallback(async () => {
    if (!venueId || !departmentId) return;
    const areasSnap = await getDocs(collection(db,'venues',venueId,'departments',departmentId,'areas'));
    const areaRows: Row[] = [];
    for (const a of areasSnap.docs) {
      const ad = a.data() as AreaDoc;
      const startedAt = parseTs(ad?.startedAt);
      const itemsQ = query(collection(db,'venues',venueId,'departments',departmentId,'areas',a.id,'items'), orderBy('name'));
      const itemsSnap = await getDocs(itemsQ);
      let expectedSum: number | null = 0, countedSum = 0, haveExpected = false, items = 0;
      itemsSnap.forEach(i => {
        const it = i.data() as ItemDoc; items += 1;
        const exp = deriveExpected(it, startedAt);
        if (exp == null) expectedSum = null; else if (expectedSum != null) { expectedSum += exp; haveExpected = true; }
        if (typeof it.lastCount === 'number') countedSum += it.lastCount || 0;
      });
      if (!haveExpected) expectedSum = null;
      const variance = expectedSum == null ? null : (countedSum - expectedSum);
      areaRows.push({ id: a.id, areaName: ad?.name || 'Unnamed area', expectedSum, countedSum, variance, items });
    }
    setRows(areaRows);
  }, [venueId, departmentId]);

  useEffect(() => { load().catch(e=>Alert.alert('Error', e?.message ?? String(e))); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } catch (e:any) { Alert.alert('Refresh failed', e?.message ?? String(e)); }
    setRefreshing(false);
  }, [load]);

  const viewRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows.slice();
    if (q) r = r.filter(x => x.areaName?.toLowerCase().includes(q));
    if (onlyVariance) r = r.filter(x => (x.variance ?? 0) !== 0);
    if (sortByMagnitude) r.sort((a,b)=>Math.abs((b.variance ?? 0)) - Math.abs((a.variance ?? 0))); else r.sort((a,b)=>a.areaName.localeCompare(b.areaName));
    return r;
  }, [rows, onlyVariance, sortByMagnitude, search]);

  const summary = useMemo(() => {
    const totalAreas = rows.length;
    const withExpected = rows.filter(r => r.expectedSum != null).length;
    const nonZero = rows.filter(r => (r.variance ?? 0) !== 0).length;
    const absVar = rows.reduce((acc, r) => acc + (r.variance != null ? Math.abs(r.variance) : 0), 0);
    const counted = rows.reduce((acc, r) => acc + r.countedSum, 0);
    const expected = rows.reduce((acc, r) => acc + (r.expectedSum ?? 0), 0);
    const netVariance = rows.reduce((acc, r) => acc + (r.variance ?? 0), 0);
    return { totalAreas, withExpected, nonZero, absVar, counted, expected, netVariance };
  }, [rows]);

  const anyFilter = !!search.trim() || onlyVariance || !sortByMagnitude;

  const fieldToCsv = (val: any, delim: string) => {
    const str = String(val ?? '');
    const needsQuotes = str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(delim);
    const safe = str.replace(/"/g,'""');
    return needsQuotes ? `"${safe}"` : safe;
  };

  const buildCsvLines = (dataset: Row[], delim: string) => {
    const headers = ['Area','Items','Expected (sum)','Counted (sum)','Variance'];
    const lines = [headers.join(delim)];
    for (const r of dataset) {
      const cells = [
        fieldToCsv(r.areaName, delim),
        fieldToCsv(String(r.items), delim),
        fieldToCsv(r.expectedSum == null ? '' : r.expectedSum.toFixed(2), delim),
        fieldToCsv(r.countedSum.toFixed(2), delim),
        fieldToCsv(r.variance == null ? '' : r.variance.toFixed(2), delim),
      ];
      lines.push(cells.join(delim));
    }
    return lines;
  };

  const copyCsv = async (mode: 'current'|'changes') => {
    try {
      const delim = delimiter === 'comma' ? ',' : '\t';
      const dataset = mode === 'changes' ? viewRows.filter(r => (r.variance ?? 0) !== 0) : viewRows;
      if (!dataset.length) { Alert.alert('Nothing to copy', 'No rows to copy.'); return; }
      const csv = buildCsvLines(dataset, delim).join('\n');
      if (!Clipboard?.setStringAsync) { Alert.alert('Copy unavailable', 'Clipboard not available on this device.'); return; }
      await Clipboard.setStringAsync(csv);
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});
      setExportToast('Copied CSV');
      setTimeout(()=>setExportToast(null), 1200);
    } catch(e:any){ Alert.alert('Copy failed', e?.message ?? String(e)); }
  };

  const exportCsv = async (mode: 'current'|'changes') => {
    try {
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});
      const delim = delimiter === 'comma' ? ',' : '\t';
      const dataset = mode === 'changes' ? viewRows.filter(r => (r.variance ?? 0) !== 0) : viewRows;
      if (!dataset.length) { Alert.alert('Nothing to export', 'No rows to export.'); return; }
      const csv = buildCsvLines(dataset, delim).join('\n');
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      const ext = delimiter === 'comma' ? 'csv' : 'tsv';
      const fname = `tallyup-dept-variance-${mode}-${slug(venueId)}-${slug(departmentId)}-${ts}.${ext}`;
      if (!FileSystem?.cacheDirectory) { Alert.alert('Export unavailable', 'Could not access cache.'); return; }
      const path = FileSystem.cacheDirectory + fname;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      setExportToast('Export ready');
      setTimeout(()=>setExportToast(null), 1400);
      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) { await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: fname }); }
      else { Alert.alert('Exported', `Saved to cache: ${fname}`); }
    } catch(e:any){ Alert.alert('Export failed', e?.message ?? String(e)); }
  };

  const copyRow = async (r: Row) => {
    try {
      const line = `${r.areaName} — Items:${r.items} • Expected:${r.expectedSum==null?'—':r.expectedSum.toFixed(2)} • Counted:${r.countedSum.toFixed(2)} • Variance:${r.variance==null?'—':r.variance.toFixed(2)}`;
      if (!Clipboard?.setStringAsync) { return; }
      await Clipboard.setStringAsync(line);
      setExportToast('Copied');
      setTimeout(()=>setExportToast(null), 900);
    } catch {}
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowTop(e.nativeEvent.contentOffset.y > 300);
  };

  const scrollToTop = () => {
    Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#FFFFFF' }}>
      <View style={{ padding:16 }}>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <Text style={{ fontSize: isCompact ? 18 : 20, fontWeight:'900' }}>Department Variance</Text>
          <TouchableOpacity onPress={()=>nav.goBack()} style={{ padding:8, borderRadius:8, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>Back</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color:'#6B7280', marginBottom:10 }}>Sums Expected vs Counted for each area in this department. Variance = Counted − Expected.</Text>

        {/* Search + Chips */}
        <View style={{ gap:8, marginBottom:8 }}>
          <View style={{ flexDirection:'row', alignItems:'center' }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search areas…"
              placeholderTextColor="#9CA3AF"
              style={{ flex:1, paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, backgroundColor:'#F9FAFB' }}
              returnKeyType="search"
            />
            {search ? (
              <TouchableOpacity onPress={()=>setSearch('')} style={{ marginLeft:8, paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6' }}>
                <Text style={{ fontWeight:'700' }}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={{ flexDirection:'row', gap:8, flexWrap:'wrap' }}>
            <TouchableOpacity onPress={()=>setOnlyVariance(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyVariance ? '#1D4ED8' : '#E5E7EB', backgroundColor: onlyVariance ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: onlyVariance ? '#1D4ED8' : '#374151' }}>{onlyVariance ? '✓ Non-zero variance' : 'Non-zero variance'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setSortByMagnitude(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: sortByMagnitude ? '#059669' : '#E5E7EB', backgroundColor: sortByMagnitude ? '#D1FAE5' : 'white' }}>
              <Text style={{ fontWeight:'800', color: sortByMagnitude ? '#065F46' : '#374151' }}>{sortByMagnitude ? '✓ Sort by largest variance' : 'Sort A–Z'}</Text>
            </TouchableOpacity>

            {/* Delimiter toggle */}
            <TouchableOpacity onPress={()=>setDelimiter('comma')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: delimiter==='comma' ? '#1E40AF' : '#E5E7EB', backgroundColor: delimiter==='comma' ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: delimiter==='comma' ? '#1E40AF' : '#374151' }}>{delimiter==='comma' ? '✓ CSV (,)' : 'CSV (,)'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setDelimiter('tab')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: delimiter==='tab' ? '#1E40AF' : '#E5E7EB', backgroundColor: delimiter==='tab' ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: delimiter==='tab' ? '#1E40AF' : '#374151' }}>{delimiter==='tab' ? '✓ TSV (tab)' : 'TSV (tab)'}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>exportCsv('current')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#EFF6FF', borderWidth:1, borderColor:'#DBEAFE' }}>
              <Text style={{ fontWeight:'800', color:'#1E40AF' }}>Export — Current view</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>exportCsv('changes')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#EEF2FF', borderWidth:1, borderColor:'#E0E7FF' }}>
              <Text style={{ fontWeight:'800', color:'#3730A3' }}>Export — Changes only</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>copyCsv('current')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#F8FAFC', borderWidth:1, borderColor:'#E5E7EB' }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>Copy CSV — Current view</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>copyCsv('changes')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#F9FAFB', borderWidth:1, borderColor:'#E5E7EB' }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>Copy CSV — Changes only</Text>
            </TouchableOpacity>
            {anyFilter ? (
              <TouchableOpacity onPress={()=>{ setSearch(''); setOnlyVariance(false); setSortByMagnitude(true); }} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F3F4F6' }}>
                <Text style={{ fontWeight:'800', color:'#374151' }}>Clear filters</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Summary line */}
        <Text style={{ color:'#6B7280', marginBottom:10 }}>
          Areas: {summary.totalAreas} • With expected: {summary.withExpected} • Non-zero: {summary.nonZero} • |∑variance|: {summary.absVar.toFixed(2)} • Counted Σ: {summary.counted.toFixed(2)} • Expected Σ: {summary.expected.toFixed(2)} • Net: {summary.netVariance.toFixed(2)}
        </Text>

        {viewRows.length === 0 ? (
          <View style={{ padding:16, borderRadius:12, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>{search ? `No matches for “${search}”` : 'No data yet'}</Text>
            <Text style={{ color:'#6B7280' }}>
              {search ? 'Broaden your search or clear filters.' : 'This department doesn’t have any areas/items loaded. Add items and counts to see variance.'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={viewRows}
            keyExtractor={(r)=>r.id}
            onScroll={onScroll}
            scrollEventThrottle={16}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => (
              <TouchableOpacity onLongPress={()=>copyRow(item)} activeOpacity={0.9}>
                <View style={{ paddingVertical: 12 * D, paddingHorizontal: 12 * D, borderBottomWidth:1, borderBottomColor:'#EEE' }}>
                  <Text style={{ fontSize: isCompact ? 15 : 16, fontWeight:'800' }}>{item.areaName}</Text>
                  <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:4 }}>
                    <Text style={{ color:'#374151' }}>Items: {item.items}</Text>
                    <Text style={{ color:'#374151' }}>Expected: {item.expectedSum == null ? '—' : item.expectedSum.toFixed(2)}</Text>
                    <Text style={{ color:'#374151' }}>Counted: {item.countedSum.toFixed(2)}</Text>
                    <Text style={{ color: item.variance == null ? '#6B7280' : item.variance === 0 ? '#6B7280' : (item.variance > 0 ? '#065F46' : '#991B1B') }}>
                      Variance: {item.variance == null ? '—' : item.variance.toFixed(2)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      {/* Floating "Top" pill */}
      {showTop ? (
        <TouchableOpacity onPress={scrollToTop} activeOpacity={0.9}
          style={{ position:'absolute', right:16, bottom: Platform.select({ ios:72, android:64 }), backgroundColor:'#111827', paddingVertical:10, paddingHorizontal:14, borderRadius:20 }}>
          <Text style={{ color:'white', fontWeight:'700' }}>↑ Top</Text>
        </TouchableOpacity>
      ) : null}

      {exportToast ? (
        <View style={{ position:'absolute', left:16, right:16, bottom: Platform.select({ ios:24, android:16 }), backgroundColor:'rgba(0,0,0,0.85)', borderRadius:12, paddingVertical:10, paddingHorizontal:14, alignItems:'center' }}>
          <Text style={{ color:'white', fontWeight:'600' }}>{exportToast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
export default withErrorBoundary(DepartmentVarianceScreen, 'Department Variance');
