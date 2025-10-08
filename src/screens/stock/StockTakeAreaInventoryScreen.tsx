// @ts-nocheck
import AreaInvHeader from "./components/AreaInvHeader";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, Modal, SafeAreaView,
  Text, TextInput, TouchableOpacity, View, ActivityIndicator, ScrollView, Platform
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
import { useDensity } from '../../hooks/useDensity';

let Haptics: any = null;
try { Haptics = require('expo-haptics'); } catch {}
let AS: any = null;
try { AS = require('@react-native-async-storage/async-storage').default; } catch {}
let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch {}
let FS: any = null, Sharing: any = null;
try { FS = require('expo-file-system'); } catch {}
try { Sharing = require('expo-sharing'); } catch {}

import { ENABLE_MANAGER_INLINE_APPROVE } from '../../flags/managerInlineApprove';
import { approveDirectCount } from '../../services/adjustmentsDirect';
import { fetchRecentItemAudits, AuditEntry } from '../../services/audits';

type Item = {
  id: string; name: string;
  lastCount?: number; lastCountAt?: any;
  expectedQty?: number; incomingQty?: number; soldQty?: number; wastageQty?: number;
  unit?: string; supplierId?: string; supplierName?: string;
  costPrice?: number; salePrice?: number; parLevel?: number;
  productId?: string; productName?: string; createdAt?: any; updatedAt?: any;
  flagRecount?: boolean;
};
type AreaDoc = { name: string; createdAt?: any; updatedAt?: any; startedAt?: any; completedAt?: any; };
type MemberDoc = { role?: string };
type VenueDoc = { ownerUid?: string };
type RouteParams = { venueId?: string; departmentId: string; areaId: string; areaName?: string; };

const hapticSuccess = () => { if (Haptics?.selectionAsync) try { Haptics.selectionAsync(); } catch {} };
const DELTA_ABS_THRESHOLD = 5;
const DELTA_RATIO_THRESHOLD = 0.5;

/* ---------- Row component moved to module scope (fixes Android keyboard drop) ---------- */

type RowProps = {
  item: Item;
  isCompact: boolean;
  dens: (n: number) => number;
  areaStarted: boolean;
  showExpected: boolean;
  compactCounted: boolean;
  showSteppers: boolean;
  isManager: boolean;
  localQty: Record<string, string>;
  setLocalQty: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  inputRefs: React.MutableRefObject<Record<string, TextInput | null>>;
  setFocusedInputId: React.Dispatch<React.SetStateAction<string | null>>;
  setMenuFor: (it: Item | null) => void;
  openEditItem: (it: Item, focusPar?: boolean) => void;
  openAdjustment: (it: Item) => void;
  deriveExpected: (it: Item) => number | null;
  countedInThisCycle: (it: Item) => boolean;
  clampNonNegative: (n: number) => number;
  approveNow: (it: Item) => Promise<void>;
  saveCount: (it: Item) => Promise<void>;
};

