import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  TextInput, FlatList, Modal, Pressable, ActivityIndicator, ScrollView, Switch
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import {
  doc, setDoc, updateDoc, serverTimestamp,
  collection, getDocs, query, orderBy, limit, addDoc, deleteDoc, Timestamp
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';

type RouteParams = { departmentId: string; areaId: string; areaName?: string };
type ItemRow = {
  id: string;
  name: string;
  unit?: string | null;
  supplierId?: string | null;
  costPrice?: number | null;
  salePrice?: number | null;
  parLevel?: number | null;
  lastCount?: number | null;
  lastCountAt?: any | null;
};
type Mode = 'COUNT' | 'WEIGHT' | 'PHOTO';

// While first live load is pending we can show a couple of MOCK items for continuity.
// Once loaded (even if empty), real list replaces them so CRUD & exp are visible.
const MOCK_ITEMS: ItemRow[] = [
  { id: 'beer-hein-330', name: 'Heineken 330ml', unit: 'bottles' },
  { id: 'wine-house-750', name: 'House Red 750ml', unit: 'bottles' },
];

export default function StockTakeAreaInventoryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { departmentId, areaId, areaName }: RouteParams = route.params || {};
  const venueId = useVenueId();

  const [mode, setMode] = useState<Mode>('COUNT');
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});

  const [liveItems, setLiveItems] = useState<ItemRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Expected-qty toggle (default ON)
  const [showExpected, setShowExpected] = useState(true);

  // Keypad (long-press) state
  const [keypadFor, setKeypadFor] = useState<ItemRow | null>(null);
  const [keypadValue, setKeypadValue] = useState<string>('');

  // Edit modal (update)
  const [editFor, setEditFor] = useState<ItemRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editSupplierId, setEditSupplierId] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editSale, setEditSale] = useState('');
  const [editPar, setEditPar] = useState('');

  // Long Add modal (create full)
  const [showLongAdd, setShowLongAdd] = useState(false);
  const [laName, setLaName] = useState('');
  const [laUnit, setLaUnit] = useState('');
  const [laSupplierId, setLaSupplierId] = useState('');
  const [laCost, setLaCost] = useState('');
  const [laSale, setLaSale] = useState('');
  const [laPar, setLaPar] = useState('');
  const [laInitialQty, setLaInitialQty] = useState('');

  // ——————————— Load items ———————————
  async function reloadItems() {
    if (!venueId || !departmentId || !areaId) { setLiveItems([]); setLoading(false); return; }
    try {
      setLoading(true);
      const colRef = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
      const snap = await getDocs(query(colRef, orderBy('name'), limit(1000)));
      const list: ItemRow[] = snap.docs.map(d => {
        const it: any = d.data();
        return {
          id: d.id,
          name: it?.name || d.id,
          unit: it?.unit ?? null,
          supplierId: it?.supplierId ?? null,
          costPrice: typeof it?.costPrice === 'number' ? it.costPrice : null,
          salePrice: typeof it?.salePrice === 'number' ? it.salePrice : null,
          parLevel: typeof it?.parLevel === 'number' ? it.parLevel : null,
          lastCount: typeof it?.lastCount === 'number' ? it.lastCount : null,
          lastCountAt: it?.lastCountAt ?? null,
        };
      });
      setLiveItems(list);
    } catch (e: any) {
      console.log('[AreaInventory] reloadItems error', e?.message);
      setLiveItems([]); // still show CRUD/exp UI
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reloadItems(); }, [venueId, departmentId, areaId]);

  // Derived list (search)
  const items = useMemo(() => {
    const base = liveItems === null ? MOCK_ITEMS : liveItems;
    if (!q.trim()) return base;
    const needle = q.trim().toLowerCase();
    return base.filter(i =>
      [i.name, i.unit ?? '', i.supplierId ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [q, liveItems]);

  // ——————————— Helpers ———————————
  const numOrNull = (s: string) => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  };

  async function ensureAreaStarted() {
    if (!venueId) return;
    try {
      const aRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
      await updateDoc(aRef, { startedAt: serverTimestamp() });
    } catch {
      // ignore (already started / identical)
    }
  }

  // ——————————— CREATE ———————————
  async function addItemQuick(name: string, costPrice?: string, salePrice?: string) {
    if (!venueId) return;
    const n = name.trim();
    if (!n) throw new Error('Missing item name');
    const colRef = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
    const now = serverTimestamp();
    const body: any = {
      name: n,
      createdAt: now,
      updatedAt: now,
    };
    const cp = numOrNull(costPrice ?? '');
    const sp = numOrNull(salePrice ?? '');
    if (cp !== null) body.costPrice = cp;
    if (sp !== null) body.salePrice = sp;
    await addDoc(colRef, body);
    await reloadItems();
  }

  async function addItemFull() {
    if (!venueId) return;
    const n = laName.trim();
    if (!n) { Alert.alert('Missing name', 'Please enter a name.'); return; }
    const colRef = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
    const now = serverTimestamp();
    const body: any = {
      name: n,
      unit: laUnit.trim() || null,
      supplierId: laSupplierId.trim() || null,
      costPrice: numOrNull(laCost),
      salePrice: numOrNull(laSale),
      parLevel: numOrNull(laPar),
      createdAt: now,
      updatedAt: now,
    };
    const initialQty = numOrNull(laInitialQty);
    if (initialQty !== null) {
      body.lastCount = initialQty;
      body.lastCountAt = now;
    }
    await addDoc(colRef, body);
    setShowLongAdd(false);
    setLaName(''); setLaUnit(''); setLaSupplierId(''); setLaCost(''); setLaSale(''); setLaPar(''); setLaInitialQty('');
    await reloadItems();
    Alert.alert('Added', 'Item created.');
  }

  // ——————————— UPDATE / DELETE ———————————
  async function updateItemMeta(itemId: string) {
    if (!venueId) return;
    const iRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', itemId);
    await updateDoc(iRef, {
      name: editName.trim() || null,
      unit: editUnit.trim() || null,
      supplierId: editSupplierId.trim() || null,
      costPrice: numOrNull(editCost),
      salePrice: numOrNull(editSale),
      parLevel: numOrNull(editPar),
      updatedAt: serverTimestamp(),
    });
    setEditFor(null);
    await reloadItems();
  }

  async function deleteItem(itemId: string) {
    if (!venueId) return;
    const iRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', itemId);
    await deleteDoc(iRef);
    const c = { ...counts }; delete c[itemId]; setCounts(c);
    await reloadItems();
  }

  // ——————————— COUNTS (preserved) ———————————
  async function saveItemCount(item: ItemRow, valueStr: string) {
    if (!venueId) return;
    const value = valueStr === '' ? null : Number(valueStr);
    try {
      await ensureAreaStarted();
      const iRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', item.id);
      await setDoc(iRef, { lastCount: value, lastCountAt: serverTimestamp() }, { merge: true });
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message ?? 'Unknown error.');
    }
  }
  function onChange(item: ItemRow, txt: string) {
    setCounts(prev => ({ ...prev, [item.id]: txt }));
  }

  async function onSubmit() {
    const invalid = Object.entries(counts).some(([_, v]) => v !== '' && isNaN(Number(v)));
    if (invalid) { Alert.alert('Check Counts', 'Some counts are not valid numbers.'); return; }

    const base = liveItems === null ? MOCK_ITEMS : liveItems || [];
    const blanks = base.filter(it => (counts[it.id] ?? '') === '');
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

    for (const it of base) {
      const v = counts[it.id];
      if (v !== undefined) await saveItemCount(it, v);
    }

    if (venueId) {
      try {
        const aRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
        await updateDoc(aRef, { completedAt: serverTimestamp() });
        Alert.alert('Area complete', `${areaName || areaId} is completed.`);
        nav.goBack();
      } catch (e: any) {
        Alert.alert('Complete Failed', e?.message || 'Unknown error.');
      }
    }
  }

  // ——————————— Expected Qty ———————————
  // These two fetchers are intentionally no-ops initially (return 0) to preserve stability.
  // Wire them to your Orders/Receipts and POS/Sales later.
  const fetchReceivedDelta = useCallback(async (_venueId: string, _itemId: string, _since: Date) => {
    return 0; // integrate with receipts between _since and now
  }, []);
  const fetchSalesDelta = useCallback(async (_venueId: string, _itemId: string, _since: Date) => {
    return 0; // integrate with sales between _since and now
  }, []);

  const computeExpected = useCallback(async (row: ItemRow) => {
    const base = typeof row.lastCount === 'number' ? row.lastCount : 0;
    const sinceTs = row.lastCountAt instanceof Timestamp
      ? row.lastCountAt.toDate()
      : (row.lastCountAt && (row.lastCountAt as any).toDate?.() ? (row.lastCountAt as any).toDate() : new Date(0));
    const received = await fetchReceivedDelta(venueId!, row.id, sinceTs);
    const sold = await fetchSalesDelta(venueId!, row.id, sinceTs);
    return base + received - sold;
  }, [fetchReceivedDelta, fetchSalesDelta, venueId]);

  // cache of expected values per item id to avoid flicker
  const [expectedById, setExpectedById] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!showExpected) return;
      const list = liveItems ?? [];
      const entries: Record<string, number> = {};
      for (const r of list) {
        entries[r.id] = typeof r.lastCount === 'number' ? r.lastCount : 0; // immediate fallback
      }
      setExpectedById(entries);
      for (const r of list) {
        const v = await computeExpected(r);
        if (!cancelled) setExpectedById(prev => ({ ...prev, [r.id]: Math.max(0, Math.round(v)) }));
      }
    })();
    return () => { cancelled = true; };
  }, [liveItems, showExpected, computeExpected]);

  // ——————————— Keypad modal (long-press) ———————————
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

  // ——————————— Edit modal ———————————
  function openEditMeta(item: ItemRow) {
    setEditFor(item);
    setEditName(item.name);
    setEditUnit(item.unit || '');
    setEditSupplierId(item.supplierId || '');
    setEditCost(item.costPrice != null ? String(item.costPrice) : '');
    setEditSale(item.salePrice != null ? String(item.salePrice) : '');
    setEditPar(item.parLevel != null ? String(item.parLevel) : '');
  }

  // ——————————— Weight / Photo stubs (preserved) ———————————
  async function onScale(item: ItemRow) {
    const mockGrams = 499;
    onChange(item, String(mockGrams));
  }
  async function onPhotoAI(item: ItemRow) {
    const estimate = 12;
    onChange(item, String(estimate));
  }

  const isLoadingLive = liveItems === null || loading;

  // —— Quick Add inline (name + optional cost/sale) ——
  function QuickAddInline() {
    const [name, setName] = useState('');
    const [cost, setCost] = useState('');
    const [sale, setSale] = useState('');
    const [busy, setBusy] = useState(false);

    async function onAdd() {
      const n = name.trim();
      if (!n) { Alert.alert('Missing name', 'Please enter an item name.'); return; }
      try {
        setBusy(true);
        await addItemQuick(n, cost, sale);
        setName(''); setCost(''); setSale('');
      } catch (e: any) {
        Alert.alert('Add failed', e?.message || 'Unknown error');
      } finally { setBusy(false); }
    }

    return (
      <View style={styles.fastAddWrap}>
        <Text style={styles.fastAddH}>Quick add</Text>
        <View style={styles.fastAddRow}>
          <TextInput value={name} onChangeText={setName} placeholder="Item name" style={[styles.input, { flex: 1.4 }]} />
          <TextInput value={cost} onChangeText={setCost} placeholder="Cost" keyboardType="decimal-pad" style={[styles.input, { width: 90 }]} />
          <TextInput value={sale} onChangeText={setSale} placeholder="Sale" keyboardType="decimal-pad" style={[styles.input, { width: 90 }]} />
          <TouchableOpacity style={[styles.primaryBtn, (!name.trim()) && styles.disabled]} onPress={onAdd} disabled={!name.trim()}>
            <Text style={styles.primaryText}>{busy ? 'Adding…' : 'Add'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.expToggleRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.expLabel}>Show expected</Text>
            <Switch value={showExpected} onValueChange={setShowExpected} />
          </View>
          <TouchableOpacity onPress={() => setShowLongAdd(true)} style={styles.linkBtn}>
            <Text style={styles.linkText}>Add with full details</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Placeholder helper for qty input: expected or "0"
  const placeholderFor = (item: ItemRow) => {
    if (!showExpected) return '0';
    const v = expectedById[item.id];
    return (typeof v === 'number' && !Number.isNaN(v)) ? String(v) : (typeof item.lastCount === 'number' ? String(item.lastCount) : '0');
  };

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
        <TextInput placeholder="Search items…" value={q} onChangeText={setQ} style={styles.search} />
        <TouchableOpacity style={styles.saveBtn} onPress={onSubmit}><Text style={styles.saveText}>Submit Area</Text></TouchableOpacity>
      </View>

      <QuickAddInline />

      {isLoadingLive ? (
        <View style={styles.center}><ActivityIndicator /><Text>Loading items…</Text></View>
      ) : (
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
                    <Text style={styles.itemSub}>
                      {(item.unit || '')}
                      {(item.parLevel != null) ? ` · PAR ${item.parLevel}` : ''}
                      {(item.costPrice != null) ? ` · $${item.costPrice}` : ''}
                      {(item.salePrice != null) ? ` · $${item.salePrice} RRP` : ''}
                    </Text>
                  </View>
                  <TextInput
                    value={counts[item.id] ?? ''}
                    onChangeText={(t) => onChange(item, t)}
                    placeholder={placeholderFor(item)}
                    placeholderTextColor="#9AA0A6"
                    keyboardType="numeric"
                    style={styles.qtyInput}
                  />
                  <TouchableOpacity style={styles.smallBtn} onPress={() => openEditMeta(item)}>
                    <Text style={styles.smallText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]} onPress={() => {
                    Alert.alert('Delete item', `Remove “${item.name}” from this area?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteItem(item.id) },
                    ]);
                  }}>
                    <Text style={[styles.smallText, { color: 'white' }]}>Del</Text>
                  </TouchableOpacity>
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
          ListEmptyComponent={<Text>No items yet. Use Quick add or add with full details.</Text>}
        />
      )}

      {/* Keypad modal */}
      <Modal visible={!!keypadFor} transparent animationType="fade" onRequestClose={() => setKeypadFor(null)}>
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
              <Pressable style={styles.secondaryBtn} onPress={() => setKeypadFor(null)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryBtn} onPress={keypadSave}><Text style={styles.primaryText}>Save</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit modal (update) */}
      <Modal visible={!!editFor} transparent animationType="fade" onRequestClose={() => setEditFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit item</Text>
            <ScrollView>
              <TextInput value={editName} onChangeText={setEditName} placeholder="Name" style={styles.modalInput} />
              <TextInput value={editUnit} onChangeText={setEditUnit} placeholder="Unit" style={styles.modalInput} />
              <TextInput value={editSupplierId} onChangeText={setEditSupplierId} placeholder="Supplier ID" style={styles.modalInput} autoCapitalize="none" />
              <TextInput value={editCost} onChangeText={setEditCost} placeholder="Cost price" keyboardType="decimal-pad" style={styles.modalInput} />
              <TextInput value={editSale} onChangeText={setEditSale} placeholder="Sale price" keyboardType="decimal-pad" style={styles.modalInput} />
              <TextInput value={editPar} onChangeText={setEditPar} placeholder="PAR level" keyboardType="numeric" style={styles.modalInput} />
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable style={styles.secondaryBtn} onPress={() => setEditFor(null)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryBtn} onPress={() => updateItemMeta(editFor!.id)}><Text style={styles.primaryText}>Save</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Long Add modal (create full) */}
      <Modal visible={showLongAdd} transparent animationType="fade" onRequestClose={() => setShowLongAdd(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add item (full details)</Text>
            <ScrollView>
              <TextInput value={laName} onChangeText={setLaName} placeholder="Name *" style={styles.modalInput} />
              <TextInput value={laUnit} onChangeText={setLaUnit} placeholder="Unit" style={styles.modalInput} />
              <TextInput value={laSupplierId} onChangeText={setLaSupplierId} placeholder="Supplier ID" style={styles.modalInput} autoCapitalize="none" />
              <TextInput value={laCost} onChangeText={setLaCost} placeholder="Cost price" keyboardType="decimal-pad" style={styles.modalInput} />
              <TextInput value={laSale} onChangeText={setLaSale} placeholder="Sale price" keyboardType="decimal-pad" style={styles.modalInput} />
              <TextInput value={laPar} onChangeText={setLaPar} placeholder="PAR level" keyboardType="numeric" style={styles.modalInput} />
              <TextInput value={laInitialQty} onChangeText={setLaInitialQty} placeholder="Initial Qty (optional)" keyboardType="numeric" style={styles.modalInput} />
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable style={styles.secondaryBtn} onPress={() => setShowLongAdd(false)}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryBtn} onPress={addItemFull}><Text style={styles.primaryText}>Add Item</Text></Pressable>
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

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 8 },

  // list
  itemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F2F7', borderRadius: 12, padding: 12 },
  itemName: { fontWeight: '700' },
  itemSub: { opacity: 0.7, marginTop: 2 },
  qtyInput: { width: 86, borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center', backgroundColor: 'white', marginRight: 6 },

  // buttons
  secondaryBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  secondaryText: { fontWeight: '700' },
  primaryBtn: { backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  primaryText: { color: 'white', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginLeft: 4 },
  smallText: { fontWeight: '700', fontSize: 12 },

  // modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { backgroundColor: 'white', padding: 16, borderRadius: 12, width: '90%', maxHeight: '85%' },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  modalInput: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },

  // quick add
  fastAddWrap: { backgroundColor: '#eef6ff', padding: 12, borderRadius: 12, marginBottom: 8 },
  fastAddH: { fontWeight: '800', marginBottom: 8, color: '#0A84FF' },
  fastAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  input: { backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#cfe3ff' },

  expToggleRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expLabel: { fontWeight: '700', color: '#0A84FF' },

  // link
  linkBtn: { alignSelf: 'flex-end' },
  linkText: { color: '#0A84FF', fontWeight: '700' },
});
