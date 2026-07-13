// @ts-nocheck
import { addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, increment, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import AreaInvHeader from "./components/AreaInvHeader";
import PhotoCountModal from "./components/PhotoCountModal";
import SmartShelfModal from "./components/SmartShelfModal";
import ShelfPhotoModal from "./components/ShelfPhotoModal";
import ShelfScanModal from "../../components/stocktake/ShelfScanModal";
import ProductPhotoModal from "../../components/stocktake/ProductPhotoModal";
import VenueProductSearchModal from "../../components/stocktake/VenueProductSearchModal";
import BarcodeScannerModal from "../../components/stocktake/BarcodeScannerModal";
import CountingUnitModal, { CountingUnitConfig } from "../../components/stocktake/CountingUnitModal";
import { uploadShelfScanPhoto } from "../../services/shelfScan/uploadShelfScanPhoto";
import { createShelfScanJob } from "../../services/shelfScan/createShelfScanJob";
import { uploadStockTakePhoto } from "../../services/stocktake/uploadStockTakePhoto";
import { createStockTakePhotoDoc } from "../../services/stocktake/stockTakePhotos";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal,
  Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View, ActivityIndicator, ScrollView, Platform, Animated, Easing
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuth } from 'firebase/auth';
import { db } from '../../services/firebase';
import HintBubble from '../../components/hints/HintBubble';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { throttleAction } from '../../utils/pressThrottle';
import { dlog } from '../../utils/devlog';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import NetInfo from '@react-native-community/netinfo';
import { useDensity } from '../../hooks/useDensity';
import generateLatestCountsSnapshot from '../../services/reports/generateLatestCountsSnapshot';
import { writeDepartmentSnapshot } from '../../services/reports/snapshotWriter';
import { incrementFullStocktakeCompleted } from '../../services/trialStocktake';
import { startNewDepartmentCycle } from '../../services/cycles';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import AS from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as FS from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { aiUrl } from '../../config/ai';

import { ENABLE_MANAGER_INLINE_APPROVE } from '../../flags/managerInlineApprove';
import { approveDirectCount } from '../../services/adjustmentsDirect';
import { openIzzy } from '../../components/IzzyAssistant';
import { fetchRecentItemAudits, AuditEntry } from '../../services/audits';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { toastService } from '../../utils/toastService';
import { findMatchingProduct } from '../../services/matching';
import { ScaleService } from '../../services/scale/ScaleService';
import { toBaseUnit } from '../../services/units';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';
import OfflineBanner from '../../components/OfflineBanner';
import { parseSpokenCount } from '../../utils/parseSpokenCount';
import { VoiceSessionBanner } from '../../components/stocktake/VoiceSessionBanner';
import {
  matchProductByVoice, detectVoiceCommand, VOICE_MESSAGES,
  VoicePhase, VoiceSessionState,
} from '../../services/stocktake/voiceCountingSession';
import {
  ExpoSpeechRecognitionModule, useSpeechRecognitionEvent, isRecognitionAvailable,
} from 'expo-speech-recognition';

type Item = {
  id: string; name: string;
  lastCount?: number; lastCountAt?: any;
  expectedQty?: number; incomingQty?: number; soldQty?: number; wastageQty?: number;
  unit?: string; supplierId?: string; supplierName?: string;
  costPrice?: number; salePrice?: number; parLevel?: number;
  productId?: string; productName?: string; createdAt?: any; updatedAt?: any;
  flagRecount?: boolean;

  // Induction flags (quick-add / other partial items)
  inductionStatus?: 'pending' | 'complete';
  inductionSource?: string | null;

  // Counting unit config
  countingUnit?: 'unit' | 'case' | 'both';
  caseSize?: number | null;
};
type AreaDoc = {
  name: string; createdAt?: any; updatedAt?: any; startedAt?: any; completedAt?: any;
  editWindowClosesAt?: any; editWindowOpen?: boolean; edits?: any[];
  managerOverride?: boolean; overrideBy?: string; overrideAt?: any; overrideReason?: string;
};
type MemberDoc = { role?: string };
type VenueDoc = { ownerUid?: string };
type RouteParams = { venueId?: string; departmentId: string; areaId: string; areaName?: string; isFestivalSession?: boolean; sessionLabel?: string; barName?: string; };

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
  showSteppers: boolean;
  isManager: boolean;
  localQty: Record<string, string>;
  setLocalQty: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  inputRefs: React.MutableRefObject<Record<string, TextInput | null>>;
  setFocusedInputId: React.Dispatch<React.SetStateAction<string | null>>;
  setLastTouchedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  onEstimateBottleLevel: (item: Item) => void;
  setMenuFor: (it: Item | null) => void;
  openEditItem: (it: Item, focusPar?: boolean) => void;
  openAdjustment: (it: Item) => void;
  deriveExpected: (it: Item) => number | null;
  countedInThisCycle: (it: Item) => boolean;
  clampNonNegative: (n: number) => number;
  approveNow: (it: Item) => Promise<void>;
  isLocked: boolean;
  isEdited: boolean;
  isHighlighted: boolean;
  confidenceDot: 'high' | 'medium' | 'low' | null;
};

function getConfidenceDot(
  item: Item,
  hasInvoice: boolean,
  hasSales: boolean
): 'high' | 'medium' | 'low' | null {
  if (typeof item.lastCount !== 'number') return null;
  if (hasInvoice && hasSales) return 'high';
  if (hasInvoice || hasSales) return 'medium';
  return 'low';
}

