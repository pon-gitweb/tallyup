import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TextInput, TouchableOpacity, Linking, ScrollView } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { Supplier } from '../../services/suppliers';
import { OrderLine, buildSuggestedOrdersInMemory, createDraftOrderWithLines, submitOrder } from '../../services/orders';
import { getAuth } from 'firebase/auth';

type SupplierBlock = {
  supplier: Supplier;
  lines: (OrderLine & { key: string })[];
  notes?: string;
  draftOrderId?: string;
};

export default function SuggestedOrderScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<SupplierBlock[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!venueId) { setLoading(false); return; }
      try {
        const { suppliers, bySupplier } = await buildSuggestedOrdersInMemory(venueId);
        const out: SupplierBlock[] = [];
        Object.keys(bySupplier).forEach(sid => {
          const sup = suppliers[sid];
          if (!sup) return;
          out.push({
            supplier: sup,
            lines: bySupplier[sid].map((l, idx) => ({ ...l, key: `${sid}:${l.productId}:${idx}` })),
            notes: '',
          });
        });
        out.sort((a, b) => (a.supplier.name || '').localeCompare(b.supplier.name || ''));
        if (!cancel) setBlocks(out);
      } catch (e: any) {
        Alert.alert('Build Failed', e?.message || 'Unknown error');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [venueId]);

  const grandTotal = useMemo(() => {
    let sum = 0;
    blocks.forEach(b => {
      b.lines.forEach(l => {
        if (l.unitCost != null) sum += (Number(l.unitCost) || 0) * (Number(l.qty) || 0);
      });
    });
    return sum;
  }, [blocks]);

  function updateQty(bi: number, li: number, v: string) {
    const qty = Number(v.replace(/[^0-9.]/g, '')) || 0;
    setBlocks(prev => {
      const copy = [...prev];
      copy[bi] = { ...copy[bi], lines: [...copy[bi].lines] };
      copy[bi].lines[li] = { ...copy[bi].lines[li], qty };
      return copy;
    });
  }

  function updateNotes(bi: number, v: string) {
    setBlocks(prev => {
      const copy = [...prev];
      copy[bi] = { ...copy[bi], notes: v };
      return copy;
    });
  }

  async function onCreateDrafts() {
    if (!venueId) return;
    if (!blocks.length) { Alert.alert('Nothing to order', 'All products are at or above par.'); return; }
    const auth = getAuth();
    if (!auth.currentUser?.uid) { Alert.alert('Not signed in', 'Sign in again.'); return; }

    setCreating(true);
    try {
      const next: SupplierBlock[] = [];
      for (const b of blocks) {
        const validLines = b.lines.filter(l => (Number(l.qty) || 0) > 0);
        if (!validLines.length) { next.push(b); continue; }

        const orderId = await createDraftOrderWithLines(venueId, b.supplier.id!, validLines, b.notes || '');
        next.push({ ...b, draftOrderId: orderId });
      }
      setBlocks(next);
      Alert.alert('Drafts Created', 'Draft orders were created by supplier.');
    } catch (e: any) {
      Alert.alert('Create Failed', e?.message || 'Unknown error');
    } finally {
      setCreating(false);
    }
  }

  async function onSubmit(bi: number) {
    if (!venueId) return;
    const b = blocks[bi];
    if (!b.draftOrderId) { Alert.alert('No Draft', 'Create the draft first.'); return; }
    try {
      await submitOrder(venueId, b.draftOrderId);
      Alert.alert('Order Submitted', `Order ${b.draftOrderId} submitted.`);
    } catch (e: any) {
      Alert.alert('Submit Failed', e?.message || 'Unknown error');
    }
  }

  function onEmail(bi: number) {
    const b = blocks[bi];
    const email = (b.supplier.email || '').trim();
    if (!email) { Alert.alert('No Email', 'Supplier has no email configured.'); return; }
    const subject = encodeURIComponent(`Order from TallyUp`);
    const lines = b.lines
      .filter(l => (Number(l.qty) || 0) > 0)
      .map(l => {
        const price = l.unitCost != null ? ` @ ${l.unitCost}` : '';
        const pack = l.packSize ? ` (pack ${l.packSize})` : '';
        return `- ${l.name}: ${l.qty}${pack}${price}`;
      })
      .join('%0D%0A');
    const note = b.notes ? `%0D%0ANotes: ${encodeURIComponent(b.notes)}` : '';
    const body = `${lines}${note}`;
    const url = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
    Linking.openURL(url).catch(() => Alert.alert('Email Failed', 'Could not open mail app.'));
  }

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Building suggested orders…</Text></View>);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>Suggested Orders</Text>
      <Text style={styles.sub}>One draft per supplier. Edit quantities before creating drafts.</Text>

      {!blocks.length ? (
        <Text>No suggestions: all products appear at par or above.</Text>
      ) : null}

      {blocks.map((b, bi) => (
        <View key={b.supplier.id} style={styles.card}>
          <Text style={styles.cardTitle}>{b.supplier.name}</Text>
          {b.lines.map((l, li) => (
            <View key={l.key} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName}>{l.name}</Text>
                <Text style={styles.lineSub}>
                  {(l.packSize ? `Pack ${l.packSize} · ` : '')}
                  {(l.unitCost != null ? `Cost ${l.unitCost}` : '')}
                </Text>
              </View>
              <View style={styles.qtyBox}>
                <Text style={styles.qtyLbl}>Qty</Text>
                <TextInput
                  style={styles.qtyInput}
                  keyboardType="numeric"
                  value={String(l.qty)}
                  onChangeText={(v) => updateQty(bi, li, v)}
                />
              </View>
            </View>
          ))}
          <Text style={styles.lbl}>Notes</Text>
          <TextInput
            value={b.notes}
            onChangeText={(v) => updateNotes(bi, v)}
            style={styles.note}
            placeholder="Optional instructions for supplier"
          />

          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.btn, b.draftOrderId && styles.btnDisabled]}
              onPress={onCreateDrafts}
              disabled={b.draftOrderId != null || creating}
            >
              <Text style={styles.btnText}>{b.draftOrderId ? 'Draft Created' : 'Create Draft Orders'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btn} onPress={() => onEmail(bi)}>
              <Text style={styles.btnText}>Email Order</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btn} onPress={() => onSubmit(bi)} disabled={!b.draftOrderId}>
              <Text style={styles.btnText}>Submit</Text>
            </TouchableOpacity>
          </View>

          {b.draftOrderId ? <Text style={styles.idNote}>Draft ID: {b.draftOrderId}</Text> : null}
        </View>
      ))}

      <View style={styles.totCard}>
        <Text style={styles.tot}>Total (priced lines): {grandTotal.toFixed(2)}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { opacity: 0.7, marginBottom: 6 },
  card: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, marginBottom: 12, gap: 10 },
  cardTitle: { fontWeight: '800', fontSize: 16 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineName: { fontWeight: '700' },
  lineSub: { opacity: 0.7 },
  qtyBox: { width: 90, alignItems: 'center' },
  qtyLbl: { fontSize: 12, opacity: 0.7 },
  qtyInput: { width: 80, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'center' },
  lbl: { fontWeight: '700', marginTop: 8 },
  note: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { flex: 1, backgroundColor: '#0A84FF', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#9EC9FF' },
  btnText: { color: 'white', fontWeight: '700' },
  idNote: { opacity: 0.7, marginTop: 4 },
  totCard: { backgroundColor: '#EFEFF4', padding: 12, borderRadius: 12, marginTop: 6 },
  tot: { fontWeight: '800' },
});