const Row = React.memo(function Row({
  item,
  isCompact,
  dens,
  areaStarted,
  showExpected,
  compactCounted,
  showSteppers,
  isManager,
  localQty,
  setLocalQty,
  inputRefs,
  setFocusedInputId,
  setMenuFor,
  openEditItem,
  openAdjustment,
  deriveExpected,
  countedInThisCycle,
  clampNonNegative,
  approveNow,
  saveCount,
}: RowProps) {
  const expectedNum = deriveExpected(item);
  const expectedStr = expectedNum != null ? String(expectedNum) : '';
  const countedNow = countedInThisCycle(item);
  const locked = countedNow && !isManager;
  const placeholder = (showExpected ? (expectedStr ? `expected ${expectedStr}` : 'expected — none available') : 'enter count here');
  const lowStock = typeof item.parLevel === 'number' && typeof item.lastCount === 'number' && item.lastCount < item.parLevel;

  // auto-repeat steppers
  const repeatTimerRef = useRef<any>(null);
  const repeatDirRef = useRef<1 | -1 | 0>(0);
  const adjustTyped = (delta: number) => {
    setLocalQty(prev => {
      const raw = (prev[item.id] ?? '').trim();
      let v = raw === '' ? 0 : parseFloat(raw);
      if (isNaN(v)) v = 0;
      v = clampNonNegative(v + delta);
      return { ...prev, [item.id]: String(v) };
    });
  };
  const startRepeat = (delta: 1 | -1) => {
    stopRepeat();
    repeatDirRef.current = delta;
    repeatTimerRef.current = setInterval(() => { adjustTyped(repeatDirRef.current); }, 120);
  };
  const stopRepeat = () => {
    if (repeatTimerRef.current) { clearInterval(repeatTimerRef.current); repeatTimerRef.current = null; }
    repeatDirRef.current = 0;
  };
  useEffect(() => () => stopRepeat(), []);

  const FlagBadge = item.flagRecount ? (
    <View style={{ paddingVertical:1, paddingHorizontal:6, borderRadius:10, backgroundColor:'#FEF3C7' }}>
      <Text style={{ color:'#92400E', fontWeight:'800', fontSize:11 }}>Recount</Text>
    </View>
  ) : null;

  const LowBadge = lowStock ? (
    <TouchableOpacity
      onPress={() => openEditItem(item, true)}
      style={{ paddingVertical:1, paddingHorizontal:6, borderRadius:10, backgroundColor:'#FEE2E2' }}
    >
      <Text style={{ color:'#B91C1C', fontWeight:'800', fontSize:11 }}>
        Low: {item.lastCount ?? 0} &lt; {item.parLevel}
      </Text>
    </TouchableOpacity>
  ) : null;

  if (locked && compactCounted) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={() => setMenuFor(item)}
        style={{ paddingVertical: dens(10), paddingHorizontal: dens(12), minHeight: 44, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8, backgroundColor:'#FAFAFA' }}
      >
        <View style={{ flexDirection:'row', alignItems:'center' }}>
          <View style={{ flex:1 }}>
            <Text style={{ fontSize: isCompact ? 14 : 16, fontWeight: '700' }}>{item.name}</Text>
            <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <Text style={{ fontSize:12, color:'#4CAF50' }}>Counted: {item.lastCount}</Text>
              {item.unit ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.unit}</Text> : null}
              {item.supplierName ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.supplierName}</Text> : null}
              {FlagBadge}
              {LowBadge}
            </View>
          </View>
          {areaStarted && showExpected && expectedStr ? (
            <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#EAF4FF', marginLeft: 8 }}>
              <Text style={{ color: '#0A5FFF', fontWeight: '700', fontSize: 12 }}>Expected: {expectedStr}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onLongPress={() => setMenuFor(item)}
      style={{ paddingVertical: dens(10), paddingHorizontal: dens(12), minHeight: 44, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 8 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: isCompact ? 14 : 16, fontWeight: '600' }}>{item.name}</Text>
          <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <Text style={{ fontSize: 12, color: countedInThisCycle(item) ? '#4CAF50' : '#999' }}>
              {countedInThisCycle(item) ? `Counted: ${item.lastCount}` : 'To count'}
            </Text>
            {item.unit ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.unit}</Text> : null}
            {item.supplierName ? <Text style={{ fontSize:12, color:'#6B7280' }}>• {item.supplierName}</Text> : null}
            {FlagBadge}
            {LowBadge}
          </View>
        </View>
        {areaStarted && showExpected && expectedStr ? (
          <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#EAF4FF', marginLeft: 8 }}>
            <Text style={{ color: '#0A5FFF', fontWeight: '700', fontSize: 12 }}>Expected: {expectedStr}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {showSteppers && !locked ? (
          <TouchableOpacity
            onPress={() => adjustTyped(-1)}
            onLongPress={() => startRepeat(-1)}
            onPressOut={stopRepeat}
            style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, borderWidth:1, borderColor:'#e5e7eb', backgroundColor:'#f9fafb' }}
          >
            <Text style={{ fontWeight:'900' }}>−</Text>
          </TouchableOpacity>
        ) : null}

        <TextInput
          ref={(el)=>{ inputRefs.current[item.id]=el; }}
          value={localQty[item.id] ?? ''}
          onChangeText={(t)=>setLocalQty(m=>({...m,[item.id]:t}))}
          placeholder={placeholder}
          keyboardType="number-pad"
          inputMode="decimal"
          maxLength={32}
          returnKeyType="done"
          blurOnSubmit={false}
          editable={!locked}
          onFocus={()=>setFocusedInputId(item.id)}
          onBlur={()=>setFocusedInputId((prev)=>prev===item.id?null:prev)}
          onSubmitEditing={()=> throttleAction(()=>saveCount(item))() }
          style={{
            flexGrow: 1, minWidth: 160,
            paddingVertical: Math.max(8, dens(8)), paddingHorizontal: dens(12),
            borderWidth: 1, borderColor: locked ? '#ddd' : '#ccc', borderRadius: 10,
            height: Math.max(40, dens(40)),
            backgroundColor: locked ? '#f7f7f7' : '#fff',
            fontSize: isCompact ? 14 : 15
          }}
        />

        {showSteppers && !locked ? (
          <TouchableOpacity
            onPress={() => adjustTyped(1)}
            onLongPress={() => startRepeat(1)}
            onPressOut={stopRepeat}
            style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, borderWidth:1, borderColor:'#e5e7eb', backgroundColor:'#f9fafb' }}
          >
            <Text style={{ fontWeight:'900' }}>＋</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={ throttleAction(()=>saveCount(item)) }
          disabled={locked}
          style={{ flexDirection:'row', alignItems:'center', gap:6, backgroundColor: locked ? '#B0BEC5' : '#0A84FF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }}
        >
          {(localQty[item.id] ?? '').trim() !== '' ? <View style={{ width:8, height:8, borderRadius:4, backgroundColor:'#00E5FF' }} /> : null}
          <Text style={{ color: '#fff', fontWeight: '800' }}>{locked ? 'Locked' : 'Save'}</Text>
        </TouchableOpacity>

        {isManager && ENABLE_MANAGER_INLINE_APPROVE ? (
          <TouchableOpacity
            onPress={ throttleAction(()=>approveNow(item)) }
            disabled={locked}
            style={{ backgroundColor: locked ? '#CFD8DC' : '#10B981', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 }}>
            <Text style={{ color: 'white', fontWeight: '800' }}>Approve now (Mgr)</Text>
          </TouchableOpacity>
        ) : null}

        {countedNow && !isManager ? (
          <TouchableOpacity onPress={() => openAdjustment(item)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F3E5F5' }}>
            <Text style={{ color: '#6A1B9A', fontWeight: '700' }}>Request adj.</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

/* ---------------------------------- Screen ---------------------------------- */

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

  // [PAIR2] global density
  const { density, setDensity, isCompact } = useDensity();
  const D = isCompact ? 0.78 : 1;                   // tighten ~22% in compact
  const dens = <T extends number>(v: T) => Math.round(v * D);

  // Export toast (non-blocking)
  const [exportToast, setExportToast] = useState<string | null>(null);
  const showExportToast = (msg = 'Export ready') => {
    setExportToast(msg);
    setTimeout(() => setExportToast(null), 1500);
  };

  // Learn/Info modals
  const [infoOpen, setInfoOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState('');
  const filterDebounced = useDebouncedValue(filter, 200);

  // View prefs (per-area)
  const prefKey = (k: string) => `view:${venueId ?? 'noVen'}:${areaId ?? 'noArea'}:${k}`;
  const [showExpected, setShowExpected] = useState(true);
  const [compactCounted, setCompactCounted] = useState(true);
  const [sortUncountedFirst, setSortUncountedFirst] = useState(false);
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [showSteppers, setShowSteppers] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  // More menu
  const [moreOpen, setMoreOpen] = useState(false);

  // Persist/restore view prefs
  useEffect(() => { (async () => {
    if (!AS) return;
    try {
      const [exp, comp, sort, unc, stp, flg] = await Promise.all([
        AS.getItem(prefKey('showExpected')),
        AS.getItem(prefKey('compactCounted')),
        AS.getItem(prefKey('sortUncountedFirst')),
        AS.getItem(prefKey('onlyUncounted')),
        AS.getItem(prefKey('showSteppers')),
        AS.getItem(prefKey('onlyFlagged')),
      ]);
      if (exp != null) setShowExpected(exp === '1');
      if (comp != null) setCompactCounted(comp === '1');
      if (sort != null) setSortUncountedFirst(sort === '1');
      if (unc != null) setOnlyUncounted(unc === '1');
      if (stp != null) setShowSteppers(stp === '1');
      if (flg != null) setOnlyFlagged(flg === '1');
    } catch {}
  })(); }, [venueId, areaId]);
  useEffect(() => { if (!AS) return; AS.setItem(prefKey('showExpected'), showExpected ? '1' : '0').catch(()=>{}); }, [showExpected, venueId, areaId]);
  useEffect(() => { if (!AS) return; AS.setItem(prefKey('compactCounted'), compactCounted ? '1' : '0').catch(()=>{}); }, [compactCounted, venueId, areaId]);
  useEffect(() => { if (!AS) return; AS.setItem(prefKey('sortUncountedFirst'), sortUncountedFirst ? '1' : '0').catch(()=>{}); }, [sortUncountedFirst, venueId, areaId]);
  useEffect(() => { if (!AS) return; AS.setItem(prefKey('onlyUncounted'), onlyUncounted ? '1' : '0').catch(()=>{}); }, [onlyUncounted, venueId, areaId]);
  useEffect(() => { if (!AS) return; AS.setItem(prefKey('showSteppers'), showSteppers ? '1' : '0').catch(()=>{}); }, [showSteppers, venueId, areaId]);
  useEffect(() => { if (!AS) return; AS.setItem(prefKey('onlyFlagged'), onlyFlagged ? '1' : '0').catch(()=>{}); }, [onlyFlagged, venueId, areaId]);

  const [localQty, setLocalQty] = useState<Record<string, string>>({});
  const [adjModalFor, setAdjModalFor] = useState<Item | null>(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const [addingName, setAddingName] = useState('');
  const [addingUnit, setAddingUnit] = useState('');
  const [addingSupplier, setAddingSupplier] = useState('');
  const nameInputRef = useRef<TextInput>(null);

  const [areaMeta, setAreaMeta] = useState<AreaDoc | null>(null);

  const [histFor, setHistFor] = useState<Item | null>(null);
  const [histRows, setHistRows] = useState<AuditEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const [menuFor, setMenuFor] = useState<Item | null>(null);

  const [editFor, setEditFor] = useState<Item | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editSupplier, setEditSupplier] = useState('');
  const [editPar, setEditPar] = useState<string>('');
  const [editFocusPar, setEditFocusPar] = useState(false);
  const editParRef = useRef<TextInput>(null);

  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const listRef = useRef<FlatList>(null);

  const [focusedInputId, setFocusedInputId] = useState<string | null>(null);

  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOffline(!(s.isConnected && s.isInternetReachable !== false)));
    return () => unsub && unsub();
  }, []);

  const [legendDismissed, setLegendDismissed] = useState(false);
  const legendKey = `areaLegendDismissed:${venueId ?? 'noVen'}:${areaId ?? 'noArea'}`;
  useEffect(() => { (async () => { if (!AS) return; try { const v = await AS.getItem(legendKey); setLegendDismissed(v === '1'); } catch {} })(); }, [legendKey]);
  const dismissLegend = async () => { setLegendDismissed(true); if (AS) try { await AS.setItem(legendKey, '1'); } catch {} };

  useEffect(() => { (async () => { if (!AS) return; try { const u = await AS.getItem('quickAdd:unit'); if (u) setAddingUnit(u); const s = await AS.getItem('quickAdd:supplier'); if (s) setAddingSupplier(s); } catch {} })(); }, []);
  const rememberQuickAdd = async (unit: string, supplier: string) => { if (!AS) return; try { await AS.setItem('quickAdd:unit', unit || ''); await AS.setItem('quickAdd:supplier', supplier || ''); } catch {} };

  useEffect(() => {
    if (!itemsPathOk) return;
    const qy = query(collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items'), orderBy('name'));
    const unsub = onSnapshot(qy, (snap) => {
      const rows: Item[] = []; snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) })); setItems(rows);
    }); return () => unsub();
  }, [itemsPathOk, venueId, departmentId, areaId]);

  useEffect(() => {
    if (!itemsPathOk) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId), (d) => {
      setAreaMeta((d.data() as AreaDoc) || null);
    }); return () => unsub();
  }, [itemsPathOk, venueId, departmentId, areaId]);

  useEffect(() => {
    let unsub: any;
    (async () => {
      if (!venueId || !uid) return;
      const ven = await getDoc(doc(db, 'venues', venueId));
      const ownerUid = (ven.data() as VenueDoc | undefined)?.ownerUid;
      if (ownerUid && ownerUid === uid) { setIsManager(true); return; }
      unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), (d) => {
        const md = d.data() as MemberDoc | undefined; setIsManager(md?.role === 'manager');
      });
    })();
    return () => unsub && unsub();
  }, [venueId, uid]);

  const startedAtMs = areaMeta?.startedAt?.toMillis ? areaMeta.startedAt.toMillis() : (areaMeta?.startedAt?._seconds ? areaMeta.startedAt._seconds * 1000 : null);
  const areaStarted = !!startedAtMs;

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
    if (!areaStarted) return null;
    if (typeof it.expectedQty === 'number') return it.expectedQty;
    const base = typeof it.lastCount === 'number' ? it.lastCount : null;
    const incoming = typeof it.incomingQty === 'number' ? it.incomingQty : 0;
    const sold = typeof it.soldQty === 'number' ? it.soldQty : 0;
    const wastage = typeof it.wastageQty === 'number' ? it.wastage : (typeof it.wastageQty === 'number' ? it.wastageQty : 0);
    if (base == null) return null;
    return base + incoming - sold - wastage;
  };

  const filteredBase = useMemo(() => {
    const n = (filterDebounced || '').trim().toLowerCase();
    return !n ? items : items.filter((it) => (it.name || '').toLowerCase().includes(n));
  }, [items, filterDebounced]);

  const filtered = useMemo(() => {
    let rows = filteredBase;
    if (onlyLow) rows = rows.filter(isLow);
    if (onlyUncounted) rows = rows.filter((it) => !countedInThisCycle(it) || it.id === focusedInputId);
    if (onlyFlagged) rows = rows.filter((it) => !!it.flagRecount);
    if (sortUncountedFirst) {
      rows = rows.slice().sort((a, b) => {
        const au = countedInThisCycle(a) ? 1 : 0;
        const bu = countedInThisCycle(b) ? 1 : 0;
        if (au !== bu) return au - bu;
        const an = (a.name || '').toLowerCase(); const bn = (b.name || '').toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
    }
    return rows;
  }, [filteredBase, onlyLow, onlyUncounted, onlyFlagged, sortUncountedFirst, startedAtMs, focusedInputId]);

  const countedCount = items.filter(countedInThisCycle).length;
  const lowCount = items.filter(isLow).length;
  const flaggedCount = items.filter((it)=>!!it.flagRecount).length;
  const progressPct = items.length ? Math.round((countedCount / items.length) * 100) : 0;

  // [PAIR3] compute last activity
  const lastActivityDate: Date | null = useMemo(() => {
    let last: Date | null = null;
    for (const it of items) {
      const ts = it?.lastCountAt?.toDate ? it.lastCountAt.toDate() : (it?.lastCountAt?._seconds ? new Date(it.lastCountAt._seconds * 1000) : null);
      if (ts && (!last || ts > last)) last = ts;
    }
    return last;
  }, [items]);

  const focusNext = (currentId?: string) => {
    let startIdx = 0;
    if (currentId) {
      const idx = filtered.findIndex((x) => x.id === currentId);
      startIdx = idx >= 0 ? idx : 0;
    }
    const nextUncountedIdx = filtered.findIndex((x, i) => i >= startIdx && !countedInThisCycle(x));
    const targetIdx = nextUncountedIdx > -1 ? nextUncountedIdx : -1;
    if (targetIdx === -1) { Keyboard.dismiss(); setFocusedInputId(null); return; }
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

  const needsDeltaConfirm = (prev: number | null | undefined, next: number) => {
    const from = typeof prev === 'number' ? prev : 0;
    const abs = Math.abs(next - from);
    const ratio = from === 0 ? 1 : abs / Math.max(1, Math.abs(from));
    return abs >= DELTA_ABS_THRESHOLD && ratio >= DELTA_RATIO_THRESHOLD;
  };

  const [undoToast, setUndoToast] = useState<{visible: boolean; itemId: string|null; prevQty: number|null; prevAt: any|null; timer?: any}>({visible:false,itemId:null,prevQty:null,prevAt:null});
  const showUndo = (itemId: string, prevQty: number|null, prevAt: any|null) => {
    if (undoToast.timer) clearTimeout(undoToast.timer);
    const t = setTimeout(() => setUndoToast({visible:false,itemId:null,prevQty:null,prevAt:null}), 10000);
    setUndoToast({ visible:true, itemId, prevQty, prevAt, timer: t });
  };
  const undoLast = async () => {
    const { itemId, prevQty, prevAt, timer } = undoToast;
    if (timer) clearTimeout(timer);
    setUndoToast({visible:false,itemId:null,prevQty:null,prevAt:null});
    if (!itemId) return;
    try {
      await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',itemId), {
        lastCount: prevQty ?? null,
        lastCountAt: prevAt ?? serverTimestamp()
      });
      hapticSuccess();
    } catch (e:any) { Alert.alert('Undo failed', e?.message ?? String(e)); }
  };

  const saveCount = async (item: Item) => {
    const typed = (localQty[item.id] ?? '').trim();
    const prevQty = (typeof item.lastCount === 'number') ? item.lastCount : null;
    const prevAt = item.lastCountAt ?? null;

    const doWrite = async (qty: number) => {
      try {
        await ensureAreaStarted();
        await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',item.id),
          { lastCount: qty, lastCountAt: serverTimestamp() });
        setLocalQty((m) => ({ ...m, [item.id]: '' }));
        hapticSuccess();
        showUndo(item.id, prevQty, prevAt);
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

  const approveNow = async (item: Item) => {
    const typed = (localQty[item.id] ?? '').trim();
    if (!ENABLE_MANAGER_INLINE_APPROVE) return;
    if (!isManager) return Alert.alert('Manager only', 'Only managers can approve directly.');
    if (!/^\d+(\.\d+)?$/.test(typed)) return Alert.alert('Invalid number', 'Enter a numeric quantity');

    const qty = parseFloat(typed);
    const prevQty = (typeof item.lastCount === 'number') ? item.lastCount : null;
    const prevAt = item.lastCountAt ?? null;

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
        showUndo(item.id, prevQty, prevAt);
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
    } else { await doApprove(); }
  };

  const addQuickItem = async () => {
    const nm = (addingName || '').trim();
    if (!nm) return Alert.alert('Name required');
    try {
      const payload: any = {
        name: nm,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const unitTrim = (addingUnit || '').trim();
      if (unitTrim) payload.unit = unitTrim; // allowed on CREATE
      await addDoc(collection(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items'), payload);
    } catch (e:any){ Alert.alert('Could not add item', e?.message ?? String(e)); return; }
    setAddingName(''); await rememberQuickAdd(addingUnit, addingSupplier);
    nameInputRef.current?.blur(); Keyboard.dismiss(); hapticSuccess();
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

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCounted, setReviewCounted] = useState<Item[]>([]);
  const [reviewMissing, setReviewMissing] = useState<Item[]>([]);
  const [reviewFlagged, setReviewFlagged] = useState<Item[]>([]);
  const openReview = () => {
    const counted = items.filter(countedInThisCycle);
    const missing = items.filter((it) => !countedInThisCycle(it));
    const flagged = items.filter((it) => !!it.flagRecount);
    setReviewCounted(counted);
    setReviewMissing(missing);
    setReviewFlagged(flagged);
    setReviewOpen(true);
  };
  const jumpToItem = (id: string) => {
    setReviewOpen(false);
    const idx = filtered.findIndex((x) => x.id === id);
    if (idx > -1) {
      try { listRef.current?.scrollToIndex({ index: idx + 1, animated: true }); } catch {}
      setTimeout(() => inputRefs.current[id]?.focus?.(), 80);
    }
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
        await maybeFinalizeDepartment(); nav.goBack();
      } catch (e: any) { Alert.alert('Could not complete area', e?.message ?? String(e)); }
    };

    if (missing.length > 0) {
      const msg = missing.length === items.length
        ? 'No items have been counted yet this cycle. Continue and save all as 0?'
        : `Not all items have a count for this cycle. ${missing.length.toLocaleString()} will be saved as 0. Continue?`;
      Alert.alert('Incomplete counts', msg, [
        { text: 'Go back', style: 'cancel' }, { text: 'Continue', onPress: perform }
      ]);
    } else { await perform(); }
  };

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
        hapticSuccess(); Alert.alert('Done', `${toZero.length} item(s) saved as 0.`);
      } catch (e:any) { Alert.alert('Failed', e?.message ?? String(e)); }
    };

    Alert.alert('Initialise with zeros', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: throttleAction(doIt) }
    ]);
  };

  const useBluetoothFor = (item: Item) => Alert.alert('Bluetooth Count', `Would read from paired scale for "${item.name}" (stub).`);
  const usePhotoFor     = (item: Item) => Alert.alert('Photo Count', `Would take photo and OCR for "${item.name}" (stub).`);

  const openHistory = throttleAction(async (item: Item) => {
    if (!venueId) return;
    setHistFor(item); setHistLoading(true);
    try { const rows = await fetchRecentItemAudits(venueId, item.id, 10); setHistRows(rows); }
    catch { setHistRows([]); }
    finally { setHistLoading(false); }
  });
  const closeHistory = () => { setHistFor(null); setHistRows([]); setHistLoading(false); };

  const openEditItem = (item: Item, focusPar?: boolean) => {
    setEditFor(item);
    setEditName(item.name || '');
    setEditUnit(item.unit || '');
    setEditSupplier(item.supplierName || '');
    setEditPar(typeof item.parLevel === 'number' ? String(item.parLevel) : '');
    setEditFocusPar(!!focusPar);
  };
  useEffect(() => {
    if (editFor && editFocusPar) {
      setTimeout(() => editParRef.current?.focus?.(), 100);
      setEditFocusPar(false);
    }
  }, [editFor, editFocusPar]);

  const saveEditItem = async () => {
    if (!editFor) return;
    const par = (editPar ?? '').trim();
    const parNum = par === '' ? null : Number(par);
    if (par !== '' && !/^\d+(\.\d+)?$/.test(par)) return Alert.alert('Invalid par', 'Par level must be a number');
    try {
      await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',editFor.id), {
        name: (editName || '').trim() || editFor.name || '',
        unit: (editUnit || '').trim() || null,
        supplierName: (editSupplier || '').trim() || null,
        parLevel: parNum,
        updatedAt: serverTimestamp(),
      });
      setEditFor(null); hapticSuccess();
    } catch (e:any) { Alert.alert('Update failed', e?.message ?? String(e)); }
  };

  const toCsv = (rows: Array<Record<string, any>>) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const safe = (v: any) => { if (v === null || v === undefined) return ''; const s = String(v).replace(/"/g, '""'); return `"${s}"`; };
    return [ headers.map(safe).join(','), ...rows.map((r) => headers.map((h) => safe(r[h])).join(',')) ].join('\n');
  };

  const exportCsvAll = throttleAction(async () => {
    try {
      showExportToast('Export ready'); // non-blocking info
      const rows = filtered.map((it) => {
        const expected = deriveExpected(it);
        return {
          name: it.name || '',
          unit: it.unit || '',
          lastCount: typeof it.lastCount === 'number' ? it.lastCount : '',
          expectedQty: expected ?? '',
          low: (typeof it.parLevel === 'number' && typeof it.lastCount === 'number' && it.lastCount < it.parLevel) ? 'yes' : 'no',
          supplier: it.supplierName || '',
          flagged: it.flagRecount ? 'yes' : 'no',
        };
      });
      const csv = toCsv(rows);
      if (!csv) { Alert.alert('Nothing to export', 'No rows in the current view.'); return; }
      if (!FS || !FS.cacheDirectory) { Alert.alert('Export unavailable', 'FileSystem not available.'); return; }
      const fname = `tallyup-area-${areaId}-${Date.now()}.csv`;
      const path = FS.cacheDirectory + fname;
      await FS.writeAsStringAsync(path, csv, { encoding: FS.EncodingType.UTF8 });
      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export CSV — Current view' });
      } else { Alert.alert('Exported', `Saved to cache: ${fname}`); }
    } catch (e:any) { Alert.alert('Export failed', e?.message ?? String(e)); }
  });

  const exportCsvChangesOnly = throttleAction(async () => {
    try {
      showExportToast('Export ready'); // non-blocking info
      if (!areaStarted) { Alert.alert('Nothing to export', 'This area has not been started yet.'); return; }
      const changed = filtered.filter(countedInThisCycle);
      if (changed.length === 0) { Alert.alert('Nothing to export', 'No items counted in this cycle for the current view.'); return; }
      const rows = changed.map((it) => ({
        name: it.name || '', unit: it.unit || '',
        newCount: typeof it.lastCount === 'number' ? it.lastCount : '',
        expected: deriveExpected(it) ?? '',
        flagged: it.flagRecount ? 'yes' : 'no',
      }));
      const csv = toCsv(rows);
      if (!FS || !FS.cacheDirectory) { Alert.alert('Export unavailable', 'FileSystem not available.'); return; }
      const fname = `tallyup-area-${areaId}-changes-${Date.now()}.csv`;
      const path = FS.cacheDirectory + fname;
      await FS.writeAsStringAsync(path, csv, { encoding: FS.EncodingType.UTF8 });
      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export CSV — Changes only' });
      } else { Alert.alert('Exported', `Saved to cache: ${fname}`); }
    } catch (e:any) { Alert.alert('Export failed', e?.message ?? String(e)); }
  });

  const clampNonNegative = (n:number) => (isNaN(n) ? 0 : Math.max(0, n));

  const toggleFlagRecount = async (item: Item) => {
    try {
      await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',item.id), {
        flagRecount: !item.flagRecount,
        updatedAt: serverTimestamp(),
      });
      hapticSuccess();
    } catch (e:any) { Alert.alert('Failed', e?.message ?? String(e)); }
  };

  if (!itemsPathOk) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, textAlign: 'center' }}>Missing navigation params. Need venueId, departmentId and areaId.</Text>
      </SafeAreaView>
    );
  }

  const ListHeader = () => {
    const anyPar = items.some((it) => typeof it.parLevel === 'number');
    const anyLow = items.some((it) => (typeof it.parLevel === 'number' && typeof it.lastCount === 'number' && it.lastCount < it.parLevel));
    const showLowChip = anyPar && anyLow;

    // started/last-activity caption formatter
    const startedAt = areaMeta?.startedAt?.toDate ? areaMeta.startedAt.toDate() : (areaMeta?.startedAt?._seconds ? new Date(areaMeta.startedAt._seconds * 1000) : null);
    const fmt = (d: Date | null) => d ? d.toLocaleString() : '—';

    return (
      <View style={{ backgroundColor: 'white', paddingBottom: dens(8), borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <View style={{ padding: dens(12), gap: 8 }}>
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontSize: isCompact ? 16 : 18, fontWeight: '800' }} numberOfLines={1}>{areaName ?? 'Area Inventory'}</Text>
              {/* [PAIR3] Started/Last activity caption with info button */}
              <View style={{ flexDirection:'row', alignItems:'center', marginTop: 4 }}>
                <Text style={{ opacity: 0.7, fontSize: 12 }} numberOfLines={1}>
                  Started at: {fmt(startedAt)} • Last activity: {fmt(lastActivityDate)}
                </Text>
                <TouchableOpacity onPress={() => setInfoOpen(true)} style={{ marginLeft: 8, padding: 4 }}>
                  <Text style={{ fontSize: 12 }}>ℹ️</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
              <View style={{ paddingVertical:2, paddingHorizontal:8, backgroundColor:'#F3F4F6', borderRadius:12 }}>
                <Text style={{ fontWeight:'800', color:'#374151' }}>
                  {countedCount}/{items.length} • {lowCount} low • {flaggedCount} flag • {progressPct}%
                </Text>
              </View>
              {/* ⋯ More button */}
              <TouchableOpacity onPress={()=>setMoreOpen(true)} style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:12, backgroundColor:'#E5E7EB' }}>
                <Text style={{ fontWeight:'900' }}>⋯</Text>
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

          <View style={{ flexDirection: 'row', gap: 8, alignItems:'center', flexWrap:'wrap' }}>
            <View style={{ flex: 1, position: 'relative' }}>
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Search items…"
                style={{ paddingVertical: dens(8), paddingHorizontal: filter ? 34 : dens(12), borderWidth: 1, borderColor: '#ccc', borderRadius: 12, height: Math.max(40, dens(40)) }}
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
            <TouchableOpacity onPress={() => setShowExpected((v) => !v)} style={{ paddingVertical: dens(8), paddingHorizontal: dens(12), borderRadius: 10, backgroundColor: '#F1F8E9' }}>
              <Text style={{ color: '#558B2F', fontWeight: '700' }}>{showExpected ? 'Hide expected' : 'Show expected'}</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection:'row', gap:8, flexWrap:'wrap' }}>
            {items.some((it)=>typeof it.parLevel==='number') && items.some((it)=> typeof it.parLevel==='number' && typeof it.lastCount==='number' && it.lastCount < it.parLevel) ? (
              <>
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
              </>
            ) : null}

            <TouchableOpacity
              onPress={() => setOnlyFlagged(v=>!v)}
              style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, borderWidth:1, borderColor: onlyFlagged ? '#D97706' : '#E5E7EB', backgroundColor: onlyFlagged ? '#FEF3C7' : 'white' }}
            >
              <Text style={{ fontWeight:'800', color: onlyFlagged ? '#92400E' : '#374151' }}>
                {onlyFlagged ? '✓ Recount only' : 'Recount only'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick add */}
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                ref={nameInputRef}
                value={addingName}
                onChangeText={setAddingName}
                placeholder="Quick add item name"
                style={{ flex: 1, paddingVertical: dens(8), paddingHorizontal: dens(12), borderWidth: 1, borderColor: '#ccc', borderRadius: 12, height: Math.max(40, dens(40)) }}
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

          <View style={{ flexDirection:'row', gap:8, alignItems:'center', marginTop:4, flexWrap:'wrap' }}>
            <TouchableOpacity
              onPress={()=>setCompactCounted((v)=>!v)}
              style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor: compactCounted ? '#E0F2FE' : '#F3F4F6', borderWidth:1, borderColor: compactCounted ? '#38BDF8' : '#E5E7EB' }}
            >
              <Text style={{ fontWeight:'800', color: compactCounted ? '#0369A1' : '#374151' }}>
                {compactCounted ? '✓ Compact counted rows' : 'Show inputs on counted rows'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={()=>setSortUncountedFirst(v=>!v)}
              style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:16, backgroundColor: sortUncountedFirst ? '#DBEAFE' : '#F3F4F6', borderWidth:1, borderColor: sortUncountedFirst ? '#1D4ED8' : '#E5E7EB' }}
            >
              <Text style={{ fontWeight:'800', color: sortUncountedFirst ? '#1D4ED8' : '#374151' }}>
                {sortUncountedFirst ? '✓ Sort uncounted first' : 'Sort A–Z'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const EmptyState = () => (
    <View style={{ paddingHorizontal: 16, paddingVertical: 24, alignItems:'center' }}>
      <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 6 }}>No items in this area yet</Text>
      <Text style={{ color: '#6B7280', textAlign:'center', marginBottom: 12 }}>
        Add your first product to start counting. You can also import later from invoices or suppliers.
      </Text>
      <View style={{ flexDirection:'row', gap:12 }}>
        <TouchableOpacity onPress={() => nameInputRef.current?.focus()} style={{ paddingVertical:10, paddingHorizontal:14, backgroundColor:'#0A84FF', borderRadius:10 }}>
          <Text style={{ color:'white', fontWeight:'800' }}>Add product</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setLearnOpen(true)} style={{ paddingVertical:10, paddingHorizontal:12 }}>
          <Text style={{ color:'#0B132B' }}>Learn more</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const ListFooter = () => (
    <View style={{ padding: dens(12), borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff', gap: 8 }}>
      <TouchableOpacity onPress={openReview}
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
        renderItem={({ item }) => (
          <Row
            item={item}
            isCompact={isCompact}
            dens={dens}
            areaStarted={areaStarted}
            showExpected={showExpected}
            compactCounted={compactCounted}
            showSteppers={showSteppers}
            isManager={isManager}
            localQty={localQty}
            setLocalQty={setLocalQty}
            inputRefs={inputRefs}
            setFocusedInputId={setFocusedInputId}
            setMenuFor={setMenuFor}
            openEditItem={openEditItem}
            openAdjustment={openAdjustment}
            deriveExpected={deriveExpected}
            countedInThisCycle={countedInThisCycle}
            clampNonNegative={clampNonNegative}
            approveNow={approveNow}
            saveCount={saveCount}
          />
        )}
        ListHeaderComponent={<AreaInvHeader areaName={areaName} isCompact={isCompact} dens={dens} startedAt={(areaMeta?.startedAt?.toDate ? areaMeta.startedAt.toDate() : (areaMeta?.startedAt?._seconds ? new Date(areaMeta.startedAt._seconds * 1000) : null))} lastActivityDate={lastActivityDate} offline={offline} legendDismissed={legendDismissed} dismissLegend={dismissLegend} showExpected={showExpected} setShowExpected={setShowExpected} filter={filter} setFilter={setFilter} addingName={addingName} setAddingName={setAddingName} addingUnit={addingUnit} setAddingUnit={setAddingUnit} addingSupplier={addingSupplier} setAddingSupplier={setAddingSupplier} onAddQuickItem={addQuickItem} stats={{ countedCount, total: items.length, lowCount, flaggedCount, progressPct }} onOpenMore={() => setMoreOpen(true)} nameInputRef={nameInputRef} />}
        ListFooterComponent={<ListFooter />}
        ListEmptyComponent={<EmptyState />}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="always"
        removeClippedSubviews={false}
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

      {/* History Modal */}
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

      {/* Edit Item Modal */}
      <Modal visible={!!editFor} animationType="slide" transparent onRequestClose={()=>setEditFor(null)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:16 }}>
            <Text style={{ fontSize:18, fontWeight:'800', marginBottom:8 }}>Edit item</Text>

            <View style={{ gap:10 }}>
              <View>
                <Text style={{ fontWeight:'600', marginBottom:4 }}>Name</Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Item name"
                  style={{ paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
                />
              </View>

              <View style={{ flexDirection:'row', gap:8 }}>
                <View style={{ flex:1 }}>
                  <Text style={{ fontWeight:'600', marginBottom:4 }}>Unit</Text>
                  <TextInput
                    value={editUnit}
                    onChangeText={setEditUnit}
                    placeholder="e.g. bottles, kg"
                    style={{ paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
                  />
                </View>
                <View style={{ flex:1 }}>
                  <Text style={{ fontWeight:'600', marginBottom:4 }}>Supplier</Text>
                  <TextInput
                    value={editSupplier}
                    onChangeText={setEditSupplier}
                    placeholder="Supplier name"
                    style={{ paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
                  />
                </View>
              </View>

              <View>
                <Text style={{ fontWeight:'600', marginBottom:4 }}>Par level</Text>
                <TextInput
                  ref={editParRef}
                  value={editPar}
                  onChangeText={setEditPar}
                  placeholder="e.g. 24"
                  keyboardType="number-pad"
                  inputMode="decimal"
                  style={{ paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
                />
              </View>
            </View>

            <View style={{ flexDirection:'row', gap:10, marginTop:14 }}>
              <TouchableOpacity onPress={()=>setEditFor(null)} style={{ padding:12, borderRadius:10, backgroundColor:'#ECEFF1', flex:1 }}>
                <Text style={{ textAlign:'center', fontWeight:'700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveEditItem} style={{ padding:12, borderRadius:10, backgroundColor:'#0A84FF', flex:1 }}>
                <Text style={{ textAlign:'center', color:'#fff', fontWeight:'800' }}>Save</Text>
              </TouchableOpacity>
            </View>
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

            <TouchableOpacity
              disabled={deriveExpected(menuFor || ({} as Item)) == null}
              onPress={()=>{
                const it = menuFor!;
                const ex = deriveExpected(it);
                setMenuFor(null);
                if (ex == null) return;
                setLocalQty(m => ({ ...m, [it.id]: String(ex) }));
                setTimeout(()=>{ inputRefs.current[it.id]?.focus?.(); }, 50);
              }}
              style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor: deriveExpected(menuFor || ({} as Item)) == null ? '#F3F4F6' : '#EAF4FF', marginBottom:8 }}
            >
              <Text style={{ fontWeight:'800', color: deriveExpected(menuFor || ({} as Item)) == null ? '#9CA3AF' : '#0A5FFF' }}>
                Use Expected
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); setTimeout(()=>toggleFlagRecount(it), 0); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#FEF3C7', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#92400E' }}>
                {menuFor?.flagRecount ? 'Unflag “Recount”' : 'Flag for recount'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); setTimeout(()=>openHistory(it), 0); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#EEF2FF', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#3730A3' }}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); openAdjustment(it); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3E5F5', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#6A1B9A' }}>Request adjustment</Text>
            </TouchableOpacity>
            {isManager && ENABLE_MANAGER_INLINE_APPROVE ? (
              <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); throttleAction(()=>approveNow(it))(); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#DCFCE7', marginBottom:8 }}>
                <Text style={{ fontWeight:'800', color:'#166534' }}>Approve now (manager)</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); useBluetoothFor(it); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#E3F2FD', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#0A84FF' }}>Bluetooth (BT)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); usePhotoFor(it); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#FFF8E1', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#9A3412' }}>Camera (Cam)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); openEditItem(it); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>Edit item</Text>
            </TouchableOpacity>
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

      {/* Bottom snackbar — Undo */}
      {undoToast.visible ? (
        <View style={{ position:'absolute', left:12, right:12, bottom:16, backgroundColor:'#111827', borderRadius:12, padding:12, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
          <Text style={{ color:'white', fontWeight:'700' }}>Saved</Text>
          <TouchableOpacity onPress={undoLast} style={{ paddingVertical:6, paddingHorizontal:10, backgroundColor:'#374151', borderRadius:8 }}>
            <Text style={{ color:'#93C5FD', fontWeight:'800' }}>Undo</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* [PAIR2] Export toast */}
      {exportToast ? (
        <View style={{
          position: 'absolute', left: 16, right: 16, bottom: Platform.select({ ios: 24, android: 16 }),
          backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center'
        }}>
          <Text style={{ color: 'white', fontWeight: '600' }}>{exportToast}</Text>
        </View>
      ) : null}

      {/* Keyboard Accessory */}
      {showSteppers && focusedInputId ? (
        <View style={{ position:'absolute', left:12, right:12, bottom:16, backgroundColor:'#F3F4F6', borderRadius:14, padding:8, flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderWidth:1, borderColor:'#E5E7EB' }}>
          <TouchableOpacity onPress={() => {
            setLocalQty(prev => {
              const raw = (prev[focusedInputId] ?? '').trim();
              let v = raw === '' ? 0 : parseFloat(raw);
              if (isNaN(v)) v = 0;
              v = clampNonNegative(v - 1);
              return { ...prev, [focusedInputId]: String(v) };
            });
          }} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#FFFFFF', borderWidth:1, borderColor:'#E5E7EB' }}>
            <Text style={{ fontWeight:'900' }}>−1</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => {
            setLocalQty(prev => {
              const raw = (prev[focusedInputId] ?? '').trim();
              let v = raw === '' ? 0 : parseFloat(raw);
              if (isNaN(v)) v = 0;
              v = clampNonNegative(v + 1);
              return { ...prev, [focusedInputId]: String(v) };
            });
          }} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#FFFFFF', borderWidth:1, borderColor:'#E5E7EB' }}>
            <Text style={{ fontWeight:'900' }}>+1</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setLocalQty(prev => ({ ...prev, [focusedInputId]: '' }))} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#FFFFFF', borderWidth:1, borderColor:'#E5E7EB' }}>
            <Text style={{ fontWeight:'800' }}>Clear</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => focusNext(focusedInputId)} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#0A84FF' }}>
            <Text style={{ fontWeight:'900', color:'white' }}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Next Uncounted FAB */}
      <TouchableOpacity
        onPress={() => focusNext()}
        style={{ position:'absolute', right:16, bottom: showSteppers && focusedInputId ? 72 : 16, backgroundColor:'#0A84FF', paddingVertical:12, paddingHorizontal:14, borderRadius:28, elevation:4 }}
        activeOpacity={0.9}
      >
        <Text style={{ color:'white', fontWeight:'900' }}>Next</Text>
      </TouchableOpacity>

      {/* Pre-Submit Review Modal (polished) */}
      <Modal visible={reviewOpen} animationType="slide" transparent onRequestClose={()=>setReviewOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:16, maxHeight:'80%' }}>
            <Text style={{ fontSize:18, fontWeight:'800', marginBottom:4 }}>Review before submit</Text>
            <Text style={{ color:'#374151', marginBottom:10 }}>
              {countedCount}/{items.length} counted • {lowCount} low • {flaggedCount} flagged • {progressPct}%
            </Text>

            <ScrollView contentContainerStyle={{ gap:10 }}>
              <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, padding:10 }}>
                <Text style={{ fontWeight:'800', marginBottom:6 }}>Counted this cycle ({reviewCounted.length})</Text>
                {reviewCounted.length === 0 ? (
                  <Text style={{ color:'#6B7280' }}>No items have been counted yet.</Text>
                ) : reviewCounted.map((it) => (
                  <TouchableOpacity key={it.id} onPress={()=>{ setReviewOpen(false); setTimeout(()=>inputRefs.current[it.id]?.focus?.(),80); }} style={{ paddingVertical:6 }}>
                    <Text style={{ fontWeight:'700' }}>{it.name}</Text>
                    <Text style={{ color:'#374151' }}>Saved: {typeof it.lastCount === 'number' ? it.lastCount : '—'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, padding:10 }}>
                <Text style={{ fontWeight:'800', marginBottom:6 }}>Will be saved as 0</Text>
                {reviewMissing.length === 0 ? (
                  <Text style={{ color:'#6B7280' }}>None — all items have been counted.</Text>
                ) : (
                  <>
                    {reviewMissing.slice(0, 3).map((it) => (
                      <TouchableOpacity key={it.id} onPress={()=>{ setReviewOpen(false); setTimeout(()=>inputRefs.current[it.id]?.focus?.(),80); }} style={{ paddingVertical:6 }}>
                        <Text style={{ fontWeight:'700' }}>{it.name}</Text>
                        <Text style={{ color:'#6B7280' }}>Tap to jump to it</Text>
                      </TouchableOpacity>
                    ))}
                    {reviewMissing.length > 3 ? (
                      <Text style={{ color:'#6B7280', marginTop:4 }}>
                        and {reviewMissing.length - 3} more…
                      </Text>
                    ) : null}
                  </>
                )}
              </View>

              <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, padding:10 }}>
                <Text style={{ fontWeight:'800', marginBottom:6 }}>Flagged for recount ({reviewFlagged.length})</Text>
                {reviewFlagged.length === 0 ? (
                  <Text style={{ color:'#6B7280' }}>No items are flagged.</Text>
                ) : reviewFlagged.map((it) => (
                  <TouchableOpacity key={it.id} onPress={()=>{ setReviewOpen(false); setTimeout(()=>inputRefs.current[it.id]?.focus?.(),80); }} style={{ paddingVertical:6 }}>
                    <Text style={{ fontWeight:'700' }}>{it.name}</Text>
                    <Text style={{ color:'#92400E' }}>Marked “Recount”</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={{ flexDirection:'row', gap:10, marginTop:12 }}>
              <TouchableOpacity onPress={()=>setReviewOpen(false)} style={{ padding:12, borderRadius:10, backgroundColor:'#ECEFF1', flex:1 }}>
                <Text style={{ textAlign:'center', fontWeight:'700' }}>Back to counting</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>{ setReviewOpen(false); throttleAction(completeArea)(); }} style={{ padding:12, borderRadius:10, backgroundColor:'#16A34A', flex:1 }}>
                <Text style={{ textAlign:'center', color:'#fff', fontWeight:'800' }}>Submit now</Text>
              </TouchableOpacity>
            </View>

            {countedCount > 0 ? (
              <TouchableOpacity onPress={exportCsvChangesOnly} style={{ marginTop:10, padding:10, borderRadius:10, backgroundColor:'#DBEAFE' }}>
                <Text style={{ textAlign:'center', color:'#1E40AF', fontWeight:'800' }}>Export CSV — Changes only</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Info explainer (timestamps) */}
      <Modal visible={infoOpen} animationType="fade" transparent onRequestClose={() => setInfoOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, width: '84%' }}>
            <Text style={{ fontWeight: '600', fontSize: 16, marginBottom: 8 }}>
              What does “Started at” mean?
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20 }}>
              “Started at” is when this area’s stock take was first opened.
              “Last activity” is the most recent count update for any item in this area.
              This helps Managers see timing and progress at a glance.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 }}>
              <TouchableOpacity onPress={() => setInfoOpen(false)} style={{ padding: 10 }}>
                <Text style={{ color: '#0B132B', fontWeight: '600' }}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Learn more explainer (empty state) */}
      <Modal visible={learnOpen} animationType="slide" transparent onRequestClose={() => setLearnOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, width: '90%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16, marginBottom: 8 }}>How to get started</Text>
            <Text style={{ fontSize: 14, lineHeight: 20, marginBottom: 12 }}>
              Add your products manually, or scan barcodes and attach suppliers later.
              You’ll see “Expected” values once PARs are set, and the Review panel shows changes before submit.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity onPress={() => setLearnOpen(false)} style={{ padding: 10 }}>
                <Text style={{ color: '#0B132B', fontWeight: '600' }}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ⋯ More action sheet */}
      <Modal visible={moreOpen} animationType="fade" transparent onRequestClose={()=>setMoreOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', alignItems:'center', padding:16 }}>
          <View style={{ backgroundColor:'#fff', borderRadius:12, width:'100%', maxWidth:420, padding:12 }}>
            <Text style={{ fontSize:16, fontWeight:'800', marginBottom:8 }}>More</Text>

            {/* Density toggle — global */}
            <TouchableOpacity onPress={()=>setDensity('comfortable')} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>
                {isCompact ? 'Density: Comfortable' : 'Density: Comfortable ✓'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setDensity('compact')} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>
                {isCompact ? 'Density: Compact ✓' : 'Density: Compact'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>{ setShowSteppers(v=>!v); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#E0F2FE', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#0369A1' }}>
                {showSteppers ? '✓ Steppers & keyboard bar (on)' : 'Enable steppers & keyboard bar'}
              </Text>
            </TouchableOpacity>

            {/* Standardized export labels */}
            <TouchableOpacity onPress={exportCsvAll} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#EFF6FF', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#1D4ED8' }}>Export CSV — Current view</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={exportCsvChangesOnly} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#DBEAFE', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#1E40AF' }}>Export CSV — Changes only</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>setCompactCounted(v=>!v)} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>
                {compactCounted ? '✓ Compact counted rows' : 'Compact counted rows'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>setSortUncountedFirst(v=>!v)} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#111827' }}>
                {sortUncountedFirst ? '✓ Sort uncounted first' : 'Sort uncounted first'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={()=>setShowExpected(v=>!v)} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F1F8E9', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#14532D' }}>
                {showExpected ? '✓ Show expected (on)' : 'Show expected (off)'}
              </Text>
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
