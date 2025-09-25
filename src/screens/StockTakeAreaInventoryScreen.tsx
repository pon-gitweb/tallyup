// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, Modal, Pressable, SafeAreaView,
  ScrollView, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc
} from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from 'src/context/VenueProvider';

type Item = {
  id: string;
  name: string;
  lastCount?: number;
  lastCountAt?: any;
  createdAt?: any;
  updatedAt?: any;
  unit?: string;
  supplierId?: string;
  costPrice?: number;
  salePrice?: number;
  parLevel?: number; // expected qty (PAR)
  productId?: string;
  productName?: string;
};

type AreaDoc = {
  name: string;
  createdAt?: any;
  updatedAt?: any;
  startedAt?: any;
  completedAt?: any;
};

type RouteParams = {
  venueId?: string;
  departmentId: string;
  areaId: string;
  areaName?: string;
};

export default function StockTakeAreaInventoryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueIdFromCtx = useVenueId();
  const { departmentId, areaId, areaName, venueId: venueIdFromRoute } = (route.params ?? {}) as RouteParams;
  const venueId = venueIdFromCtx || venueIdFromRoute;

  const itemsPathOk = !!venueId && !!departmentId && !!areaId;

  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState('');
  const [addingName, setAddingName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [localQty, setLocalQty] = useState<Record<string, string>>({});
  const [showExpected, setShowExpected] = useState(true);
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!itemsPathOk) return;
    const q = query(
      collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items'),
      orderBy('name')
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: Item[] = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
      setItems(rows);
    });
    return () => unsub();
  }, [itemsPathOk, venueId, departmentId, areaId]);

  const filtered = useMemo(() => {
    const base = !filter.trim()
      ? items
      : items.filter((it) => (it.name || '').toLowerCase().includes(filter.trim().toLowerCase()));
    return base;
  }, [items, filter]);

  const { toCount, counted } = useMemo(() => {
    const t: Item[] = [];
    const c: Item[] = [];
    for (const it of filtered) {
      if (it.lastCountAt) c.push(it); else t.push(it);
    }
    return { toCount: t, counted: c };
  }, [filtered]);

  const itemsCol = () => collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items');
  const areaRef  = () => doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId);
  const areasCol = () => collection(db, 'venues', venueId!, 'departments', departmentId, 'areas');

  // ---------- CREATE ----------
  const addQuickItem = async () => {
    const trimmed = (addingName || '').trim();
    if (!trimmed) return Alert.alert('Name required', 'Please enter a name.');
    try {
      await addDoc(itemsCol(), { name: trimmed, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setAddingName(''); nameInputRef.current?.blur(); Keyboard.dismiss();
    } catch (e: any) { console.log('[QuickCreate:error]', e); Alert.alert('Could not add item', e?.message ?? String(e)); }
  };

  // ---------- LIFECYCLE ----------
  const ensureAreaStarted = async () => {
    try {
      const a = await getDoc(areaRef());
      const data = a.data() as AreaDoc | undefined;
      if (!data?.startedAt) await updateDoc(areaRef(), { startedAt: serverTimestamp() });
    } catch (e) { /* soft-fail */ }
  };

  // ---------- UPDATE: counts ----------
  const saveCount = async (itemId: string, effectiveRaw: string) => {
    const raw = (effectiveRaw ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return Alert.alert('Invalid number', 'Enter a numeric quantity (e.g. 20 or 20.5).');
    const qty = parseFloat(raw);
    try {
      await ensureAreaStarted();
      await updateDoc(doc(itemsCol(), itemId), { lastCount: qty, lastCountAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setLocalQty((m) => ({ ...m, [itemId]: '' }));
    } catch (e: any) { console.log('[CountSave:error]', e); Alert.alert('Could not save count', e?.message ?? String(e)); }
  };

  // ---------- UPDATE: rename ----------
  const startRename = (item: Item) => { setEditingId(item.id); setEditingName(item.name); };
  const commitRename = async () => {
    const id = editingId; const nm = editingName.trim();
    if (!id) return;
    if (!nm) return Alert.alert('Name required', 'Item name cannot be empty.');
    try { await updateDoc(doc(itemsCol(), id), { name: nm, updatedAt: serverTimestamp() }); setEditingId(null); setEditingName(''); }
    catch (e: any) { console.log('[Rename:error]', e); Alert.alert('Could not rename', e?.message ?? String(e)); }
  };

  // ---------- DELETE ----------
  const removeItem = async (itemId: string) => {
    Alert.alert('Delete item', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteDoc(doc(itemsCol(), itemId)); } 
        catch (e: any) { console.log('[Delete:error]', e); Alert.alert('Could not delete', e?.message ?? String(e)); }
      } }
    ]);
  };

  // ---------- Finalization ----------
  const completeArea = async () => {
    const missing = items.filter((it) => !it.lastCountAt);
    const perform = async () => {
      try {
        if (missing.length > 0) {
          await Promise.all(missing.map((it) => updateDoc(doc(itemsCol(), it.id), { lastCount: 0, lastCountAt: serverTimestamp(), updatedAt: serverTimestamp() })));
        }
        await updateDoc(areaRef(), { completedAt: serverTimestamp() }); // lifecycle-only
        // (optional full-finalization logic lives elsewhere; rules-compatible)
        nav.goBack();
      } catch (e: any) { console.log('[CompleteArea:error]', e); Alert.alert('Could not complete area', e?.message ?? String(e)); }
    };

    if (missing.length > 0) {
      Alert.alert('Incomplete counts',
        `There are ${missing.length.toLocaleString()} item(s) without a count.\n\nContinue and record 0 for them, or go back to enter totals?`,
        [{ text: 'Enter totals', style: 'cancel' }, { text: 'Continue with 0', onPress: perform }]
      );
    } else {
      await perform();
    }
  };

  // ---------- stubs ----------
  const useBluetoothFor = (item: Item) => Alert.alert('Bluetooth Count', `Would read from paired scale for "${item.name}" (stub).`);
  const usePhotoFor     = (item: Item) => Alert.alert('Photo Count',     `Would take photo and OCR for "${item.name}" (stub).`);

  // ---------- Row ----------
  const Row = ({ item }: { item: Item }) => {
    // DISPLAYED value logic:
    // - If user has typed -> show localQty
    // - Else if showExpected ON and parLevel exists -> show parLevel
    // - Else -> empty
    const typed = localQty[item.id];
    const expected = (typeof item.parLevel === 'number') ? String(item.parLevel) : '';
    const displayed = typed !== undefined && typed !== '' ? typed : (showExpected ? expected : '');

    const placeholder = showExpected && expected ? `qty (expected ${expected})` : 'qty';

    return (
      <Pressable
        style={{ paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            {editingId === item.id ? (
              <TextInput
                value={editingName}
                onChangeText={setEditingName}
                onBlur={commitRename}
                onSubmitEditing={commitRename}
                autoFocus
                placeholder="Item name"
                style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, fontSize: 16 }}
              />
            ) : (
              <TouchableOpacity onLongPress={() => startRename(item)}>
                <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
                <Text style={{ fontSize: 12, color: item.lastCountAt ? '#4CAF50' : '#999' }}>
                  {item.lastCountAt ? `Counted: ${item.lastCount}` : 'Not counted'}
                  {showExpected && typeof item.parLevel === 'number' ? `   •   Expected: ${item.parLevel}` : ''}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={displayed}
            onChangeText={(t) => setLocalQty((m) => ({ ...m, [item.id]: t }))}
            placeholder={placeholder}
            keyboardType="numeric"
            inputMode="decimal"
            maxLength={32}
            returnKeyType="done"
            blurOnSubmit={false}           // DON'T collapse after first digit
            // no onSubmitEditing here; user taps Save explicitly
            style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 10 }}
          />

          <TouchableOpacity
            onPress={() => saveCount(item.id, displayed)}
            style={{ backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }}
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>Save</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => useBluetoothFor(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#E3F2FD' }}>
            <Text style={{ color: '#0A84FF', fontWeight: '700' }}>BT</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => usePhotoFor(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#FFF8E1' }}>
            <Text style={{ color: '#FF6F00', fontWeight: '700' }}>Cam</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => removeItem(item.id)} style={{ padding: 6 }}>
            <Text style={{ color: '#D32F2F', fontWeight: '800' }}>Del</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    );
  };

  const Section = ({ title, data }: { title: string; data: Item[] }) => (
    <View style={{ marginTop: 10 }}>
      <Text style={{ marginHorizontal: 12, marginBottom: 6, fontWeight: '800', color: '#666' }}>{title} ({data.length})</Text>
      <FlatList
        data={data}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => <Row item={item} />}
        ListEmptyComponent={<Text style={{ paddingHorizontal: 12, paddingVertical: 10, color: '#999' }}>No items</Text>}
      />
    </View>
  );

  if (!itemsPathOk) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, textAlign: 'center' }}>Missing navigation params. Need venueId, departmentId and areaId.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>{areaName ?? 'Area Inventory'}</Text>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Search items…"
            style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 12 }}
          />
          <TouchableOpacity onPress={() => setShowExpected((v) => !v)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F1F8E9' }}>
            <Text style={{ color: '#558B2F', fontWeight: '700' }}>{showExpected ? 'Hide expected' : 'Show expected'}</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Add */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            ref={nameInputRef}
            value={addingName}
            onChangeText={setAddingName}
            placeholder="Quick add item name"
            style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 12 }}
          />
          <TouchableOpacity onPress={addQuickItem} style={{ backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Lists */}
      <FlatList
        ListHeaderComponent={<><Section title="To count" data={toCount} /><Section title="Counted" data={counted} /></>}
        data={[]}
        renderItem={null as any}
        keyExtractor={() => 'x'}
      />

      {/* Sticky footer Submit */}
      <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff' }}>
        <TouchableOpacity onPress={completeArea} style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#E8F5E9' }}>
          <Text style={{ textAlign: 'center', color: '#2E7D32', fontWeight: '800' }}>✅ Submit Area</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
