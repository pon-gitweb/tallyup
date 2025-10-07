// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import { useNavigation, useRoute } from '@react-navigation/native';
import { exportCsv, exportPdf } from '../../utils/exporters';

const dlog = (...a:any[]) => { if (__DEV__) console.log(...a); };

export default function ReportsIndexScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = route?.params?.venueId ?? 'demo_venue';

  const [busy, setBusy] = React.useState(false);

  const exportQuickCsv = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Minimal CSV with a header; replace with live data when service lands
      const headers = ['Report', 'Metric', 'Value'];
      const rows = [
        ['Session Summary', 'Status', 'In progress'],
        ['Variance', 'Shortage Value', '—'],
        ['Variance', 'Excess Value', '—'],
      ];
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const filename = `reports-summary-${stamp}.csv`;
      const out = await exportCsv(filename, headers, rows);
      dlog('[ReportsIndex] CSV export', out);
      if (!out.ok && out.reason === 'sharing_unavailable') {
        Alert.alert('Export saved', 'Sharing unavailable on this device. File was written to app storage.');
      }
    } catch (e:any) {
      Alert.alert('Export failed', e?.message || 'Could not export CSV');
    } finally { setBusy(false); }
  }, [busy]);

  const shareQuickPdf = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const html = `
        <html><body style="font-family:-apple-system,Roboto,sans-serif;padding:12px">
          <h2>TallyUp — Reports Summary</h2>
          <p>This is a quick shareable PDF placeholder. Wire to live data as services land.</p>
          <ul>
            <li>Session: In progress</li>
            <li>Variance (shortage): —</li>
            <li>Variance (excess): —</li>
          </ul>
        </body></html>
      `;
      const out = await exportPdf('Reports Summary', html);
      dlog('[ReportsIndex] PDF export', out);
      if (!out.ok && out.reason === 'sharing_unavailable') {
        Alert.alert('PDF generated', 'Sharing unavailable on this device.');
      }
    } catch (e:any) {
      Alert.alert('Share failed', e?.message || 'Could not generate PDF');
    } finally { setBusy(false); }
  }, [busy]);

  const goVariance = React.useCallback(() => {
    if (busy) return;
    nav.navigate('DepartmentVariance', { venueId });
  }, [busy, nav, venueId]);

  return (
    <LocalThemeGate>
      <View style={{ flex:1, backgroundColor:'#0F1115' }}>
        <View style={{ padding:16, borderBottomColor:'#263142', borderBottomWidth:1 }}>
          <MaybeTText style={{ color:'white', fontSize:20, fontWeight:'700' }}>Reports</MaybeTText>
          <Text style={{ color:'#94A3B8', marginTop:4 }}>Quick exports and variance.</Text>
        </View>

        <View style={{ padding:16, gap:10 }}>
          <TouchableOpacity
            disabled={busy}
            onPress={exportQuickCsv}
            style={{ backgroundColor: busy ? '#2B3442' : '#3B82F6', paddingVertical:12, borderRadius:10, alignItems:'center' }}>
            {busy ? <ActivityIndicator/> : <Text style={{ color:'white', fontWeight:'700' }}>Export CSV — Summary</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            disabled={busy}
            onPress={shareQuickPdf}
            style={{ backgroundColor: busy ? '#2B3442' : '#7C3AED', paddingVertical:12, borderRadius:10, alignItems:'center' }}>
            {busy ? <ActivityIndicator/> : <Text style={{ color:'white', fontWeight:'700' }}>Share PDF — Summary</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            disabled={busy}
            onPress={goVariance}
            style={{ backgroundColor: '#10B981', paddingVertical:12, borderRadius:10, alignItems:'center' }}>
            <Text style={{ color:'white', fontWeight:'700' }}>Open Department Variance</Text>
          </TouchableOpacity>
        </View>
      </View>
    </LocalThemeGate>
  );
}
