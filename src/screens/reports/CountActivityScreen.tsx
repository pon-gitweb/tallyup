import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, FlatList, Alert, Platform, RefreshControl } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { useDensity } from '../../hooks/useDensity';
import { usePersistedState } from '../../hooks/usePersistedState';

let FileSystem: any = null, Sharing: any = null;
try { FileSystem = require('expo-file-system'); } catch {}
try { Sharing = require('expo-sharing'); } catch {}

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

function CountActivityScreen() {
  dlog('[TallyUp Reports] CountActivityScreen');
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params ?? {}) as RouteParams;
  const { isCompact } = useDensity();

  const [rows, setRows] = useState<Row[]>([]);
  const [onlyThisCycle, setOnlyThisCycle] = usePersistedState<boolean>('ui:reports:countAct:onlyThisCycle', false);
  const [onlyFlagged, setOnlyFlagged] = usePersistedState<boolean>('ui:reports:countAct:onlyFlagged', false);
  const [onlyBelowPar, setOnlyBelowPar] = usePersistedState<boolean>('ui:reports:countAct:onlyBelowPar', false);
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const D = isCompact ? 0.86 : 1;
  const showToast = (m='Export ready') => { setExportToast(m); setTimeout(()=>setExportToast(null), 1400); };
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

  const viewRows = useMemo(() => {
    let r = rows.slice();
    if (onlyThisCycle) r = r.filter(x=>x.countedThisCycle);
    if (onlyFlagged) r = r.filter(x=>x.flagged);
    if (onlyBelowPar) r = r.filter(x=>x.belowPar);
    r.sort((a,b)=>(b.lastCountAt?.getTime() ?? 0) - (a.lastCountAt?.getTime() ?? 0));
    return r;
  }, [rows, onlyThisCycle, onlyFlagged, onlyBelowPar]);

  const counts = useMemo(() => {
    const total = rows.length;
    const flagged = rows.filter(x=>x.flagged).length;
    const below = rows.filter(x=>x.belowPar).length;
    const cycle = rows.filter(x=>x.countedThisCycle).length;
    return { total, flagged, below, cycle };
  }, [rows]);

  const anyFilter = onlyThisCycle || onlyFlagged || onlyBelowPar;

  const exportCsv = async (mode:'current'|'changes') => {
    try {
      const dataset = mode === 'changes'
        ? rows.filter(x => x.countedThisCycle || x.flagged || x.belowPar)
        : viewRows;
      if (!dataset.length) { Alert.alert('Nothing to export', 'No rows to export.'); return; }
      showToast('Export ready');
      const headers = ['Area','Item','Par','Last Count','Below Par','Last Count At','Flagged','Counted this cycle'];
      const lines = [headers.join(',')];
      for (const r of dataset) {
        const row = [
          r.areaName,
          r.itemName,
          r.par ?? '',
          r.lastCount ?? '',
          r.belowPar ? 'yes' : '',
          r.lastCountAt ? r.lastCountAt.toISOString() : '',
          r.flagged ? 'yes' : '',
          r.countedThisCycle ? 'yes' : '',
        ]
        .map((s:any)=>{ const str = String(s ?? ''); return (str.includes(',')||str.includes('"')||str.includes('\n')) ? `"${str.replace(/"/g,'""')}"` : str; })
        .join(',');
        lines.push(row);
      }
      const csv = lines.join('\n');
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      const fname = `tallyup-count-activity-${mode}-${ts}.csv`;
      if (!FileSystem?.cacheDirectory) { Alert.alert('Export unavailable', 'Could not access cache.'); return; }
      const path = FileSystem.cacheDirectory + fname;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) { await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: fname }); }
      else { Alert.alert('Exported', `Saved to cache: ${fname}`); }
    } catch(e:any){ Alert.alert('Export failed', e?.message ?? String(e)); }
  };

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
          Recent counts across areas and items. Filter by cycle, flags, or below-par; exports match your current view or changes only.
        </Text>

        <View style={{ flexDirection:'row', gap:8, marginBottom:8, flexWrap:'wrap' }}>
          <TouchableOpacity onPress={()=>setOnlyThisCycle(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyThisCycle ? '#1D4ED8' : '#E5E7EB', backgroundColor: onlyThisCycle ? '#DBEAFE' : 'white' }}>
            <Text style={{ fontWeight:'800', color: onlyThisCycle ? '#1D4ED8' : '#374151' }}>{onlyThisCycle ? '✓ This cycle only' : 'This cycle only'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>setOnlyFlagged(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyFlagged ? '#D97706' : '#E5E7EB', backgroundColor: onlyFlagged ? '#FEF3C7' : 'white' }}>
            <Text style={{ fontWeight:'800', color: onlyFlagged ? '#92400E' : '#374151' }}>{onlyFlagged ? '✓ Flagged only' : 'Flagged only'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>setOnlyBelowPar(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyBelowPar ? '#DC2626' : '#E5E7EB', backgroundColor: onlyBelowPar ? '#FEE2E2' : 'white' }}>
            <Text style={{ fontWeight:'800', color: onlyBelowPar ? '#991B1B' : '#374151' }}>{onlyBelowPar ? '✓ Below Par' : 'Below Par'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>exportCsv('current')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#EFF6FF', borderWidth:1, borderColor:'#DBEAFE' }}>
            <Text style={{ fontWeight:'800', color:'#1E40AF' }}>Export CSV — Current view</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>exportCsv('changes')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#EEF2FF', borderWidth:1, borderColor:'#E0E7FF' }}>
            <Text style={{ fontWeight:'800', color:'#3730A3' }}>Export CSV — Changes only</Text>
          </TouchableOpacity>
          {anyFilter ? (
            <TouchableOpacity onPress={()=>{ setOnlyThisCycle(false); setOnlyFlagged(false); setOnlyBelowPar(false); }} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F3F4F6' }}>
              <Text style={{ fontWeight:'800', color:'#374151' }}>Clear filters</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Summary line */}
        <Text style={{ color:'#6B7280', marginBottom:10 }}>
          Rows: {counts.total} • Flagged: {counts.flagged} • Below par: {counts.below} • This cycle: {counts.cycle}
        </Text>

        {rows.length === 0 ? (
          <View style={{ padding:16, borderRadius:12, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>No data yet</Text>
            <Text style={{ color:'#6B7280' }}>Add items and counts first, then return to see activity.</Text>
          </View>
        ) : (
          <FlatList
            data={viewRows}
            keyExtractor={(r)=>r.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => (
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
            )}
          />
        )}
      </View>

      {exportToast ? (
        <View style={{ position:'absolute', left:16, right:16, bottom: Platform.select({ ios:24, android:16 }), backgroundColor:'rgba(0,0,0,0.85)', borderRadius:12, paddingVertical:10, paddingHorizontal:14, alignItems:'center' }}>
          <Text style={{ color:'white', fontWeight:'600' }}>{exportToast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
export default withErrorBoundary(CountActivityScreen, 'Count Activity');
