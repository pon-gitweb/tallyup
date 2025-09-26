// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, Modal, SafeAreaView,
  Text, TextInput, TouchableOpacity, View
} from 'react-native';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from 'src/services/firebase';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from 'src/context/VenueProvider';
import { throttleAction } from '../../utils/pressThrottle';

type Item = {
  id: string;
  name: string;
  lastCount?: number;
  lastCountAt?: any;

  expectedQty?: number;
  incomingQty?: number;
  soldQty?: number;
  wastageQty?: number;

  unit?: string;
  supplierId?: string;
  costPrice?: number;
  salePrice?: number;
  parLevel?: number;
  productId?: string;
  productName?: string;
  createdAt?: any;
  updatedAt?: any;
};

type AreaDoc = { name: string; createdAt?: any; updatedAt?: any; startedAt?: any; completedAt?: any; };
type MemberDoc = { role?: string };
type VenueDoc = { ownerUid?: string };
type RouteParams = { venueId?: string; departmentId: string; areaId: string; areaName?: string; };

export default function StockTakeAreaInventoryScreen() {
  console.log('[AreaInv ACTIVE FILE] src/screens/stock/StockTakeAreaInventoryScreen.tsx');

  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueIdFromCtx = useVenueId();
  const { departmentId, areaId, areaName, venueId: venueIdFromRoute } = (route.params ?? {}) as RouteParams;
  const venueId = venueIdFromCtx || venueIdFromRoute;

  const itemsPathOk = !!venueId && !!departmentId && !!areaId;

  const uid = getAuth().currentUser?.uid;
  const [isManager, setIsManager] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState('');
  const [showExpected, setShowExpected] = useState(true);
  const [localQty, setLocalQty] = useState<Record<string, string>>({});

  const [adjModalFor, setAdjModalFor] = useState<Item | null>(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const [addingName, setAddingName] = useState('');
  const nameInputRef = useRef<TextInput>(null);

  // area meta for cycle-aware logic
  const [areaMeta, setAreaMeta] = useState<AreaDoc | null>(null);

  // ----- subscriptions -----
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

  useEffect(() => {
    if (!itemsPathOk) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId), (d) => {
      setAreaMeta((d.data() as AreaDoc) || null);
    });
    return () => unsub();
  }, [itemsPathOk, venueId, departmentId, areaId]);

  useEffect(() => {
    let unsub: any;
    (async () => {
      if (!venueId || !uid) return;
      const ven = await getDoc(doc(db, 'venues', venueId));
      const ownerUid = (ven.data() as VenueDoc | undefined)?.ownerUid;
      if (ownerUid && ownerUid === uid) { setIsManager(true); return; }
      unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), (d) => {
        const md = d.data() as MemberDoc | undefined;
        setIsManager(md?.role === 'manager');
      });
    })();
    return () => unsub && unsub();
  }, [venueId, uid]);

  // ----- helpers -----
  const startedAtMs = areaMeta?.startedAt?.toMillis ? areaMeta.startedAt.toMillis() : (areaMeta?.startedAt?._seconds ? areaMeta.startedAt._seconds * 1000 : null);

  const countedInThisCycle = (it: Item): boolean => {
    const lcMs = it?.lastCountAt?.toMillis ? it.lastCountAt.toMillis() : (it?.lastCountAt?._seconds ? it.lastCountAt._seconds * 1000 : null);
    if (!lcMs || !startedAtMs) return false;
    return lcMs >= startedAtMs;
  };

  // Expected is GUIDE ONLY (chip + placeholder). Never assigned to input value.
  const deriveExpected = (it: Item): number | null => {
    if (typeof it.expectedQty === 'number') return it.expectedQty;
    const base = typeof it.lastCount === 'number' ? it.lastCount : null;
    const incoming = typeof it.incomingQty === 'number' ? it.incomingQty : 0;
    const sold = typeof it.soldQty === 'number' ? it.soldQty : 0;
    const wastage = typeof it.wastageQty === 'number' ? it.wastageQty : 0;
    if (base == null) return null;
    return base + incoming - sold - wastage;
  };

  const filtered = useMemo(() => {
    const n = filter.trim().toLowerCase();
    return !n ? items : items.filter((it) => (it.name || '').toLowerCase().includes(n));
  }, [items, filter]);

  const itemsCol = () => collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items');
  const itemRef  = (id: string) => doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items', id);
  const areaRef  = () => doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId);
  const areasCol = () => collection(db, 'venues', venueId!, 'departments', departmentId, 'areas');

  const ensureAreaStarted = async () => {
    try {
      const a = await getDoc(areaRef()); const data = a.data() as AreaDoc | undefined;
      if (!data?.startedAt) await updateDoc(areaRef(), { startedAt: serverTimestamp() });
    } catch {}
  };

  // ----- CRUD -----
  const addQuickItem = async () => {
    const nm = (addingName || '').trim(); if (!nm) return Alert.alert('Name required');
    try {
      await addDoc(itemsCol(), { name: nm, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setAddingName(''); nameInputRef.current?.blur(); Keyboard.dismiss();
    } catch (e: any) { Alert.alert('Could not add item', e?.message ?? String(e)); }
  };

  // SAVE COUNT: rules-clean (ONLY lastCount & lastCountAt)
  const saveCount = async (item: Item) => {
    const typed = (localQty[item.id] ?? '').trim();

    const doWrite = async (qty: number) => {
      try {
        await ensureAreaStarted();
        await updateDoc(itemRef(item.id), {
          lastCount: qty,
          lastCountAt: serverTimestamp(),
        });
        setLocalQty((m) => ({ ...m, [item.id]: '' }));
      } catch (e: any) { Alert.alert('Could not save count', e?.message ?? String(e)); }
    };

    if (typed === '') {
      Alert.alert('No quantity entered', `Save “${item.name}” as 0?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save as 0', onPress: () => doWrite(0) }
      ]);
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(typed)) return Alert.alert('Invalid number', 'Enter a numeric quantity (e.g. 20 or 20.5)');
    await doWrite(parseFloat(typed));
  };

  const removeItem = async (itemId: string) => {
    Alert.alert('Delete item', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteDoc(itemRef(itemId)); } catch (e: any) { Alert.alert('Could not delete', e?.message ?? String(e)); }
      } },
    ]);
  };

  const openAdjustment = (item: Item) => { setAdjModalFor(item); setAdjQty(''); setAdjReason(''); };
  const submitAdjustment = async () => {
    const it = adjModalFor!; const qtyStr = adjQty.trim();
    if (!/^\d+(\.\d+)?$/.test(qtyStr)) return Alert.alert('Invalid number');
    if (!adjReason.trim()) return Alert.alert('Reason required');
    try {
      await addDoc(collection(db, 'venues', venueId!, 'sessions'), {
        type: 'stock-adjustment-request', status: 'pending',
        venueId, departmentId, areaId, itemId: it.id, itemName: it.name,
        fromQty: it.lastCount ?? null, proposedQty: parseFloat(qtyStr),
        reason: adjReason.trim(), requestedBy: uid ?? null,
        requestedAt: serverTimestamp(), createdAt: serverTimestamp(),
      });
      setAdjModalFor(null);
    } catch (e: any) { Alert.alert('Could not submit request', e?.message ?? String(e)); }
  };

  const maybeFinalizeDepartment = async () => {
    try {
      const snap = await getDocs(areasCol());
      let allCompleted = true;
      snap.forEach((d) => { const a = d.data() as AreaDoc; if (!a?.completedAt) allCompleted = false; });
      if (allCompleted) Alert.alert('Department complete', 'All areas in this department are now submitted.');
    } catch {}
  };

  const completeArea = async () => {
    const missing = items.filter((it) => !countedInThisCycle(it));
    const perform = async () => {
      try {
        if (missing.length > 0) {
          await Promise.all(missing.map((it) =>
            updateDoc(itemRef(it.id), {
              lastCount: 0,
              lastCountAt: serverTimestamp(),
            })
          ));
        }
        await updateDoc(areaRef(), { completedAt: serverTimestamp() });
        await maybeFinalizeDepartment();
        nav.goBack();
      } catch (e: any) { Alert.alert('Could not complete area', e?.message ?? String(e)); }
    };

    if (missing.length > 0) {
      const msg = missing.length === items.length
        ? 'No items have been counted yet this cycle. Continue and save all as 0?'
        : `Not all items have a count for this cycle. ${missing.length.toLocaleString()} will be saved as 0. Continue?`;
      Alert.alert('Incomplete counts', msg, [
        { text: 'Go back', style: 'cancel' },
        { text: 'Continue', onPress: perform }
      ]);
    } else {
      await perform();
    }
  };

  const useBluetoothFor = (item: Item) => Alert.alert('Bluetooth Count', `Would read from paired scale for "${item.name}" (stub).`);
  const usePhotoFor     = (item: Item) => Alert.alert('Photo Count', `Would take photo and OCR for "${item.name}" (stub).`);

  // Throttled handler factories
  const makeSave = (item: Item) => throttleAction(() => saveCount(item));
  const onSubmitArea = throttleAction(completeArea);

  const Row = ({ item }: { item: Item }) => {
    const typed = localQty[item.id] ?? '';
    const expectedNum = deriveExpected(item);
    const expectedStr = expectedNum != null ? String(expectedNum) : '';

    const countedNow = countedInThisCycle(item);
    const locked = countedNow && !isManager;

    const placeholder = showExpected
      ? (expectedStr ? `expected ${expectedStr}` : 'expected — none available')
      : 'enter count here';

    return (
      <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ fontSize: 12, color: countedNow ? '#4CAF50' : '#999' }}>
              {countedNow ? `Counted: ${item.lastCount}` : 'To count'}
            </Text>
          </View>
          {showExpected && expectedStr ? (
            <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#EAF4FF', marginLeft: 8 }}>
              <Text style={{ color: '#0A5FFF', fontWeight: '700', fontSize: 12 }}>Expected: {expectedStr}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={typed}
            onChangeText={(t) => setLocalQty((m) => ({ ...m, [item.id]: t }))}
            placeholder={placeholder}
            keyboardType="number-pad"
            inputMode="decimal"
            maxLength={32}
            returnKeyType="done"
            blurOnSubmit={false}
            editable={!locked}
            style={{
              flex: 1, paddingVertical: 8, paddingHorizontal: 12,
              borderWidth: 1, borderColor: locked ? '#ddd' : '#ccc', borderRadius: 10,
              backgroundColor: locked ? '#f7f7f7' : '#fff'
            }}
          />

          <TouchableOpacity onPress={makeSave(item)} disabled={locked}
            style={{ backgroundColor: locked ? '#B0BEC5' : '#0A84FF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>{locked ? 'Locked' : 'Save'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => useBluetoothFor(item)} disabled={locked}
            style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: locked ? '#ECEFF1' : '#E3F2FD' }}>
            <Text style={{ color: locked ? '#90A4AE' : '#0A84FF', fontWeight: '700' }}>BT</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => usePhotoFor(item)} disabled={locked}
            style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: locked ? '#F5F5F5' : '#FFF8E1' }}>
            <Text style={{ color: locked ? '#BDBDBD' : '#FF6F00', fontWeight: '700' }}>Cam</Text>
          </TouchableOpacity>

          {/* Request adj. — only when a current-cycle count exists, and user is not a manager */}
          {countedNow && !isManager ? (
            <TouchableOpacity onPress={() => setAdjModalFor(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F3E5F5' }}>
              <Text style={{ color: '#6A1B9A', fontWeight: '700' }}>Request adj.</Text>
            </TouchableOpacity>
          ) : (
            !locked && (
              <TouchableOpacity onPress={() => removeItem(item.id)} style={{ padding: 6 }}>
                <Text style={{ color: '#D32F2F', fontWeight: '800' }}>Del</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>
    );
  };

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

        {/* Search + Toggle */}
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
          <TouchableOpacity onPress={addQuickItem}
            style={{ backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Single list */}
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => <Row item={item} />}
        ListEmptyComponent={<Text style={{ paddingHorizontal: 12, paddingVertical: 10, color: '#999' }}>No items</Text>}
      />

      {/* Sticky footer Submit */}
      <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff' }}>
        <TouchableOpacity onPress={onSubmitArea}
          style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#E8F5E9' }}>
          <Text style={{ textAlign: 'center', color: '#2E7D32', fontWeight: '800' }}>✅ Submit Area</Text>
        </TouchableOpacity>
      </View>

      {/* Adjustment Modal */}
      <Modal visible={!!adjModalFor} animationType="slide" onRequestClose={() => setAdjModalFor(null)} transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 10 }}>Request Adjustment</Text>
            <Text style={{ marginBottom: 8, color: '#555' }}>
              Item: {adjModalFor?.name}{'\n'}
              Current saved qty: {adjModalFor?.lastCount ?? '—'}
            </Text>
            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: '600', marginBottom: 4 }}>Proposed qty</Text>
              <TextInput value={adjQty} onChangeText={setAdjQty} placeholder="e.g. 21" keyboardType="number-pad" inputMode="decimal"
                style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 10 }} />
            </View>
            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: '600', marginBottom: 4 }}>Reason</Text>
              <TextInput value={adjReason} onChangeText={setAdjReason} placeholder="Brief reason"
                style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 10 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setAdjModalFor(null)} style={{ padding: 12, borderRadius: 10, backgroundColor: '#ECEFF1', flex: 1 }}>
                <Text style={{ textAlign: 'center', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitAdjustment} style={{ padding: 12, borderRadius: 10, backgroundColor: '#6A1B9A', flex: 1 }}>
                <Text style={{ textAlign: 'center', color: '#fff', fontWeight: '800' }}>Submit request</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
