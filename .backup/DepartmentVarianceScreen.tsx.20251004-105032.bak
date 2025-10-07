import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, FlatList, Alert, Platform, RefreshControl } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { useDensity } from '../../hooks/useDensity';

let FileSystem: any = null, Sharing: any = null;
try { FileSystem = require('expo-file-system'); } catch {}
try { Sharing = require('expo-sharing'); } catch {}

type RouteParams = { venueId: string; departmentId: string };
type AreaDoc = { name: string; startedAt?: any; completedAt?: any };
type ItemDoc = { name?: string; lastCount?: number; lastCountAt?: any; expectedQty?: number; incomingQty?: number; soldQty?: number; wastageQty?: number; };
type Row = { id: string; areaName: string; expectedSum: number | null; countedSum: number; variance: number | null; items: number; };

function DepartmentVarianceScreen() {
  dlog('[TallyUp Reports] DepartmentVarianceScreen');
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params ?? {}) as RouteParams;
  const { isCompact } = useDensity();

  const [rows, setRows] = useState<Row[]>([]);
  const [onlyVariance, setOnlyVariance] = useState(false);
  const [sortByMagnitude, setSortByMagnitude] = useState(true);
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
    let r = rows.slice();
    if (onlyVariance) r = r.filter(x => (x.variance ?? 0) !== 0);
    if (sortByMagnitude) r.sort((a,b)=>Math.abs((b.variance ?? 0)) - Math.abs((a.variance ?? 0))); else r.sort((a,b)=>a.areaName.localeCompare(b.areaName));
    return r;
  }, [rows, onlyVariance, sortByMagnitude]);

  const exportCsv = async (mode: 'current'|'changes') => {
    try {
      const dataset = mode === 'changes' ? viewRows.filter(r => (r.variance ?? 0) !== 0) : viewRows;
      showToast('Export ready');
      const headers = ['Area','Items','Expected (sum)','Counted (sum)','Variance'];
      const lines = [headers.join(',')];
      for (const r of dataset) {
        const row = [
          r.areaName,
          String(r.items),
          r.expectedSum == null ? '' : r.expectedSum.toFixed(2),
          r.countedSum.toFixed(2),
          r.variance == null ? '' : r.variance.toFixed(2)
        ].map(s => { const str = String(s ?? ''); return (str.includes(',')||str.includes('"')) ? `"${str.replace(/"/g,'""')}"` : str; }).join(',');
        lines.push(row);
      }
      const csv = lines.join('\n');
      if (!csv) { Alert.alert('Nothing to export', 'No rows to export.'); return; }
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      const fname = `tallyup-dept-variance-${mode}-${ts}.csv`;
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
          <Text style={{ fontSize: isCompact ? 18 : 20, fontWeight:'900' }}>Department Variance</Text>
          <TouchableOpacity onPress={()=>nav.goBack()} style={{ padding:8, borderRadius:8, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>Back</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color:'#6B7280', marginBottom:10 }}>Sums Expected vs Counted for each area in this department. Variance = Counted − Expected.</Text>
        <View style={{ flexDirection:'row', gap:8, marginBottom:10, flexWrap:'wrap' }}>
          <TouchableOpacity onPress={()=>setOnlyVariance(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyVariance ? '#1D4ED8' : '#E5E7EB', backgroundColor: onlyVariance ? '#DBEAFE' : 'white' }}>
            <Text style={{ fontWeight:'800', color: onlyVariance ? '#1D4ED8' : '#374151' }}>{onlyVariance ? '✓ Non-zero variance' : 'Non-zero variance'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>setSortByMagnitude(v=>!v)} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: sortByMagnitude ? '#059669' : '#E5E7EB', backgroundColor: sortByMagnitude ? '#D1FAE5' : 'white' }}>
            <Text style={{ fontWeight:'800', color: sortByMagnitude ? '#065F46' : '#374151' }}>{sortByMagnitude ? '✓ Sort by largest variance' : 'Sort A–Z'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>exportCsv('current')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#EFF6FF', borderWidth:1, borderColor:'#DBEAFE' }}>
            <Text style={{ fontWeight:'800', color:'#1E40AF' }}>Export CSV — Current view</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>exportCsv('changes')} style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor:'#EEF2FF', borderWidth:1, borderColor:'#E0E7FF' }}>
            <Text style={{ fontWeight:'800', color:'#3730A3' }}>Export CSV — Changes only</Text>
          </TouchableOpacity>
        </View>

        {rows.length === 0 ? (
          <View style={{ padding:16, borderRadius:12, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>No data yet</Text>
            <Text style={{ color:'#6B7280' }}>This department doesn’t have any areas/items loaded. Add items and counts to see variance.</Text>
          </View>
        ) : (
          <FlatList
            data={viewRows}
            keyExtractor={(r)=>r.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderItem={({ item }) => (
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
export default withErrorBoundary(DepartmentVarianceScreen, 'Department Variance');
