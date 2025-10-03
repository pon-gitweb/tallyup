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
type AreaDoc = { name: string; startedAt?: any };
type ItemDoc = { name?: string; lastCount?: number; lastCountAt?: any; flagRecount?: boolean; par?: number };

type Row = {
  id: string;
  areaName: string;
  itemName: string;
  lastCount: number | null;
  lastCountAt: Date | null;
  flagged: boolean;
  countedThisCycle: boolean;
  par: number | null;
  belowPar: boolean;
};

const slug = (s?: string) => (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function CountActivityScreen() {
  dlog('[TallyUp Reports] CountActivityScreen');
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params ?? {}) as RouteParams;
  const { isCompact } = useDensity();

  // Remember this as last opened report
  const [, setLastOpened] = usePersistedState<string>('ui:reports:lastOpened', '');
  useEffect(() => { setLastOpened('CountActivity'); }, [setLastOpened]);

  const [rows, setRows] = useState<Row[]>([]);
  const [onlyThisCycle, setOnlyThisCycle] = usePersistedState<boolean>('ui:reports:countAct:onlyThisCycle', false);
  const [onlyFlagged, setOnlyFlagged] = usePersistedState<boolean>('ui:reports:countAct:onlyFlagged', false);
  const [onlyBelowPar, setOnlyBelowPar] = usePersistedState<boolean>('ui:reports:countAct:onlyBelowPar', false);
  const [search, setSearch] = usePersistedState<string>('ui:reports:countAct:search', '');
  const [sortAZ, setSortAZ] = usePersistedState<boolean>('ui:reports:countAct:sortAZ', false);
  const [delimiter, setDelimiter] = usePersistedState<'comma'|'tab'>('ui:reports:csvDelimiter', 'comma');
  const [dateRange, setDateRange] = usePersistedState<'all'|'7d'|'30d'>('ui:reports:countAct:dateRange', 'all');
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  const D = isCompact ? 0.86 : 1;
  const parseTs = (v:any): Date|null => v?.toDate ? v.toDate() : (v?._seconds ? new Date(v._seconds*1000) : (isNaN(new Date(v).getTime()) ? null : new Date(v)));

  const load = useCallback(async () => {
    if (!venueId || !departmentId) return;
    const areasSnap = await getDocs(collection(db,'venues',venueId,'departments',departmentId,'areas'));
    const out: Row[] = [];
    for (const a of areasSnap.docs) {
      const ad = a.data() as AreaDoc;
      const startedAt = parseTs(ad?.startedAt);
      const itemsQ = query(collection(db,'venues',venueId,'departments',departmentId,'areas',a.id,'items'), orderBy('name'));
      const itemsSnap = await getDocs(itemsQ);
      itemsSnap.forEach(i => {
        const it = i.data() as ItemDoc;
        const lastAt = parseTs(it.lastCountAt);
        const countedThisCycle = (startedAt && lastAt) ? lastAt >= startedAt : false;
        const par = typeof it.par === 'number' ? it.par : null;
        const lastVal = typeof it.lastCount === 'number' ? it.lastCount : null;
        const belowPar = par != null && lastVal != null ? lastVal < par : false;
        out.push({
          id: `${a.id}:${i.id}`,
          areaName: ad?.name || 'Unnamed area',
          itemName: it?.name || 'Unnamed item',
          lastCount: lastVal,
          lastCountAt: lastAt,
          flagged: !!it.flagRecount,
          countedThisCycle,
          par,
          belowPar,
        });
      });
    }
    setRows(out);
  }, [venueId, departmentId]);

  useEffect(() => { load().catch(e=>Alert.alert('Error', e?.message ?? String(e))); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } catch (e:any) { Alert.alert('Refresh failed', e?.message ?? String(e)); }
    setRefreshing(false);
  }, [load]);

  const now = Date.now();
  const cutoff = useMemo(() => dateRange === '7d' ? (now - 7*86400000) : dateRange === '30d' ? (now - 30*86400000) : null, [now, dateRange]);

  const viewRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows.slice();
    if (q) r = r.filter(x => x.itemName?.toLowerCase().includes(q) || x.areaName?.toLowerCase().includes(q));
    if (onlyThisCycle) r = r.filter(x=>x.countedThisCycle);
    if (onlyFlagged) r = r.filter(x=>x.flagged);
    if (onlyBelowPar) r = r.filter(x=>x.belowPar);
    if (cutoff != null) r = r.filter(x => (x.lastCountAt?.getTime() ?? 0) >= cutoff);
    if (sortAZ) r.sort((a,b)=> (a.areaName.localeCompare(b.areaName)) || a.itemName.localeCompare(b.itemName));
    else r.sort((a,b)=>(b.lastCountAt?.getTime() ?? 0) - (a.lastCountAt?.getTime() ?? 0));
    return r;
  }, [rows, onlyThisCycle, onlyFlagged, onlyBelowPar, search, sortAZ, cutoff]);

  const counts = useMemo(() => {
    const total = rows.length;
    const flagged = rows.filter(x=>x.flagged).length;
    const below = rows.filter(x=>x.belowPar).length;
    const cycle = rows.filter(x=>x.countedThisCycle).length;
    return { total, flagged, below, cycle };
  }, [rows]);

  const anyFilter = !!search.trim() || onlyThisCycle || onlyFlagged || onlyBelowPar || sortAZ || dateRange !== 'all';

  const fieldToCsv = (val: any, delim: string) => {
    const str = String(val ?? '');
    const needsQuotes = str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(delim);
    const safe = str.replace(/"/g,'""');
    return needsQuotes ? `"${safe}"` : safe;
  };

  const buildCsvLines = (dataset: Row[], delim: string) => {
    const headers = ['Area','Item','Par','Last Count','Below Par','Last Count At','Flagged','Counted this cycle'];
    const lines = [headers.join(delim)];
    for (const r of dataset) {
      const cells = [
        fieldToCsv(r.areaName, delim),
        fieldToCsv(r.itemName, delim),
        fieldToCsv(r.par ?? '', delim),
        fieldToCsv(r.lastCount ?? '', delim),
        fieldToCsv(r.belowPar ? 'yes' : '', delim),
        fieldToCsv(r.lastCountAt ? r.lastCountAt.toISOString() : '', delim),
        fieldToCsv(r.flagged ? 'yes' : '', delim),
        fieldToCsv(r.countedThisCycle ? 'yes' : '', delim),
      ];
      lines.push(cells.join(delim));
    }
    return lines;
  };

  const copyCsv = async (mode:'current'|'changes') => {
    try {
      const delim = delimiter === 'comma' ? ',' : '\t';
      const dataset = mode === 'changes'
        ? rows.filter(x => x.countedThisCycle || x.flagged || x.belowPar)
        : viewRows;
      if (!dataset.length) { Alert.alert('Nothing to copy', 'No rows to copy.'); return; }
      const csv = buildCsvLines(dataset, delim).join('\n');
      if (!Clipboard?.setStringAsync) { Alert.alert('Copy unavailable', 'Clipboard not available on this device.'); return; }
      await Clipboard.setStringAsync(csv);
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});
      setExportToast('Copied CSV');
      setTimeout(()=>setExportToast(null), 1200);
    } catch(e:any){ Alert.alert('Copy failed', e?.message ?? String(e)); }
  };

  const exportCsv = async (mode:'current'|'changes') => {
    try {
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});
      const delim = delimiter === 'comma' ? ',' : '\t';
      const dataset = mode === 'changes'
        ? rows.filter(x => x.countedThisCycle || x.flagged || x.belowPar)
        : viewRows;
      if (!dataset.length) { Alert.alert('Nothing to export', 'No rows to export.'); return; }
      const csv = buildCsvLines(dataset, delim).join('\n');
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      const ext = delimiter === 'comma' ? 'csv' : 'tsv';
      const fname = `tallyup-count-activity-${mode}-${slug(venueId)}-${slug(departmentId)}-${ts}.${ext}`;
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
      const parts = [
        `${r.areaName} • ${r.itemName}`,
        `Par:${r.par ?? '—'}`,
        `Last:${r.lastCount ?? '—'}`,
        `At:${r.lastCountAt ? r.lastCountAt.toLocaleString() : '—'}`,
        r.belowPar ? 'Below Par' : '',
        r.flagged ? 'Recount' : '',
        r.countedThisCycle ? 'This cycle' : '',
      ].filter(Boolean);
      const line = parts.join(' — ');
      if (!Clipboard?.setStringAsync) { return; }
      await Clipboard.setStringAsync(line);
      setExportToast('Copied');
      setTimeout(()=>setExportToast(null), 900);
    } catch {}
  };

  const SummarySticky = () => (
    <View style={{ backgroundColor:'#FFFFFF', paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#E5E7EB' }}>
      <Text style={{ color:'#6B7280' }}>
        Rows: {counts.total} • Flagged: {counts.flagged} • Below par: {counts.below} • This cycle: {counts.cycle}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#FFFFFF' }}>
      <View style={{ padding:16 }}>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <Text style={{ fontSize: isCompact ? 18 : 20, fontWeight:'900' }}>Count Activity</Text>
          <TouchableOpacity onPress={()=>nav.goBack()} style={{ padding:8, borderRadius:8, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>Back</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color:'#6B7280', marginBottom:10 }}>
          Recent counts across areas and items. Filter by date window, cycle, flags, below-par; exports match your current view or changes only.
        </Text>

        {/* Search + chips */}
        <View style={{ gap:8, marginBottom:8 }}>
          <View style={{ flexDirection:'row', alignItems:'center' }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search items or areas…"
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
            {/* Date window */}
            <TouchableOpacity onPress={()=>setDateRange('all')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: dateRange==='all' ? '#1E40AF' : '#E5E7EB', backgroundColor: dateRange==='all' ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: dateRange==='all' ? '#1E40AF' : '#374151' }}>{dateRange==='all' ? '✓ All time' : 'All time'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setDateRange('7d')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: dateRange==='7d' ? '#1E40AF' : '#E5E7EB', backgroundColor: dateRange==='7d' ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: dateRange==='7d' ? '#1E40AF' : '#374151' }}>{dateRange==='7d' ? '✓ Last 7 days' : 'Last 7 days'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setDateRange('30d')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: dateRange==='30d' ? '#1E40AF' : '#E5E7EB', backgroundColor: dateRange==='30d' ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: dateRange==='30d' ? '#1E40AF' : '#374151' }}>{dateRange==='30d' ? '✓ Last 30 days' : 'Last 30 days'}</Text>
            </TouchableOpacity>

            {/* Flags */}
            <TouchableOpacity onPress={()=>setOnlyThisCycle(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyThisCycle ? '#1D4ED8' : '#E5E7EB', backgroundColor: onlyThisCycle ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: onlyThisCycle ? '#1D4ED8' : '#374151' }}>{onlyThisCycle ? '✓ This cycle only' : 'This cycle only'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setOnlyFlagged(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyFlagged ? '#D97706' : '#E5E7EB', backgroundColor: onlyFlagged ? '#FEF3C7' : 'white' }}>
              <Text style={{ fontWeight:'800', color: onlyFlagged ? '#92400E' : '#374151' }}>{onlyFlagged ? '✓ Flagged only' : 'Flagged only'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setOnlyBelowPar(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyBelowPar ? '#DC2626' : '#E5E7EB', backgroundColor: onlyBelowPar ? '#FEE2E2' : 'white' }}>
              <Text style={{ fontWeight:'800', color: onlyBelowPar ? '#991B1B' : '#374151' }}>{onlyBelowPar ? '✓ Below Par' : 'Below Par'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setSortAZ(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: sortAZ ? '#059669' : '#E5E7EB', backgroundColor: sortAZ ? '#D1FAE5' : 'white' }}>
              <Text style={{ fontWeight:'800', color: sortAZ ? '#065F46' : '#374151' }}>{sortAZ ? '✓ Sort A–Z' : 'Sort by newest'}</Text>
            </TouchableOpacity>

            {/* Export delimiter */}
            <TouchableOpacity onPress={()=>setDelimiter('comma')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: delimiter==='comma' ? '#1E40AF' : '#E5E7EB', backgroundColor: delimiter==='comma' ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: delimiter==='comma' ? '#1E40AF' : '#374151' }}>{delimiter==='comma' ? '✓ CSV (,)' : 'CSV (,)'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setDelimiter('tab')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: delimiter==='tab' ? '#1E40AF' : '#E5E7EB', backgroundColor: delimiter==='tab' ? '#DBEAFE' : 'white' }}>
              <Text style={{ fontWeight:'800', color: delimiter==='tab' ? '#1E40AF' : '#374151' }}>{delimiter==='tab' ? '✓ TSV (tab)' : 'TSV (tab)'}</Text>
            </TouchableOpacity>

            {/* Export / Copy */}
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
              <TouchableOpacity onPress={()=>{ setSearch(''); setOnlyThisCycle(false); setOnlyFlagged(false); setOnlyBelowPar(false); setSortAZ(false); setDateRange('all'); }} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F3F4F6' }}>
                <Text style={{ fontWeight:'800', color:'#374151' }}>Clear filters</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* LIST (with sticky summary header) */}
        <FlatList
          ref={listRef}
          data={viewRows}
          keyExtractor={(r)=>r.id}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => setShowTop(e.nativeEvent.contentOffset.y > 300)}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={<SummarySticky />}
          stickyHeaderIndices={[0]}
          renderItem={({ item }) => (
            <TouchableOpacity onLongPress={()=>copyRow(item)} activeOpacity={0.9}>
              <View style={{ paddingVertical: 10*D, paddingHorizontal: 12*D, borderBottomWidth:1, borderBottomColor:'#EEE' }}>
                <Text style={{ fontWeight:'800', fontSize: isCompact ? 14 : 15 }}>
                  {item.areaName} • {item.itemName}
                </Text>
                <View style={{ flexDirection:'row', gap:8, flexWrap:'wrap', marginTop:4 }}>
                  <Text style={{ color:'#374151' }}>Par: {item.par ?? '—'}</Text>
                  <Text style={{ color:'#374151' }}>Last: {item.lastCount ?? '—'}</Text>
                  <Text style={{ color:'#374151' }}>At: {item.lastCountAt ? item.lastCountAt.toLocaleString() : '—'}</Text>
                  {item.belowPar ? <Text style={{ color:'#991B1B' }}>Below Par</Text> : null}
                  {item.flagged ? <Text style={{ color:'#92400E' }}>Recount</Text> : null}
                  {item.countedThisCycle ? <Text style={{ color:'#065F46' }}>This cycle</Text> : null}
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={(
            <View style={{ padding:16, borderRadius:12, backgroundColor:'#F3F4F6' }}>
              <Text style={{ fontWeight:'700' }}>{search ? `No matches for “${search}”` : 'No data yet'}</Text>
              <Text style={{ color:'#6B7280' }}>
                {search ? 'Broaden your search or clear filters.' : 'This department doesn’t have any areas/items loaded. Add items and counts to see activity.'}
              </Text>
            </View>
          )}
        />
      </View>

      {/* Floating "Top" pill */}
      {showTop ? (
        <TouchableOpacity onPress={() => { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{}); listRef.current?.scrollToOffset({ offset: 0, animated: true }); }} activeOpacity={0.9}
          style={{ position:'absolute', right:16, bottom: Platform.select({ ios:72, android:64 }), backgroundColor:'#111827', paddingVertical:10, paddingHorizontal:14, borderRadius:20 }}>
          <Text style={{ color:'white', fontWeight:'700' }}>↑ Top</Text>
        </TouchableOpacity>
      ) : null}

      {/* Toast */}
      {exportToast ? (
        <View style={{ position:'absolute', left:16, right:16, bottom: Platform.select({ ios:24, android:16 }), backgroundColor:'rgba(0,0,0,0.85)', borderRadius:12, paddingVertical:10, paddingHorizontal:14, alignItems:'center' }}>
          <Text style={{ color:'white', fontWeight:'600' }}>{exportToast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
export default withErrorBoundary(CountActivityScreen, 'Count Activity');
