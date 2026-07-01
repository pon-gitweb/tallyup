// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { createCreditNote, type CreditNoteLineInput } from '../../services/invoices/creditNotes';

type Supplier = { id: string; name: string };

type LineDraft = CreditNoteLineInput;

const emptyLine = (): LineDraft => ({ name: '', qtyReturned: 0, creditAmountPerUnit: 0 });

export default function CreditNoteFormScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { showSuccess, showError } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const [originalInvoiceId, setOriginalInvoiceId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'suppliers'))
      .then(snap => setSuppliers(snap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id }))))
      .catch(() => {});
  }, [venueId]);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum - Math.abs(Number(l.qtyReturned) || 0) * Math.abs(Number(l.creditAmountPerUnit) || 0), 0),
    [lines],
  );

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines(prev => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    setLines(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!venueId) return;
    setSaving(true);
    try {
      const result = await createCreditNote({
        venueId,
        supplierId,
        supplierName: supplierName || null,
        originalInvoiceId: originalInvoiceId.trim() || null,
        date,
        notes: notes.trim() || null,
        lines,
      });
      if (!result.ok) {
        showError(result.error || 'Could not save credit note');
        return;
      }
      showSuccess('✓ Credit note recorded.');
      nav.goBack();
    } catch (e: any) {
      showError(e?.message || 'Could not save credit note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={styles.wrap}>
      <Text style={[styles.title, { color: c.navy }]}>Record credit note</Text>
      <Text style={[styles.sub, { color: c.textSecondary }]}>
        For returned/damaged stock, overcharge corrections, or delivery shortfalls.
        Quantities and amounts are recorded as negative — stock is reduced by the quantity returned.
      </Text>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.navy }]}>Supplier</Text>
        <TouchableOpacity
          style={[styles.input, { borderColor: c.border, justifyContent: 'center' }]}
          onPress={() => setPickerOpen(true)}
        >
          <Text style={{ color: supplierName ? c.navy : c.textSecondary }}>
            {supplierName || 'Select supplier'}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.label, { color: c.navy }]}>Original invoice reference (optional)</Text>
        <TextInput
          placeholder="INV-1001"
          value={originalInvoiceId}
          onChangeText={setOriginalInvoiceId}
          autoCapitalize="characters"
          style={[styles.input, { borderColor: c.border, color: c.navy }]}
          placeholderTextColor={c.textSecondary}
        />

        <Text style={[styles.label, { color: c.navy }]}>Date (YYYY-MM-DD)</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          autoCapitalize="none"
          style={[styles.input, { borderColor: c.border, color: c.navy }]}
          placeholderTextColor={c.textSecondary}
        />
      </View>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.section, { color: c.navy }]}>Line items</Text>
        {lines.map((l, idx) => (
          <View key={idx} style={styles.line}>
            <TextInput
              placeholder="Product name"
              value={l.name}
              onChangeText={(v) => updateLine(idx, { name: v })}
              style={[styles.input, { flex: 1, borderColor: c.border, color: c.navy }]}
              placeholderTextColor={c.textSecondary}
            />
            <TextInput
              placeholder="Qty returned"
              keyboardType="numeric"
              value={String(l.qtyReturned || '')}
              onChangeText={(v) => updateLine(idx, { qtyReturned: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
              style={[styles.input, styles.smallInput, { borderColor: c.border, color: c.navy }]}
              placeholderTextColor={c.textSecondary}
            />
            <TextInput
              placeholder="Credit $/unit"
              keyboardType="numeric"
              value={String(l.creditAmountPerUnit || '')}
              onChangeText={(v) => updateLine(idx, { creditAmountPerUnit: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
              style={[styles.input, styles.smallInput, { borderColor: c.border, color: c.navy }]}
              placeholderTextColor={c.textSecondary}
            />
            {lines.length > 1 && (
              <TouchableOpacity onPress={() => removeLine(idx)} style={styles.removeBtn}>
                <Text style={{ color: c.textSecondary, fontSize: 18 }}>×</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <TouchableOpacity onPress={addLine} style={styles.addLine}>
          <Text style={{ color: c.deepBlue, fontWeight: '700' }}>+ Add line</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.navy }]}>Notes (optional)</Text>
        <TextInput
          placeholder="e.g. 2 cases damaged on delivery"
          value={notes}
          onChangeText={setNotes}
          multiline
          style={[styles.input, { borderColor: c.border, color: c.navy, minHeight: 60 }]}
          placeholderTextColor={c.textSecondary}
        />
      </View>

      <View style={[styles.card, styles.total, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.totalText, { color: c.navy }]}>Credit total</Text>
        <Text style={[styles.totalText, { color: c.navy }]}>${total.toFixed(2)}</Text>
      </View>

      <TouchableOpacity
        style={[styles.primary, { backgroundColor: c.deepBlue, opacity: saving ? 0.6 : 1 }]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save credit note</Text>}
      </TouchableOpacity>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={[styles.modalCard, { backgroundColor: c.surface }]}>
            <Text style={[styles.section, { color: c.navy, marginBottom: 8 }]}>Select supplier</Text>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={suppliers}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.supplierRow}
                  onPress={() => { setSupplierId(item.id); setSupplierName(item.name); setPickerOpen(false); }}
                >
                  <Text style={{ color: c.navy }}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={() => <Text style={{ color: c.textSecondary, padding: 12 }}>No suppliers on file.</Text>}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  label: { fontWeight: '700', fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  section: { fontWeight: '800', marginBottom: 4 },
  line: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  smallInput: { width: 90, textAlign: 'right' },
  removeBtn: { paddingHorizontal: 6 },
  addLine: { paddingVertical: 8 },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalText: { fontWeight: '900', fontSize: 18 },
  primary: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  modalCard: { width: '85%', maxHeight: '60%', borderRadius: 14, padding: 16 },
  supplierRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' },
});
