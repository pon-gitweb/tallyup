/* @ts-nocheck */
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';
import { processSalesCsv } from '../../services/sales/processSalesCsv';
import { storeSalesReport } from '../../services/sales/storeSalesReport';
import { matchAndPersist } from '../../services/sales/matchSalesToRecipes';

const EXPECTED_HEADERS = [
  { col: 'name', desc: 'Product name', required: true },
  { col: 'qty_sold', desc: 'Quantity sold', required: true },
  { col: 'gross', desc: 'Gross sales value', required: false },
  { col: 'net', desc: 'Net sales value', required: false },
  { col: 'tax', desc: 'Tax amount', required: false },
  { col: 'sku', desc: 'Product SKU / code', required: false },
  { col: 'barcode', desc: 'Barcode', required: false },
  { col: 'date_start', desc: 'Period start date', required: false },
  { col: 'date_end', desc: 'Period end date', required: false },
];

export default function SalesReportUploadPanel({ onClose }: { onClose: () => void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const [showFormat, setShowFormat] = useState(false);

  const upload = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      setBusy(true);
      const a = res.assets[0];
      const isCsv = (a.mimeType || '').includes('csv') || /\.csv$/i.test(a.name || '');
      if (!isCsv) {
        Alert.alert(
          'CSV only for now',
          'Sales PDF imports are not enabled yet. Please export a CSV from your POS and upload that instead.'
        );
        return;
      }
      if (!venueId) throw new Error('Not ready: no venue selected');
      if (!a.uri?.startsWith('file')) throw new Error('Expected a local file URI');

      const parsed = await processSalesCsv({
        venueId,
        fileUri: a.uri,
        filename: a.name || 'sales.csv',
      });

      const lineCount = parsed?.lines?.length ?? 0;
      const matchable = parsed?.lines?.filter(
        (l: any) => l.name || l.sku || l.barcode
      ).length ?? 0;

      if (lineCount === 0) {
        Alert.alert(
          'Nothing parsed',
          'No lines were found in this CSV.\n\nMake sure your file has the required column headers — tap "Expected format" to see what we need.',
        );
        return;
      }

      const saved = await storeSalesReport({
        venueId,
        report: parsed?.report || parsed,
        source: 'csv',
      });

      if (!saved?.ok) throw new Error(saved?.error || 'storeSalesReport failed');

      // Non-blocking: match sales lines to recipes and write theoretical consumption
      if (parsed?.lines?.length > 0 && saved?.id) {
        matchAndPersist(venueId, parsed.lines, saved.id).catch(e => {
          if (__DEV__) console.log('[SalesUpload] recipe match failed (non-fatal)', e?.message);
        });
      }

      Alert.alert(
        'Sales report saved',
        `${lineCount} line${lineCount === 1 ? '' : 's'} imported, ${matchable} matchable to products.\n\nAnalytics will use this data automatically.`
      );
      onClose();
    } catch (e: any) {
      Alert.alert('Sales import failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [venueId, onClose]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#fff' }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>
        Sales Reports (CSV Import)
      </Text>
      <Text style={{ color: '#6B7280', marginBottom: 16, lineHeight: 20 }}>
        Import a POS sales report as CSV. Once saved, TallyUp uses this data for
        GP calculations, variance reports and suggested orders.
      </Text>

      {/* Format guidance toggle */}
      <TouchableOpacity
        onPress={() => setShowFormat((v) => !v)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 12,
          borderRadius: 10,
          backgroundColor: '#EFF6FF',
          borderWidth: 1,
          borderColor: '#DBEAFE',
          marginBottom: 12,
        }}
      >
        <Text style={{ fontWeight: '700', color: '#1D4ED8', fontSize: 14 }}>
          Expected CSV format
        </Text>
        <Text style={{ color: '#1D4ED8', fontWeight: '800', fontSize: 16 }}>
          {showFormat ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      {showFormat && (
        <View
          style={{
            backgroundColor: '#F8FAFC',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#E2E8F0',
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: '800', marginBottom: 8, color: '#0F172A' }}>
            Column headers (row 1 of your CSV)
          </Text>
          {EXPECTED_HEADERS.map((h) => (
            <View
              key={h.col}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 5,
                borderBottomWidth: 1,
                borderBottomColor: '#E2E8F0',
                gap: 8,
              }}
            >
              <View
                style={{
                  backgroundColor: h.required ? '#111827' : '#E5E7EB',
                  borderRadius: 6,
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  minWidth: 110,
                }}
              >
                <Text
                  style={{
                    color: h.required ? '#fff' : '#374151',
                    fontWeight: '800',
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                >
                  {h.col}
                </Text>
              </View>
              <Text style={{ color: '#4B5563', fontSize: 13, flex: 1 }}>
                {h.desc}
                {h.required ? (
                  <Text style={{ color: '#DC2626' }}> *</Text>
                ) : null}
              </Text>
            </View>
          ))}
          <Text style={{ color: '#9CA3AF', fontSize: 11, marginTop: 8 }}>
            * Required. Other columns are optional but improve matching accuracy.
          </Text>
          <Text style={{ color: '#9CA3AF', fontSize: 11, marginTop: 4 }}>
            Tip: Most POS systems (Lightspeed, Square, Kounta/Impos) can export
            sales by product. Rename columns to match the above before uploading.
          </Text>

          {/* Example row */}
          <Text style={{ fontWeight: '800', marginTop: 12, marginBottom: 6, color: '#0F172A', fontSize: 13 }}>
            Example CSV
          </Text>
          <View
            style={{
              backgroundColor: '#0F172A',
              borderRadius: 8,
              padding: 10,
            }}
          >
            <Text style={{ color: '#86EFAC', fontSize: 11, fontFamily: 'monospace', lineHeight: 18 }}>
              {'name,qty_sold,gross,net,sku\n'}
              {'Heineken 330ml,48,288.00,250.43,HEI330\n'}
              {'House Red Wine,24,192.00,167.00,\n'}
              {'Gin & Tonic,36,324.00,281.74,'}
            </Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        disabled={busy}
        onPress={upload}
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: '#111',
          opacity: busy ? 0.7 : 1,
          marginBottom: 10,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>
          {busy ? 'Processing…' : 'Upload Sales Report (CSV)'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        disabled={busy}
        onPress={onClose}
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: '#F3F4F6',
        }}
      >
        <Text style={{ color: '#111', fontWeight: '800', textAlign: 'center' }}>
          Close
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
