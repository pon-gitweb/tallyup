import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  TextInput, FlatList, Modal, Pressable
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';

type RouteParams = { departmentId: string; areaId: string; areaName?: string };
type ItemRow = { id: string; name: string; unit?: string; lastCount?: number };
type Mode = 'COUNT' | 'WEIGHT' | 'PHOTO';

// 👇 Replace with live products later; writing stays rule‑safe today.
const MOCK_ITEMS: ItemRow[] = [
  { id: 'beer-hein-330', name: 'Heineken 330ml', unit: 'bottles' },
  { id: 'wine-house-750', name: 'House Red 750ml', unit: 'bottles' },
  { id: 'fruit-limes', name: 'Limes', unit: 'each' },
];

export default function StockTakeAreaInventoryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { departmentId, areaId, areaName }: RouteParams = route.params || {};
  const venueId = useVenueId();

  const [mode, setMode] = useState<Mode>('COUNT');
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [keypadFor, setKeypadFor] = useState<ItemRow | null>(null);
  const [keypadValue, setKeypadValue] = useState<string>('');

  const items = useMemo(() => {
    if (!query) return MOCK_ITEMS;
    const q = query.toLowerCase();
    return MOCK_ITEMS.filter(i => i.name.toLowerCase().includes(q));
  }, [query]);

  async function ensureAreaStarted() {
    if (!venueId) return;
    try {
      // First write flips startedAt (idempotent if already set).
      const aRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
      await updateDoc(aRef, { startedAt: serverTimestamp() });
      console.log('[TallyUp Inventory] startedAt set');
    } catch (e: any) {
      // Safe to ignore if already started / missing perms for identical value
      console.log('[TallyUp Inventory] startedAt skip', JSON.stringify({ code: e?.code, message: e?.message }));
    }
  }

  async function saveItemCount(item: ItemRow, valueStr: string) {
    if (!venueId) return;
    const value = valueStr === '' ? null : Number(valueStr);
    try {
      await ensureAreaStarted();
      // Only lastCount / lastCountAt → allowed by rules
      const iRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', item.id);
      await setDoc(iRef, { lastCount: value, lastCountAt: serverTimestamp() }, { merge: true });
      console.log('[TallyUp Inventory] saved', { id: item.id, value });
    } catch (e: any) {
      console.log('[TallyUp Inventory] save error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Save Failed', e?.message ?? 'Unknown error.');
    }
  }

  function onChange(item: ItemRow, txt: string) {
    setCounts(prev => ({ ...prev, [item.id]: txt }));
  }

  async function onSubmit() {
    // Validate numeric entries
    const invalid = Object.entries(counts).some(([_, v]) => v !== '' && isNaN(Number(v)));
    if (invalid) {
      Alert.alert('Check Counts', 'Some counts are not valid numbers.');
      return;
    }

    // Offer to save blanks as 0
    const blanks = items.filter(it => (counts[it.id] ?? '') === '');
    if (blanks.length) {
      let proceed = false;
      await new Promise<void>((resolve) => {
        Alert.alert(
          'Missing counts',
          `You have ${blanks.length} blank items. Save these as 0?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
            { text: 'Save as 0', onPress: () => { proceed = true; resolve(); } },
          ]
        );
      });
      if (!proceed) return;
      blanks.forEach(b => counts[b.id] = '0');
      setCounts({ ...counts });
    }

    // Persist edited values
    for (const it of items) {
      const v = counts[it.id];
      if (v !== undefined) await saveItemCount(it, v);
    }

    // Mark area completed
    if (venueId) {
      try {
        const aRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
        await updateDoc(aRef, { completedAt: serverTimestamp() });
        Alert.alert('Area complete', `${areaName || areaId} is completed.`);
        nav.goBack(); // return to Areas list
      } catch (e: any) {
        console.log('[TallyUp Inventory] complete error', JSON.stringify({ code: e?.code, message: e?.message }));
        Alert.alert('Complete Failed', e?.message || 'Unknown error.');
      }
    }
  }

  // —— Keypad modal (long‑press) ——
  function openKeypad(item: ItemRow) {
    setKeypadFor(item);
    setKeypadValue(counts[item.id] ?? '');
  }
  function closeKeypad() { setKeypadFor(null); }
  async function keypadSave() {
    if (!keypadFor) return;
    onChange(keypadFor, keypadValue);
    closeKeypad();
  }

  // —— Stubs ——
  async function onScale(item: ItemRow) {
    console.log('[Scale] Connecting…');
    console.log('[Scale] Reading…');
    console.log('[Scale] Fallback');
    const mockGrams = 499; // fake reading
    onChange(item, String(mockGrams));
  }

  async function onPhotoAI(item: ItemRow) {
    console.log('[PhotoAI] Opening camera (stub)…');
    const estimate = 12;
    console.log('[PhotoAI] Estimate =', estimate);
    onChange(item, String(estimate));
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{areaName || areaId}</Text>

      <View style={styles.modes}>
        <TouchableOpacity style={[styles.modeBtn, mode === 'COUNT' && styles.modeActive]} onPress={() => setMode('COUNT')}>
          <Text style={[styles.modeText, mode === 'COUNT' ? styles.modeTextActive : undefined]}>Count</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeBtn, mode === 'WEIGHT' && styles.modeActive]} onPress={() => setMode('WEIGHT')}>
          <Text style={[styles.modeText, mode === 'WEIGHT' ? styles.modeTextActive : undefined]}>Weight</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeBtn, mode === 'PHOTO' && styles.modeActive]} onPress={() => setMode('PHOTO')}>
          <Text style={[styles.modeText, mode === 'PHOTO' ? styles.modeTextActive : undefined]}>Photo</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <TextInput placeholder="Search items…" value={query} onChangeText={setQuery} style={styles.search} />
        <TouchableOpacity style={styles.saveBtn} onPress={onSubmit}><Text style={styles.saveText}>Submit Area</Text></TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          if (mode === 'COUNT') {
            return (
              <TouchableOpacity style={styles.itemRow} onLongPress={() => openKeypad(item)} delayLongPress={250}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemSub}>{item.unit || ''}</Text>
                </View>
                <TextInput
                  value={counts[item.id] ?? ''}
                  onChangeText={(t) => onChange(item, t)}
                  placeholder="0"
                  keyboardType="numeric"
                  style={styles.qtyInput}
                />
              </TouchableOpacity>
            );
          }
          if (mode === 'WEIGHT') {
            return (
              <View style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemSub}>Bluetooth scale (stub)</Text>
                </View>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => onScale(item)}>
                  <Text style={styles.secondaryText}>Capture</Text>
                </TouchableOpacity>
              </View>
            );
          }
          // PHOTO
          return (
            <View style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemSub}>Attach photo / AI estimate (stub)</Text>
              </View>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => onPhotoAI(item)}>
                <Text style={styles.secondaryText}>Add</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={<Text>No items.</Text>}
      />

      {/* Keypad modal */}
      <Modal visible={!!keypadFor} transparent animationType="fade" onRequestClose={closeKeypad}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{keypadFor?.name}</Text>
            <TextInput
              value={keypadValue}
              onChangeText={setKeypadValue}
              keyboardType="numeric"
              placeholder="0"
              style={styles.modalInput}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable style={styles.secondaryBtn} onPress={closeKeypad}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryBtn} onPress={keypadSave}><Text style={styles.primaryText}>Save</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  modes: { flexDirection: 'row', gap: 8 },
  modeBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#E5E7EB' },
  modeActive: { backgroundColor: '#0A84FF' },
  modeText: { fontWeight: '700' },
  modeTextActive: { color: 'white' },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: { flex: 1, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  saveBtn: { backgroundColor: '#0A84FF', paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' },
  saveText: { color: 'white', fontWeight: '700' },
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F2F7', borderRadius: 12, padding: 12 },
  itemName: { fontWeight: '700' },
  itemSub: { opacity: 0.7, marginTop: 2 },
  qtyInput: { width: 80, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center', backgroundColor: 'white' },
  secondaryBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  secondaryText: { fontWeight: '700' },
  primaryBtn: { backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  primaryText: { color: 'white', fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { backgroundColor: 'white', padding: 16, borderRadius: 12, width: '85%' },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
});
