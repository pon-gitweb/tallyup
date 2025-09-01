import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { getOrderWithLines, receiveOrder } from '../../services/orders.safe';
import { createInvoiceFromOrder } from '../../services/invoices';
import { notifyError } from '../../utils/errors';

export default function ReceiveOrderScreen() {
  const venueId = useVenueId();
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const orderId: string = route.params?.orderId;
  const supplierId: string = route.params?.supplierId;

  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<any[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(''); // yyyy-mm-dd
  const [notes, setNotes] = useState('');

  async function load() {
    if (!venueId || !orderId) return;
    try {
      setLoading(true);
      const d = await getOrderWithLines(venueId, orderId);
      // default "received qty" equals ordered qty
      const withRecv = d.lines.map((l: any) => ({ ...l, recvQty: l.qty ?? 0 }));
      setLines(withRecv);
    } catch (e) {
      notifyError(e);
      nav.goBack();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId, orderId]);

  const total = useMemo(() => (
    lines.reduce((s, l) => s + (Number(l.recvQty || 0) * Number(l.unitCost ?? 0)), 0)
  ), [lines]);

  async function onConfirm() {
    if (!venueId || !orderId || !supplierId) return;
    try {
      setLoading(true);
      // Build invoice lines from received qty (>0)
      const invLines = lines
        .filter(l => Number(l.recvQty) > 0)
        .map(l => ({
          productId: l.productId, name: l.name,
          qty: Number(l.recvQty), unitCost: l.unitCost ?? null, packSize: l.packSize ?? null,
        }));

      const { invoiceId } = await createInvoiceFromOrder({
        venueId,
        orderId,
        supplierId,
        lines: invLines,
        invoiceNumber: invoiceNumber || null,
        invoiceDate: invoiceDate || null,
        notes: notes || null,
      });

      await receiveOrder(venueId, orderId);

      Alert.alert('Order Received', `Saved invoice ${invoiceNumber || invoiceId}.`);
      nav.navigate('Orders');
    } catch (e) {
      notifyError(e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator />
      <Text>Loading…</Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>Receive Order</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Invoice number</Text>
        <TextInput
          value={invoiceNumber}
          onChangeText={setInvoiceNumber}
          placeholder="e.g. INV-12345"
          style={styles.input}
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Invoice date (YYYY-MM-DD)</Text>
        <TextInput
          value={invoiceDate}
          onChangeText={setInvoiceDate}
          placeholder="2025-09-01"
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional notes…"
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          multiline
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Quantities received</Text>
        {lines.map((l, idx) => (
          <View key={l.productId} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{l.name}</Text>
              <Text style={styles.sub}>Ordered: {l.qty} @ {l.unitCost != null ? Number(l.unitCost).toFixed(2) : '—'}</Text>
            </View>
            <TextInput
              keyboardType="numeric"
              value={String(l.recvQty ?? 0)}
              onChangeText={(t) => {
                const v = Math.max(0, Number(t || 0));
                const copy = [...lines];
                copy[idx] = { ...copy[idx], recvQty: v };
                setLines(copy);
              }}
              style={styles.qty}
            />
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Invoice total (calc)</Text>
          <Text style={styles.totalValue}>{total.toFixed(2)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.primary} onPress={onConfirm}>
        <Text style={styles.primaryText}>Confirm Received & Save Invoice</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  wrap: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, gap: 8 },
  label: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  section: { fontWeight: '800', marginBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  lineName: { fontWeight: '700' },
  sub: { opacity: 0.7 },
  qty: { width: 64, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#E2E5E9', paddingTop: 8, marginTop: 8 },
  totalLabel: { fontWeight: '800' },
  totalValue: { fontWeight: '900' },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '800' },
});
