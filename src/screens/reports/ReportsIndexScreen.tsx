// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import { useNavigation } from '@react-navigation/native';
import { exportCsv, exportPdf } from '../../utils/exporters';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';

import { pickParseAndUploadProductsCsv } from 'src/services/imports/pickAndUploadCsv';
import { callProcessProductsCsv } from 'src/services/imports/processProductsCsv';

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Toast from 'react-native-toast-message';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[ReportsIndex]', ...a); };

export default function ReportsIndexScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [busy, setBusy] = React.useState(false);

  const exportQuickCsv = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const headers = ['Report', 'Metric', 'Value'];
      const rows = [
        ['Last Cycle', 'Status', '—'],
        ['Variance', 'Shortage Value', '—'],
        ['Variance', 'Excess Value', '—'],
      ];
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const filename = `reports-summary-${stamp}.csv`;
      const out = await exportCsv(filename, headers, rows);
      dlog('CSV export', out);
      if (!out.ok && out.reason === 'sharing_unavailable') {
        Alert.alert('Export saved', 'Sharing unavailable on this device. File was written to app storage.');
      }
    } catch (e:any) { Alert.alert('Export failed', e?.message || 'Could not export CSV'); }
    finally { setBusy(false); }
  }, [busy]);

  const shareQuickPdf = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const html = `
        <html><body style="font-family:-apple-system,Roboto,sans-serif;padding:12px">
          <h2>TallyUp — Reports Summary</h2>
          <p>Shareable summary placeholder. Wire to live aggregates.</p>
          <ul>
            <li>Session: —</li>
            <li>Variance (shortage): —</li>
            <li>Variance (excess): —</li>
          </ul>
        </body></html>`;
      const out = await exportPdf('Reports Summary', html);
      dlog('PDF export', out);
      if (!out.ok && out.reason === 'sharing_unavailable') Alert.alert('PDF generated', 'Sharing unavailable on this device.');
    } catch (e:any) { Alert.alert('Share failed', e?.message || 'Could not generate PDF'); }
    finally { setBusy(false); }
  }, [busy]);

  const showCountsToast = (title:string, counts:any) => {
    const c = counts || {};
    Toast.show({
      type: 'success',
      text1: title,
      text2: `Created: ${c.created ?? 0} • Updated: ${c.updated ?? 0} • Skipped: ${c.skipped ?? 0}`,
      position: 'bottom',
      visibilityTime: 3000,
    });
  };

  // Core import flow (force=false by default)
  const runImport = React.useCallback(async (opts?:{ force?: boolean }) => {
    if (busy) return;
    if (!venueId) { Alert.alert('Not ready', 'No venue selected.'); return; }
    setBusy(true);
    const force = !!opts?.force;
    try {
      // 1) Upload to Storage via HTTPS function
      const res = await pickParseAndUploadProductsCsv(venueId);
      if (res.cancelled) return;

      const path = String(res.storagePath || '');
      if (!path) throw new Error('Upload returned no storage path');

      // 2) Immediately process to Firestore
      const proc = await callProcessProductsCsv(venueId, path, force);
      const c = proc?.counts || {};

      Alert.alert(
        force ? 'Products reprocessed' : 'Products imported',
        `Path: ${path}\n\n${c.created ?? 0} created\n${c.updated ?? 0} updated\n${c.skipped ?? 0} skipped`
      );
      showCountsToast(force ? 'Reprocess complete' : 'Import complete', c);
    } catch (e:any) {
      Alert.alert('Import failed', e?.message || 'Could not import/process CSV');
      Toast.show({ type: 'error', text1: 'Import failed', text2: e?.message || 'Error' });
    } finally {
      setBusy(false);
    }
  }, [busy, venueId]);

  const importProductsCsv = React.useCallback(async () => {
    return runImport({ force: false });
  }, [runImport]);

  const importProductsCsvForce = React.useCallback(async () => {
    Alert.alert(
      'Force reprocess?',
      'This will update all matching products even if nothing changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reprocess', style: 'destructive', onPress: () => runImport({ force: true }) },
      ]
    );
  }, [runImport]);

  // Create a sharable sample CSV file so testers can save it to device
  const createSampleCsvAndShare = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const sample = [
        'name,sku,supplierId,supplierName,costPrice,unit,packSize,parLevel',
        'Lime,fruit-limes,fruitco,Fruit Co,0.45,each,50,24',
        'Coca-Cola 330ml,coke-330,8LTkJoQLiaBkmVmJlbQc,Coke,0.65,bottle,24,48',
        'House Wine 750ml,wine-house-750,8LTkJoQLiaBkmVmJlbQc,WineCo,7.80,bottle,12,12',
        'Heineken 330ml,beer-hein-330,beerco,Beer Co,1.15,bottle,24,48',
        'Lemon,fruit-lemons,fruitco,Fruit Co,0.40,each,50,24',
      ].join('\n');

      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const filename = `tallyup-sample-products-${stamp}.csv`;
      const fileUri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, sample, { encoding: FileSystem.EncodingType.UTF8 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Save sample CSV' });
      } else {
        Alert.alert('Saved to cache', `Path: ${fileUri}`);
      }
    } catch (e:any) {
      Alert.alert('Could not create sample', e?.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const go = (name:string, params?:any) => () => {
    if (!busy && venueId) nav.navigate(name as never, { venueId, ...(params||{}) } as never);
  };

  const Tile = ({title, subtitle, onPress, onLongPress, color}:{title:string;subtitle?:string;onPress:()=>void;onLongPress?:()=>void;color:string}) => (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={!venueId && title !== 'Share PDF — Summary' && title !== 'Export CSV — Summary' && title !== 'Create sample CSV (share)'}
      style={{ opacity: (venueId || title.includes('Summary') || title.includes('sample')) ? 1 : 0.6, backgroundColor: color, paddingVertical:14, paddingHorizontal:16, borderRadius:12 }}>
      <Text style={{ color:'#fff', fontWeight:'900', fontSize:16 }}>{title}</Text>
      {subtitle ? <Text style={{ color:'#F3F4F6', marginTop:4 }}>{subtitle}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <LocalThemeGate>
      <View style={{ flex:1, backgroundColor:'#0F1115' }}>
        <View style={{ padding:16, borderBottomColor:'#263142', borderBottomWidth:1, flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
          <View>
            <MaybeTText style={{ color:'white', fontSize:20, fontWeight:'700' }}>Reports</MaybeTText>
            <Text style={{ color:'#94A3B8', marginTop:4 }}>
              Share, export, and deep-dive analytics.
            </Text>
          </View>
          <IdentityBadge align="right" />
        </View>

        <ScrollView contentContainerStyle={{ padding:16, gap:12 }}>
          <Tile title="Export CSV — Summary" onPress={exportQuickCsv} color={busy ? '#334155' : '#3B82F6'} />
          <Tile title="Share PDF — Summary" onPress={shareQuickPdf} color={busy ? '#4338CA' : '#7C3AED'} />

          {/* Imports */}
          <Tile
            title="Import Products CSV"
            subtitle="Tap = import • Long-press = force"
            onPress={importProductsCsv}
            onLongPress={importProductsCsvForce}
            color={busy ? '#52525B' : '#1D4ED8'}
          />
          <Tile
            title="Create sample CSV (share)"
            subtitle="Save a sample to device for testing"
            onPress={createSampleCsvAndShare}
            color={busy ? '#374151' : '#2563EB'}
          />

          <Tile title="Variance Snapshot" subtitle="Compare on-hand vs expected" onPress={go('VarianceSnapshot')} color="#0EA5E9" />
          <Tile title="Last Cycle Summary" subtitle="Session KPIs & top variances" onPress={go('LastCycleSummary')} color="#059669" />
          <Tile title="Budgets" subtitle="Spend by period & supplier" onPress={go('Budgets')} color="#F59E0B" />
          <Tile title="Department Variance" subtitle="Shortage & excess by department" onPress={go('DepartmentVariance')} color="#10B981" />
        </ScrollView>
      </View>
    </LocalThemeGate>
  );
}
