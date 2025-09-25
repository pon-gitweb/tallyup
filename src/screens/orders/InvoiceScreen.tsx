import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { db } from '../../services/firebase';
import {
  doc, getDoc, getDocs, collection, addDoc, writeBatch, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';

type Order = {
  id: string;
  supplierId: string;
  status: string;
  notes?: string | null;
};

type OrderLine = {
  id: string;
  productId: string;
  name?: string;
  qty?: number;
  unitCost?: number;
  packSize?: number | null;
};

type InvoiceLine = {
  productId: string;
  name?: string;
  qty: number;
  unitCost: number;
};

export default function InvoiceScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const venueId = useVenueId();
  const orderId: string = route.params?.orderId;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [invoiceNo, setInvoiceNo] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0,10)); // YYYY-MM-DD

  useEffect(() => {
    (async () => {
      if (!venueId || !orderId) {
        Alert.alert('Missing context', 'No venue/order found');
        navigation.goBack();
        return;
      }
      try {
        setLoading(true);
        const oref = doc(db, 'venues', venueId, 'orders', orderId);
        const osnap = await getDoc(oref);
        if (!osnap.exists()) throw new Error('Order not found');
        setOrder({ id: osnap.id, ...(osnap.data() as any) });

        const lref = collection(db, 'venues', venueId, 'orders', orderId, 'lines');
        const lsnap = await getDocs(lref);
        const arr: OrderLine[] = lsnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setLines(arr);
      } catch (e: any) {
        console.log('[Invoice] load error', e?.message);
        Alert.alert('Load failed', e?.message || 'Unknown error');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId, orderId]);

  // Editable invoice items (start with order lines)
  const [invoiceItems, setInvoiceItems] = useState<InvoiceLine[]>([]);
  useEffect(() => {
    if (lines.length) {
      setInvoiceItems(lines.map(l => ({
        productId: l.productId,
        name: l.name,
        qty: Number(l.qty) || 0,
        unitCost: Number(l.unitCost) || 0,
      })));
    } else {
      setInvoiceItems([]);
    }
  }, [lines]);

  const total = useMemo(() => {
    return invoiceItems.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);
  }, [invoiceItems]);

  function updateLine(idx: number, patch: Partial<InvoiceLine>) {
    setInvoiceItems(prev => prev.map((x, i) => i === idx ? { ...x, ...patch } : x));
  }

  async function saveInvoice() {
    if (!venueId || !orderId || !order) return;
    if (!invoiceNo.trim()) {
      Alert.alert('Missing invoice number', 'Please enter an invoice number.');
      return;
    }
    try {
      setLoading(true);

      // create invoice doc
      const invCol = collection(db, 'venues', venueId, 'invoices');
      const invRef = await addDoc(invCol, {
        orderId,
        supplierId: order.supplierId,
        invoiceNo: invoiceNo.trim(),
        invoiceDate: invoiceDate || null,
        status: 'posted',
        total,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // write lines
      const batch = writeBatch(db);
      invoiceItems.forEach((it) => {
        const lineRef = doc(collection(db, 'venues', venueId, 'invoices', invRef.id, 'lines'));
        batch.set(lineRef, {
          productId: it.productId,
          name: it.name || null,
          qty: Number(it.qty) || 0,
          unitCost: Number(it.unitCost) || 0,
          lineTotal: (Number(it.qty) || 0) * (Number(it.unitCost) || 0),
        });
      });

      // link invoice back to order
      const oref = doc(db, 'venues', venueId, 'orders', orderId);
      batch.update(oref, { invoiceId: invRef.id, invoicedAt: serverTimestamp(), updatedAt: serverTimestamp() });

      await batch.commit();

      console.log('[Invoice] saved', JSON.stringify({ invoiceId: invRef.id, orderId, total }));
      Alert.alert('Invoice saved', `Invoice ${invoiceNo.trim()} posted.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      console.log('[Invoice] save error', e?.message);
      Alert.alert('Save failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Preparing invoice…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>Invoice</Text>
      <Text style={styles.sub}>Order: {orderId}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Invoice number</Text>
        <TextInput
          placeholder="INV-1001"
          value={invoiceNo}
          onChangeText={setInvoiceNo}
          autoCapitalize="characters"
          style={styles.input}
        />
        <Text style={styles.label}>Invoice date (YYYY-MM-DD)</Text>
        <TextInput
          placeholder="2025-09-01"
          value={invoiceDate}
          onChangeText={setInvoiceDate}
          autoCapitalize="none"
          style={styles.input}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Lines</Text>
        {invoiceItems.map((it, idx) => (
          <View key={idx} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{it.name || it.productId}</Text>
              <Text style={styles.muted}>{it.productId}</Text>
            </View>
            <View style={styles.lineInputs}>
              <TextInput
                keyboardType="numeric"
                value={String(it.qty ?? 0)}
                onChangeText={(v) => updateLine(idx, { qty: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                style={[styles.smallInput, { width: 64 }]}
              />
              <TextInput
                keyboardType="numeric"
                value={String(it.unitCost ?? 0)}
                onChangeText={(v) => updateLine(idx, { unitCost: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                style={[styles.smallInput, { width: 84 }]}
              />
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.card, styles.total]}>
        <Text style={styles.totalText}>Total</Text>
        <Text style={styles.totalText}>${total.toFixed(2)}</Text>
      </View>

      <TouchableOpacity style={styles.primary} onPress={saveInvoice}>
        <Text style={styles.primaryText}>Save / Post Invoice</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { opacity: 0.7, marginBottom: 8 },
  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, gap: 8 },
  label: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  section: { fontWeight: '800', marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  lineName: { fontWeight: '700' },
  muted: { opacity: 0.6, fontSize: 12 },
  lineInputs: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallInput: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalText: { fontWeight: '900', fontSize: 18 },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryText: { color: 'white', fontWeight: '800' },
});
