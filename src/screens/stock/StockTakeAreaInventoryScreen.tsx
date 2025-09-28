// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, Modal, SafeAreaView,
  Text, TextInput, TouchableOpacity, View, ActivityIndicator, ScrollView
} from 'react-native';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../services/firebase';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { throttleAction } from '../../utils/pressThrottle';
import { dlog } from '../../utils/devlog';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import NetInfo from '@react-native-community/netinfo';

// Haptics (guarded)
let Haptics: any = null;
try { Haptics = require('expo-haptics'); } catch { Haptics = null; }

// AsyncStorage (guarded) for dismissible legend & quick-add memory
let AS: any = null;
try { AS = require('@react-native-async-storage/async-storage').default; } catch { AS = null; }

// Clipboard (guarded)
let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch {}

// FileSystem & Sharing (guarded)
let FS: any = null, Sharing: any = null;
try { FS = require('expo-file-system'); } catch {}
try { Sharing = require('expo-sharing'); } catch {}

// Manager inline-approve (flag + service)
import { ENABLE_MANAGER_INLINE_APPROVE } from '../../flags/managerInlineApprove';
import { approveDirectCount } from '../../services/adjustmentsDirect';

// Read-only audits for History modal
import { fetchRecentItemAudits, AuditEntry } from '../../services/audits';

type Item = {
  id: string; name: string;
  lastCount?: number; lastCountAt?: any;
  expectedQty?: number; incomingQty?: number; soldQty?: number; wastageQty?: number;
  unit?: string; supplierId?: string; supplierName?: string;
  costPrice?: number; salePrice?: number; parLevel?: number;
  productId?: string; productName?: string; createdAt?: any; updatedAt?: any;
};

type AreaDoc = { name: string; createdAt?: any; updatedAt?: any; startedAt?: any; completedAt?: any; };
type MemberDoc = { role?: string };
type VenueDoc = { ownerUid?: string };
type RouteParams = { venueId?: string; departmentId: string; areaId: string; areaName?: string; };

// Haptics helper
const hapticSuccess = () => { if (Haptics?.selectionAsync) try { Haptics.selectionAsync(); } catch {} };

// Delta confirm thresholds
const DELTA_ABS_THRESHOLD = 5;       // require confirm if abs change >= 5
const DELTA_RATIO_THRESHOLD = 0.5;   // ...and 50% or more vs previous