const Row = React.memo(function Row({
  item,
  isCompact,
  dens,
  areaStarted,
  showExpected,
  showSteppers,
  isManager,
  localQty,
  setLocalQty,
  inputRefs,
  setFocusedInputId,
  setLastTouchedItemId,
  onEstimateBottleLevel,
  setMenuFor,
  openEditItem,
  openAdjustment,
  deriveExpected,
  countedInThisCycle,
  clampNonNegative,
  approveNow,
  isLocked,
  isEdited,
  isHighlighted,
  confidenceDot,
}: RowProps) {
  const effectiveSteppers = showSteppers && !isLocked;
  const colours = useColours();
  const expectedNum = deriveExpected(item);
  const expectedStr = expectedNum != null ? String(expectedNum) : '';
  const countedNow = countedInThisCycle(item);
  const hasLocalEntry = /^(\d+(\.\d+)?|\.\d+)$/.test((localQty[item.id] ?? '').trim());

  const typedRaw = (localQty[item.id] ?? '').trim();
  const typedNum = /^(\d+(\.\d+)?|\.\d+)$/.test(typedRaw) ? parseFloat(typedRaw) : null;
  const visibleCount: number | null =
    typedNum != null ? typedNum :
    (typeof item.lastCount === 'number' ? item.lastCount : null);

  const lowStock = typeof item.parLevel === 'number'
    && typeof visibleCount === 'number'
    && visibleCount < item.parLevel;

  const showOutlier =
    expectedNum != null &&
    countedNow &&
    typeof item.lastCount === 'number' &&
    Math.abs(item.lastCount - expectedNum) >= 5;

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

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onLongPress={() => setMenuFor(item)}
      style={{
        paddingVertical: dens(10),
        paddingHorizontal: dens(12),
        minHeight: 56,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        backgroundColor: isHighlighted ? '#E0FDF4' : (hasLocalEntry ? '#FFFFFF' : '#F9FAFB'),
        borderLeftWidth: isHighlighted ? 4 : (hasLocalEntry ? 3 : 0),
        borderLeftColor: isHighlighted ? '#0D9488' : '#1b4f72',
      }}
    >
      {/* Single row: product info left (flex:1) + count controls right */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>

        {/* LEFT — full product description */}
        <View style={{ flex: 1 }}>
          <Text
            style={{ fontSize: isCompact ? 14 : 15, fontWeight: '600', lineHeight: isCompact ? 18 : 21 }}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 3 }}>
            {hasLocalEntry && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' }} />
                <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '700' }}>Counted</Text>
              </View>
            )}
            {isEdited && (
              <Text style={{ fontSize: 11, color: '#92400E', fontWeight: '800', backgroundColor: '#FEF3C7', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                EDITED
              </Text>
            )}
            {lowStock && (
              <TouchableOpacity onPress={() => openEditItem(item, true)}>
                <Text style={{ fontSize: 11, color: '#B91C1C', fontWeight: '800', backgroundColor: '#FEE2E2', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                  LOW
                </Text>
              </TouchableOpacity>
            )}
            {item.flagRecount && (
              <Text style={{ fontSize: 11, color: '#6A1B9A', fontWeight: '800', backgroundColor: '#F3E8FF', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                RECOUNT
              </Text>
            )}
            {showOutlier && (
              <Text style={{ fontSize: 11, color: '#B45309', fontWeight: '800', backgroundColor: '#FEF3C7', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 }}>
                ?
              </Text>
            )}
            {item.unit ? <Text style={{ fontSize: 11, color: '#6B7280' }}>{item.unit}</Text> : null}
            {item.supplierName ? <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{item.supplierName}</Text> : null}
            {areaStarted && showExpected && expectedStr ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 11, color: '#0A5FFF', fontWeight: '600' }}>
                  exp: {expectedStr}
                </Text>
                {confidenceDot && (
                  <View style={{
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: confidenceDot === 'high' ? '#16a34a' : confidenceDot === 'medium' ? '#c47b2b' : '#9ca3af',
                  }} />
                )}
              </View>
            ) : null}
          </View>
        </View>

        {/* RIGHT — count controls */}
        {item.countingUnit === 'both' ? (
          /* Both mode: cases + loose dual inputs */
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ fontSize: 10, color: '#64748b', width: 34, textAlign: 'right' }}>Cases</Text>
              {effectiveSteppers && (
                <TouchableOpacity onPress={() => adjustTyped(-1)} style={{ width: 28, height: 36, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '900', fontSize: 18 }}>-</Text>
                </TouchableOpacity>
              )}
              <TextInput
                ref={(el) => { inputRefs.current[item.id] = el; }}
                value={localQty[item.id] ?? ''}
                onChangeText={(t) => setLocalQty(m => ({ ...m, [item.id]: t }))}
                placeholder="0"
                keyboardType="decimal-pad"
                maxLength={6}
                onFocus={() => { setFocusedInputId(item.id); setLastTouchedItemId(item.id); }}
                onBlur={() => setFocusedInputId(prev => prev === item.id ? null : prev)}
                onLongPress={() => {
                  Keyboard.dismiss();
                  setTimeout(() => onEstimateBottleLevel(item), 150);
                }}
                style={{ width: 52, paddingVertical: 6, paddingHorizontal: 4, borderWidth: 2, borderColor: (localQty[item.id] ?? '').trim() ? '#4CAF50' : '#d1d5db', borderRadius: 8, height: 36, backgroundColor: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' }}
              />
              {showSteppers && (
                <TouchableOpacity onPress={() => adjustTyped(1)} style={{ width: 28, height: 36, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '900', fontSize: 18 }}>+</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={{ fontSize: 9, color: colours.slateMid, textAlign: 'right' }}>hold for AI</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ fontSize: 10, color: '#64748b', width: 34, textAlign: 'right' }}>Loose</Text>
              {effectiveSteppers && (
                <TouchableOpacity onPress={() => setLocalQty(m => { const v = Math.max(0, parseFloat(m[item.id + '_loose'] || '0') - 1); return { ...m, [item.id + '_loose']: String(v) }; })} style={{ width: 28, height: 36, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '900', fontSize: 18 }}>-</Text>
                </TouchableOpacity>
              )}
              <TextInput
                value={localQty[item.id + '_loose'] ?? ''}
                onChangeText={(t) => setLocalQty(m => ({ ...m, [item.id + '_loose']: t }))}
                placeholder="0"
                keyboardType="decimal-pad"
                maxLength={6}
                style={{ width: 52, paddingVertical: 6, paddingHorizontal: 4, borderWidth: 2, borderColor: (localQty[item.id + '_loose'] ?? '').trim() ? '#4CAF50' : '#d1d5db', borderRadius: 8, height: 36, backgroundColor: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' }}
              />
              {effectiveSteppers && (
                <TouchableOpacity onPress={() => setLocalQty(m => { const v = parseFloat(m[item.id + '_loose'] || '0') + 1; return { ...m, [item.id + '_loose']: String(v) }; })} style={{ width: 28, height: 36, borderRadius: 6, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '900', fontSize: 18 }}>+</Text>
                </TouchableOpacity>
              )}
            </View>
            {item.caseSize && (
              <Text style={{ fontSize: 10, color: '#6b7280' }}>
                = {((parseFloat(localQty[item.id] || '0') * (item.caseSize ?? 1)) + parseFloat(localQty[item.id + '_loose'] || '0')).toFixed(0)} units
              </Text>
            )}
          </View>
        ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {effectiveSteppers && (
            <TouchableOpacity
              onPress={() => adjustTyped(-1)}
              onLongPress={() => startRepeat(-1)}
              onPressOut={stopRepeat}
              style={{
                width: 48, height: 48, borderRadius: 10,
                borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb',
                justifyContent: 'center', alignItems: 'center',
              }}
            >
              <Text style={{ fontWeight: '900', fontSize: 22 }}>-</Text>
            </TouchableOpacity>
          )}

          <View style={{ alignItems: 'center' }}>
            <TextInput
              ref={(el) => { inputRefs.current[item.id] = el; }}
              value={localQty[item.id] ?? ''}
              onChangeText={(t) => setLocalQty(m => ({ ...m, [item.id]: t }))}
              placeholder="0"
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={10}
              returnKeyType="done"
              blurOnSubmit={false}
              editable={true}
              onFocus={() => { setFocusedInputId(item.id); setLastTouchedItemId(item.id); }}
              onBlur={() => setFocusedInputId(prev => prev === item.id ? null : prev)}
              onSubmitEditing={() => { inputRefs.current[item.id]?.blur?.(); }}
              onLongPress={() => {
                Keyboard.dismiss();
                setTimeout(() => onEstimateBottleLevel(item), 150);
              }}
              editable={!isLocked}
              style={{
                width: 80,
                paddingVertical: Math.max(8, dens(6)),
                paddingHorizontal: 6,
                borderWidth: 2,
                borderColor: hasLocalEntry ? '#4CAF50' : '#d1d5db',
                borderRadius: 10,
                height: Math.max(44, dens(40)),
                backgroundColor: '#fff',
                fontSize: 18,
                fontWeight: '700',
                textAlign: 'center',
              }}
            />
            {item.countingUnit === 'case' && item.caseSize && (
              <Text style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                {hasLocalEntry
                  ? `= ${(parseFloat(localQty[item.id] || '0') * (item.caseSize ?? 1)).toFixed(0)} units`
                  : 'cases'}
              </Text>
            )}
            <Text style={{ fontSize: 9, color: colours.slateMid, marginTop: 2 }}>hold for AI</Text>
          </View>

          {effectiveSteppers && (
            <TouchableOpacity
              onPress={() => adjustTyped(1)}
              onLongPress={() => startRepeat(1)}
              onPressOut={stopRepeat}
              style={{
                width: 48, height: 48, borderRadius: 10,
                borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb',
                justifyContent: 'center', alignItems: 'center',
              }}
            >
              <Text style={{ fontWeight: '900', fontSize: 22 }}>+</Text>
            </TouchableOpacity>
          )}
        </View>
        )}
      </View>

      {/* Manager inline approve */}
      {isManager && ENABLE_MANAGER_INLINE_APPROVE && (
        <TouchableOpacity
          onPress={throttleAction(() => approveNow(item))}
          style={{
            marginTop: 6, alignSelf: 'flex-start',
            backgroundColor: '#10B981',
            paddingVertical: dens(8), paddingHorizontal: dens(12),
            borderRadius: 10, minHeight: 36,
          }}
        >
          <Text style={{ color: 'white', fontWeight: '800' }}>Approve now (Mgr)</Text>
        </TouchableOpacity>
      )}

      {/* Staff adjustment request */}
      {countedNow && !isManager && (
        <TouchableOpacity
          onPress={() => openAdjustment(item)}
          style={{ marginTop: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F3E5F5' }}
        >
          <Text style={{ color: '#6A1B9A', fontWeight: '700' }}>Request adj.</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
});

/* ---------------------------------- Screen ---------------------------------- */

function StockTakeAreaInventoryScreen() {
  dlog('[AreaInv ACTIVE FILE] src/screens/stock/StockTakeAreaInventoryScreen.tsx');

  const colours = useColours();
  const insets = useSafeAreaInsets();
  const { showSuccess, showError, showInfo, show } = useToast();
  const { confirm, modal } = useConfirmModal();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueIdFromCtx = useVenueId();
  const { departmentId, areaId, areaName, venueId: venueIdFromRoute, isFestivalSession } = (route.params ?? {}) as RouteParams;
  const venueId = venueIdFromCtx || venueIdFromRoute;

  const itemsPathOk = !!venueId && !!departmentId && !!areaId;

  // Header: 📷 Scan + ✦ Izzy — set once, stable ref avoids stale closure on setOptions
  const openBarcodeRef = useRef(() => setBarcodeScanOpen(true));
  useEffect(() => { openBarcodeRef.current = () => setBarcodeScanOpen(true); });
  useEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 }}>
          <TouchableOpacity
            onPress={() => openBarcodeRef.current()}
            style={{ paddingVertical: 6, paddingHorizontal: 10 }}
          >
            <Text style={{ color: '#1b4f72', fontSize: 13, fontWeight: '700' }}>📷 Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openIzzy} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
            <Text style={{ color: '#1b4f72', fontSize: 18, fontWeight: '600' }}>✦</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [nav]);

  // Current user and label (for area locking)
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  const userLabel = auth.currentUser?.displayName || auth.currentUser?.email || 'Staff member';

  const [isManager, setIsManager] = useState(false);

  // Remember “last area” per department for resume in AreaSelection
  useEffect(() => {
    if (!AS) return;
    if (!venueId || !departmentId || !areaId) return;
    const key = `lastArea:${venueId}:${departmentId}`;
    AS.setItem(key, areaId).catch(() => {});
  }, [venueId, departmentId, areaId]);

    // [ONE AREA, ONE USER] — acquire a lock on this area while this screen is active.
  const lockHeldRef = useRef(false);

  useEffect(() => {
    if (!itemsPathOk || !venueId || !departmentId || !areaId || !uid) return;

    const areaRef = doc(
      db,
      'venues',
      venueId,
      'departments',
      departmentId,
      'areas',
      areaId,
    );
    let cancelled = false;

    const acquireLock = async () => {
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(areaRef);
          if (!snap.exists()) {
            throw new Error('Area not found');
          }

          const data: any = snap.data() || {};
          const lock = data.currentLock || {};
          const now = Date.now();
          const existingUid = lock.uid;
          const lockedAtMillis = lock.lockedAtMillis || 0;
          const STALE_MS = 45 * 60 * 1000; // 45 minutes

          const isStale = !lockedAtMillis || now - lockedAtMillis > STALE_MS;

          if (existingUid && existingUid !== uid && !isStale) {
            const err: any = new Error('TAKEN_BY_OTHER');
            err.lockedBy = lock.name || 'another staff member';
            throw err;
          }

          // Take/refresh the lock for this user
                    tx.update(areaRef, {
            currentLock: {
              uid,
              name: userLabel,
              lockedAtMillis: now,
            },
          });
        });

        if (!cancelled) {
          lockHeldRef.current = true;
        }
      } catch (e: any) {
        if (cancelled) return;

        if (e?.message === 'TAKEN_BY_OTHER') {
          const who = e.lockedBy || 'someone else';
          showError(`This area is currently being counted by ${who}.\n\nOnly one person can work in an area at a time.`);
          nav.goBack();
        } else {
          if (__DEV__) console.log('[AreaLock] acquire failed', e?.message || e);
          showError('There was a problem reserving this area for you. Please try again in a moment.');
          nav.goBack();
        }
      }
    };

    acquireLock();

    // Cleanup: only clear the lock if we still hold it
    return () => {
      cancelled = true;
      if (!lockHeldRef.current) return;

      runTransaction(db, async (tx) => {
        const snap = await tx.get(areaRef);
        if (!snap.exists()) return;

        const data: any = snap.data() || {};
        const lock = data.currentLock;

        if (lock?.uid === uid) {
          tx.update(areaRef, {
            currentLock: null,
          });
        }
      }).catch((e) => {
        if (__DEV__) console.log('[AreaLock] release failed', e?.message || e);
      });
    };
  }, [itemsPathOk, venueId, departmentId, areaId, uid, userLabel]);

  // [PAIR2] global density
  const { density, setDensity, isCompact } = useDensity();
  const D = isCompact ? 0.72 : 1;
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

  // View prefs (per-area)
  const prefKey = (k: string) => `view:${venueId ?? 'noVen'}:${areaId ?? 'noArea'}:${k}`;
  const [showExpected, setShowExpected] = useState(true);
  const [compactCounted, setCompactCounted] = useState(true);
  const [sortUncountedFirst, setSortUncountedFirst] = useState(false);
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const [showSteppers, setShowSteppers] = useState(true);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  // More menu (settings only)
  const [moreOpen, setMoreOpen] = useState(false);
  // Add product sheet
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // Quick add manual sub-modal
  const [quickAddSheetOpen, setQuickAddSheetOpen] = useState(false);

  // Smart Shelf Count (existing)
  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelfPhotoOpen, setShelfPhotoOpen] = useState(false);
  const [shelfLoading, setShelfLoading] = useState(false);
  const [shelfJobId, setShelfJobId] = useState(null);
  const [shelfProposals, setShelfProposals] = useState([]);

  // New capture tools
  const [captureShelfOpen, setCaptureShelfOpen] = useState(false);
  const [captureProductOpen, setCaptureProductOpen] = useState(false);
  const [venueSearchOpen, setVenueSearchOpen] = useState(false);
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const [batchAddToast, setBatchAddToast] = useState<string | null>(null);
  const [photoModalBarcode, setPhotoModalBarcode] = useState<string | null>(null);

  // Unified search
  const [unifiedSearch, setUnifiedSearch] = useState('');
  const [venueProducts, setVenueProducts] = useState<any[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const [invoiceDataAvailable, setInvoiceDataAvailable] = React.useState(false);
  const [salesDataAvailable, setSalesDataAvailable] = React.useState(false);
  const [confidenceLegendDismissed, setConfidenceLegendDismissed] = React.useState(false);
  const [enrichmentComplete, setEnrichmentComplete] = React.useState(false);
  const [nudgeDismissed, setNudgeDismissed] = React.useState(false);
  const [bottomBarHeight, setBottomBarHeight] = useState(64); // sensible default before first onLayout fires

  // Load venue products once for tier-2 search
  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
      setVenueProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      console.log('[VoiceDebug] venueProducts loaded:', snap.docs.length);
    }).catch((e) => {
      console.log('[VoiceDebug] venueProducts load failed:', e?.message || e);
    });
  }, [venueId]);

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
  const localQtyRef = React.useRef<Record<string, string>>({});
  React.useEffect(() => { localQtyRef.current = localQty; }, [localQty]);
  const draftKey = venueId && departmentId && areaId
    ? `countDraft:${venueId}:${departmentId}:${areaId}`
    : null;
  const draftRestoredRef = React.useRef(false);

  // Restore draft from AsyncStorage on mount
  useEffect(() => {
    if (!draftKey || !AS) return;
    (async () => {
      try {
        const stored = await AS.getItem(draftKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') setLocalQty(parsed);
        }
      } catch {}
      finally { draftRestoredRef.current = true; }
    })();
  }, [draftKey]);

  // Persist draft to AsyncStorage on every localQty change (after restore)
  useEffect(() => {
    if (!draftKey || !AS || !draftRestoredRef.current) return;
    AS.setItem(draftKey, JSON.stringify(localQty)).catch(() => {});
  }, [localQty, draftKey]);

  // ── Voice counting session (Phase 2) ──────────────────────────────────────
  // One mic button for the whole area. Two-phase cycle: product name → count.
  // Per-row mic buttons removed. AirPods/Bluetooth work via OS audio routing.
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const activeVoiceItemRef = useRef<Item | null>(null);

  const [voiceSessionState, setVoiceSessionState] = useState<VoiceSessionState>({
    isActive: false,
    phase: 'idle',
    matchedItem: null,
    candidateItems: [],
    lastSavedItem: null,
    lastSavedCount: null,
    bannerMessage: '',
    bannerColour: 'hidden',
  });
  const voiceSessionActiveRef = useRef(false);
  const voicePhaseRef = useRef<VoicePhase>('idle');

  // Refs to avoid stale closures inside the Voice listener (set once with [])
  const itemsRef = useRef<Item[]>(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const candidateItemsRef = useRef<Item[]>([]);

  // Tier-2 not-found fallback — full venue product catalogue (already loaded
  // for unified search) so a spoken product not yet in this area can still
  // be auto-added instead of immediately falling back to "not found".
  const venueProductsRef = useRef<any[]>(venueProducts);
  useEffect(() => { venueProductsRef.current = venueProducts; }, [venueProducts]);

  // Genuinely-unknown spoken product names collected during a session —
  // local only, no Firestore write; surfaced as a single toast when the
  // session ends so the user can review them afterwards.
  const flaggedVoiceProductsRef = useRef<string[]>([]);

  // saveCount ref — always points to the latest saveCount regardless of closure age
  const saveCountRef = useRef(saveCount);
  useEffect(() => { saveCountRef.current = saveCount; });

  // Best available English TTS voice locale, resolved on mount — falls back
  // through en-NZ → en-AU → en-GB → en-US → en since many Android devices
  // (e.g. Samsung Galaxy A06) ship with zero en-NZ voices installed.
  const voiceLangRef = useRef<string>('en-NZ');

  // ── Spoken prompts (hands-free) ─────────────────────────────────────────
  // Default on; persisted across sessions and toggleable from the banner.
  const [voiceSpeechEnabled, setVoiceSpeechEnabled] = useState(true);
  const voiceSpeechEnabledRef = useRef(true);
  useEffect(() => { voiceSpeechEnabledRef.current = voiceSpeechEnabled; }, [voiceSpeechEnabled]);
  useEffect(() => { if (!AS) return; AS.setItem('hosti_voice_speech_enabled', voiceSpeechEnabled ? '1' : '0').catch(() => {}); }, [voiceSpeechEnabled]);

  // Highlighted item from voice product match
  const [highlightedVoiceItemId, setHighlightedVoiceItemId] = useState<string | null>(null);

  // ── Advanced voice commands (Phase 3) ──────────────────────────────────────
  // UNDO / CORRECTION / SKIP / REPEAT / RECOUNT — detected before normal
  // product/number matching runs and take priority over everything else.

  // Last 10 voice-entered counts, so undo/correction/repeat always have
  // something to act on regardless of what's currently in localQty.
  const voiceHistoryRef = useRef<Array<{
    itemId: string;
    itemName: string;
    previousCount: number | null;
    newCount: number;
    timestamp: number;
  }>>([]);

  // Items skipped during a voice session — surfaced for review before submit
  const [skippedItems, setSkippedItems] = useState<Set<string>>(new Set());
  const [filterSkippedOnly, setFilterSkippedOnly] = useState(false);

  type AdvancedVoiceCommand = {
    command: 'undo' | 'correction' | 'skip' | 'repeat' | 'recount' | null;
    value?: number;
    productHint?: string;
  };

  const detectAdvancedVoiceCommand = (transcript: string): AdvancedVoiceCommand => {
    const t = transcript.toLowerCase().trim();

    // UNDO — revert last count
    if (['undo', 'go back', 'undo that', 'cancel that', 'remove that'].includes(t)) {
      return { command: 'undo' };
    }

    // CORRECTION — change last count: "actually 24" / "correction 24" / "change that to 24" / "make it 24"
    const correctionMatch = t.match(/^(?:actually|correction|change that to|make it|no|no wait|its|it's)\s+(\d+)/);
    if (correctionMatch) {
      return { command: 'correction', value: parseInt(correctionMatch[1], 10) };
    }

    // SKIP — move past without counting
    if (['skip', 'next', 'pass', 'skip this one', 'move on'].includes(t)) {
      return { command: 'skip' };
    }

    // REPEAT — read back last item
    if (['repeat', 'what did i say', 'what was that', 'say again', 'read that back'].includes(t)) {
      return { command: 'repeat' };
    }

    // RECOUNT — find specific product: "recount heineken" / "go to heineken"
    const recountMatch = t.match(/^(?:recount|go to|find|search for|count)\s+(.+)$/);
    if (recountMatch) {
      return { command: 'recount', productHint: recountMatch[1].trim() };
    }

    return { command: null };
  };

  // UNDO — revert the last voice-entered count
  const handleVoiceUndo = (): string => {
    const history = voiceHistoryRef.current;
    if (history.length === 0) return 'Nothing to undo.';
    const last = history[history.length - 1];
    if (last.previousCount === null) {
      setLocalQty(prev => {
        const next = { ...prev };
        delete next[last.itemId];
        return next;
      });
    } else {
      setLocalQty(prev => ({ ...prev, [last.itemId]: String(last.previousCount) }));
    }
    voiceHistoryRef.current = history.slice(0, -1);
    return `Undone — ${last.itemName} removed.`;
  };

  // CORRECTION — change the count for the last voice-entered item
  const handleVoiceCorrection = (newCount: number): string => {
    const history = voiceHistoryRef.current;
    if (history.length === 0) return 'Nothing to correct. Count a product first.';
    const last = history[history.length - 1];
    setLocalQty(prev => ({ ...prev, [last.itemId]: String(newCount) }));
    voiceHistoryRef.current = [...history.slice(0, -1), { ...last, newCount }];
    return `Updated — ${last.itemName}: ${newCount}.`;
  };

  // SKIP — mark the current item as skipped, surfaced again before submit
  const handleVoiceSkip = (currentItemId: string | null, currentItemName: string | null): string => {
    if (!currentItemId) return 'No current item to skip.';
    setSkippedItems(prev => { const n = new Set(prev); n.add(currentItemId); return n; });
    return `Skipped ${currentItemName}. It will appear in your review.`;
  };

  // REPEAT — read back the last voice-entered count
  const handleVoiceRepeat = (): string => {
    const history = voiceHistoryRef.current;
    if (history.length === 0) return 'Nothing counted yet.';
    const last = history[history.length - 1];
    return `${last.itemName}: ${last.newCount}.`;
  };

  // RECOUNT — fuzzy-find a product by name so the session can jump to it
  const handleVoiceRecount = (productHint: string): { item: Item | null; message: string } => {
    const list = itemsRef.current || [];
    const hint = productHint.toLowerCase();
    const match = list.find(it => it.name.toLowerCase().includes(hint));
    if (!match) return { item: null, message: `Could not find "${productHint}". Try a shorter name.` };
    return { item: match, message: `Found ${match.name}. What's the count?` };
  };

  // Speech recognition device-capability check (mount) + cleanup (unmount).
  // expo-speech-recognition is a TurboModule built for New Architecture, so
  // unlike the old @react-native-voice/voice it doesn't need a try/catch
  // around the import — but every call here still logs its outcome, so a
  // future linking regression shows up immediately instead of silently
  // dimming the mic button again.
  useEffect(() => {
    try {
      const available = isRecognitionAvailable();
      console.log('[VoiceDebug] isRecognitionAvailable:', available);
      setVoiceAvailable(!!available);
    } catch (e: any) {
      console.log('[VoiceDebug] isRecognitionAvailable threw:', e?.message || e);
      setVoiceAvailable(false);
    }

    Speech.getAvailableVoicesAsync().then(voices => {
      const langs = ['en-NZ', 'en-AU', 'en-GB', 'en-US', 'en'];
      const best = langs.find(l =>
        voices.some(v => v.language?.startsWith(l.replace('-', '_')) || v.language?.startsWith(l))
      );
      if (best) voiceLangRef.current = best;
      console.log('[SpeechDebug] selected voice language:', voiceLangRef.current);
    }).catch(e => console.log('[SpeechDebug] getAvailableVoices threw:', e?.message));

    (async () => {
      if (!AS) return;
      try {
        const stored = await AS.getItem('hosti_voice_speech_enabled');
        if (stored != null) setVoiceSpeechEnabled(stored === '1');
      } catch {}
    })();

    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch (e: any) {
        console.log('[VoiceDebug] abort on unmount threw:', e?.message || e);
      }
    };
  }, []);

  // Every place that used to call Voice.start()/.stop() now goes through
  // these two helpers — every error path logs. No bare .catch(() => {})
  // anywhere in this voice flow; this is the standard going forward.
  const startListening = () => {
    try {
      ExpoSpeechRecognitionModule.start({ lang: 'en-NZ', interimResults: false, continuous: false });
    } catch (e: any) {
      console.log('[VoiceDebug] start threw:', e?.message || e);
    }
  };

  const stopListening = () => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e: any) {
      console.log('[VoiceDebug] stop threw:', e?.message || e);
    }
  };

  // Spoken prompts — natural English, distinct from the banner's visual
  // shorthand. Silent no-op when speech is muted or on any failure; never
  // blocks the recognition flow.
  const speakIfEnabled = async (text: string) => {
    if (!voiceSpeechEnabledRef.current) return;
    try {
      await Speech.stop();
      Speech.speak(text, { language: voiceLangRef.current, rate: 1.05, pitch: 1.0 });
    } catch (e: any) {
      console.log('[VoiceDebug] speak threw:', e?.message || e);
    }
  };

  // Speaks the prompt, then starts listening only once speech actually
  // finishes — on iOS, starting recognition immediately after Speech.speak()
  // lets the device hear the tail of its own voice output, corrupting the
  // next product name or swallowing the count. A 300ms pad after onDone
  // gives iOS time to close the audio output session before the mic opens.
  const speakThenListen = (text: string) => {
    if (!voiceSpeechEnabledRef.current) {
      // Speech disabled — start listening immediately
      startListening();
      return;
    }
    Speech.stop().catch(() => {});
    Speech.speak(text, {
      language: voiceLangRef.current,
      rate: 1.05,
      pitch: 1.0,
      onDone: () => {
        // Wait 300ms after speech ends before starting to listen
        // Gives iOS time to close the audio output session
        setTimeout(() => {
          if (voiceSessionActiveRef.current) startListening();
        }, 300);
      },
      onError: () => {
        // Speech failed — start listening anyway
        if (voiceSessionActiveRef.current) startListening();
      },
    });
  };

  // Interrupts any in-progress speech without speaking anything new —
  // used when the session ends, regardless of whether speech is enabled.
  const stopSpeech = () => {
    try {
      Speech.stop().catch(() => {});
    } catch {}
  };

  // Surfaces everything flagged as "genuinely unknown" during the session
  // as a single toast, then clears the list for the next session.
  const flushFlaggedVoiceProducts = () => {
    const flagged = flaggedVoiceProductsRef.current;
    if (flagged.length > 0) {
      showInfo(`${flagged.length} product${flagged.length > 1 ? 's' : ''} flagged — check after your count: ${flagged.join(', ')}`);
      flaggedVoiceProductsRef.current = [];
    }
  };

  // ── Two-phase session handler ─────────────────────────────────────────
  // All state read via refs — no stale closure over phase or candidateItems.
  // useSpeechRecognitionEvent always invokes the latest version of this
  // function internally (via its own ref), so it's safe to define fresh
  // each render rather than wiring it up imperatively in a useEffect.
  const handleVoiceResult = (event: any) => {
    if (!event?.isFinal) return;
    const spoken = event?.results?.[0]?.transcript ?? '';
    if (!spoken || !voiceSessionActiveRef.current) return;

    const phase = voicePhaseRef.current;

    // ── ADVANCED COMMANDS ──────────────────────────────────────────────
    // undo / correction / skip / repeat / recount — checked first, in any
    // phase, and take priority over normal product/number matching.
    const advancedCmd = detectAdvancedVoiceCommand(spoken);
    if (advancedCmd.command) {
      switch (advancedCmd.command) {
        case 'undo': {
          const feedback = handleVoiceUndo();
          setVoiceSessionState(prev => ({ ...prev, bannerMessage: feedback, bannerColour: 'amber' }));
          speakThenListen('Undone.');
          return;
        }
        case 'correction': {
          if (advancedCmd.value === undefined) break;
          const feedback = handleVoiceCorrection(advancedCmd.value);
          setVoiceSessionState(prev => ({ ...prev, bannerMessage: feedback, bannerColour: 'amber' }));
          startListening();
          return;
        }
        case 'repeat': {
          const feedback = handleVoiceRepeat();
          setVoiceSessionState(prev => ({ ...prev, bannerMessage: feedback, bannerColour: 'amber' }));
          startListening();
          return;
        }
        case 'skip': {
          const current = activeVoiceItemRef.current;
          const feedback = handleVoiceSkip(current?.id ?? null, current?.name ?? null);
          if (current) {
            activeVoiceItemRef.current = null;
            candidateItemsRef.current = [];
            voicePhaseRef.current = 'product';
            setVoiceSessionState(prev => ({ ...prev, phase: 'product', matchedItem: null, candidateItems: [], bannerMessage: feedback, bannerColour: 'amber' }));
          } else {
            setVoiceSessionState(prev => ({ ...prev, bannerMessage: feedback, bannerColour: 'amber' }));
          }
          speakThenListen('Skipped. Say the next product.');
          return;
        }
        case 'recount': {
          if (!advancedCmd.productHint) break;
          const found = handleVoiceRecount(advancedCmd.productHint);
          if (found.item) {
            activeVoiceItemRef.current = found.item;
            candidateItemsRef.current = [];
            voicePhaseRef.current = 'count';
            setHighlightedVoiceItemId(found.item.id);
            setTimeout(() => setHighlightedVoiceItemId(null), 3000);
            setVoiceSessionState(prev => ({ ...prev, phase: 'count', matchedItem: found.item, candidateItems: [], bannerMessage: found.message, bannerColour: 'teal' }));
          } else {
            setVoiceSessionState(prev => ({ ...prev, bannerMessage: found.message, bannerColour: 'terracotta' }));
          }
          startListening();
          return;
        }
      }
    }

    // ── PRODUCT PHASE ──────────────────────────────────────────────────
    if (phase === 'product') {
      const command = detectVoiceCommand(spoken);

      if (command === 'end_session') {
        voiceSessionActiveRef.current = false;
        voicePhaseRef.current = 'idle';
        activeVoiceItemRef.current = null;
        candidateItemsRef.current = [];
        stopListening();
        stopSpeech();
        setVoiceSessionState({ isActive: false, phase: 'idle', matchedItem: null, candidateItems: [], lastSavedItem: null, lastSavedCount: null, bannerMessage: '', bannerColour: 'hidden' });
        flushFlaggedVoiceProducts();
        return;
      }

      // Handle selection from multiple-match list
      const candidates = candidateItemsRef.current;
      if (candidates.length > 1) {
        const idx = command === 'select_1' ? 0 : command === 'select_2' ? 1 : command === 'select_3' ? 2 : -1;
        if (idx >= 0 && candidates[idx]) {
          const matched = candidates[idx];
          activeVoiceItemRef.current = matched;
          voicePhaseRef.current = 'count';
          candidateItemsRef.current = [];
          setHighlightedVoiceItemId(matched.id);
          setTimeout(() => setHighlightedVoiceItemId(null), 3000);
          setVoiceSessionState(prev => ({ ...prev, phase: 'count', matchedItem: matched, candidateItems: [], bannerMessage: VOICE_MESSAGES.listening_count(matched.name), bannerColour: 'teal' }));
          speakThenListen(`${matched.name}. Say the count.`);
          return;
        }
      }

      const matches = matchProductByVoice(spoken, itemsRef.current);

      if (matches.length === 0) {
        // Tier 2 — check the full venue product catalogue before giving up.
        const venueMatches = matchProductByVoice(spoken, venueProductsRef.current);
        if (venueMatches.length > 0) {
          const match = venueMatches[0];
          speakIfEnabled(`${match.name} isn't in this area yet. Adding it now.`);
          (async () => {
            try {
              await ensureAreaStarted();
              const newRef = await addDoc(
                collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items'),
                {
                  name: match.name || '',
                  unit: match.unit || null,
                  supplierId: match.supplierId || null,
                  supplierName: match.supplierName || null,
                  productId: match.id || null,
                  countingUnit: 'unit',
                  caseSize: null,
                  costPrice: match.costPrice || null,
                  parLevel: match.parLevel || null,
                  barcode: match.barcode || null,
                  barcodeNumber: match.barcodeNumber || match.barcode || null,
                  category: match.category || match.categorySuggested || null,
                  brand: match.brand || null,
                  size: match.size || null,
                  inductionStatus: 'pending',
                  inductionSource: 'venue-search',
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                }
              );
              const newItem: Item = {
                id: newRef.id,
                name: match.name || '',
                unit: match.unit || undefined,
                supplierId: match.supplierId || undefined,
                supplierName: match.supplierName || undefined,
                costPrice: match.costPrice || undefined,
                parLevel: match.parLevel || undefined,
                productId: match.id || undefined,
                countingUnit: 'unit',
                caseSize: null,
              };
              activeVoiceItemRef.current = newItem;
              voicePhaseRef.current = 'count';
              candidateItemsRef.current = [];
              setHighlightedVoiceItemId(newItem.id);
              setTimeout(() => setHighlightedVoiceItemId(null), 3000);
              setVoiceSessionState(prev => ({ ...prev, phase: 'count', matchedItem: newItem, candidateItems: [], bannerMessage: VOICE_MESSAGES.listening_count(newItem.name), bannerColour: 'teal' }));
              speakThenListen(`${newItem.name}. Say the count.`);
            } catch (e: any) {
              console.log('[VoiceDebug] auto-add venue product failed:', e?.message || e);
              setVoiceSessionState(prev => ({ ...prev, candidateItems: [], bannerMessage: VOICE_MESSAGES.not_found, bannerColour: 'terracotta' }));
              speakThenListen("Couldn't add that product. Say the next product.");
            }
          })();
          return;
        }

        // Genuinely unknown — flag for later, no Firestore write during the session.
        flaggedVoiceProductsRef.current = [...flaggedVoiceProductsRef.current, spoken];
        candidateItemsRef.current = [];
        setVoiceSessionState(prev => ({ ...prev, candidateItems: [], bannerMessage: VOICE_MESSAGES.not_found, bannerColour: 'terracotta' }));
        speakThenListen(`${spoken} isn't set up yet. I'll flag it for later. Say the next product.`);
        return;
      }

      if (matches.length === 1) {
        const matched = matches[0];
        activeVoiceItemRef.current = matched;
        voicePhaseRef.current = 'count';
        candidateItemsRef.current = [];
        setHighlightedVoiceItemId(matched.id);
        setTimeout(() => setHighlightedVoiceItemId(null), 3000);
        setVoiceSessionState(prev => ({ ...prev, phase: 'count', matchedItem: matched, candidateItems: [], bannerMessage: VOICE_MESSAGES.listening_count(matched.name), bannerColour: 'teal' }));
        speakThenListen(`${matched.name}. Say the count.`);
        return;
      }

      // Multiple matches — present top 3, wait for "one" / "two" / "three"
      const top3 = matches.slice(0, 3);
      candidateItemsRef.current = top3;
      const matchList = top3.map((m: Item, i: number) => `${i + 1}. ${m.name}`).join('\n');
      setVoiceSessionState(prev => ({ ...prev, candidateItems: top3, bannerMessage: `Multiple matches:\n${matchList}`, bannerColour: 'amber' }));
      if (top3.length === 2) {
        speakThenListen(`Did you mean ${top3[0].name}, or ${top3[1].name}?`);
      } else {
        speakThenListen(`${top3[0].name}, ${top3[1].name}, or ${top3[2].name}?`);
      }
      return;
    }

    // ── COUNT PHASE ────────────────────────────────────────────────────
    if (phase === 'count') {
      const command = detectVoiceCommand(spoken);

      if (command === 'end_session') {
        voiceSessionActiveRef.current = false;
        voicePhaseRef.current = 'idle';
        activeVoiceItemRef.current = null;
        candidateItemsRef.current = [];
        stopListening();
        stopSpeech();
        setVoiceSessionState({ isActive: false, phase: 'idle', matchedItem: null, candidateItems: [], lastSavedItem: null, lastSavedCount: null, bannerMessage: '', bannerColour: 'hidden' });
        flushFlaggedVoiceProducts();
        return;
      }

      if (command === 'skip') {
        // Skip this product — return to listening for next product name
        activeVoiceItemRef.current = null;
        candidateItemsRef.current = [];
        voicePhaseRef.current = 'product';
        setVoiceSessionState(prev => ({ ...prev, phase: 'product', matchedItem: null, candidateItems: [], bannerMessage: VOICE_MESSAGES.listening_product, bannerColour: 'amber' }));
        speakThenListen('Skipped. Say the next product.');
        return;
      }

      const count = parseSpokenCount(spoken);

      if (count === null) {
        setVoiceSessionState(prev => ({ ...prev, bannerMessage: "Didn't catch that — say the count again", bannerColour: 'amber' }));
        speakThenListen("Didn't catch that. Say the count again.");
        return;
      }

      const item = activeVoiceItemRef.current;
      if (!item) return;

      // Update localQty for immediate UI feedback (green border on row)
      setLocalQty(prev => ({ ...prev, [item.id]: String(count) }));
      // Write to Firestore — forceReplace=true skips the add-or-replace alert
      saveCountRef.current(item, count, true);

      // Record in voice history for undo/correction/repeat (last 10 entries)
      const prevRaw = (localQtyRef.current[item.id] ?? '').trim();
      const previousCount = /^(\d+(\.\d+)?|\.\d+)$/.test(prevRaw) ? parseFloat(prevRaw) : null;
      voiceHistoryRef.current = [
        ...voiceHistoryRef.current.slice(-9),
        { itemId: item.id, itemName: item.name, previousCount, newCount: count, timestamp: Date.now() },
      ];

      const itemName = item.name;
      voicePhaseRef.current = 'saving';
      activeVoiceItemRef.current = null;
      candidateItemsRef.current = [];
      setVoiceSessionState(prev => ({ ...prev, phase: 'saving', lastSavedItem: itemName, lastSavedCount: count, bannerMessage: VOICE_MESSAGES.saved(itemName, count), bannerColour: 'green' }));
      speakIfEnabled(`Got it. ${count} saved.`);

      // Brief confirmation flash, then listen for next product name
      setTimeout(() => {
        if (!voiceSessionActiveRef.current) return;
        voicePhaseRef.current = 'product';
        setVoiceSessionState(prev => ({ ...prev, phase: 'product', matchedItem: null, bannerMessage: VOICE_MESSAGES.listening_product, bannerColour: 'amber' }));
        startListening();
      }, 800);
    }
  };

  useSpeechRecognitionEvent('result', handleVoiceResult);

  const handleVoiceError = (event: any) => {
    // Every recognition error now logs clearly — this is the standard going
    // forward for the whole voice flow, not just the one call originally
    // diagnosed (Voice.isAvailable() throwing silently under New Architecture).
    console.log('[VoiceDebug] recognition error:', event?.error, event?.message);
    if (!voiceSessionActiveRef.current) return;
    const phase = voicePhaseRef.current;
    if (phase === 'product' || phase === 'count') {
      setTimeout(() => { if (voiceSessionActiveRef.current) startListening(); }, 500);
    }
  };

  useSpeechRecognitionEvent('error', handleVoiceError);

  // ── Toggle voice session on/off ────────────────────────────────────────────
  // Called by the header mic button. Checks connection and Voice availability.
  const toggleVoiceSession = async () => {
    if (!voiceAvailable) {
      showInfo('Voice counting is not available on this device.');
      return;
    }
    if (offline) {
      showInfo('Voice counting needs an internet connection.');
      return;
    }
    if (voiceSessionActiveRef.current) {
      voiceSessionActiveRef.current = false;
      voicePhaseRef.current = 'idle';
      activeVoiceItemRef.current = null;
      candidateItemsRef.current = [];
      stopListening();
      stopSpeech();
      setVoiceSessionState({ isActive: false, phase: 'idle', matchedItem: null, candidateItems: [], lastSavedItem: null, lastSavedCount: null, bannerMessage: '', bannerColour: 'hidden' });
      flushFlaggedVoiceProducts();
    } else {
      if (itemsRef.current.length === 0) {
        showInfo('Products are still loading — try again in a moment.');
        return;
      }

      // expo-speech-recognition surfaces permission denial via requestPermissionsAsync()
      // (the old library instead rejected Voice.start() with a "permissions" error code).
      let permission: any;
      try {
        permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      } catch (e: any) {
        console.log('[VoiceDebug] requestPermissionsAsync threw:', e?.message || e);
        showInfo('Could not check microphone permission.');
        return;
      }
      if (!permission?.granted) {
        console.log('[VoiceDebug] permission not granted:', permission);
        showInfo('Microphone access needed. Enable in Settings → Privacy → Microphone.');
        return;
      }

      // Retry venueProducts load if it failed on mount
      if (venueProductsRef.current.length === 0 && venueId) {
        getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
          const prods = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          setVenueProducts(prods);
          venueProductsRef.current = prods;
          console.log('[VoiceDebug] venueProducts retry loaded:', prods.length);
        }).catch((e) => console.log('[VoiceDebug] venueProducts retry failed:', e?.message));
      }

      // First-time explanation — informational only, never blocks session start.
      (async () => {
        if (!AS) return;
        try {
          const seen = await AS.getItem('hosti_voice_intro_seen');
          const tipVersion = await AS.getItem('hosti_voice_intro_v');
          if (!seen || tipVersion !== '2') {
            show({
              message: `Hands-free mode — say a product name, then say the count clearly. For small numbers say 'one bottle' or 'two units' so the mic catches it. Say 'stop' when done.`,
              variant: 'info',
              duration: 6000,
            });
            await AS.setItem('hosti_voice_intro_seen', '1');
            await AS.setItem('hosti_voice_intro_v', '2');
          }
        } catch {}
      })();

      flaggedVoiceProductsRef.current = [];
      voiceSessionActiveRef.current = true;
      voicePhaseRef.current = 'product';
      setVoiceSessionState(prev => ({ ...prev, isActive: true, phase: 'product', matchedItem: null, candidateItems: [], bannerMessage: VOICE_MESSAGES.listening_product, bannerColour: 'amber' }));
      speakThenListen('Say a product name');
    }
  };

  // Speech toggle — flips state, persists (via the effect above), and
  // interrupts any speech immediately when turning off.
  const onToggleVoiceSpeech = () => {
    setVoiceSpeechEnabled(prev => {
      const next = !prev;
      if (!next) stopSpeech();
      return next;
    });
  };

  // Keep screen awake during counting session
  useEffect(() => {
    activateKeepAwake();
    return () => deactivateKeepAwake();
  }, []);

  const [adjModalFor, setAdjModalFor] = useState<Item | null>(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  // Bluetooth scale — live weight modal
  const [scaleModalFor, setScaleModalFor] = useState<Item | null>(null);
  const [scaleModalPhase, setScaleModalPhase] = useState<'checking' | 'reconnecting' | 'live' | 'unavailable'>('checking');
  const [scaleWeight, setScaleWeight] = useState<number | null>(null);
  const [scaleStable, setScaleStable] = useState(false);
  const [scaleReconnectName, setScaleReconnectName] = useState<string | null>(null);
  const [scaleConversionMsg, setScaleConversionMsg] = useState<string | null>(null);
  const scaleRequestRef = useRef(0);

  const [addingName, setAddingName] = useState('');
  const [addingUnit, setAddingUnit] = useState('');
  const [addingSupplier, setAddingSupplier] = useState('');
  const [addingQty, setAddingQty] = useState('');
  const [addingBarcode, setAddingBarcode] = useState('');
  const nameInputRef = useRef<TextInput>(null);

  const [areaMeta, setAreaMeta] = useState<AreaDoc | null>(null);

  // Edit window state
  const [overrideActive, setOverrideActive] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideReasonInput, setOverrideReasonInput] = useState('');
  const [currentOverrideReason, setCurrentOverrideReason] = useState('');
  const [editedItemIds, setEditedItemIds] = useState<Set<string>>(new Set());
  const [highlightedItemIds, setHighlightedItemIds] = useState<Set<string>>(new Set());

  const [histFor, setHistFor] = useState<Item | null>(null);
  const [histRows, setHistRows] = useState<AuditEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const [menuFor, setMenuFor] = useState<Item | null>(null);

  // Counting unit picker — shown before writing any new product to the area
  const [countingUnitVisible, setCountingUnitVisible] = useState(false);
  const [countingUnitPending, setCountingUnitPending] = useState<{
    name: string; unit?: string; supplierId?: string; supplierName?: string;
    productId?: string; costPrice?: number; caseSize?: number | null;
    write: (extras: CountingUnitConfig) => Promise<void>;
  } | null>(null);
  const [countingUnitForItem, setCountingUnitForItem] = useState<Item | null>(null);

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
  // Mirrors focusedInputId but isn't cleared on blur — gives toolbar-level actions
  // (not tied to a specific row) a stable "which item was the user just working on" signal.
  const [lastTouchedItemId, setLastTouchedItemId] = useState<string | null>(null);
  const [photoCountSheetOpen, setPhotoCountSheetOpen] = useState(false);
  const [bottleLevelBusy, setBottleLevelBusy] = useState(false);

  const [offline, setOffline] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoFor, setPhotoFor] = useState<Item | null>(null);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOffline(!(s.isConnected && s.isInternetReachable !== false)));
    return () => unsub && unsub();
  }, []);

  // Track items saved while offline (UI-only perceived sync)
  const [pendingSyncIds, setPendingSyncIds] = useState<Set<string>>(new Set());
  const addPending = (id: string) =>
    setPendingSyncIds(prev => { const n = new Set(prev); n.add(id); return n; });
  const removePending = (id: string) =>
    setPendingSyncIds(prev => { const n = new Set(prev); n.delete(id); return n; });

  // When we come back online, clear the pending marks after a short grace
  useEffect(() => {
    if (!offline) {
      const t = setTimeout(() => setPendingSyncIds(new Set()), 2000);
      return () => clearTimeout(t);
    }
  }, [offline]);

  // Online reconnection toast (animated)
  const [onlineToastVisible, setOnlineToastVisible] = useState(false);
  const onlineAnim = useRef(new Animated.Value(0)).current;
  const wasOfflineRef = useRef<boolean>(false);

  useEffect(() => {
    wasOfflineRef.current = offline;
  }, []);

  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    if (wasOffline && !offline) {
      setOnlineToastVisible(true);
      onlineAnim.setValue(0);
      Animated.timing(onlineAnim, {
        toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true
      }).start();

      const t = setTimeout(() => {
        Animated.timing(onlineAnim, {
          toValue: 0, duration: 220, easing: Easing.in(Easing.ease), useNativeDriver: true
        }).start(({ finished }) => { if (finished) setOnlineToastVisible(false); });
      }, 1600);

      return () => clearTimeout(t);
    }
    wasOfflineRef.current = offline;
  }, [offline, onlineAnim]);

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

  // Enrich items with incomingQty and soldQty from invoices and sales.
  // Non-blocking — onSnapshot auto-refreshes items when values are written back.
  useEffect(() => {
    if (!itemsPathOk || !venueId || !departmentId || !areaId) return;
    getAuth().currentUser?.getIdToken().then(token => {
      fetch('https://us-central1-tallyup-f1463.cloudfunctions.net/api/enrich-area-items', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, departmentId, areaId }),
      })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setInvoiceDataAvailable(!!data.hasInvoiceData);
          setSalesDataAvailable(!!data.hasSalesData);
          setEnrichmentComplete(true);
        }
      })
      .catch(() => {});
    }).catch(() => {});
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

  const [localStartedAtMs, setLocalStartedAtMs] = React.useState<number|null>(null);
  const startedAtMs = localStartedAtMs ?? (areaMeta?.startedAt?.toMillis ? areaMeta.startedAt.toMillis() : (areaMeta?.startedAt?._seconds ? areaMeta.startedAt._seconds * 1000 : null));
  const areaStarted = !!startedAtMs;

  // Edit window computed state
  const isSubmitted = !!areaMeta?.completedAt;
  const editWindowClosesAtMs = areaMeta?.editWindowClosesAt?.toMillis
    ? areaMeta.editWindowClosesAt.toMillis()
    : (areaMeta?.editWindowClosesAt?._seconds ? areaMeta.editWindowClosesAt._seconds * 1000 : null);
  const editWindowOpen = isSubmitted && editWindowClosesAtMs != null
    ? editWindowClosesAtMs > Date.now()
    : false;
  const windowMinutesLeft = editWindowOpen && editWindowClosesAtMs != null
    ? Math.max(0, Math.round((editWindowClosesAtMs - Date.now()) / 60000))
    : 0;
  const canEdit = !isSubmitted || editWindowOpen || (isManager && overrideActive);

  const countedInThisCycle = (it: Item): boolean => {
    const lcMs = it?.lastCountAt?.toMillis ? it.lastCountAt.toMillis() : (it?.lastCountAt?._seconds ? it.lastCountAt._seconds * 1000 : null);
    if (!lcMs || !startedAtMs) return false;
    return lcMs >= startedAtMs;
  };

  // Local-state source of truth for "has been counted this session"
  const hasLocalEntry = (it: Item): boolean =>
    /^(\d+(\.\d+)?|\.\d+)$/.test((localQty[it.id] ?? '').trim());

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
    const wastage = typeof it.wastageQty === 'number' ? it.wastageQty : 0;
    if (base == null) return null;
    return base + incoming - sold - wastage;
  };

  const filteredBase = useMemo(() => {
    const n = (unifiedSearch || '').trim().toLowerCase();
    return !n ? items : items.filter((it) => (it.name || '').toLowerCase().includes(n));
  }, [items, unifiedSearch]);

  const filtered = useMemo(() => {
    let rows = filteredBase;
    if (filterSkippedOnly) rows = rows.filter((it) => skippedItems.has(it.id));
    if (onlyLow) rows = rows.filter(isLow);
    if (onlyUncounted) rows = rows.filter((it) => !hasLocalEntry(it) || it.id === focusedInputId);
    if (onlyFlagged) rows = rows.filter((it) => !!it.flagRecount);
    if (sortUncountedFirst) {
      rows = rows.slice().sort((a, b) => {
        const au = hasLocalEntry(a) ? 1 : 0;
        const bu = hasLocalEntry(b) ? 1 : 0;
        if (au !== bu) return au - bu;
        const an = (a.name || '').toLowerCase(); const bn = (b.name || '').toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
    }
    return rows;
  }, [filteredBase, filterSkippedOnly, skippedItems, onlyLow, onlyUncounted, onlyFlagged, sortUncountedFirst, startedAtMs, focusedInputId]);

  const countedCount = items.filter(hasLocalEntry).length;
  const lowCount = items.filter(isLow).length;
  const flaggedCount = items.filter((it)=>!!it.flagRecount).length;
  const progressPct = items.length ? Math.round((countedCount / items.length) * 100) : 0;

  // Completion banner
  const allCounted = items.length > 0 && countedCount === items.length;
  const showBanner = allCounted && !bannerDismissed;
  useEffect(() => {
    Animated.timing(bannerAnim, {
      toValue: showBanner ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [showBanner]);
  useEffect(() => {
    // Reset dismiss when items change (user adds more uncounted products)
    if (!allCounted) setBannerDismissed(false);
  }, [allCounted]);

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
    const nextUncountedIdx = filtered.findIndex((x, i) => i >= startIdx && !hasLocalEntry(x));
    const targetIdx = nextUncountedIdx > -1 ? nextUncountedIdx : -1;
    if (targetIdx === -1) { Keyboard.dismiss(); setFocusedInputId(null); return; }
    const nextId = filtered[targetIdx].id;
    try { listRef.current?.scrollToIndex({ index: targetIdx + 1, animated: true }); } catch {}
    setTimeout(() => inputRefs.current[nextId]?.focus?.(), 80);
  };

  const ensureAreaStarted = async () => {
    if (startedAtMs) return;
    try {
      const a = await getDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId));
      const data = a.data() as AreaDoc | undefined;
      if (!data?.startedAt) {
        const now = Date.now();
        setLocalStartedAtMs(now);
        await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId), { startedAt: serverTimestamp() });
        // Mark venue as having an active stocktake — freezes invoice incomingQty writes
        updateDoc(doc(db, 'venues', venueId!), {
          stocktakeActive: true,
          stocktakeActiveAt: serverTimestamp(),
        }).catch(() => {});
      } else {
        const ms = data.startedAt?.toMillis ? data.startedAt.toMillis() : (data.startedAt?._seconds ? data.startedAt._seconds * 1000 : null);
        if (ms) setLocalStartedAtMs(ms);
      }
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
    } catch (e:any) { toastService.error(e?.message ?? 'Undo failed.'); }
  };

  const saveCount = async (item: Item, overrideQty?: number, forceReplace?: boolean) => {
    let qty: number;
    if (overrideQty != null) {
      qty = overrideQty;
    } else if (item.countingUnit === 'case' && item.caseSize) {
      qty = parseFloat(String(localQtyRef.current[item.id] ?? '0')) * item.caseSize;
    } else if (item.countingUnit === 'both' && item.caseSize) {
      const cases = parseFloat(String(localQtyRef.current[item.id] ?? '0'));
      const loose = parseFloat(String(localQtyRef.current[item.id + '_loose'] ?? '0'));
      qty = cases * item.caseSize + loose;
    } else {
      qty = parseFloat(String(localQtyRef.current[item.id] ?? '0'));
    }
    console.log('[SaveCount] called item:', item.id, 'qty:', qty, 'localQtyRef:', localQtyRef.current[item.id], 'localQty:', localQty[item.id]);
    const existingCount = typeof item.lastCount === 'number' ? item.lastCount : null;
    const doSave = async (finalQty: number) => {
      try {
        await ensureAreaStarted();
        const cu = getAuth().currentUser;
        const iRef = doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId!, 'items', item.id);
        await setDoc(iRef, {
          lastCount: finalQty,
          lastCountAt: serverTimestamp(),
          lastCountBy: cu?.uid ?? 'unknown',
          lastCountByName: cu?.displayName || 'Unknown',
          updatedAt: serverTimestamp(),
        }, { merge: true });
        // Log edit if area was already submitted
        if (isSubmitted && canEdit) {
          const oldCount = typeof item.lastCount === 'number' ? item.lastCount : null;
          const reason = isManager && overrideActive ? currentOverrideReason : 'within-edit-window';
          await logEditToArea(item, oldCount, finalQty, reason, isManager && overrideActive);
          setEditedItemIds(prev => { const n = new Set(prev); n.add(item.id); return n; });
          // FIX 4: Flag snapshot for recalculation
          (async () => {
            try {
              const deptSnap = await getDoc(doc(db, 'venues', venueId!, 'departments', departmentId));
              const cycleNum = typeof deptSnap.data()?.totalCyclesCompleted === 'number'
                ? deptSnap.data().totalCyclesCompleted : null;
              if (cycleNum) {
                await updateDoc(
                  doc(db, 'venues', venueId!, 'departments', departmentId, 'snapshots', `cycle-${cycleNum}`),
                  { requiresRecalculation: true, recalculationReason: 'count-edited-after-submission', editedAt: serverTimestamp() }
                );
              }
            } catch {}
          })();
        }
        hapticSuccess();
      } catch (e: any) {
        console.error('[SaveCount] FAILED:', e?.code, e?.message);
        // Firestore offline queue returns 'unavailable' — write is queued, don't alert
        if (e?.code !== 'unavailable' && e?.code !== 'failed-precondition') {
          toastService.error(e?.message ?? 'Save failed.');
        }
      }
    };
    if (!forceReplace && existingCount !== null && existingCount > 0 && qty > 0) {
      const total = existingCount + qty;
      Alert.alert('Update count?',
        item.name + ' is currently counted at ' + existingCount + '.\n\nReplace with ' + qty + ', or add to get ' + total + '?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace with ' + qty, onPress: () => doSave(qty) },
          { text: 'Add → ' + total, onPress: () => doSave(total) },
        ]
      );
    } else {
      await doSave(qty);
    }
  };

  const approveNow = async (item: Item) => {
    const typed = (localQty[item.id] ?? '').trim();
if (!ENABLE_MANAGER_INLINE_APPROVE) return;
if (!isManager) {
  showInfo('Manager access required.'); return;
}

// Require something in the box
if (!typed) {
  showInfo('Please enter a quantity.'); return;
}

// If NOT a valid number, show error
if (!/^(\d+(\.\d+)?|\.\d+)$/.test(typed)) {
  showInfo('Please enter a valid number.'); return;
}

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
        showSuccess('✓ Count updated and logged.');
      } catch (e: any) {
        toastService.error(e?.message ?? 'Approve failed.');
      }
    };

    if (needsDeltaConfirm(item.lastCount ?? null, qty)) {
      confirm({
        title: 'Large change',
        message: `Approve “${item.name}” from ${item.lastCount ?? 0} → ${qty}?`,
        confirmLabel: 'Approve',
        destructive: true,
        onConfirm: throttleAction(doApprove),
      });
    } else { await doApprove(); }
  };

  const addQuickItem = async () => {
  const nm = (addingName || '').trim();
  const unit = (addingUnit || '').trim();
  const supplier = (addingSupplier || '').trim();
  const qtyStr = (addingQty || '').trim();
  const bc = (addingBarcode || '').trim();

  if (!venueId || !departmentId || !areaId) {
    showInfo('Missing area context. Please go back and re-enter this area.');
    return;
  }

  if (!nm) {
    showInfo('Please enter a product name.');
    return;
  }

  // Optional: parse starting quantity
  let qty: number | null = null;
  if (qtyStr) {
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(qtyStr)) {
      showInfo('Please enter a valid quantity.');
      return;
    }
    qty = parseFloat(qtyStr);
  }

  const nowTs = serverTimestamp ? serverTimestamp() : new Date();

  const payload: any = {
    name: nm,
    unit: unit || null,
    supplierName: supplier || null,

    // Mark as a partial / inducted-from-area item
    inductionStatus: 'pending',
    inductionSource: 'quick-add',

    createdAt: nowTs,
    updatedAt: nowTs,
  };

  // If the user provided a starting quantity, save it as the current count
  if (qty != null) {
    const _qcu = getAuth().currentUser;
    payload.lastCount = qty;
    payload.lastCountAt = nowTs;
    payload.lastCountBy = _qcu?.uid ?? 'unknown';
    payload.lastCountByName = _qcu?.displayName || 'Unknown';
  }

  const writePath = `venues/${venueId}/departments/${departmentId}/areas/${areaId}/items`;
  console.log('[Area quick add] path=', writePath, 'venueId=', venueId, 'departmentId=', departmentId, 'areaId=', areaId, 'data=', JSON.stringify(payload));
  if (!venueId || !departmentId || !areaId) {
    showInfo('Missing area context. Please go back and re-enter this area.');
    return;
  }

  try {
    await ensureAreaStarted();

    // Find or create a venue product so the area item has a productId link
    let productId: string | null = null;
    try {
      const matchResult = await findMatchingProduct(venueId, { name: nm });
      if (matchResult.match && matchResult.confidence >= 0.85) {
        productId = matchResult.match.id;
      } else {
        const newProdRef = doc(collection(db, 'venues', venueId, 'products'));
        await setDoc(newProdRef, {
          name: nm,
          unit: unit || null,
          supplierName: supplier || null,
          ...(bc ? { barcode: bc, barcodeNumber: bc } : {}),
          createdAt: nowTs,
          updatedAt: nowTs,
        });
        productId = newProdRef.id;
        // Best-effort: contribute to global catalogue when a barcode was provided
        if (bc) {
          try {
            const [g1, g2] = await Promise.all([
              getDocs(query(collection(db, 'global_products'), where('barcode', '==', bc))),
              getDocs(query(collection(db, 'global_products'), where('barcodeNumber', '==', bc))),
            ]);
            if (g1.empty && g2.empty) {
              await setDoc(doc(db, 'global_products', bc), {
                barcode: bc,
                barcodeNumber: bc,
                name: nm,
                unit: unit || null,
                addedAt: serverTimestamp(),
                addedByVenue: venueId,
                source: 'quick-add',
              }, { merge: true });
            }
          } catch (e: any) {
            console.warn('[addQuickItem] global catalogue write failed:', e?.message);
          }
        }
      }
    } catch {
      // Non-fatal — area item still created without productId
    }

    if (productId) payload.productId = productId;

    const colRef = collection(
      db,
      'venues',
      venueId,
      'departments',
      departmentId,
      'areas',
      areaId,
      'items',
    );

    const docRef = await addDoc(colRef, payload);

    console.log('[Area quick add] SUCCESS path=', writePath, 'id=', docRef.id);
    showSuccess(`✓ “${nm}” added to this area.`);

    // Clear name, qty, supplier — keep unit (user likely counting same type of product)
    setAddingName('');
    setAddingQty('');
    setAddingSupplier('');
    setAddingBarcode('');

    // Persist unit preference only
    rememberQuickAdd(unit, '');

    hapticSuccess?.();
  } catch (e: any) {
    console.log('[Area quick add] FAILED', e?.code, e?.message);
    toastService.error(e?.message ?? 'Could not add item.');
  }
};

  const removeItem = (itemId: string) => {
    confirm({
      title: 'Delete item',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try { await deleteDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',itemId)); }
        catch (e:any) { toastService.error(e?.message ?? 'Could not delete.'); }
      },
    });
  };

  const openAdjustment = (item: Item) => { setAdjModalFor(item); setAdjQty(''); setAdjReason(''); };
  const submitAdjustment = async () => {
  const it = adjModalFor!;
  const qtyStr = adjQty.trim();

if (!qtyStr) {
  showInfo('Please enter a quantity.');
  return;
}

// If NOT a valid number, show error
if (!/^(\d+(\.\d+)?|\.\d+)$/.test(qtyStr)) {
  showInfo('Please enter a valid number.');
  return;
}

if (!adjReason.trim()) { showInfo('Please enter a reason.'); return; }

try {
  await addDoc(collection(db, 'venues', venueId!, 'sessions'), {
    type: 'stock-adjustment-request', status: 'pending',
    venueId, departmentId, areaId, itemId: it.id, itemName: it.name,
    fromQty: it.lastCount ?? null, proposedQty: parseFloat(qtyStr),
    reason: adjReason.trim(), requestedBy: getAuth().currentUser?.uid ?? null,
    requestedAt: serverTimestamp(), createdAt: serverTimestamp(),
  });
      setAdjModalFor(null);
    } catch (e: any) { toastService.error(e?.message ?? 'Could not submit request.'); }
  };

  const maybeFinalizeDepartment = async () => {
    if (!venueId || !departmentId) return;

    try {
      const areasCol = collection(
        db,
        'venues',
        venueId,
        'departments',
        departmentId,
        'areas',
      );
      const snap = await getDocs(areasCol);
      if (snap.empty) {
        return;
      }

      const areas = snap.docs.map(d => d.data() as { startedAt?: any; completedAt?: any });

      const allCompleted = areas.every(a => !!a.completedAt);
      if (!allCompleted) {
        return;
      }

      let firstStart: any = null;
      let lastComplete: any = null;

      for (const a of areas) {
        if (a.startedAt) {
          if (!firstStart || a.startedAt.toMillis() < firstStart.toMillis()) {
            firstStart = a.startedAt;
          }
        }
        if (a.completedAt) {
          if (!lastComplete || a.completedAt.toMillis() > lastComplete.toMillis()) {
            lastComplete = a.completedAt;
          }
        }
      }

      const startDate: Date | null = firstStart ? firstStart.toDate() : null;
      const endDate: Date = lastComplete ? lastComplete.toDate() : new Date();

      const windowMs = startDate ? endDate.getTime() - startDate.getTime() : 0;
      const windowHours = windowMs > 0 ? windowMs / (1000 * 60 * 60) : 0;
      const roundedHours = Math.round(windowHours);
      const moreThan24h = windowHours > 24;

      const proceed = await new Promise<boolean>((resolve) => {
        if (!moreThan24h) {
          Alert.alert(
            'Submit full stock take',
            'All areas in this department are now marked as completed.\n\nSubmit this as a full stock take?',
            [
              { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Submit', style: 'default', onPress: () => resolve(true) },
            ],
          );
        } else {
          Alert.alert(
            'Long stocktake window',
            `It has been about ${roundedHours} hours between the first area start and the last area completion.\n\nThis may reduce accuracy. Do you still want to submit?`,
            [
              { text: 'Review areas', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Submit anyway', style: 'destructive', onPress: () => resolve(true) },
            ],
          );
        }
      });

      if (!proceed) return;

      const uid = getAuth().currentUser?.uid ?? 'unknown';
      const submittedAt = new Date();

      // Read department for cycle number + name before incrementing
      const deptRef = doc(db, 'venues', venueId!, 'departments', departmentId);
      let deptCycleNumber = 1;
      let deptName = departmentId;
      try {
        const deptSnap = await getDoc(deptRef);
        const deptData = deptSnap.data() ?? {};
        deptCycleNumber = (typeof deptData.totalCyclesCompleted === 'number' ? deptData.totalCyclesCompleted : 0) + 1;
        deptName = deptData.name ?? departmentId;
      } catch {}

      // Calculate stats for this department only
      let deptValue = 0;
      let deptItemsCount = 0;
      try {
        for (const areaDoc of snap.docs) {
          const itemsSnap = await getDocs(collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaDoc.id, 'items'));
          deptItemsCount += itemsSnap.size;
          itemsSnap.forEach(d => {
            const data = d.data();
            deptValue += (typeof data.lastCount === 'number' ? data.lastCount : 0)
              * (typeof data.costPrice === 'number' ? data.costPrice : 0);
          });
        }
      } catch {}

      // Update department: timing + cycle counter (atomic increment)
      await updateDoc(deptRef, {
        lastStockTakeAt: serverTimestamp(),
        lastStockTakeWindowHours: roundedHours,
        lastCycleAt: serverTimestamp(),
        lastCycleCompletedBy: uid,
        totalCyclesCompleted: increment(1),
      });

      // Write department-level cycle history document
      try {
        await addDoc(collection(db, 'venues', venueId!, 'departments', departmentId, 'cycles'), {
          completedAt: serverTimestamp(),
          completedBy: uid,
          cycleNumber: deptCycleNumber,
          totalItems: deptItemsCount,
          stockValue: deptValue,
          areaCount: snap.docs.length,
          durationMinutes: Math.round(windowHours * 60),
          venueId: venueId!,
          departmentId,
        });
      } catch (e) {
        console.warn('[stocktake] dept cycle write failed', e);
      }

      // Every department completion counts as a completed stocktake
      try { await incrementFullStocktakeCompleted(venueId!); } catch {}

      // Write rich cycle snapshot for reports — 3 attempts with exponential backoff
      (async () => {
        let snapshotWritten = false;
        let attempts = 0;
        while (!snapshotWritten && attempts < 3) {
          try {
            await writeDepartmentSnapshot(venueId!, departmentId, deptCycleNumber);
            snapshotWritten = true;
          } catch (e: any) {
            attempts++;
            console.warn(`[stocktake] snapshot write attempt ${attempts} failed:`, e?.message);
            if (attempts < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempts - 1)));
            }
          }
        }
        if (!snapshotWritten) {
          setExportToast('Report data may be delayed — please try again later.');
          setTimeout(() => setExportToast(null), 5000);
        }
      })();

      // Check if ALL departments completed within the last 7 days
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      let allDeptsComplete = false;
      try {
        const allDeptsSnap = await getDocs(collection(db, 'venues', venueId!, 'departments'));
        const cutoff = Date.now() - SEVEN_DAYS_MS;
        allDeptsComplete = allDeptsSnap.docs.every(d => {
          if (d.id === departmentId) return true; // just completed now
          const lc = d.data().lastCycleAt;
          const ms = lc?.toMillis?.() ?? lc?.toDate?.()?.getTime?.() ?? 0;
          return ms > cutoff;
        });
      } catch {}

      let venueValue = 0;
      let venueItemsCount = 0;

      if (allDeptsComplete) {
        // Aggregate stats across ALL departments for the venue-wide record
        try {
          const allDeptsSnap = await getDocs(collection(db, 'venues', venueId!, 'departments'));
          await Promise.all(allDeptsSnap.docs.map(async deptDoc => {
            const areasSnap = await getDocs(collection(db, 'venues', venueId!, 'departments', deptDoc.id, 'areas'));
            await Promise.all(areasSnap.docs.map(async areaDoc => {
              const itemsSnap = await getDocs(collection(db, 'venues', venueId!, 'departments', deptDoc.id, 'areas', areaDoc.id, 'items'));
              venueItemsCount += itemsSnap.size;
              itemsSnap.forEach(d => {
                const data = d.data();
                venueValue += (typeof data.lastCount === 'number' ? data.lastCount : 0)
                  * (typeof data.costPrice === 'number' ? data.costPrice : 0);
              });
            }));
          }));
        } catch {}

        // Write ONE venue-wide cycle history document
        try {
          await addDoc(collection(db, 'venues', venueId!, 'stockTakes'), {
            completedAt: serverTimestamp(),
            completedBy: uid,
            source: 'venue-wide-cycle',
            totalItems: venueItemsCount,
            durationMinutes: Math.round(windowHours * 60),
            stockValue: venueValue,
            venueId: venueId!,
          });
        } catch (e) {
          console.warn('[stocktake] venue cycle write failed', e);
        }

        // Venue-wide completion — track separately for future full-venue report.
        // (totalStocktakesCompleted now increments unconditionally per department, above.)
        try {
          await updateDoc(doc(db, 'venues', venueId!), {
            lastFullVenueStocktakeAt: serverTimestamp(),
          });
        } catch {}
      }

      const counted = items.filter(i => i.lastCountAt);
      const missed = items.filter(i => !i.lastCountAt);

      if (allDeptsComplete) {
        // All departments aligned — navigate to venue-wide summary
        nav.navigate('StocktakeSummary' as never, {
          departmentName: deptName,
          submittedAt: submittedAt.toISOString(),
          itemsCounted: counted.length,
          itemsMissed: missed.length,
          totalValue: venueValue,
          windowHours: roundedHours,
          items: counted.slice(0, 20).map(i => ({ name: i.name, counted: i.lastCount || 0, unit: i.unit, costPrice: i.costPrice })),
        } as never);
        return true;
      } else {
        // Department done, others still in progress — dept summary screen
        nav.navigate('DepartmentSummary' as never, {
          departmentId,
          departmentName: deptName,
          cycleNumber: deptCycleNumber,
          totalItems: deptItemsCount,
          stockValue: deptValue,
          areaCount: snap.docs.length,
          durationMinutes: Math.round(windowHours * 60),
          submittedAt: submittedAt.toISOString(),
        } as never);
        return true;
      }
    } catch (e: any) {
      if (__DEV__) {
        console.log('[StockTake] maybeFinalizeDepartment error', e?.message || e);
      }
    }
    return false;
  };

  const varianceCheckedRef = React.useRef(false);
  const skippedReviewedRef = React.useRef(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCounted, setReviewCounted] = useState<Item[]>([]);
  const [reviewMissing, setReviewMissing] = useState<Item[]>([]);
  const [reviewFlagged, setReviewFlagged] = useState<Item[]>([]);
  const [submittingArea, setSubmittingArea] = useState(false);

  const openReview = () => {
    // Items skipped during voice counting — give the user a chance to count
    // them before submitting (asked once per submit attempt).
    if (skippedItems.size > 0 && !skippedReviewedRef.current) {
      const names = Array.from(skippedItems).map(id => {
        const it = itemsRef.current?.find(i => i.id === id);
        return `• ${it?.name || id}`;
      }).join('\n');
      // useConfirmModal does not support onCancel callback — simplified to binary confirm.
      // "Submit anyway" is the primary action; user can tap Cancel and use the filter button.
      showInfo('You can use the filter button to show only skipped items and count them manually.');
      confirm({
        title: `${skippedItems.size} item${skippedItems.size !== 1 ? 's' : ''} skipped`,
        message: `You skipped these items during voice counting:\n\n${names}\n\nDo you want to submit anyway?`,
        confirmLabel: 'Submit anyway',
        destructive: true,
        onConfirm: () => { skippedReviewedRef.current = true; openReview(); },
      });
      return;
    }
    skippedReviewedRef.current = false;

    const counted = items.filter(hasLocalEntry);
    const missing = items.filter((it) => !hasLocalEntry(it));
    const flagged = items.filter((it) => !!it.flagRecount);

    // High variance detection — check before opening review modal
    const highVariance = items.filter(it => {
      const raw = (localQty[it.id] ?? '').trim();
      const c = /^(\d+(\.\d+)?|\.\d+)$/.test(raw) ? parseFloat(raw) : 0;
      const expected = deriveExpected(it);
      if (expected == null) return false;
      const varianceAbs = Math.abs(c - expected);
      const variancePct = expected > 0 ? varianceAbs / expected : 0;
      const varianceDollars = typeof it.costPrice === 'number' ? varianceAbs * it.costPrice : 0;
      if (typeof it.costPrice === 'number' && it.costPrice > 30 && varianceAbs > 0) return true;
      if (varianceDollars > 50) return true;
      if (variancePct > 0.2 && varianceAbs >= 2) return true;
      return false;
    });

    const proceedToReview = () => {
      varianceCheckedRef.current = true;
      setReviewCounted(counted);
      setReviewMissing(missing);
      setReviewFlagged(flagged);
      setReviewOpen(true);
    };

    if (highVariance.length > 0) {
      const hvList = highVariance.slice(0, 4).map(it => {
        const raw = (localQty[it.id] ?? '').trim();
        const c = /^(\d+(\.\d+)?|\.\d+)$/.test(raw) ? parseFloat(raw) : 0;
        const expected = deriveExpected(it);
        const variance = expected != null ? c - expected : 0;
        const dollar = typeof it.costPrice === 'number' ? Math.abs(variance * it.costPrice) : null;
        return `• ${it.name} — counted ${c}, expected ${expected ?? '?'} (${variance > 0 ? '+' : ''}${variance}${dollar != null ? `, $${dollar.toFixed(0)}` : ''})`;
      }).join('\n');
      const overflow = highVariance.length > 4 ? `\n...and ${highVariance.length - 4} more` : '';

      // useConfirmModal does not support onCancel — simplified to recount-only confirm.
      // TODO: restore "Flag for review" and "Accept and submit" paths when a multi-action
      // sheet component is available.
      confirm({
        title: '⚠️ High variance detected',
        message: `These items differ significantly from last stocktake:\n\n${hvList}${overflow}\n\nRecount before submitting?`,
        confirmLabel: 'Recount now',
        onConfirm: () => {
          setHighlightedItemIds(new Set(highVariance.map(it => it.id)));
          const idx = filtered.findIndex(x => x.id === highVariance[0].id);
          if (idx > -1) {
            try { listRef.current?.scrollToIndex({ index: idx + 1, animated: true }); } catch {}
            setTimeout(() => inputRefs.current[highVariance[0].id]?.focus?.(), 80);
          }
          setTimeout(() => setHighlightedItemIds(new Set()), 5000);
        },
      });
      return;
    }

    varianceCheckedRef.current = true;
    proceedToReview();
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
    if (submittingArea) return;

    const missing = items.filter((it) => !hasLocalEntry(it));

    const perform = async () => {
      if (submittingArea) return;

      // If variance wasn't checked via openReview, run a quick guard
      if (!varianceCheckedRef.current) {
        const highVarianceGuard = items.filter(it => {
          const raw = (localQty[it.id] ?? '').trim();
          const c = /^(\d+(\.\d+)?|\.\d+)$/.test(raw) ? parseFloat(raw) : 0;
          const expected = deriveExpected(it);
          if (expected == null) return false;
          const varianceAbs = Math.abs(c - expected);
          const variancePct = expected > 0 ? varianceAbs / expected : 0;
          const varianceDollars = typeof it.costPrice === 'number' ? varianceAbs * it.costPrice : 0;
          if (typeof it.costPrice === 'number' && it.costPrice > 30 && varianceAbs > 0) return true;
          if (varianceDollars > 50) return true;
          if (variancePct > 0.2 && varianceAbs >= 2) return true;
          return false;
        });
        if (highVarianceGuard.length > 0) {
          confirm({
            title: '⚠️ High variance detected',
            message: `${highVarianceGuard.length} item(s) have significant variance. Proceed with submission?`,
            confirmLabel: 'Submit anyway',
            cancelLabel: 'Go back',
            destructive: true,
            onConfirm: () => { varianceCheckedRef.current = true; perform(); },
          });
          return;
        }
      }
      varianceCheckedRef.current = false;

      setSubmittingArea(true);
      try {
        await ensureAreaStarted();

        // Write all items from localQty — entered items use their value, unset items get 0
        const _cu = getAuth().currentUser;
        const _countBy = _cu?.uid ?? 'unknown';
        const _countByName = _cu?.displayName || 'Unknown';
        await Promise.all(items.map((it) => {
          const raw = (localQty[it.id] ?? '').trim();
          const qty = /^(\d+(\.\d+)?|\.\d+)$/.test(raw) ? parseFloat(raw) : 0;
          return setDoc(
            doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId!,'items',it.id),
            { lastCount: qty, lastCountAt: serverTimestamp(), lastCountBy: _countBy, lastCountByName: _countByName, updatedAt: serverTimestamp() },
            { merge: true }
          );
        }));

        // Stamp confirmedCount on all items for safe cycle reset, and collect
        // lastCountAt timestamps to compute active counting session segments
        // (Hosti Health Phase 2 — labour efficiency tracking). Reuses this same
        // read rather than fetching items twice.
        let countSessionSegments: { startMs: number; endMs: number }[] = [];
        let activeCountingMinutes = 0;
        try {
          const { getDocs: _getDocs, writeBatch: _writeBatch } = await import('firebase/firestore');
          const itemsSnap = await _getDocs(collection(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items'));
          const confirmBatch = _writeBatch(db);
          const countTimestamps: number[] = [];
          itemsSnap.forEach(itemDoc => {
            const d = itemDoc.data();
            if (typeof d.lastCount === 'number') {
              confirmBatch.update(itemDoc.ref, { confirmedCount: d.lastCount, confirmedCountAt: serverTimestamp() });
            }
            const ts = d.lastCountAt?.toMillis?.() || d.lastCountAt;
            if (typeof ts === 'number' && ts > 0) countTimestamps.push(ts);
          });
          await confirmBatch.commit();

          // Split into segments where gap > 5 minutes = new segment
          countTimestamps.sort((a, b) => a - b);
          const GAP_MS = 3 * 60 * 1000; // 3 minutes — more accurate threshold for genuine counting gaps
          if (countTimestamps.length > 0) {
            let segStart = countTimestamps[0];
            let segEnd = countTimestamps[0];
            for (let i = 1; i < countTimestamps.length; i++) {
              if (countTimestamps[i] - countTimestamps[i - 1] > GAP_MS) {
                countSessionSegments.push({ startMs: segStart, endMs: segEnd });
                segStart = countTimestamps[i];
              }
              segEnd = countTimestamps[i];
            }
            countSessionSegments.push({ startMs: segStart, endMs: segEnd });
          }
          activeCountingMinutes = countSessionSegments.reduce((sum, s) => sum + (s.endMs - s.startMs) / 60000, 0);
        } catch {}

        // Clear the local draft after successful submit
        if (draftKey && AS) {
          try { await AS.removeItem(draftKey); } catch {}
        }

        await updateDoc(
          doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId),
          {
            completedAt: serverTimestamp(),
            editWindowClosesAt: Timestamp.fromMillis(Date.now() + (60 * 60 * 1000)),
            editWindowOpen: true,
            edits: [],
            countSessionSegments,
            activeCountingMinutes: Math.round(activeCountingMinutes),
          }
        );
        const finalized = await maybeFinalizeDepartment();
        if (isFestivalSession && finalized) {
          await startNewDepartmentCycle(venueId!, departmentId);
        }
        const breakCount = Math.max(0, countSessionSegments.length - 1);
        const totalWallMinutes = Math.round(windowHours * 60);
        const breakMinutes = Math.max(0, totalWallMinutes - Math.round(activeCountingMinutes));
        const durationMsg = activeCountingMinutes > 0 && breakCount > 0
          ? `${Math.round(activeCountingMinutes)} min active · ${breakCount} break${breakCount > 1 ? 's' : ''} (${breakMinutes} min) excluded`
          : `${totalWallMinutes} min`;

        // Offline-aware feedback
        const netState = await NetInfo.fetch().catch(() => ({ isConnected: true, isInternetReachable: true }));
        const isOnline = (netState as any).isConnected === true && (netState as any).isInternetReachable !== false;

        if (finalized) {
          showSuccess('Department complete — nice work!');
        } else if (isOnline) {
          showSuccess(`${areaName || 'Area'} submitted · ${durationMsg}`);
        } else {
          showInfo(`${areaName || 'Area'} saved locally · ${durationMsg} · will sync when online`);
        }
        if (!finalized) nav.navigate('Areas' as never, { departmentId } as never);
      } catch (e: any) {
        toastService.error(e?.message ?? 'Could not complete area.');
      } finally {
        setSubmittingArea(false);
      }
    };

    if (missing.length > 0) {
      const itemList = missing.slice(0, 8).map((it) => `• ${it.name || 'Unnamed'}`).join('\n');
      const overflow = missing.length > 8 ? `\n...and ${missing.length - 8} more` : '';
      const msg = missing.length === items.length
        ? `No items have been entered yet. All ${missing.length} will be saved as 0:\n\n${itemList}${overflow}`
        : `These ${missing.length.toLocaleString()} item${missing.length > 1 ? 's' : ''} will be saved as 0:\n\n${itemList}${overflow}`;
      confirm({
        title: 'Incomplete counts',
        message: msg,
        confirmLabel: 'Continue',
        cancelLabel: 'Go back',
        onConfirm: () => perform(),
      });
    } else {
      await perform();
    }
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
        if (toZero.length === 0) { showInfo('No items to update — everything already has a count.'); return; }
        const _zcu = getAuth().currentUser;
        await Promise.all(toZero.map((it) =>
          updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',it.id),
            { lastCount: 0, lastCountAt: serverTimestamp(), lastCountBy: _zcu?.uid ?? 'unknown', lastCountByName: _zcu?.displayName || 'Unknown', updatedAt: serverTimestamp() })
        ));
        hapticSuccess(); showSuccess(`✓ ${toZero.length} item(s) saved as 0.`);
      } catch (e:any) { toastService.error(e?.message ?? 'Failed.'); }
    };

   confirm({
  title: 'Initialise with zeros',
  message: msg,
  confirmLabel: 'Confirm',
  destructive: true,
  onConfirm: throttleAction(doIt),
});
  };

  const closeScaleModal = () => {
    setScaleModalFor(null);
    setScaleModalPhase('checking');
    setScaleWeight(null);
    setScaleStable(false);
    setScaleReconnectName(null);
    setScaleConversionMsg(null);
  };

  const useBluetoothFor = async (item: Item) => {
    const requestId = ++scaleRequestRef.current;
    setScaleModalFor(item);
    setScaleModalPhase('checking');
    setScaleWeight(null);
    setScaleStable(false);
    setScaleReconnectName(null);
    setScaleConversionMsg(null);

    await ScaleService.init();
    if (scaleRequestRef.current !== requestId) return; // superseded by a newer request

    if (ScaleService.getStatus() === 'connected') {
      setScaleModalPhase('live');
      return;
    }

    const last = ScaleService.getLastKnownDevice();
    if (!last) {
      setScaleModalPhase('unavailable');
      return;
    }

    setScaleReconnectName(last.deviceName || 'your scale');
    setScaleModalPhase('reconnecting');
    const ok = await ScaleService.tryReconnectLastDevice();
    if (scaleRequestRef.current !== requestId) return; // superseded by a newer request
    setScaleModalPhase(ok ? 'live' : 'unavailable');
  };

  const onScaleTare = () => { ScaleService.tare(); };

  const useScaleWeightForItem = () => {
    const item = scaleModalFor;
    if (!item || scaleWeight == null) return;

    const base = toBaseUnit(item.unit);
    if (base !== 'g') {
      setScaleConversionMsg(
        `"${item.unit || 'No unit set'}" isn't a weight unit, so the scale reading can't be converted automatically. Enter the count manually, or change this item's counting unit to g/kg.`
      );
      return;
    }

    const unitLower = (item.unit || '').toLowerCase().trim();
    const isKg = unitLower === 'kg' || unitLower === 'kilogram';
    const value = isKg ? scaleWeight / 1000 : scaleWeight;
    const rounded = isKg ? Math.round(value * 1000) / 1000 : Math.round(value);

    setLocalQty(m => ({ ...m, [item.id]: String(rounded) }));
    hapticSuccess();
    showSuccess(`✓ ${rounded}${isKg ? 'kg' : 'g'} from scale → ${item.name}`);
    closeScaleModal();
  };

  // Subscribe to live weight only while the scale modal is open and connected.
  useEffect(() => {
    if (!scaleModalFor || scaleModalPhase !== 'live') return;
    const unsub = ScaleService.onWeight(r => {
      setScaleWeight(r.weightGrams);
      setScaleStable(r.stable);
    });
    return () => { unsub(); };
  }, [scaleModalFor, scaleModalPhase]);

  const usePhotoFor = (item: Item) => {
    setPhotoFor(item);
    setPhotoOpen(true);
  };

  // ── AI photo count toolbar button — targets whichever item's count field
  // was most recently focused (lastTouchedItemId survives blur, unlike focusedInputId).
  const resolvePhotoCountTarget = (): Item | null => {
    const targetId = focusedInputId || lastTouchedItemId;
    if (!targetId) return null;
    return items.find(i => i.id === targetId) ?? null;
  };

  const openPhotoCountSheet = () => {
    setPhotoCountSheetOpen(true); // Always open — sheet handles no-target case
  };

  const handleCountItemsOnShelf = () => {
    setPhotoCountSheetOpen(false);
    const item = resolvePhotoCountTarget();
    if (!item) { showInfo("Tap a product's count field first, then use AI Count."); return; }
    usePhotoFor(item);
  };

  const handleEstimateBottleLevelForItem = async (item: Item) => {
    if (bottleLevelBusy) return;
    setBottleLevelBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        showError('Camera access required — please allow camera access in Settings.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;

      const base64 = await FS.readAsStringAsync(res.assets[0].uri, { encoding: FS.EncodingType.Base64 });
      const token = await getAuth().currentUser?.getIdToken().catch(() => null);
      if (!token) { showError('Not authenticated.'); return; }

      const resp = await fetch(aiUrl('/api/photo-count'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          venueId: venueId || 'unknown',
          imageBase64: base64,
          productHint: item.name,
          mode: 'bottle-level',
        }),
      });
      const json: any = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.ok || typeof json.fillLevel !== 'number') {
        showError(json?.error || 'Could not estimate fill level.');
        return;
      }

      const fillLevel = json.fillLevel;
      setLocalQty(prev => ({ ...prev, [item.id]: String(fillLevel) }));
      hapticSuccess();
      showSuccess(`Estimated ${Math.round(fillLevel * 100)}% full — tap save to confirm or adjust`);
    } catch (e: any) {
      showError(e?.message || 'Could not estimate fill level.');
    } finally {
      setBottleLevelBusy(false);
    }
  };

  const handleEstimateBottleLevel = async () => {
    setPhotoCountSheetOpen(false);
    const item = resolvePhotoCountTarget();
    if (!item) { showInfo("Tap a product's count field first, then use AI Count."); return; }
    await handleEstimateBottleLevelForItem(item);
  };

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
    if (par !== '' && !/^\d+(\.\d+)?$/.test(par)) { showInfo('Par level must be a number.'); return; }
    try {
      await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',editFor.id), {
        name: (editName || '').trim() || editFor.name || '',
        unit: (editUnit || '').trim() || null,
        supplierName: (editSupplier || '').trim() || null,
        parLevel: parNum,
        updatedAt: serverTimestamp(),
      });
      setEditFor(null); hapticSuccess();
    } catch (e:any) { toastService.error(e?.message ?? 'Update failed.'); }
  };

  const toCsv = (rows: Array<Record<string, any>>) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const safe = (v: any) => { if (v === null || v === undefined) return ''; const s = String(v).replace(/"/g, '""'); return `"${s}"`; };
    return [ headers.map(safe).join(','), ...rows.map((r) => headers.map((h) => safe(r[h])).join(',')) ].join('\n');
  };

  const exportCsvAll = throttleAction(async () => {
    try {
      showExportToast('Export ready');
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
      if (!csv) { showInfo('Nothing to export in the current view.'); return; }
      if (!FS || !FS.cacheDirectory) { showError('Export unavailable — FileSystem not found.'); return; }
      const fname = `tallyup-area-${areaId}-${Date.now()}.csv`;
      const path = FS.cacheDirectory + fname;
      await FS.writeAsStringAsync(path, csv, { encoding: FS.EncodingType.UTF8 });
      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export CSV — Current view' });
      } else { showSuccess('✓ Exported to device.'); }
    } catch (e:any) { toastService.error(e?.message ?? 'Export failed.'); }
  });

  const exportCsvChangesOnly = throttleAction(async () => {
    try {
      showExportToast('Export ready');
      if (!areaStarted) { showInfo('Nothing to export — area not started yet.'); return; }
      const changed = filtered.filter(countedInThisCycle);
      if (changed.length === 0) { showInfo('Nothing to export — no items counted this stocktake.'); return; }
      const rows = changed.map((it) => ({
        name: it.name || '', unit: it.unit || '',
        newCount: typeof it.lastCount === 'number' ? it.lastCount : '',
        expected: deriveExpected(it) ?? '',
        flagged: it.flagRecount ? 'yes' : 'no',
      }));
      const csv = toCsv(rows);
      if (!FS || !FS.cacheDirectory) { showError('Export unavailable — FileSystem not found.'); return; }
      const fname = `tallyup-area-${areaId}-changes-${Date.now()}.csv`;
      const path = FS.cacheDirectory + fname;
      await FS.writeAsStringAsync(path, csv, { encoding: FS.EncodingType.UTF8 });
      if (Sharing?.isAvailableAsync && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export CSV — Changes only' } as any);
      } else { showSuccess('✓ Exported to device.'); }
    } catch (e:any) { toastService.error(e?.message ?? 'Export failed.'); }
  });

  const clampNonNegative = (n:number) => (isNaN(n) ? 0 : Math.max(0, n));

  const toggleFlagRecount = async (item: Item) => {
    try {
      await updateDoc(doc(db,'venues',venueId!,'departments',departmentId,'areas',areaId,'items',item.id), {
        flagRecount: !item.flagRecount,
        updatedAt: serverTimestamp(),
      });
      hapticSuccess();
    } catch (e:any) { toastService.error(e?.message ?? 'Failed.'); }
  };

  const logEditToArea = async (
    item: Item,
    oldCount: number | null,
    newCount: number,
    reason: string,
    isManagerOverride = false,
  ) => {
    const cu = getAuth().currentUser;
    try {
      await updateDoc(
        doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId),
        {
          edits: arrayUnion({
            editedBy: cu?.uid ?? 'unknown',
            editedByName: cu?.displayName || 'Unknown',
            editedAt: new Date().toISOString(),
            itemId: item.id,
            itemName: item.name,
            oldCount,
            newCount,
            reason,
            isManagerOverride,
          }),
        }
      );
    } catch (e: any) {
      console.warn('[logEditToArea] failed (non-fatal):', e?.message);
    }
  };

  // ── New capture handlers ──────────────────────────────────────────────────

  const handleShelfScanConfirm = async (products: { name: string; brand: string; size: string; category: string }[]) => {
    if (!venueId) throw new Error('Missing venue');
    await ensureAreaStarted();
    let added = 0;
    let skipped = 0;
    for (const p of products) {
      const displayName = [p.name, p.brand, p.size].filter(Boolean).join(' ').trim() || p.name;
      const alreadyExists = items.some(it => it.name?.toLowerCase() === displayName.toLowerCase());
      if (alreadyExists) { skipped++; continue; }

      // Find or create venue product for productId link
      let productId: string | null = null;
      try {
        const matchResult = await findMatchingProduct(venueId, { name: displayName });
        if (matchResult.match && matchResult.confidence >= 0.85) {
          productId = matchResult.match.id;
        } else {
          const newProdRef = doc(collection(db, 'venues', venueId!, 'products'));
          await setDoc(newProdRef, {
            name: displayName,
            unit: p.size || null,
            category: p.category || null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          productId = newProdRef.id;
        }
      } catch {
        // Non-fatal — area item still created without productId
      }

      await addDoc(
        collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items'),
        { name: displayName, unit: p.size || null, productId: productId ?? null, inductionStatus: 'pending', inductionSource: 'shelf-scan', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
      );
      added++;
    }
    if (skipped > 0) {
      showSuccess(`✓ ${added} product${added !== 1 ? 's' : ''} added, ${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped.`);
    }
  };

  const handleProductPhotoConfirm = async (product: { name: string; brand: string; size: string; unit: string; barcode?: string; category?: string }, count: number) => {
    if (!venueId) throw new Error('Missing venue');
    await ensureAreaStarted();
    const displayName = [product.name, product.brand, product.size].filter(Boolean).join(' ').trim() || product.name;
    const barcode = (product as any).barcode?.trim() || null;
    const _cu = getAuth().currentUser;

    // Write to venue products so the barcode scanner can find it next time
    let venueProductId: string | null = null;
    try {
      const prodRef = await addDoc(collection(db, 'venues', venueId!, 'products'), {
        name: displayName,
        brand: (product as any).brand || null,
        size: (product as any).size || null,
        category: (product as any).category || null,
        unit: product.unit || null,
        barcode: barcode,
        barcodeNumber: barcode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      venueProductId = prodRef.id;
    } catch (e: any) {
      console.warn('[ProductPhoto] venue product write failed (non-fatal):', e?.message);
    }

    await addDoc(
      collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items'),
      {
        name: displayName,
        unit: product.unit || null,
        productId: venueProductId,
        barcode: barcode,
        barcodeNumber: barcode,
        inductionStatus: 'pending',
        inductionSource: 'product-photo',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastCount: count,
        lastCountAt: serverTimestamp(),
        lastCountBy: _cu?.uid ?? 'unknown',
        lastCountByName: _cu?.displayName || 'Unknown',
      }
    );
  };

  const handleVenueProductSelected = async (product: any) => {
    if (!venueId || !departmentId || !areaId) {
      showError('Missing area information. Please go back and reopen this area.');
      return;
    }
    const already = items.find(it => it.name?.toLowerCase() === (product.name || '').toLowerCase());
    if (already) { showInfo(`${product.name} is already in this area.`); return; }
    await ensureAreaStarted();
    setCountingUnitPending({
      name: product.name || '',
      unit: product.unit || undefined,
      supplierName: product.supplierName || undefined,
      productId: product.id || undefined,
      costPrice: product.costPrice || undefined,
      caseSize: product.caseSize || null,
      write: async ({ countingUnit, caseSize }) => {
        await addDoc(
          collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items'),
          {
            name: product.name || '',
            unit: product.unit || null,
            supplierId: product.supplierId || null,
            supplierName: product.supplierName || null,
            productId: product.id || null,
            countingUnit,
            caseSize: caseSize ?? null,
            costPrice: product.costPrice || null,
            parLevel: product.parLevel || null,
            barcode: product.barcode || null,
            barcodeNumber: product.barcodeNumber || product.barcode || null,
            category: product.category || product.categorySuggested || null,
            brand: product.brand || null,
            size: product.size || null,
            inductionStatus: 'pending',
            inductionSource: 'venue-search',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        );
        hapticSuccess();
      },
    });
    setCountingUnitVisible(true);
  };

  // Auto-dismiss batch toast after 3.5s
  useEffect(() => {
    if (!batchAddToast) return;
    const t = setTimeout(() => setBatchAddToast(null), 3500);
    return () => clearTimeout(t);
  }, [batchAddToast]);

  // Batch add from VenueProductSearchModal multi-select
  const handleBatchVenueProductsSelected = async (products: any[]) => {
    if (!venueId || !departmentId || !areaId || !products.length) return;
    const newProducts = products.filter(p =>
      !items.find(it => it.name?.toLowerCase() === (p.name || '').toLowerCase())
    );
    if (!newProducts.length) {
      showInfo('All selected products are already in this area.');
      return;
    }
    await ensureAreaStarted();

    // Shared batch write — called by both "individual units" and "same unit for all" paths
    const doBatchWrite = async (getUnitForProduct: (p: any) => { countingUnit: string; caseSize: number | null }) => {
      const { writeBatch: wb } = await import('firebase/firestore');
      const batch = wb(db);
      for (const product of newProducts) {
        const { countingUnit, caseSize } = getUnitForProduct(product);
        const newRef = doc(collection(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items'));
        batch.set(newRef, {
          name: product.name || '',
          unit: product.unit || null,
          supplierId: product.supplierId || null,
          supplierName: product.supplierName || null,
          productId: product.id || null,
          countingUnit,
          caseSize: caseSize ?? null,
          costPrice: product.costPrice || null,
          parLevel: product.parLevel || null,
          barcode: product.barcode || null,
          barcodeNumber: product.barcodeNumber || product.barcode || null,
          category: product.category || product.categorySuggested || null,
          brand: product.brand || null,
          size: product.size || null,
          inductionStatus: 'pending',
          inductionSource: 'venue-search-batch',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      hapticSuccess();
      setBatchAddToast(`✓ ${newProducts.length} product${newProducts.length !== 1 ? 's' : ''} added to ${areaName || 'area'}`);
    };

    // Offer choice before forcing a single counting unit on a mixed batch
    // TODO: restore "Set same unit for all" path when multi-action sheet is available.
    confirm({
      title: 'Counting units',
      message: `How would you like to set counting units for these ${newProducts.length} products?`,
      confirmLabel: "Use each product's own unit",
      onConfirm: () => {
        doBatchWrite(p => ({
          countingUnit: p.unit || 'unit',
          caseSize: p.packSize ? parseInt(String(p.packSize)) : null,
        })).catch((e: any) => toastService.error(e?.message || 'Could not add products.'));
      },
    });
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (!itemsPathOk) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colours.oat || '#f5f3ee' }} edges={['top', 'left', 'right']}>
        <Text style={{ fontSize: 16, textAlign: 'center' }}>Missing navigation params. Need venueId, departmentId and areaId.</Text>
      </SafeAreaView>
    );
  }

  const EmptyState = () => (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 17, fontWeight: '800', marginBottom: 4, color: '#0f172a' }}>
        No products in this area yet
      </Text>
      <Text style={{ color: '#6B7280', marginBottom: 16, fontSize: 13 }}>
        Add your first products to start counting
      </Text>
      {[
        { icon: '📱', title: 'Scan barcode', desc: 'Point at any barcode — instant lookup or add new', onPress: () => setBarcodeScanOpen(true) },
        { icon: '📷', title: 'Photograph this shelf', desc: "Take a photo — AI reads what's on the shelf", onPress: () => setCaptureShelfOpen(true) },
        /* PHOTOGRAPH_PRODUCT — hidden. Photo flow now triggered automatically after failed barcode scan. Code intact in ProductPhotoModal.tsx */
        { icon: '🔍', title: 'Search venue products', desc: 'Find a product already in your venue and add it here', onPress: () => setVenueSearchOpen(true) },
        { icon: '✏️', title: 'Add manually', desc: 'Type in the product name and details', onPress: () => nameInputRef.current?.focus() },
      ].map(card => (
        <TouchableOpacity
          key={card.icon}
          onPress={card.onPress}
          activeOpacity={0.75}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
            borderWidth: 1, borderColor: '#f1f5f9',
            shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
          }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#eef6ff', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18 }}>{card.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{card.title}</Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{card.desc}</Text>
          </View>
          <Text style={{ fontSize: 18, color: '#cbd5e1' }}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const ListFooter = () => (
    <View
      style={{
        padding: dens(12),
        borderTopWidth: 1,
        borderTopColor: '#eee',
        backgroundColor: '#fff',
        gap: 10,
      }}
    >
      {!isSubmitted && <TouchableOpacity
        onPress={openReview}
        disabled={submittingArea}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: '#E8F5E9',
          opacity: submittingArea ? 0.6 : 1,
        }}
      >
        <Text
          style={{
            textAlign: 'center',
            color: '#2E7D32',
            fontWeight: '800',
          }}
        >
          {submittingArea ? 'Submitting…' : '✅ Review & submit area'}
        </Text>
        <Text
          style={{
            marginTop: 4,
            textAlign: 'center',
            color: '#166534',
            fontSize: 12,
          }}
        >
          We’ll show you any missing items that will be saved as 0 before you
          finalise.
        </Text>
      </TouchableOpacity>}

      {!isSubmitted && <TouchableOpacity
        onPress={throttleAction(initAllZeros)}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: '#FFF7ED',
        }}
      >
        <Text
          style={{
            textAlign: 'center',
            color: '#C2410C',
            fontWeight: '800',
          }}
        >
          🟠 Initialise: set all uncounted to 0
        </Text>
      </TouchableOpacity>}

      <Text style={{ textAlign: 'center', color: '#666' }}>
        {countedCount}/{items.length} items counted
      </Text>
    </View>
  );

  // Unified search tiers
  const uTerm = unifiedSearch.trim().toLowerCase();
  const uTier1 = uTerm ? items.filter(it => (it.name || '').toLowerCase().includes(uTerm)) : [];
  const areaItemIds = new Set(items.map(it => it.id));
  const areaItemNames = new Set(items.map(it => (it.name || '').toLowerCase()));
  const uTier2 = uTerm
    ? venueProducts.filter(
        p => (p.name || '').toLowerCase().includes(uTerm) &&
             !areaItemIds.has(p.id) &&
             !areaItemNames.has((p.name || '').toLowerCase())
      ).slice(0, 5)
    : [];

  async function addTier2ToArea(product: any) {
    if (!venueId || !departmentId || !areaId) return;
    await ensureAreaStarted();
    setCountingUnitPending({
      name: product.name || '',
      unit: product.unit || undefined,
      supplierName: product.supplierName || undefined,
      productId: product.id,
      costPrice: product.costPrice || undefined,
      caseSize: product.caseSize || null,
      write: async ({ countingUnit, caseSize }) => {
        const itemData = {
          name: product.name || '',
          unit: product.unit || null,
          supplierName: product.supplierName || null,
          productId: product.id || null,
          countingUnit,
          caseSize: caseSize ?? null,
          inductionStatus: 'pending',
          inductionSource: 'venue-search',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        console.log('[SearchBar] writing fields:', Object.keys(itemData));
        try {
          await addDoc(
            collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items'),
            itemData,
          );
          setUnifiedSearch('');
        } catch (error: any) {
          console.error('[SearchBar] write failed:', error);
          toastService.error('Could not add product. Please try again.');
        }
      },
    });
    setCountingUnitVisible(true);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colours.oat || '#f5f3ee' }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={{ flex: 1 }}>
      <OfflineBanner />
      <HintBubble id="stocktake_save_indicator" style={{ marginHorizontal: 12, marginTop: 8 }} />

      {/* Unified search bar + dropdown */}
      <View style={{ marginHorizontal: 12, marginBottom: 2, zIndex: 200 }}>
        <TextInput
          value={unifiedSearch}
          onChangeText={setUnifiedSearch}
          placeholder="Find or add a product…"
          placeholderTextColor="#94a3b8"
          style={{
            backgroundColor: '#f8fafc', borderRadius: 10, paddingHorizontal: 12,
            paddingVertical: 9, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0', color: '#0f172a',
          }}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {unifiedSearch.trim().length > 0 && (
          <View style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
            backgroundColor: '#fff', borderRadius: 10, marginTop: 4,
            borderWidth: 1, borderColor: '#e2e8f0', maxHeight: 300,
            shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
          }}>
            {/* Tier 1 — In this area */}
            {uTier1.length > 0 && (
              <>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>In this area</Text>
                {uTier1.slice(0, 5).map(it => (
                  <TouchableOpacity
                    key={it.id}
                    onPress={() => {
                      setUnifiedSearch('');
                      const idx = filtered.findIndex(x => x.id === it.id);
                      if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
                    }}
                    style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}
                  >
                    <Text style={{ fontWeight: '600', color: '#0f172a' }}>{it.name}</Text>
                    {it.unit ? <Text style={{ fontSize: 11, color: '#94a3b8' }}>{it.unit}</Text> : null}
                  </TouchableOpacity>
                ))}
              </>
            )}
            {/* Tier 2 — In venue, not in this area */}
            {uTier2.length > 0 && (
              <>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#1b4f72', textTransform: 'uppercase', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>Add to this area</Text>
                {uTier2.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => addTier2ToArea(p)}
                    style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <View>
                      <Text style={{ fontWeight: '600', color: '#0f172a' }}>{p.name}</Text>
                      {p.unit ? <Text style={{ fontSize: 11, color: '#94a3b8' }}>{p.unit}</Text> : null}
                    </View>
                    <Text style={{ color: '#1b4f72', fontWeight: '700', fontSize: 13 }}>+ Add</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {/* Tier 3 — Not found */}
            {uTier1.length === 0 && uTier2.length === 0 && (
              <TouchableOpacity
                onPress={() => {
                  const term = unifiedSearch.trim();
                  setUnifiedSearch('');
                  setAddingName(term);
                  setTimeout(() => nameInputRef.current?.focus(), 100);
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 12 }}
              >
                <Text style={{ color: '#1b4f72', fontWeight: '700' }}>+ Add "{unifiedSearch.trim()}" as new product</Text>
                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Opens quick add with name pre-filled</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Pre-count nudge — shows when data is missing */}
      {!areaStarted && !nudgeDismissed && enrichmentComplete && (!invoiceDataAvailable || !salesDataAvailable) && (
        <View style={{
          backgroundColor: '#fffbeb',
          borderBottomWidth: 1,
          borderBottomColor: '#c47b2b',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={{ fontSize: 16 }}>💡</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400e', marginBottom: 4 }}>
                {!invoiceDataAvailable && !salesDataAvailable
                  ? 'No deliveries or sales data for this cycle'
                  : !salesDataAvailable
                  ? 'No sales data for this cycle'
                  : 'No delivery data for this cycle'}
              </Text>
              <Text style={{ fontSize: 12, color: '#92400e', lineHeight: 17, marginBottom: 10 }}>
                {!invoiceDataAvailable && !salesDataAvailable
                  ? 'Expected counts are based on your last stocktake only. Add invoices and a sales report for more accurate expected counts.'
                  : !salesDataAvailable
                  ? 'Expected counts include deliveries but not sales. Upload a sales report or connect your POS for full accuracy.'
                  : 'Expected counts include sales but no deliveries have been recorded this cycle.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {!salesDataAvailable && (
                  <TouchableOpacity
                    onPress={() => nav.navigate('SalesImport' as never)}
                    style={{
                      backgroundColor: '#c47b2b',
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                      Upload sales →
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setNudgeDismissed(true)}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: '#c47b2b',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#92400e' }}>
                    Count anyway
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Confidence legend — shown pre-count when invoice or sales data is available */}
      {!areaStarted && !confidenceLegendDismissed && (invoiceDataAvailable || salesDataAvailable) && (
        <View style={{
          backgroundColor: '#f9fafb',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 4 }}>
              Expected count confidence
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#16a34a' }} />
                <Text style={{ fontSize: 11, color: '#6b7280' }}>Sales + deliveries</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#c47b2b' }} />
                <Text style={{ fontSize: 11, color: '#6b7280' }}>Partial data</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#9ca3af' }} />
                <Text style={{ fontSize: 11, color: '#6b7280' }}>Last count only</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity onPress={() => setConfidenceLegendDismissed(true)} style={{ padding: 4 }}>
            <Text style={{ fontSize: 18, color: '#9ca3af' }}>×</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Edit window status banner */}
      {isSubmitted && editWindowOpen && (
        <View style={{ backgroundColor: '#FEF3C7', borderBottomWidth: 1, borderBottomColor: '#F59E0B', paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ fontWeight: '800', color: '#92400E', fontSize: 13 }}>✏️ Submitted — corrections open</Text>
          <Text style={{ color: '#92400E', fontSize: 12, marginTop: 1 }}>
            Editable for {windowMinutesLeft} minute{windowMinutesLeft !== 1 ? 's' : ''} · All changes are logged
          </Text>
        </View>
      )}
      {isSubmitted && !editWindowOpen && !overrideActive && (
        <View style={{ backgroundColor: '#F3F4F6', borderBottomWidth: 1, borderBottomColor: '#D1D5DB', paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontWeight: '800', color: '#374151', fontSize: 13 }}>🔒 Submitted and locked</Text>
            <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 1 }}>Edit window has closed</Text>
          </View>
          {isManager && (
            <TouchableOpacity
              onPress={() => { setOverrideReasonInput(''); setOverrideModalOpen(true); }}
              style={{ backgroundColor: '#374151', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Manager override</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {isSubmitted && overrideActive && (
        <View style={{ backgroundColor: '#FDF2F8', borderBottomWidth: 1, borderBottomColor: '#D946EF', paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ fontWeight: '800', color: '#86198F', fontSize: 13 }}>🔓 Manager override active</Text>
          <Text style={{ color: '#86198F', fontSize: 12, marginTop: 1 }}>All changes logged · Reason: {currentOverrideReason}</Text>
        </View>
      )}

      {/* Voice session banner — amber=listening, teal=matched, green=saved, hidden=off */}
      <VoiceSessionBanner state={voiceSessionState} speechEnabled={voiceSpeechEnabled} onToggleSpeech={onToggleVoiceSpeech} />

      <FlatList
        ref={listRef}
        data={filtered}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
        renderItem={({ item }) => (
          <Row
            item={item}
            isCompact={isCompact}
            dens={dens}
            areaStarted={areaStarted}
            showExpected={showExpected}
            showSteppers={showSteppers}
            isManager={isManager}
            localQty={localQty}
            setLocalQty={setLocalQty}
            inputRefs={inputRefs}
            setFocusedInputId={setFocusedInputId}
            setLastTouchedItemId={setLastTouchedItemId}
            onEstimateBottleLevel={handleEstimateBottleLevelForItem}
            setMenuFor={setMenuFor}
            openEditItem={openEditItem}
            openAdjustment={openAdjustment}
            deriveExpected={deriveExpected}
            countedInThisCycle={countedInThisCycle}
            clampNonNegative={clampNonNegative}
            approveNow={approveNow}
            isLocked={isSubmitted && !canEdit}
            isEdited={editedItemIds.has(item.id)}
            isHighlighted={highlightedItemIds.has(item.id) || highlightedVoiceItemId === item.id}
            confidenceDot={getConfidenceDot(item, invoiceDataAvailable, salesDataAvailable)}
          />
        )}
        ListHeaderComponent={
          <AreaInvHeader
            areaName={areaName}
            isCompact={isCompact}
            dens={dens}
            startedAt={areaMeta?.startedAt?.toDate ? areaMeta.startedAt.toDate() : (areaMeta?.startedAt?._seconds ? new Date(areaMeta.startedAt._seconds * 1000) : null)}
            lastActivityDate={lastActivityDate}
            offline={offline}
            legendDismissed={legendDismissed}
            dismissLegend={dismissLegend}
            stats={{ countedCount, total: items.length, lowCount, flaggedCount, progressPct }}
            onOpenMore={() => setMoreOpen(true)}
          />
        }
        ListFooterComponent={<ListFooter />}
        ListEmptyComponent={<EmptyState />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        removeClippedSubviews={false}
        onScrollBeginDrag={() => {
          const cur = focusedInputId;
          if (cur && inputRefs.current[cur]) {
            inputRefs.current[cur].blur?.();
          }
        }}
      />

      {/* Completion banner */}
      <Animated.View style={{
        transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [100, 0] }) }],
        opacity: bannerAnim,
        backgroundColor: '#1b4f72',
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        paddingHorizontal: 16, paddingVertical: 12,
        display: showBanner ? 'flex' : 'none',
      }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, marginBottom: 2 }}>
          ✓ {areaName || 'Area'} looking complete
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginBottom: 10 }}>
          {countedCount} product{countedCount !== 1 ? 's' : ''} counted
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 10, alignItems: 'center' }}
            onPress={openReview}
            disabled={submittingArea}
          >
            <Text style={{ color: '#1b4f72', fontWeight: '800', fontSize: 13 }}>
              {submittingArea ? 'Submitting…' : 'Submit this area'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 999, paddingVertical: 10, alignItems: 'center' }}
            onPress={() => setBannerDismissed(true)}
          >
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 13 }}>Keep counting</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Anchored bottom bar */}
      <View
        onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
        style={{
          flexDirection: 'row', backgroundColor: '#f5f3ee',
          borderTopWidth: 1, borderTopColor: '#e5e1d8',
          paddingTop: 8, paddingBottom: (Platform.OS === 'ios' ? 8 : 12) + insets.bottom,
          paddingHorizontal: 4,
        }}
      >
        {[
          { icon: '➕', label: 'Add', onPress: () => setAddSheetOpen(true) },
          { icon: '📷', label: 'Barcode', onPress: () => setBarcodeScanOpen(true) },
          { icon: '📸', label: 'Shelf', onPress: () => setCaptureShelfOpen(true) },
          {
            icon: voiceSessionState.isActive ? '🔴' : '🎤',
            label: 'Hands-free',
            onPress: voiceAvailable
              ? toggleVoiceSession
              : () => showInfo('Voice counting is available in the full release build.'),
            dim: !voiceAvailable,
          },
          { icon: '⚡', label: 'Scale', onPress: () => nav.navigate('ScaleSettings' as never) },
          { icon: '🤖', label: 'AI Count', onPress: openPhotoCountSheet, dim: bottleLevelBusy },
        ].map(btn => (
          <TouchableOpacity
            key={btn.label}
            onPress={btn.onPress}
            activeOpacity={0.7}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 4, opacity: (btn as any).dim ? 0.35 : 1 }}
          >
            <Text style={{ fontSize: 20 }}>{btn.icon}</Text>
            <Text style={{ fontSize: 10, fontWeight: '600', color: '#1b4f72', marginTop: 2 }}>{btn.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* AI photo count — choose between discrete counting and bottle fill estimate */}
      <Modal visible={photoCountSheetOpen} animationType="fade" transparent onRequestClose={() => setPhotoCountSheetOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, width: '100%', maxWidth: 420, padding: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 8 }} numberOfLines={1}>
              AI photo count{resolvePhotoCountTarget() ? ` — ${resolvePhotoCountTarget()!.name}` : ''}
            </Text>

            {resolvePhotoCountTarget() ? (
              <>
                <TouchableOpacity onPress={handleCountItemsOnShelf} style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#FFF8E1', marginBottom: 8 }}>
                  <Text style={{ fontWeight: '800', color: '#9A3412' }}>📷 Count items on shelf</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleEstimateBottleLevel} style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F0FFF4', marginBottom: 8 }}>
                  <Text style={{ fontWeight: '800', color: '#14532D' }}>🍾 Estimate bottle fill level</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={{ color: colours.slateMid, textAlign: 'center', paddingVertical: 10, marginBottom: 8 }}>
                Tap a product's count field first, then tap AI Count again.
              </Text>
            )}

            <TouchableOpacity onPress={() => setPhotoCountSheetOpen(false)} style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F3F4F6' }}>
              <Text style={{ fontWeight: '700', color: '#111827', textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
              <TextInput value={adjQty} onChangeText={setAdjQty} placeholder="e.g. 21" keyboardType="decimal-pad" inputMode="decimal"
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

      {/* Bluetooth Scale Modal */}
      <Modal visible={!!scaleModalFor} animationType="slide" transparent onRequestClose={closeScaleModal}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colours.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 10, color: colours.text }} numberOfLines={1}>
              Bluetooth Scale — {scaleModalFor?.name ?? 'Item'}
            </Text>

            {scaleModalPhase === 'checking' && (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color={colours.primary} />
              </View>
            )}

            {scaleModalPhase === 'reconnecting' && (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color={colours.primary} />
                <Text style={{ marginTop: 10, color: colours.textSecondary }}>
                  Reconnecting to {scaleReconnectName || 'your scale'}…
                </Text>
              </View>
            )}

            {scaleModalPhase === 'unavailable' && (
              <View>
                <Text style={{ color: colours.textSecondary, marginBottom: 14, lineHeight: 20 }}>
                  {scaleReconnectName
                    ? `Couldn't reconnect to ${scaleReconnectName}. Make sure it's powered on and in range, or pair it again in Scale Settings.`
                    : 'No Bluetooth scale paired yet. Pair one in Scale Settings to enable weight-based counting.'}
                </Text>
                <TouchableOpacity onPress={() => { closeScaleModal(); nav.navigate('ScaleSettings' as never); }}
                  style={{ backgroundColor: colours.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ color: colours.primaryText, fontWeight: '800' }}>Open Scale Settings</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={closeScaleModal} style={{ padding: 10, alignItems: 'center' }}>
                  <Text style={{ color: colours.textSecondary, fontWeight: '700' }}>Close</Text>
                </TouchableOpacity>
              </View>
            )}

            {scaleModalPhase === 'live' && (
              <View>
                <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                  <Text style={{ fontSize: 48, fontWeight: '900', color: colours.text }}>
                    {scaleWeight != null ? scaleWeight.toFixed(1) : '—'}
                    <Text style={{ fontSize: 18, color: colours.textSecondary }}> g</Text>
                  </Text>
                  {scaleStable ? (
                    <Text style={{ color: colours.success, fontWeight: '700', marginTop: 4 }}>Stable ✓</Text>
                  ) : scaleWeight != null ? (
                    <Text style={{ color: colours.warning, fontWeight: '700', marginTop: 4 }}>Settling...</Text>
                  ) : (
                    <Text style={{ color: colours.textSecondary, marginTop: 4 }}>Waiting for reading…</Text>
                  )}
                </View>

                {scaleConversionMsg && (
                  <View style={{ backgroundColor: colours.negativeSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
                    <Text style={{ color: colours.error, fontSize: 13 }}>{scaleConversionMsg}</Text>
                  </View>
                )}

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={onScaleTare}
                    style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.border, alignItems: 'center' }}>
                    <Text style={{ fontWeight: '800', color: colours.text }}>Tare</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={useScaleWeightForItem} disabled={scaleWeight == null}
                    style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: scaleWeight == null ? colours.border : colours.primary, alignItems: 'center' }}>
                    <Text style={{ fontWeight: '800', color: scaleWeight == null ? colours.textSecondary : colours.primaryText }}>Use this weight</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={closeScaleModal} style={{ padding: 12, alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ color: colours.textSecondary, fontWeight: '700' }}>Close</Text>
                </TouchableOpacity>
              </View>
            )}
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
              <View style={{ gap:8 }}>
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
              </View>
            )}

            <TouchableOpacity onPress={closeHistory} style={{ marginTop:12, alignSelf:'center', paddingVertical:10, paddingHorizontal:16, borderRadius:10, backgroundColor:'#E5E7EB' }}>
              <Text style={{ fontWeight:'700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manager Override Modal */}
      <Modal visible={overrideModalOpen} animationType="slide" transparent onRequestClose={() => setOverrideModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 8 }}>Manager override</Text>
            <Text style={{ color: '#6B7280', marginBottom: 12 }}>
              The edit window has closed. You can make corrections — all changes will be logged with your name and reason.
            </Text>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontWeight: '600', marginBottom: 4 }}>Reason for override</Text>
              <TextInput
                value={overrideReasonInput}
                onChangeText={setOverrideReasonInput}
                placeholder="e.g. Miscounted during handover"
                style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 10 }}
                autoFocus
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setOverrideModalOpen(false)} style={{ padding: 12, borderRadius: 10, backgroundColor: '#ECEFF1', flex: 1 }}>
                <Text style={{ textAlign: 'center', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (!overrideReasonInput.trim()) { showInfo('Please enter a reason for the override.'); return; }
                  setCurrentOverrideReason(overrideReasonInput.trim());
                  setOverrideActive(true);
                  setOverrideModalOpen(false);
                  // Write override fields to area doc
                  const cu = getAuth().currentUser;
                  updateDoc(doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId), {
                    managerOverride: true,
                    overrideBy: cu?.uid ?? 'unknown',
                    overrideAt: serverTimestamp(),
                    overrideReason: overrideReasonInput.trim(),
                  }).catch(() => {});
                }}
                style={{ padding: 12, borderRadius: 10, backgroundColor: '#374151', flex: 1 }}
              >
                <Text style={{ textAlign: 'center', color: '#fff', fontWeight: '800' }}>Unlock for editing</Text>
              </TouchableOpacity>
            </View>
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
                  keyboardType="decimal-pad"
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
            <TouchableOpacity onPress={()=>{ setMenuFor(null); setTimeout(()=>setCaptureShelfOpen(true), 0); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F0FFF4', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#14532D' }}>📷 Photograph shelf</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{ setMenuFor(null); setTimeout(()=>setCaptureProductOpen(true), 0); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#FEFCE8', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#92400E' }}>📸 Add product by photo</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>{ const it = menuFor!; setMenuFor(null); setTimeout(()=>{ setCountingUnitForItem(it); setCountingUnitVisible(true); }, 0); }} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#EDE9FE', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#5B21B6' }}>Change counting unit</Text>
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
        <View style={{ position:'absolute', left:12, right:12, bottom:16 + insets.bottom, backgroundColor:'#111827', borderRadius:12, padding:12, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
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

      {/* --- Connection banner (absolute overlay) --- */}
      {offline ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16, right: 16,
            bottom: (showSteppers && focusedInputId) ? 120 : 56,
            borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
            backgroundColor: '#F59E0B',
            shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
            elevation: 2
          }}
        >
          <Text style={{ color: '#111827', fontWeight: '800' }}>Offline</Text>
          <Text style={{ color: '#111827', opacity: 0.85 }}>Changes will sync when reconnected</Text>
        </View>
      ) : null}

      {!offline && onlineToastVisible ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 16, right: 16,
            bottom: (showSteppers && focusedInputId) ? 120 : 56,
            transform: [{ translateY: onlineAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            opacity: onlineAnim
          }}
        >
          <View
            style={{
              borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
              backgroundColor: '#10B981',
              shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
              elevation: 2
            }}
          >
            <Text style={{ color: 'white', fontWeight: '800' }}>Online</Text>
            <Text style={{ color: 'white', opacity: 0.9 }}>All changes synced</Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Keyboard Accessory */}
      {showSteppers && focusedInputId ? (
        <View style={{ position:'absolute', left:12, right:12, bottom: bottomBarHeight + 8, backgroundColor:'#F3F4F6', borderRadius:14, padding:8, flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderWidth:1, borderColor:'#E5E7EB' }}>
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
        style={{ position:'absolute', right:16, bottom: bottomBarHeight + (showSteppers && focusedInputId ? 64 : 0) + 12, backgroundColor:'#0A84FF', paddingVertical:12, paddingHorizontal:14, borderRadius:28, elevation:4 }}
        activeOpacity={0.9}
      >
        <Text style={{ color:'white', fontWeight:'900' }}>Next</Text>
      </TouchableOpacity>

      {/* Pre-Submit Review Modal (polished) */}
<Modal
  visible={reviewOpen}
  animationType="slide"
  transparent
  onRequestClose={() => setReviewOpen(false)}
>
  <View
    style={{
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'flex-end',
    }}
  >
    <View
      style={{
        backgroundColor: '#fff',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 16,
        maxHeight: '80%',
      }}
    >
      {/* Make the content scrollable so Submit is always reachable */}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
          Review before submit
        </Text>
        <Text style={{ color: '#374151', marginBottom: 10 }}>
          {countedCount}/{items.length} counted • {lowCount} low •{' '}
          {flaggedCount} flagged • {progressPct}%
        </Text>

        <View style={{ gap: 10 }}>
          <View
            style={{
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 10,
              padding: 10,
            }}
          >
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>
              Counted this cycle ({reviewCounted.length})
            </Text>
            {reviewCounted.length === 0 ? (
              <Text style={{ color: '#6B7280' }}>
                No items have been counted yet.
              </Text>
            ) : (
              reviewCounted.map((it) => (
                <TouchableOpacity
                  key={it.id}
                  onPress={() => {
                    setReviewOpen(false);
                    setTimeout(
                      () => inputRefs.current[it.id]?.focus?.(),
                      80,
                    );
                  }}
                  style={{ paddingVertical: 6 }}
                >
                  <Text style={{ fontWeight: '700' }}>{it.name}</Text>
                  <Text style={{ color: '#374151' }}>
                    Count: {localQty[it.id] ?? '—'}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 10,
              padding: 10,
            }}
          >
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>
              Will be saved as 0
            </Text>
            {reviewMissing.length === 0 ? (
              <Text style={{ color: '#6B7280' }}>
                None — all items have been counted.
              </Text>
            ) : (
              <>
                {reviewMissing.slice(0, 3).map((it) => (
                  <TouchableOpacity
                    key={it.id}
                    onPress={() => {
                      setReviewOpen(false);
                      setTimeout(
                        () => inputRefs.current[it.id]?.focus?.(),
                        80,
                      );
                    }}
                    style={{ paddingVertical: 6 }}
                  >
                    <Text style={{ fontWeight: '700' }}>{it.name}</Text>
                    <Text style={{ color: '#6B7280' }}>Tap to jump to it</Text>
                  </TouchableOpacity>
                ))}
                {reviewMissing.length > 3 ? (
                  <Text style={{ color: '#6B7280', marginTop: 4 }}>
                    and {reviewMissing.length - 3} more…
                  </Text>
                ) : null}
              </>
            )}
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: '#E5E7EB',
              borderRadius: 10,
              padding: 10,
            }}
          >
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>
              Flagged for recount ({reviewFlagged.length})
            </Text>
            {reviewFlagged.length === 0 ? (
              <Text style={{ color: '#6B7280' }}>
                No items are flagged.
              </Text>
            ) : (
              reviewFlagged.map((it) => (
                <TouchableOpacity
                  key={it.id}
                  onPress={() => {
                    setReviewOpen(false);
                    setTimeout(
                      () => inputRefs.current[it.id]?.focus?.(),
                      80,
                    );
                  }}
                  style={{ paddingVertical: 6 }}
                >
                  <Text style={{ fontWeight: '700' }}>{it.name}</Text>
                  <Text style={{ color: '#92400E' }}>
                    Marked “Recount”
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => setReviewOpen(false)}
            style={{
              padding: 12,
              borderRadius: 10,
              backgroundColor: '#ECEFF1',
              flex: 1,
            }}
          >
            <Text style={{ textAlign: 'center', fontWeight: '700' }}>
              Back to counting
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setReviewOpen(false);
              throttleAction(completeArea)();
            }}
            disabled={submittingArea}
            style={{
              padding: 12,
              borderRadius: 10,
              backgroundColor: submittingArea ? '#16A34A99' : colours.success,
              flex: 1,
            }}
          >
            <Text
              style={{
                textAlign: 'center',
                color: '#fff',
                fontWeight: '800',
              }}
            >
              {submittingArea ? 'Submitting…' : 'Submit now'}
            </Text>
          </TouchableOpacity>
        </View>

        {countedCount > 0 ? (
          <TouchableOpacity
            onPress={exportCsvChangesOnly}
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 10,
              backgroundColor: '#DBEAFE',
            }}
          >
            <Text
              style={{
                textAlign: 'center',
                color: '#1E40AF',
                fontWeight: '800',
              }}
            >
              Export CSV — Changes only
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
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
                <Text style={{ color: colours.navy, fontWeight: '600' }}>OK</Text>
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
                <Text style={{ color: colours.navy, fontWeight: '600' }}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ⋯ More action sheet — view settings only */}
      <Modal visible={moreOpen} animationType="fade" transparent onRequestClose={()=>setMoreOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', alignItems:'center', padding:16 }}>
          <View style={{ backgroundColor:'#fff', borderRadius:12, width:'100%', maxWidth:420, padding:12 }}>
            <Text style={{ fontSize:16, fontWeight:'800', marginBottom:8 }}>View settings</Text>

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

            <TouchableOpacity onPress={()=>setShowExpected(v=>!v)} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F1F8E9', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#14532D' }}>
                {showExpected ? '✓ Show expected (on)' : 'Show expected (off)'}
              </Text>
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

            <TouchableOpacity onPress={exportCsvAll} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#EFF6FF', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#1D4ED8' }}>Export CSV — Current view</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={exportCsvChangesOnly} style={{ paddingVertical:10, paddingHorizontal:12, borderRadius:10, backgroundColor:'#DBEAFE', marginBottom:8 }}>
              <Text style={{ fontWeight:'800', color:'#1E40AF' }}>Export CSV — Changes only</Text>
            </TouchableOpacity>

            <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
              <TouchableOpacity onPress={()=>setMoreOpen(false)} style={{ padding:10, backgroundColor:'#E5E7EB', borderRadius:10, flex:1 }}>
                <Text style={{ textAlign:'center', fontWeight:'800', color:'#374151' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ➕ Add Product options sheet */}
      <Modal visible={addSheetOpen} animationType="slide" transparent onRequestClose={()=>setAddSheetOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:16, paddingBottom:32 }}>
            <Text style={{ fontSize:17, fontWeight:'800', color:'#0f172a', marginBottom:4 }}>Add a product</Text>
            <Text style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>Choose how you want to add to this area</Text>

            {[
              { icon: '🔍', label: 'Search venue products', desc: 'Find a product already in your venue', onPress: ()=>{ setAddSheetOpen(false); setTimeout(()=>setVenueSearchOpen(true), 0); } },
              { icon: '📷', label: 'Scan barcode', desc: 'Point at any barcode — instant lookup or add new', onPress: ()=>{ setAddSheetOpen(false); setTimeout(()=>setBarcodeScanOpen(true), 0); } },
              /* PHOTOGRAPH_PRODUCT — hidden. Photo flow now triggered automatically after failed barcode scan. Code intact in ProductPhotoModal.tsx */
              { icon: '🖼️', label: 'Scan shelf section', desc: 'Take a photo — AI reads what\'s on the shelf', onPress: ()=>{ setAddSheetOpen(false); setTimeout(()=>setCaptureShelfOpen(true), 0); } },
              { icon: '✏️', label: 'Quick add manually', desc: 'Type in a product name and count', onPress: ()=>{ setAddSheetOpen(false); setTimeout(()=>{ setAddingName(''); setAddingUnit(''); setAddingQty(''); setAddingBarcode(''); setQuickAddSheetOpen(true); }, 0); } },
            ].map(opt => (
              <TouchableOpacity
                key={opt.label}
                onPress={opt.onPress}
                activeOpacity={0.75}
                style={{ flexDirection:'row', alignItems:'center', gap:12, paddingVertical:12, borderTopWidth:1, borderTopColor:'#f1f5f9' }}
              >
                <View style={{ width:40, height:40, borderRadius:20, backgroundColor:'#f0f9ff', alignItems:'center', justifyContent:'center' }}>
                  <Text style={{ fontSize:18 }}>{opt.icon}</Text>
                </View>
                <View style={{ flex:1 }}>
                  <Text style={{ fontSize:14, fontWeight:'700', color:'#0f172a' }}>{opt.label}</Text>
                  <Text style={{ fontSize:12, color:'#64748b', marginTop:1 }}>{opt.desc}</Text>
                </View>
                <Text style={{ fontSize:18, color:'#cbd5e1' }}>›</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={()=>setAddSheetOpen(false)} style={{ marginTop:12, paddingVertical:12, backgroundColor:'#f1f5f9', borderRadius:12, alignItems:'center' }}>
              <Text style={{ fontWeight:'700', color:'#374151' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ✏️ Quick Add manual sub-modal */}
      <Modal visible={quickAddSheetOpen} animationType="slide" transparent onRequestClose={()=>setQuickAddSheetOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:16, paddingBottom:32 }}>
            <Text style={{ fontSize:17, fontWeight:'800', color:'#0f172a', marginBottom:12 }}>Quick add</Text>

            <TextInput
              ref={nameInputRef}
              value={addingName}
              onChangeText={setAddingName}
              placeholder="Product name (required)"
              autoFocus
              style={{
                borderWidth:1, borderColor:'#e2e8f0', borderRadius:10,
                paddingHorizontal:12, paddingVertical:10, fontSize:15,
                color:'#0f172a', marginBottom:10,
              }}
              returnKeyType="next"
              blurOnSubmit={false}
            />

            <View style={{ flexDirection:'row', gap:8, marginBottom:10 }}>
              <TextInput
                value={addingUnit}
                onChangeText={setAddingUnit}
                placeholder="Unit (e.g. bottles)"
                style={{
                  flex:1, borderWidth:1, borderColor:'#e2e8f0', borderRadius:10,
                  paddingHorizontal:12, paddingVertical:10, fontSize:14, color:'#0f172a',
                }}
                returnKeyType="next"
                blurOnSubmit={false}
              />
              <TextInput
                value={addingQty}
                onChangeText={setAddingQty}
                placeholder="Count now"
                keyboardType="decimal-pad"
                inputMode="decimal"
                style={{
                  flex:1, borderWidth:1, borderColor:'#e2e8f0', borderRadius:10,
                  paddingHorizontal:12, paddingVertical:10, fontSize:14, color:'#0f172a',
                }}
                returnKeyType="done"
                blurOnSubmit={false}
                onSubmitEditing={() => { addQuickItem(); setQuickAddSheetOpen(false); }}
              />
            </View>

            <TextInput
              value={addingBarcode}
              onChangeText={setAddingBarcode}
              placeholder="Barcode (optional)"
              keyboardType="number-pad"
              style={{
                borderWidth:1, borderColor:'#e2e8f0', borderRadius:10,
                paddingHorizontal:12, paddingVertical:10, fontSize:14,
                color:'#0f172a', marginBottom:10,
              }}
              returnKeyType="done"
              blurOnSubmit={false}
            />

            <TouchableOpacity
              onPress={async () => { await addQuickItem(); setQuickAddSheetOpen(false); }}
              style={{ backgroundColor:'#1b4f72', borderRadius:12, paddingVertical:14, alignItems:'center', marginBottom:8 }}
            >
              <Text style={{ color:'#fff', fontWeight:'800', fontSize:15 }}>Add to area</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={()=>setQuickAddSheetOpen(false)} style={{ paddingVertical:12, alignItems:'center' }}>
              <Text style={{ color:'#64748b', fontWeight:'600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    
      <ShelfScanModal
        visible={captureShelfOpen}
        onClose={() => setCaptureShelfOpen(false)}
        venueId={venueId}
        areaName={areaName}
        onConfirm={handleShelfScanConfirm}
      />
      <ProductPhotoModal
        visible={captureProductOpen || photoModalBarcode !== null}
        onClose={() => { setCaptureProductOpen(false); setPhotoModalBarcode(null); }}
        venueId={venueId}
        areaName={areaName}
        initialBarcode={photoModalBarcode ?? undefined}
        onConfirm={handleProductPhotoConfirm}
      />
      <BarcodeScannerModal
        visible={barcodeScanOpen}
        onClose={() => setBarcodeScanOpen(false)}
        venueId={venueId}
        departmentId={departmentId}
        areaId={areaId}
        areaItems={items}
        onProductAddedToArea={() => { /* onSnapshot auto-refreshes items */ }}
        onOpenPhotoModal={(barcode) => { setPhotoModalBarcode(barcode); }}
        onManualEntry={(barcode) => {
          setAddingName('');
          setAddingUnit('');
          setAddingQty('');
          setAddingBarcode(barcode);
          setQuickAddSheetOpen(true);
        }}
        onBeforeAddToArea={(product, write) => {
          setBarcodeScanOpen(false);
          setTimeout(() => {
            setCountingUnitPending({
              name: product.name,
              unit: product.unit || undefined,
              productId: product.id,
              caseSize: product.caseSize ?? null,
              write: async ({ countingUnit, caseSize }) => {
                await write({ countingUnit, caseSize: caseSize ?? null });
              },
            });
            setCountingUnitVisible(true);
          }, 300);
        }}
      />
      <VenueProductSearchModal
        visible={venueSearchOpen}
        onClose={() => setVenueSearchOpen(false)}
        venueId={venueId}
        areaName={areaName}
        onSelect={handleVenueProductSelected}
        onBatchSelect={handleBatchVenueProductsSelected}
      />

      {/* Batch add toast */}
      {!!batchAddToast && (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 80, left: 16, right: 16, backgroundColor: '#10b981', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', zIndex: 999 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{batchAddToast}</Text>
        </View>
      )}

      {/* Counting unit picker — for new products and changing existing */}
      <CountingUnitModal
        visible={countingUnitVisible}
        productName={countingUnitForItem?.name ?? countingUnitPending?.name ?? ''}
        areaName={areaName}
        initialUnit={countingUnitForItem?.countingUnit as any ?? undefined}
        initialCaseSize={countingUnitForItem?.caseSize ?? undefined}
        suggestedCaseSize={countingUnitPending?.caseSize ?? undefined}
        onSave={async (config) => {
          setCountingUnitVisible(false);
          if (countingUnitForItem) {
            // Updating existing item's counting unit
            try {
              await updateDoc(
                doc(db, 'venues', venueId!, 'departments', departmentId, 'areas', areaId, 'items', countingUnitForItem.id),
                { countingUnit: config.countingUnit, caseSize: config.caseSize ?? null, updatedAt: serverTimestamp() }
              );
            } catch (e: any) { toastService.error(e?.message || 'Could not update.'); }
            setCountingUnitForItem(null);
          } else if (countingUnitPending) {
            try { await countingUnitPending.write(config); } catch (error: any) {
              console.error('[AreaInventory] write failed:', error);
              toastService.error('Could not add product. Please try again.');
            }
            setCountingUnitPending(null);
          }
        }}
        onCancel={() => {
          setCountingUnitVisible(false);
          // If pending add, save with default unit mode
          if (countingUnitPending && !countingUnitForItem) {
            countingUnitPending.write({ countingUnit: 'unit', caseSize: null }).catch((error: any) => {
              console.error('[AreaInventory] write failed (cancel path):', error);
              toastService.error('Could not add product. Please try again.');
            });
            setCountingUnitPending(null);
          }
          setCountingUnitForItem(null);
        }}
      />

      <ShelfPhotoModal
        visible={shelfPhotoOpen}
        onClose={() => setShelfPhotoOpen(false)}
        onCaptured={async ({ fileUri }) => {
          if (!venueId) throw new Error("Missing venueId");
          if (!uid) throw new Error("Missing user");
          if (offline) { showInfo('You are offline. Smart Shelf needs internet to upload.'); return; }

          const scanId = String(Date.now());
          setShelfLoading(true);
          setShelfOpen(true);

          const up = await uploadShelfScanPhoto({ venueId: venueId!, uid, scanId, fileUri });
          if (!up?.fullPath) throw new Error("Upload returned no fullPath");

          const job = await createShelfScanJob({
            venueId: venueId!,
            departmentId,
            areaId,
            areaNameSnapshot: areaName || null,
            storagePath: up.fullPath,
            createdBy: uid,
          });

          setShelfJobId(job.id);
          setShelfPhotoOpen(false);

          // TEMP (until backend exists): show placeholder proposal so UX is testable
          setShelfProposals([
            { key: "tmp1", name: "Example item (edit me)", itemId: null, count: 1, confidence: 0.5, isNew: true },
          ]);
          setShelfLoading(false);
        }}
      />

      <SmartShelfModal
        visible={shelfOpen}
        onClose={() => { setShelfOpen(false); setShelfJobId(null); setShelfProposals([]); setShelfLoading(false); }}
        jobId={shelfJobId}
        proposals={shelfProposals}
        loading={shelfLoading}
        onSubmit={async (rows) => {
          // Apply counts + add new items if needed
          if (!venueId) throw new Error("Missing venueId");
          await ensureAreaStarted();

          for (const r of rows) {
            // If matched to existing item: just save count
            if (r.itemId) {
              await updateDoc(doc(db,venues,venueId!,departments,departmentId,areas,areaId,items,r.itemId), { lastCount: Number(r.count), lastCountAt: serverTimestamp() });
              continue;
            }

            // New item: add to area, then save count
            const payload:any = {
              name: (r.name || ''
              ).trim(),
              inductionStatus: pending,
              inductionSource: 'smart-shelf-scan',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              lastCount: Number(r.count),
              lastCountAt: serverTimestamp(),
            };
            const colRef = collection(db,venues,venueId!,departments,departmentId,areas,areaId,items);
            await addDoc(colRef, payload);
          }

          showSuccess('✓ Shelf counts applied.');
        }}
      />

      {modal}

      <PhotoCountModal
        visible={photoOpen}
        onClose={() => { setPhotoOpen(false); setPhotoFor(null); }}
        item={photoFor}
        areaName={areaName || null}
        defaultCount={photoFor ? (typeof photoFor.lastCount === "number" ? photoFor.lastCount : null) : null}
        onCaptured={async ({ fileUri, count, note }) => {
          if (!photoFor) throw new Error('No item selected');
          if (!venueId) throw new Error('Missing venueId');

          if (offline) {
            showInfo('Offline. You can still save the count normally, but photo evidence needs internet.');
            return;
          }

          const up = await uploadStockTakePhoto({
            venueId: venueId!,
            areaId,
            itemId: photoFor.id,
            fileUri,
          });

          const storagePath = up?.fullPath || '';
          if (!storagePath) throw new Error('Photo upload returned no fullPath');

          const uid = (getAuth()?.currentUser && getAuth().currentUser.uid) ? getAuth().currentUser.uid : null;

          await createStockTakePhotoDoc({
            venueId: venueId!,
            departmentId: departmentId || null,
            areaId,
            areaNameSnapshot: ((route?.params && (route.params as any).areaName) ? (route.params as any).areaName : null),
            areaStartedAtMs: null,

            itemId: photoFor.id,
            itemNameSnapshot: photoFor?.name || null,
            unitSnapshot: photoFor?.unit || null,

            count: Number(count),
            note: (note || '').trim() ? (note || '').trim() : null,

            storagePath,
            createdBy: uid,
          });

          setLocalQty((m) => ({ ...m, [photoFor.id]: String(count) }));
          // Count stored in localQty; written to Firestore on area submit
}}
      />

      </View>
      </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default withErrorBoundary(StockTakeAreaInventoryScreen, 'Area Inventory');
