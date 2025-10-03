import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, ScrollView, RefreshControl, Alert, Platform } from 'react-native';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useLastCycleSummary } from '../../hooks/reports/useLastCycleSummary';
import { useDensity } from '../../hooks/useDensity';
import { usePersistedState } from '../../hooks/usePersistedState';

let FileSystem: any = null, Sharing: any = null, Haptics: any = null, Clipboard: any = null;
try { FileSystem = require('expo-file-system'); } catch {}
try { Sharing = require('expo-sharing'); } catch {}
try { Haptics = require('expo-haptics'); } catch {}
try { Clipboard = require('expo-clipboard'); } catch {}

const slug = (s?: string) => (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function LastCycleSummaryScreen() {
  const { loading, data, generateNow, refresh } = useLastCycleSummary();
  const { isCompact } = useDensity();
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const D = isCompact ? 0.9 : 1;

  // Remember this as last opened report
  const [, setLastOpened] = usePersistedState<string>('ui:reports:lastOpened', '');
  useEffect(() => { setLastOpened('LastCycleSummary'); }, [setLastOpened]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } catch (e:any) { Alert.alert('Refresh failed', e?.message ?? String(e)); }
    setRefreshing(false);
  }, [refresh]);

  const showToast = (msg='Export ready') => { setExportToast(msg); setTimeout(()=>setExportToast(null), 1400); };

  const buildCsv = () => {
    const headers = ['Venue','Departments','Areas (total)','Areas Completed','Areas In Progress','Session Status','Generated At'];
    const lines = [headers.join(',')];
    const row = [
      data?.venueId ?? '',
      data?.departments ?? '',
      data?.areasTotal ?? '',
      data?.areasCompleted ?? '',
      data?.areasInProgress ?? '',
      data?.sessionStatus ?? '',
      new Date().toISOString(),
    ].map((s:any)=>{ const str = String(s ?? ''); return (str.includes(',')||str.includes('"')||str.includes('\n')) ? `"${str.replace(/"/g,'""')}"` : str; }).join(',');
    lines.push(row);
    return lines.join('\n');
  };

  const copyCsv = async () => {
    try {
      const csv = buildCsv();
      if (!csv) { Alert.alert('Nothing to copy', 'No data to copy.'); return; }
      if (!Clipboard?.setStringAsync) { Alert.alert('Copy unavailable', 'Clipboard not available on this device.'); return; }
      await Clipboard.setStringAsync(csv);
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});
      setExportToast('Copied CSV');
      setTimeout(()=>setExportToast(null), 1200);
    } catch(e:any){ Alert.alert('Copy failed', e?.message ?? String(e)); }
  };

  const exportCsv = async () => {
    try {
      Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(()=>{});
      const csv = buildCsv();
      if (!csv) { Alert.alert('Nothing to export', 'No data to export.'); return; }
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      const fname = `tallyup-last-cycle-summary-${slug(data?.venueId)}-${ts}.csv`;
      if (!FileSystem?.cacheDirectory) { Alert.alert('Export unavailable', 'Could not access cache.'); return; }
      const path = FileSystem.cacheDirectory + fname;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      showToast('Export ready');
      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) { await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: fname }); }
      else { Alert.alert('Exported', `Saved to cache: ${fname}`); }
    } catch(e:any){ Alert.alert('Export failed', e?.message ?? String(e)); }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#FFFFFF' }}>
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} />}
      >
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <Text style={{ fontSize: isCompact ? 18 : 20, fontWeight:'900' }}>Last Cycle Summary</Text>
          <View style={{ flexDirection:'row', gap:8 }}>
            <TouchableOpacity onPress={exportCsv} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#EFF6FF', borderWidth:1, borderColor:'#DBEAFE' }}>
              <Text style={{ fontWeight:'800', color:'#1E40AF' }}>Export CSV — Current view</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={copyCsv} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F9FAFB', borderWidth:1, borderColor:'#E5E7EB' }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>Copy CSV — Current view</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => generateNow().catch((e:any)=>Alert.alert('Generate failed', e?.message ?? String(e)))} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#ECFDF5', borderWidth:1, borderColor:'#D1FAE5' }}>
              <Text style={{ fontWeight:'800', color:'#065F46' }}>Generate now</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={{ color:'#6B7280', marginBottom:12 }}>
          A quick recap of your most recent stock cycle. Pull down to refresh or “Generate now” to recompute.
        </Text>

        <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12 }}>
          <Row label="Departments" value={String(data?.departments ?? '—')} />
          <Row label="Areas (total)" value={String(data?.areasTotal ?? '—')} />
          <Row label="Areas completed" value={String(data?.areasCompleted ?? '—')} />
          <Row label="Areas in progress" value={String(data?.areasInProgress ?? '—')} />
          <Row label="Session status" value={String(data?.sessionStatus ?? '—')} />
        </View>
      </ScrollView>

      {exportToast ? (
        <View style={{ position:'absolute', left:16, right:16, bottom: Platform.select({ ios:24, android:16 }), backgroundColor:'rgba(0,0,0,0.85)', borderRadius:12, paddingVertical:10, paddingHorizontal:14, alignItems:'center' }}>
          <Text style={{ color:'white', fontWeight:'600' }}>{exportToast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:8 }}>
      <Text style={{ fontWeight:'800' }}>{label}</Text>
      <Text style={{ color:'#111827' }}>{value}</Text>
    </View>
  );
}

export default withErrorBoundary(LastCycleSummaryScreen, 'Last Cycle Summary');
