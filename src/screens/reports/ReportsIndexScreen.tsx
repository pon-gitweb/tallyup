// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import { useNavigation, useRoute } from '@react-navigation/native';
import { exportCsv, exportPdf } from '../../utils/exporters';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[ReportsIndex]', ...a); };

export default function ReportsIndexScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = route?.params?.venueId ?? 'demo_venue';

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

  const go = (name:string, params?:any) => () => { if (!busy) nav.navigate(name as never, { venueId, ...(params||{}) } as never); };

  const Tile = ({title, subtitle, onPress, color}:{title:string;subtitle?:string;onPress:()=>void;color:string}) => (
    <TouchableOpacity
      onPress={onPress}
      style={{ backgroundColor: color, paddingVertical:14, paddingHorizontal:16, borderRadius:12 }}>
      <Text style={{ color:'#fff', fontWeight:'900', fontSize:16 }}>{title}</Text>
      {subtitle ? <Text style={{ color:'#F3F4F6', marginTop:4 }}>{subtitle}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <LocalThemeGate>
      <View style={{ flex:1, backgroundColor:'#0F1115' }}>
        <View style={{ padding:16, borderBottomColor:'#263142', borderBottomWidth:1 }}>
          <MaybeTText style={{ color:'white', fontSize:20, fontWeight:'700' }}>Reports</MaybeTText>
          <Text style={{ color:'#94A3B8', marginTop:4 }}>Share, export, and deep-dive analytics.</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding:16, gap:12 }}>
          {/* Quick share / export */}
          <Tile title="Export CSV — Summary" onPress={exportQuickCsv} color={busy ? '#334155' : '#3B82F6'} />
          <Tile title="Share PDF — Summary" onPress={shareQuickPdf} color={busy ? '#4338CA' : '#7C3AED'} />

          {/* Your existing analytics */}
          <Tile title="Variance Snapshot" subtitle="Compare on-hand vs expected" onPress={go('VarianceSnapshot')} color="#0EA5E9" />
          <Tile title="Last Cycle Summary" subtitle="Session KPIs & top variances" onPress={go('LastCycleSummary')} color="#059669" />
          <Tile title="Budgets" subtitle="Spend by period & supplier" onPress={go('Budgets')} color="#F59E0B" />

          {/* New department-focused view with header exports */}
          <Tile title="Department Variance" subtitle="Shortage & excess by department" onPress={go('DepartmentVariance')} color="#10B981" />
        </ScrollView>
      </View>
    </LocalThemeGate>
  );
}
