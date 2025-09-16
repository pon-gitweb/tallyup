import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { addQuickItem } from '../../../services/areaInventory';

type Props = {
  venueId: string;
  departmentId: string;
  areaId: string;
  onAdded?: () => void;
};

export default function FastAddInline({ venueId, departmentId, areaId, onAdded }: Props) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);

  async function onAdd() {
    const n = name.trim();
    if (!n) { Alert.alert('Missing name', 'Please enter an item name.'); return; }
    const initialQty = qty.trim() === '' ? null : Number(qty);
    if (qty.trim() !== '' && Number.isNaN(initialQty)) {
      Alert.alert('Invalid qty', 'Quantity must be a number.'); return;
    }
    try {
      setBusy(true);
      await addQuickItem(venueId, departmentId, areaId, {
        name: n,
        unit: unit.trim() || null,
        initialQty: initialQty as number | null
      });
      setName(''); setUnit(''); setQty('');
      onAdded?.();
      Alert.alert('Added', 'Item created.');
    } catch (e: any) {
      Alert.alert('Add failed', e?.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={S.wrap}>
      <Text style={S.h}>Quick add item</Text>
      <View style={S.row}>
        <TextInput style={[S.input, { flex: 1.6 }]} placeholder="Item name" value={name} onChangeText={setName} />
        <TextInput style={[S.input, { flex: 0.8 }]} placeholder="Unit (optional)" value={unit} onChangeText={setUnit} />
        <TextInput style={[S.input, { width: 90 }]} placeholder="Qty" keyboardType="numeric" value={qty} onChangeText={setQty} />
      </View>
      <TouchableOpacity
        style={[S.primary, (!name.trim() || busy) && S.disabled]}
        onPress={onAdd}
        disabled={!name.trim() || busy}
      >
        <Text style={S.primaryText}>{busy ? 'Adding…' : 'Add to area'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { backgroundColor: '#eef6ff', padding: 12, borderRadius: 12, marginBottom: 12 },
  h: { fontWeight: '800', marginBottom: 8, color: '#0A84FF' },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  input: {
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#cfe3ff',
  },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