function StockTakeAreaInventoryScreen() {
  dlog('[AreaInv ACTIVE FILE] src/screens/stock/StockTakeAreaInventoryScreen.tsx');

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
  const filterDebounced = useDebouncedValue(filter, 200);

  const [showExpected, setShowExpected] = useState(true);
  const [localQty, setLocalQty] = useState<Record<string, string>>({});

  // Collapse control (compact counted rows)
  const [compactCounted, setCompactCounted] = useState(true);

  const [adjModalFor, setAdjModalFor] = useState<Item | null>(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  // Quick add fields + memory
  const [addingName, setAddingName] = useState('');
  const [addingUnit, setAddingUnit] = useState('');
  const [addingSupplier, setAddingSupplier] = useState('');
  const nameInputRef = useRef<TextInput>(null);

  const [areaMeta, setAreaMeta] = useState<AreaDoc | null>(null);

  // History modal state (read-only)
  const [histFor, setHistFor] = useState<Item | null>(null);
  const [histRows, setHistRows] = useState<AuditEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  // Long-press action sheet state
  const [menuFor, setMenuFor] = useState<Item | null>(null);

  // NEW: More menu state
  const [moreOpen, setMoreOpen] = useState(false);

  // Save→Next focus
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const listRef = useRef<FlatList>(null);

  // Low-stock filter
  const [onlyLow, setOnlyLow] = useState(false);

  // Offline banner state
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOffline(!(s.isConnected && s.isInternetReachable !== false)));
    return () => unsub && unsub();
  }, []);

  // Dismissible legend
  const [legendDismissed, setLegendDismissed] = useState(false);
  const legendKey = `areaLegendDismissed:${venueId ?? 'noVen'}:${areaId ?? 'noArea'}`;
  useEffect(() => { (async () => {
    if (!AS) return;
    try { const v = await AS.getItem(legendKey); setLegendDismissed(v === '1'); } catch {}
  })(); }, [legendKey]);
  const dismissLegend = async () => {
    setLegendDismissed(true);
    if (AS) try { await AS.setItem(legendKey, '1'); } catch {}
  };

  // Quick-add memory
  useEffect(() => { (async () => {
    if (!AS) return;
    try {
      const u = await AS.getItem('quickAdd:unit'); if (u) setAddingUnit(u);
      const s = await AS.getItem('quickAdd:supplier'); if (s) setAddingSupplier(s);
    } catch {}
  })(); }, []);
  const rememberQuickAdd = async (unit: string, supplier: string) => {
    if (!AS) return;
    try {
      await AS.setItem('quickAdd:unit', unit || '');
      await AS.setItem('quickAdd:supplier', supplier || '');
    } catch {}
  };

  // Live items
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

  // Area meta
  useEffect(() => {
    if (!itemsPathOk) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId), (d) => {
      setAreaMeta((d.data() as AreaDoc) || null);
    });
    return () => unsub();
  }, [itemsPathOk, venueId, departmentId, areaId]);

  // Role
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

  const startedAtMs = areaMeta?.startedAt?.toMillis ? areaMeta.startedAt.toMillis() : (areaMeta?.startedAt?._seconds ? areaMeta.startedAt._seconds * 1000 : null);
  const countedInThisCycle = (it: Item): boolean => {
    const lcMs = it?.lastCountAt?.toMillis ? it.lastCountAt.toMillis() : (it?.lastCountAt?._seconds ? it.lastCountAt._seconds * 1000 : null);
    if (!lcMs || !startedAtMs) return false;
    return lcMs >= startedAtMs;
  };

  const isLow = (it: Item) =>
    typeof it.parLevel === 'number' &&
    typeof it.lastCount === 'number' &&
    it.lastCount < it.parLevel;

  const deriveExpected = (it: Item): number | null => {
    if (typeof it.expectedQty === 'number') return it.expectedQty;
    const base = typeof it.lastCount === 'number' ? it.lastCount : null;
    const incoming = typeof it.incomingQty === 'number' ? it.incomingQty : 0;
    const sold = typeof it.soldQty === 'number' ? it.soldQty : 0;
    const wastage = typeof it.wastageQty === 'number' ? it.wastageQty : 0;
    if (base == null) return null;
    return base + incoming - sold - wastage;
  };

  // Filtered list
  const filteredBase = useMemo(() => {
    const n = filterDebounced.trim().toLowerCase();
    return !n ? items : items.filter((it) => (it.name || '').toLowerCase().includes(n));
  }, [items, filterDebounced]);

  const filtered = useMemo(
    () => (onlyLow ? filteredBase.filter(isLow) : filteredBase),
    [filteredBase, onlyLow]
  );

  // Counts for header/footer
  const countedCount = items.filter(countedInThisCycle).length;
  const lowCount = items.filter(isLow).length;

  // Save→Next: prefer next *uncounted* in current filtered list
  const focusNext = (currentId: string) => {
    const idx = filtered.findIndex((x) => x.id === currentId);
    if (idx < 0) return Keyboard.dismiss();

    const nextUncountedIdx = filtered.findIndex((x, i) => i > idx && !countedInThisCycle(x));
    const targetIdx = nextUncountedIdx > -1 ? nextUncountedIdx : (idx + 1 < filtered.length ? idx + 1 : -1);

    if (targetIdx === -1) return Keyboard.dismiss();
    const nextId = filtered[targetIdx].id;
    try { listRef.current?.scrollToIndex({ index: targetIdx + 1, animated: true }); } catch {}
    setTimeout(() => inputRefs.current[nextId]?.focus?.(), 80);
  };

  const ensureAreaStarted = async () => {
    try {
      const a = await getDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId));
      const data = a.data() as AreaDoc | undefined;
      if (!data?.startedAt) await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId), { startedAt: serverTimestamp() });
    } catch {}
  };

  // delta confirm helper
  const needsDeltaConfirm = (prev: number | null | undefined, next: number) => {
    const from = typeof prev === 'number' ? prev : 0;
    const abs = Math.abs(next - from);
    const ratio = from === 0 ? 1 : abs / Math.max(1, Math.abs(from));
    return abs >= DELTA_ABS_THRESHOLD && ratio >= DELTA_RATIO_THRESHOLD;
  };

  const saveCount = async (item: Item) => {
    const typed = (localQty[item.id] ?? '').trim();

    const doWrite = async (qty: number) => {
      try {
        await ensureAreaStarted();
        await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',item.id),
          { lastCount: qty, lastCountAt: serverTimestamp() });
        setLocalQty((m) => ({ ...m, [item.id]: '' }));
        hapticSuccess();
        focusNext(item.id);
      } catch (e:any){ Alert.alert('Could not save count', e?.message ?? String(e)); }
    };

    const proceedWith = async (qty: number) => {
      const mustConfirm = needsDeltaConfirm(item.lastCount ?? null, qty);
      if (!mustConfirm) return doWrite(qty);
      Alert.alert('Large change', `Change “${item.name}” from ${item.lastCount ?? 0} → ${qty}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: 'destructive', onPress: () => doWrite(qty) }
      ]);
    };

    if (typed === '') {
      return Alert.alert('No quantity',`Save “${item.name}” as 0?`,[
        {text:'Cancel',style:'cancel'},
        {text:'Save as 0',onPress:()=>proceedWith(0)}
      ]);
    }
    if (!/^\d+(\.\d+)?$/.test(typed)) return Alert.alert('Invalid','Enter number');
    await proceedWith(parseFloat(typed));
  };

  // Manager inline-approve path (explicit audit) with delta confirm
  const approveNow = async (item: Item) => {
    const typed = (localQty[item.id] ?? '').trim();
    if (!ENABLE_MANAGER_INLINE_APPROVE) return;
    if (!isManager) return Alert.alert('Manager only', 'Only managers can approve directly.');
    if (!/^\d+(\.\d+)?$/.test(typed)) return Alert.alert('Invalid number', 'Enter a numeric quantity (e.g. 20 or 20.5)');

    const qty = parseFloat(typed);
    const doApprove = async () => {
      try {
        await ensureAreaStarted();
        await approveDirectCount({
          venueId: venueId!, departmentId, areaId,
          itemId: item.id, itemName: item.name,
          fromQty: item.lastCount ?? null, toQty: qty,
          reason: 'Inline approve (manager)',
        });
        setLocalQty((m) => ({ ...m, [item.id]: '' }));
        hapticSuccess();
        focusNext(item.id);
        Alert.alert('Saved', 'Count updated and audit logged.');
      } catch (e: any) {
        Alert.alert('Approve failed', e?.message ?? String(e));
      }
    };

    if (needsDeltaConfirm(item.lastCount ?? null, qty)) {
      Alert.alert('Large change', `Approve “${item.name}” from ${item.lastCount ?? 0} → ${qty}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', style: 'destructive', onPress: throttleAction(doApprove) }
      ]);
    } else {
      await doApprove();
    }
  };

  const addQuickItem = async () => {
    const nm = (addingName || '').trim();
    if (!nm) return Alert.alert('Name required');
    try {
      await addDoc(collection(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items'), {
        name: nm,
        unit: addingUnit || null,
        supplierName: addingSupplier || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setAddingName('');
      await rememberQuickAdd(addingUnit, addingSupplier);
      nameInputRef.current?.blur(); Keyboard.dismiss();
      hapticSuccess();
    } catch (e:any){ Alert.alert('Could not add item', e?.message ?? String(e)); }
  };

  const removeItem = async (itemId: string) => {
    Alert.alert('Delete item', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',itemId)); }
        catch (e:any) { Alert.alert('Could not delete', e?.message ?? String(e)); }
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
        reason: adjReason.trim(), requestedBy: getAuth().currentUser?.uid ?? null,
        requestedAt: serverTimestamp(), createdAt: serverTimestamp(),
      });
      setAdjModalFor(null);
    } catch (e: any) { Alert.alert('Could not submit request', e?.message ?? String(e)); }
  };

  const maybeFinalizeDepartment = async () => {
    try {
      const snap = await getDocs(collection(db,'venues',venueId!,'departments',departmentId,'areas'));
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
            updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',it.id),
              { lastCount: 0, lastCountAt: serverTimestamp() })
          ));
        }
        await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId), { completedAt: serverTimestamp() });
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

  // One-tap initialise (set all uncounted to 0 without submitting area)
  const initAllZeros = async () => {
    const noneCountedThisCycle = items.every((it) => !countedInThisCycle(it));
    const msg = noneCountedThisCycle
      ? 'This will initialise this area by saving ALL items as 0 now. Continue?'
      : 'This will save any UNCOUNTED items as 0 now. Already counted items are untouched. Continue?';

    const doIt = async () => {
      try {
        await ensureAreaStarted();
        const toZero = items.filter((it) => !countedInThisCycle(it));
        if (toZero.length === 0) { Alert.alert('Nothing to do', 'Everything already has a count.'); return; }
        await Promise.all(toZero.map((it) =>
          updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',it.id),
            { lastCount: 0, lastCountAt: serverTimestamp() })
        ));
        hapticSuccess();
        Alert.alert('Done', `${toZero.length} item(s) saved as 0.`);
      } catch (e:any) {
        Alert.alert('Failed', e?.message ?? String(e));
      }
    };

    Alert.alert('Initialise with zeros', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: throttleAction(doIt) }
    ]);
  };

  const useBluetoothFor = (item: Item) => Alert.alert('Bluetooth Count', `Would read from paired scale for "${item.name}" (stub).`);
  const usePhotoFor     = (item: Item) => Alert.alert('Photo Count', `Would take photo and OCR for "${item.name}" (stub).`);

  const makeSave = (item:Item)=>throttleAction(()=>saveCount(item));
  const makeApproveNow = (item: Item) => throttleAction(() => approveNow(item));
  const onSubmitArea = throttleAction(completeArea);

  // History modal loaders
  const openHistory = throttleAction(async (item: Item) => {
    if (!venueId) return;
    setHistFor(item);
    setHistLoading(true);
    try {
      const rows = await fetchRecentItemAudits(venueId, item.id, 10);
      setHistRows(rows);
    } catch {
      setHistRows([]);
    } finally {
      setHistLoading(false);
    }
  });
  const closeHistory = () => { setHistFor(null); setHistRows([]); setHistLoading(false); };

  // ---------- Utility for CSV ----------
  const toCsv = (rows: Array<Record<string, any>>) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const safe = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    };
    return [
      headers.map(safe).join(','),
      ...rows.map((r) => headers.map((h) => safe(r[h])).join(',')),
    ].join('\n');
  };

  // ---------- Actions for More menu ----------
  const exportCsv = throttleAction(async () => {
    try {
      const rows = filtered.map((it) => {
        const expected = deriveExpected(it);
        return {
          name: it.name || '',
          unit: it.unit || '',
          lastCount: typeof it.lastCount === 'number' ? it.lastCount : '',
          expectedQty: expected ?? '',
          low: isLow(it) ? 'yes' : 'no',
          note: it.supplierName || '',
        };
      });
      const csv = toCsv(rows);
      if (!csv) { Alert.alert('Nothing to export', 'No rows in the current view.'); return; }

      if (!FS || !FS.cacheDirectory) { Alert.alert('Export unavailable', 'FileSystem not available.'); return; }
      const fname = `tallyup-area-${areaId}-${Date.now()}.csv`;
      const path = FS.cacheDirectory + fname;
      await FS.writeAsStringAsync(path, csv, { encoding: FS.EncodingType.UTF8 });

      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export CSV' });
      } else {
        Alert.alert('Exported', `Saved to cache: ${fname}`);
      }
    } catch (e:any) {
      Alert.alert('Export failed', e?.message ?? String(e));
    }
  });

  const copySummary = throttleAction(async () => {
    const total = items.length;
    const counted = countedCount;
    const uncounted = total - counted;
    const low = lowCount;

    const lines = [
      `TallyUp — ${areaName ?? 'Area'} summary`,
      `Counted: ${counted}/${total} (${uncounted} remaining)`,
      `Low stock items: ${low}`,
    ];

    const text = lines.join('\n');

    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(text);
      hapticSuccess();
      Alert.alert('Copied', 'Summary copied to clipboard.');
    } else {
      Alert.alert('Copy unavailable', 'Clipboard not available.');
    }
  });

  // ---------- Row ----------
  const Row = ({ item }: { item: Item }) => {
    const typed = localQty[item.id] ?? '';
    const expectedNum = deriveExpected(item);
    const expectedStr = expectedNum != null ? String(expectedNum) : '';
    const countedNow = countedInThisCycle(item);
    const locked = countedNow && !isManager;
    const placeholder = (showExpected ? (expectedStr ? `expected ${expectedStr}` : 'expected — none available') : 'enter count here');
    const lowStock = isLow(item);

    // Compact layout when counted & user not manager & compactCounted is on
    if (locked && compactCounted) {
      return (
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => setMenuFor(item)}
          style={{ paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8, backgroundColor:'#FAFAFA' }}
        >
          <View style={{ flexDirection:'row', alignItems:'center' }}>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>{item.name}</Text>
              <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                <Text style={{ fontSize:12, color:'#4CAF50' }}>Counted: {item.lastCount}</Text>
                {item.unit ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.unit}</Text> : null}
                {item.supplierName ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.supplierName}</Text> : null}
                {lowStock ? (
                  <View style={{ paddingVertical:1, paddingHorizontal:6, borderRadius:10, backgroundColor:'#FEE2E2' }}>
                    <Text style={{ color:'#B91C1C', fontWeight:'800', fontSize:11 }}>
                      Low: {item.lastCount ?? 0} &lt; {item.parLevel}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            {showExpected && expectedStr ? (
              <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#EAF4FF', marginLeft: 8 }}>
                <Text style={{ color: '#0A5FFF', fontWeight: '700', fontSize: 12 }}>Expected: {expectedStr}</Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
            <TouchableOpacity onPress={() => openHistory(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#EEF2FF' }}>
              <Text style={{ color: '#3730A3', fontWeight: '700' }}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openAdjustment(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F3E5F5' }}>
              <Text style={{ color: '#6A1B9A', fontWeight: '700' }}>Request adj.</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    }

    // Full row (default)
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={() => setMenuFor(item)}
        style={{ paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
            <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <Text style={{ fontSize: 12, color: countedNow ? '#4CAF50' : '#999' }}>
                {countedNow ? `Counted: ${item.lastCount}` : 'To count'}
              </Text>
              {item.unit ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.unit}</Text> : null}
              {item.supplierName ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.supplierName}</Text> : null}
              {lowStock ? (
                <View style={{ paddingVertical:1, paddingHorizontal:6, borderRadius:10, backgroundColor:'#FEE2E2' }}>
                  <Text style={{ color:'#B91C1C', fontWeight:'800', fontSize:11 }}>
                    Low: {item.lastCount ?? 0} &lt; {item.parLevel}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          {showExpected && expectedStr ? (
            <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#EAF4FF', marginLeft: 8 }}>
              <Text style={{ color: '#0A5FFF', fontWeight: '700', fontSize: 12 }}>Expected: {expectedStr}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TextInput
            ref={(el)=>inputRefs.current[item.id]=el}
            value={localQty[item.id] ?? ''}
            onChangeText={(t)=>setLocalQty(m=>({...m,[item.id]:t}))}
            placeholder={placeholder}
            keyboardType="number-pad"
            inputMode="decimal"
            maxLength={32}
            returnKeyType="done"
            blurOnSubmit={false}
            editable={!locked}
            onSubmitEditing={()=>makeSave(item)()} // enter → save (moves next)
            style={{
              flexGrow: 1, minWidth: 160,
              paddingVertical: 8, paddingHorizontal: 12,
              borderWidth: 1, borderColor: locked ? '#ddd' : '#ccc', borderRadius: 10,
              backgroundColor: locked ? '#f7f7f7' : '#fff'
            }}
          />

          <TouchableOpacity onPress={makeSave(item)} disabled={locked}
            style={{ flexDirection:'row', alignItems:'center', gap:6, backgroundColor: locked ? '#B0BEC5' : '#0A84FF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }}>
            {(localQty[item.id] ?? '').trim() !== '' ? <View style={{ width:8, height:8, borderRadius:4, backgroundColor:'#00E5FF' }} /> : null}
            <Text style={{ color: '#fff', fontWeight: '800' }}>{locked ? 'Locked' : 'Save'}</Text>
          </TouchableOpacity>

          {isManager && ENABLE_MANAGER_INLINE_APPROVE ? (
            <TouchableOpacity onPress={makeApproveNow(item)} disabled={locked}
              style={{ backgroundColor: locked ? '#CFD8DC' : '#10B981', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }}>
              <Text style={{ color: 'white', fontWeight: '800' }}>Approve now (Mgr)</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity onPress={() => openHistory(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#EEF2FF' }}>
            <Text style={{ color: '#3730A3', fontWeight: '700' }}>History</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => useBluetoothFor(item)} disabled={locked}
            style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: locked ? '#ECEFF1' : '#E3F2FD' }}>
            <Text style={{ color: locked ? '#90A4AE' : '#0A84FF', fontWeight: '700' }}>BT</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => usePhotoFor(item)} disabled={locked}
            style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: locked ? '#F5F5F5' : '#FFF8E1' }}>
            <Text style={{ color: locked ? '#BDBDBD' : '#FF6F00', fontWeight: '700' }}>Cam</Text>
          </TouchableOpacity>

          {countedNow && !isManager ? (
            <TouchableOpacity onPress={() => openAdjustment(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F3E5F5' }}>
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
      </TouchableOpacity>
    );
  };

  if (!itemsPathOk) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, textAlign: 'center' }}>Missing navigation params. Need venueId, departmentId and areaId.</Text>
      </SafeAreaView>
    );
  }

  // Sticky ListHeader (title + counts + More + banners + legend + search/filters + quick-add + compact toggle)
  const ListHeader = () => {
    const anyPar = items.some((it) => typeof it.parLevel === 'number');
    const anyLow = items.some((it) => isLow(it));
    const showLowChip = anyPar && anyLow;

    return (
      <View style={{ backgroundColor: 'white', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <View style={{ padding: 12, gap: 8 }}>
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>{areaName ?? 'Area Inventory'}</Text>
            <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
              <View style={{ paddingVertical:2, paddingHorizontal:8, backgroundColor:'#F3F4F6', borderRadius:12 }}>
                <Text style={{ fontWeight:'800', color:'#374151' }}>
                  {countedCount}/{items.length} counted • {lowCount} low
                </Text>
              </View>
              <TouchableOpacity onPress={() => setMoreOpen(true)}
                style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:12, backgroundColor:'#EFF6FF' }}>
                <Text style={{ color:'#1D4ED8', fontWeight:'800' }}>⋯ More</Text>
              </TouchableOpacity>
            </View>
          </View>

          {offline ? (
            <View style={{ backgroundColor:'#FEF3C7', borderColor:'#F59E0B', borderWidth:1, padding:6, borderRadius:8 }}>
              <Text style={{ color:'#92400E', fontWeight:'700' }}>Offline</Text>
              <Text style={{ color:'#92400E' }}>You can keep counting; changes will sync when back online.</Text>
            </View>
          ) : null}

          {!legendDismissed ? (
            <View style={{ backgroundColor:'#EFF6FF', borderColor:'#93C5FD', borderWidth:1, padding:8, borderRadius:10 }}>
              <Text style={{ color:'#1E3A8A', fontWeight:'700' }}>Tip</Text>
              <Text style={{ color:'#1E3A8A' }}>
                “Expected” is our guidance based on last count and movements. Type your Count and press Save (or Approve now).
              </Text>
              <TouchableOpacity onPress={dismissLegend} style={{ alignSelf:'flex-start', marginTop:6, paddingVertical:6, paddingHorizontal:10, backgroundColor:'#DBEAFE', borderRadius:8 }}>
                <Text style={{ color:'#1E3A8A', fontWeight:'700' }}>Got it</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8, alignItems:'center' }}>
            <View style={{ flex: 1, position: 'relative' }}>
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Search items…"
                style={{ paddingVertical: 8, paddingHorizontal: filter ? 34 : 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 12 }}
              />
              {filter ? (
                <TouchableOpacity
                  onPress={() => setFilter('')}
                  style={{ position: 'absolute', right: 8, top: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: '#EEEEEE' }}
                >
                  <Text style={{ fontWeight:'800' }}>×</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => setShowExpected((v) => !v)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F1F8E9' }}>
              <Text style={{ color: '#558B2F', fontWeight: '700' }}>{showExpected ? 'Hide expected' : 'Show expected'}</Text>
            </TouchableOpacity>
          </View>

          {showLowChip ? (
            <View style={{ flexDirection:'row', gap:8 }}>
              <TouchableOpacity
                onPress={() => setOnlyLow(false)}
                style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyLow ? '#E5E7EB' : '#0A84FF', backgroundColor: onlyLow ? 'white' : '#D6E9FF' }}
              >
                <Text style={{ fontWeight:'800', color:'#0A84FF' }}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setOnlyLow(true)}
                style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyLow ? '#DC2626' : '#E5E7EB', backgroundColor: onlyLow ? '#FEE2E2' : 'white' }}
              >
                <Text style={{ fontWeight:'800', color:'#B91C1C' }}>Low stock</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Quick add with memory (Unit, Supplier optional) */}
          <View style={{ gap: 8 }}>
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
            <View style={{ flexDirection:'row', gap:8 }}>
              <TextInput
                value={addingUnit}
                onChangeText={setAddingUnit}
                placeholder="Unit (e.g. bottles, kg)"
                style={{ flex:1, paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
              />
              <TextInput
                value={addingSupplier}
                onChangeText={setAddingSupplier}
                placeholder="Supplier"
                style={{ flex:1, paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
              />
            </View>
          </View>

          {/* Compact counted toggle */}
          <View style={{ flexDirection:'row', gap:8, alignItems:'center', marginTop:4 }}>
            <TouchableOpacity
              onPress={()=>setCompactCounted((v)=>!v)}
              style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor: compactCounted ? '#E0F2FE' : '#F3F4F6', borderWidth:1, borderColor: compactCounted ? '#38BDF8' : '#E5E7EB' }}
            >
              <Text style={{ fontWeight:'800', color: compactCounted ? '#0369A1' : '#374151' }}>
                {compactCounted ? '✓ Compact counted rows' : 'Show inputs on counted rows'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // Empty state
  const EmptyState = () => (
    <View style={{ paddingHorizontal: 16, paddingVertical: 24, alignItems:'center' }}>
      <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 6 }}>No items yet</Text>
      <Text style={{ color: '#6B7280', textAlign:'center' }}>
        Use “Quick add item name” above to create your first item for this area.
      </Text>
      <View style={{ height: 10 }} />
      <TouchableOpacity onPress={() => nameInputRef.current?.focus()} style={{ paddingVertical:10, paddingHorizontal:14, backgroundColor:'#0A84FF', borderRadius:10 }}>
        <Text style={{ color:'white', fontWeight:'800' }}>Add first item</Text>
      </TouchableOpacity>
    </View>
  );

  // Footer actions
  const ListFooter = () => (
    <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff', gap: 8 }}>
      <TouchableOpacity onPress={onSubmitArea}
        style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#E8F5E9' }}>
        <Text style={{ textAlign: 'center', color: '#2E7D32', fontWeight: '800' }}>✅ Submit Area</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={throttleAction(initAllZeros)}
        style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#FFF7ED' }}>
        <Text style={{ textAlign: 'center', color: '#C2410C', fontWeight: '800' }}>🟠 Initialise: set all uncounted to 0</Text>
      </TouchableOpacity>
      <Text style={{ textAlign:'center', color:'#666' }}>{countedCount}/{items.length} items counted</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        data={filtered}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => <Row item={item} />}
        ListHeaderComponent={<ListHeader />}
        ListFooterComponent={<ListFooter />}
        ListEmptyComponent={<EmptyState />}
        stickyHeaderIndices={[0]}
      />

      {/* Request Adjustment Modal */}
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

      {/* History Modal (read-only) */}
      <Modal visible={!!histFor} transparent animationType="fade" onRequestClose={closeHistory}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center', padding:16 }}>
          <View style={{ backgroundColor:'white', borderRadius:16, width:'100%', maxHeight:'80%', padding:14 }}>
            <Text style={{ fontSize:16, fontWeight:'800', marginBottom:8 }}>
              History — {histFor?.name ?? 'Item'}
            </Text>

            {histLoading ? (
              <View style={{ alignItems:'center', padding:12 }}>
                <ActivityIndicator />
                <Text style={{ marginTop:8, color:'#6B7280' }}>Loading…</Text>
              </View>
            ) : histRows.length === 0 ? (
              <Text style={{ color:'#6B7280' }}>No recent audits for this item.</Text>
            ) : (
              <ScrollView contentContainerStyle={{ gap:8 }}>
                {histRows.map(a => (
                  <View key={a.id} style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, padding:10 }}>
                    <Text style={{ fontWeight:'800' }}>{a.type.replace(/-/g,' ')}</Text>
                    <Text style={{ color:'#374151' }}>
                      {a.fromQty != null ? `From ${a.fromQty} → ` : ''}{a.toQty != null ? `To ${a.toQty}` : ''}
                    </Text>
                    {a.decisionNote ? <Text style={{ color:'#6B7280', marginTop:2 }}>Note: {a.decisionNote}</Text> : null}
                    <Text style={{ color:'#9CA3AF', fontSize:12, marginTop:4 }}>
                      {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : '—'}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity onPress={closeHistory} style={{ marginTop:12, alignSelf:'center', paddingVertical:10, paddingHorizontal:16, borderRadius:10, backgroundColor:'#E5E7EB' }}>
              <Text style={{ fontWeight:'700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Long-press action sheet */}
      <Modal visible={!!menuFor} animationType="fade" transparent onRequestClose={()=>setMenuFor(null)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', alignItems:'center', padding:16 }}>
          <View style={{ backgroundColor:'#fff', borderRadius:12, width:'100%', maxWidth:420, padding:12 }}>
            <Text style={{ fontSize:16, fontWeight:'800', marginBottom:8 }} numberOfLines={1}>
              {menuFor?.name ?? 'Item'}
            </Text>
            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); openHistory(it); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#EEF2FF', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#3730A3' }}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); openAdjustment(it); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3E5F5', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#6A1B9A' }}>Request adjustment</Text>
            </TouchableOpacity>
            {isManager && ENABLE_MANAGER_INLINE_APPROVE ? (
              <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); makeApproveNow(it)(); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#DCFCE7', marginBottom:8 }}>
                <Text style={{ fontWeight:'800', color:'#166534' }}>Approve now (manager)</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={()=>{ const id = menuFor!.id; setMenuFor(null); removeItem(id); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#FEE2E2', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#991B1B' }}>Delete item</Text>
            </TouchableOpacity>
            <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
              <TouchableOpacity onPress={()=>setMenuFor(null)} style={{ padding:10, backgroundColor:'#E5E7EB', borderRadius:10, flex:1 }}>
                <Text style={{ textAlign:'center', fontWeight:'800', color:'#374151' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ⋯ More menu */}
      <Modal visible={moreOpen} animationType="fade" transparent onRequestClose={()=>setMoreOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', alignItems:'center', padding:16 }}>
          <View style={{ backgroundColor:'#fff', borderRadius:12, width:'100%', maxWidth:420, padding:12 }}>
            <Text style={{ fontSize:16, fontWeight:'800', marginBottom:8 }}>More</Text>
            <TouchableOpacity onPress={()=>{ setMoreOpen(false); exportCsv(); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>Export CSV (current view)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{ setMoreOpen(false); copySummary(); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>Copy area summary</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=> setOnlyLow(v => !v)} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor: onlyLow ? '#DBEAFE' : '#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color: onlyLow ? '#1D4ED8' : '#111827' }}>{onlyLow ? '✓ ' : ''}Low only</Text>
            </TouchableOpacity>
            <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
              <TouchableOpacity onPress={()=>setMoreOpen(false)} style={{ padding:10, backgroundColor:'#E5E7EB', borderRadius:10, flex:1 }}>
                <Text style={{ textAlign:'center', fontWeight:'800', color:'#374151' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default withErrorBoundary(StockTakeAreaInventoryScreen, 'Area Inventory');
