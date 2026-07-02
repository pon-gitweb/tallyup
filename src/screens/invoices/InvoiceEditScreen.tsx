// @ts-nocheck
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { fetchOrderWithLines, upsertInvoiceFromOrder, InvoiceLineInput } from '../../services/invoices';
import { useVenue } from '../../context/VenueProvider'; // Assumes this exists and provides { venueId, user }
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useToast } from '../../components/common/Toast';

function yyyymmddToDate(s: string): Date {
  if (!s) return new Date();
  const parts = s.split('-');
  if (parts.length !== 3) return new Date();
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return isNaN(d.getTime()) ? new Date() : d;
}
function dateToYyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type RootStackParamList = {
  InvoiceEdit: { orderId: string; status?: string; existingInvoiceId?: string };
  OrderDetail: { orderId: string; status?: string };
};

type Props = NativeStackScreenProps<RootStackParamList, 'InvoiceEdit'>;

export default function InvoiceEditScreen({ route, navigation }: Props) {
  const { venueId, user } = useVenue() as any;
  const { orderId } = route.params;
  const { showSuccess, showError, showInfo } = useToast();

  const [loading, setLoading] = useState(true);
  const [supplierName, setSupplierName] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDateISO, setInvoiceDateISO] = useState<string>(() => new Date().toISOString().slice(0,10)); // YYYY-MM-DD
  const [showInvoiceDatePicker, setShowInvoiceDatePicker] = useState(false);
  const [lines, setLines] = useState<InvoiceLineInput[]>([]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Invoice',
      headerRight: () => (
        <TouchableOpacity onPress={onPost} style={{ paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>Post</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, onPost, invoiceNumber, invoiceDateISO, lines]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!venueId) throw new Error('No venue');
        const { order, lines: orderLines } = await fetchOrderWithLines(venueId, orderId);
        if (!mounted) return;

        setSupplierName(order.supplierName || '');

        // Pre-fill invoice lines from order lines (qty/cost are editable)
        const preset: InvoiceLineInput[] = orderLines.map(ol => ({
          lineId: ol.id,
          productId: ol.productId,
          productName: ol.productName,
          qty: ol.qty ?? 0,
          cost: ol.cost ?? 0,
        }));
        setLines(preset);

        // Optional: If you store an invoice number hint on order, hydrate it
        // (kept conservative; no hard assumptions)
      } catch (e: any) {
        console.error('[Invoices] prefill error', e);
        showError(e?.message || 'Failed to load order lines.');
        navigation.goBack();
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [venueId, orderId]);

  const onChangeLine = (lineId: string, field: 'qty'|'cost', value: string) => {
    setLines(curr => curr.map(l => l.lineId === lineId ? { ...l, [field]: field === 'qty' ? Number(value) : Number(value) } : l));
  };

  const subtotal = useMemo(() => lines.reduce((s, l) => s + (Number(l.qty)||0)*(Number(l.cost)||0), 0), [lines]);

  const onPost = React.useCallback(async () => {
    try {
      if (!venueId) throw new Error('No venue');
      if (!user?.uid) throw new Error('No user');
      if (!invoiceNumber.trim()) {
        showError('Please enter an invoice number.');
        return;
      }
      if (!lines.length) {
        showInfo('There are no lines to post.');
        return;
      }
      const result = await upsertInvoiceFromOrder(venueId, user.uid, {
        orderId,
        invoiceNumber,
        invoiceDateISO,
        lines,
      });
      showSuccess('Invoice posted.');
      navigation.navigate('OrderDetail' as any, { orderId, status: route.params?.status });
    } catch (e: any) {
      console.error('[Invoices] post error', e);
      showError(e?.message || 'Failed to post invoice.');
    }
  }, [venueId, user?.uid, orderId, invoiceNumber, invoiceDateISO, lines]);

  if (loading) {
    return <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}><Text>Loading…</Text></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, padding: 16 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 12, opacity: 0.7 }}>Supplier</Text>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>{supplierName || '-'}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, opacity: 0.7 }}>Invoice #</Text>
          <TextInput
            value={invoiceNumber}
            onChangeText={setInvoiceNumber}
            placeholder="e.g. INV-12345"
            style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 }}
            autoCapitalize="characters"
          />
        </View>
        <View style={{ width: 140 }}>
          <Text style={{ fontSize: 12, opacity: 0.7 }}>Date</Text>
          <TouchableOpacity
            style={[{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 }, { justifyContent: 'center' }]}
            onPress={() => setShowInvoiceDatePicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 14, color: invoiceDateISO ? '#000' : '#aaa' }}>
              {invoiceDateISO || 'Select date'}
            </Text>
          </TouchableOpacity>
          {showInvoiceDatePicker && (
            <DateTimePicker
              value={yyyymmddToDate(invoiceDateISO)}
              mode="date"
              display="default"
              onChange={(event: any, selectedDate?: Date) => {
                setShowInvoiceDatePicker(false);
                if (event?.type === 'dismissed' || !selectedDate) return;
                setInvoiceDateISO(dateToYyyymmdd(selectedDate));
              }}
            />
          )}
        </View>
      </View>

      <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>Lines</Text>
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={lines}
        keyExtractor={(l) => l.lineId}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={{ borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12 }}>
            <Text style={{ fontWeight: '600' }}>{item.productName || item.productId}</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, opacity: 0.7 }}>Qty</Text>
                <TextInput
                  value={String(item.qty ?? 0)}
                  keyboardType="numeric"
                  onChangeText={(t) => onChangeLine(item.lineId, 'qty', t)}
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8 }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, opacity: 0.7 }}>Unit Cost</Text>
                <TextInput
                  value={String(item.cost ?? 0)}
                  keyboardType="numeric"
                  onChangeText={(t) => onChangeLine(item.lineId, 'cost', t)}
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8 }}
                />
              </View>
              <View style={{ width: 100, alignItems: 'flex-end', justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, opacity: 0.7 }}>Line</Text>
                <Text style={{ fontWeight: '600' }}>
                  {((Number(item.qty)||0) * (Number(item.cost)||0)).toFixed(2)}
                </Text>
              </View>
            </View>
          </View>
        )}
        style={{ flex: 1 }}
      />

      <View style={{ paddingVertical: 12, borderTopWidth: 1, borderColor: '#eee' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', textAlign: 'right' }}>Subtotal: {subtotal.toFixed(2)}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}
