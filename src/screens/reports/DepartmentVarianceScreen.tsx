// @ts-nocheck
import React from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import { exportCsv, exportPdf } from '../../utils/exporters';
import { useVenueId } from '../../context/VenueProvider';
import { useVarianceReport } from '../../hooks/useVarianceReport';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[DepartmentVariance]', ...a); };

type Row = { id?: string; name: string; sku?: string; variance: number; value?: number; department?: string };

export default function DepartmentVarianceScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const venueIdCtx = useVenueId();
  const venueIdParam: string | undefined = route?.params?.venueId;
  const venueId = venueIdParam || venueIdCtx || null;
  const departmentId: string | undefined = route?.params?.departmentId;

  const { loading, result, error } = useVarianceReport(venueId, departmentId ?? null);

  const shortages: Row[] = React.useMemo(() => {
    if (!result?.shortages?.length) return [];
    return result.shortages.map(it => ({
      id: it.itemId,
      name: it.name ?? '(item)',
      sku: '', // placeholder for future SKU
      variance: Number(it.deltaVsPar ?? 0), // negative
      value: it.valueImpact ?? undefined,
      department: it.departmentId ?? undefined,
    }));
  }, [result]);

  const excesses: Row[] = React.useMemo(() => {
    if (!result?.excesses?.length) return [];
    return result.excesses.map(it => ({
      id: it.itemId,
      name: it.name ?? '(item)',
      sku: '',
      variance: Number(it.deltaVsPar ?? 0), // positive
      value: it.valueImpact ?? undefined,
      department: it.departmentId ?? undefined,
    }));
  }, [result]);

  const totals = React.useMemo(() => ({
    shortage: Number(result?.totalShortageValue ?? 0),
    excess: Number(result?.totalExcessValue ?? 0),
  }), [result]);

  React.useEffect(() => {
    if (error) {
      Alert.alert('Failed to load variance', error);
    }
  }, [error]);

  const exportCurrentCsv = React.useCallback(async () => {
    try {
      const headers = ['Type', 'Name', 'SKU', 'Variance', 'Value'];
      const rows = [
        ...shortages.map(r => ['Shortage', r.name, r.sku || '', r.variance, r.value ?? '']),
        ...excesses.map(r => ['Excess', r.name, r.sku || '', r.variance, r.value ?? '']),
      ];
      const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      const filename = `variance-${departmentId || 'all'}-${stamp}.csv`;
      const out = await exportCsv(filename, headers, rows);
      dlog('[Reports] CSV export', out);
    } catch (e:any) {
      Alert.alert('Export failed', e?.message || 'Could not export CSV.');
    }
  }, [shortages, excesses, departmentId]);

  const sharePdf = React.useCallback(async () => {
    const rowHtml = (label: string, items: Row[]) => `
      <h3>${label}</h3>
      <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
        <thead><tr><th>Name</th><th>SKU</th><th style="text-align:right">Variance</th><th style="text-align:right">Value</th></tr></thead>
        <tbody>
          ${items.map(r => `<tr>
            <td>${r.name}</td>
            <td>${r.sku || ''}</td>
            <td style="text-align:right">${r.variance}</td>
            <td style="text-align:right">${r.value != null ? `$${Number(r.value).toFixed(2)}` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
    try {
      const html = `
        <html><body style="font-family: -apple-system, Roboto, sans-serif; padding: 12px;">
          <h2>Department Variance — ${departmentId || 'All Departments'}</h2>
          <p><b>Total shortage:</b> $${totals.shortage.toFixed(2)} &nbsp;&nbsp; <b>Total excess:</b> $${totals.excess.toFixed(2)}</p>
          ${rowHtml('Shortages', shortages)}
          <br />
          ${rowHtml('Excesses', excesses)}
        </body></html>
      `;
      const out = await exportPdf('Department Variance', html);
      dlog('[Reports] PDF export', out);
    } catch (e:any) {
      Alert.alert('Share PDF failed', e?.message || 'Could not generate PDF.');
    }
  }, [shortages, excesses, totals, departmentId]);

  const RowItem = ({ label, item }: { label: 'Shortage'|'Excess', item: Row }) => (
    <View style={{
      paddingVertical: 10, paddingHorizontal: 12,
      borderBottomColor: '#263142', borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center'
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>{item.name}</Text>
        <Text style={{ color: '#9CA3AF', fontSize: 12 }}>{item.sku || '—'} • {label}</Text>
      </View>
      <View style={{ width: 90, alignItems: 'flex-end' }}>
        <Text style={{ color: label === 'Shortage' ? '#FCA5A5' : '#A7F3D0', fontWeight: '700' }}>
          {item.variance > 0 ? `+${item.variance}` : `${item.variance}`}
        </Text>
        <Text style={{ color: '#94A3B8', fontSize: 12 }}>
          {item.value != null ? `$${Number(item.value).toFixed(2)}` : ''}
        </Text>
      </View>
    </View>
  );

  const combined = React.useMemo(() => ([
    ...shortages.map(r => ({ label: 'Shortage' as const, item: r })),
    ...excesses.map(r => ({ label: 'Excess'   as const, item: r })),
  ]), [shortages, excesses]);

  return (
    <LocalThemeGate>
      <View style={{ flex: 1, backgroundColor: '#0F1115' }}>
        <View style={{ padding: 16, borderBottomColor: '#263142', borderBottomWidth: 1 }}>
          <MaybeTText style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>
            Department Variance
          </MaybeTText>
          <Text style={{ color: '#94A3B8', marginTop: 4 }}>
            {departmentId ? `Department: ${departmentId}` : 'All Departments'}
          </Text>

          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <TouchableOpacity
              onPress={exportCurrentCsv}
              style={{ backgroundColor: '#3B82F6', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginRight: 8 }}
              disabled={loading}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Export CSV — Current view</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={sharePdf}
              style={{ backgroundColor: '#7C3AED', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }}
              disabled={loading}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Share PDF</Text>
            </TouchableOpacity>
          </View>
          {!venueId && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: '#fca5a5' }}>No venue selected — connect to a venue to load variance.</Text>
            </View>
          )}
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: '#9CA3B8' }}>
              Totals: shortage ${totals.shortage.toFixed(2)} · excess ${totals.excess.toFixed(2)}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={combined}
            keyExtractor={(r, i) => r.item?.id || `${r.label}-${i}`}
            renderItem={({ item }) => <RowItem label={item.label} item={item.item} />}
            ListEmptyComponent={() => (
              <View style={{ padding: 16 }}>
                <Text style={{ color: '#9CA3B8' }}>
                  No variance items found for this scope.
                </Text>
              </View>
            )}
          />
        )}
      </View>
    </LocalThemeGate>
  );
}
