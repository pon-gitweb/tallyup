// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { uploadInvoiceCsv } from '../../../services/invoices/invoiceUpload';
import { processInvoicesCsv } from '../../../services/invoices/processInvoicesCsv';

type Props = {
  orderId: string;
  venueId?: string | null;
  orderLines?: any[];
  onDone?: () => void;
  embed?: boolean;
};

export default function GenericCsvProcessorScreen({
  orderId,
  venueId,
  orderLines = [],
  onDone,
  embed,
}: Props) {
  const [busy, setBusy] = useState(false);

  const pickAndProcess = async () => {
    try {
      if (!venueId || !orderId) {
        Alert.alert('Invoice CSV', 'Missing venue or order ID – cannot process CSV.');
        return;
      }

      // 1) Pick a CSV file
      const result: any = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });

      // Handle both new & old shapes
      if (result.canceled || result.type === 'cancel') {
        return;
      }

      const asset = Array.isArray(result.assets) ? result.assets[0] : result;
      const fileUri = asset?.uri;
      const fileName = asset?.name || 'invoice.csv';

      if (!fileUri || !fileUri.startsWith('file')) {
        Alert.alert('Invoice CSV', 'Please choose a local CSV file.');
        return;
      }

      setBusy(true);

      // 2) Upload CSV to Storage via API tunnel
      const uploadRes = await uploadInvoiceCsv(String(venueId), String(orderId), fileUri, fileName);
      const storagePath = uploadRes?.fullPath || uploadRes?.path || uploadRes?.storagePath;

      if (!storagePath) {
        throw new Error('Upload succeeded but no storagePath/fullPath was returned.');
      }

      // 3) Ask AI/Express to parse the stored CSV
      const parsed = await processInvoicesCsv({
        venueId: String(venueId),
        orderId: String(orderId),
        storagePath,
      });

      const numLines = Array.isArray(parsed?.lines) ? parsed.lines.length : 0;
      const warnings = parsed?.warnings || parsed?.matchReport?.warnings || [];

      let msg = numLines
        ? `Invoice CSV processed. Parsed ${numLines} line${numLines === 1 ? '' : 's'}.`
        : 'Invoice CSV processed, but no lines were returned.';

      if (warnings.length) {
        msg += `\n\nWarnings:\n- ${warnings.slice(0, 5).join('\n- ')}`;
      }

      Alert.alert('Invoice CSV', msg);

      // TODO (next step): open ReceiveApproveScreen with parsed lines for manual review
      onDone?.();
    } catch (e: any) {
      console.warn('[GenericCsvProcessorScreen] error', e);
      Alert.alert('CSV failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !venueId || !orderId;

  return (
    <View style={S.wrap}>
      <Text style={S.h}>Invoice CSV</Text>
      <Text style={S.sub}>
        Pick a CSV invoice file. We’ll upload it to secure storage, send it to the AI parser, and attach the result
        to this order.
      </Text>

      {!venueId || !orderId ? (
        <Text style={S.warn}>
          Missing venueId/orderId – open this screen from an order context to enable CSV processing.
        </Text>
      ) : null}

      <TouchableOpacity
        disabled={disabled}
        onPress={pickAndProcess}
        style={[S.btn, disabled && S.btnDis]}
      >
        {busy ? (
          <>
            <ActivityIndicator style={{ marginRight: 8 }} />
            <Text style={S.btnTxt}>Processing…</Text>
          </>
        ) : (
          <Text style={S.btnTxt}>Upload & Process CSV</Text>
        )}
      </TouchableOpacity>

      <Text style={S.foot}>
        Next step (planned): feed parsed lines into the approval screen so you can review and confirm the receipt
        before we update stock.
      </Text>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { gap: 12, paddingVertical: 8 },
  h: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sub: { fontSize: 13, color: '#4B5563' },
  warn: {
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    padding: 8,
    borderRadius: 8,
    fontSize: 13,
  },
  btn: {
    marginTop: 12,
    backgroundColor: '#0B5FFF',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnDis: { opacity: 0.6 },
  btnTxt: { color: '#fff', fontWeight: '700' },
  foot: { fontSize: 12, color: '#6B7280', marginTop: 8 },
});
