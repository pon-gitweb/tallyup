// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import DateTimePicker from '@react-native-community/datetimepicker';
import { doc, setDoc, getDoc, getDocs, collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { determineCycleLength, getCycleConfig } from '../../services/festival/cycleConfig';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { SectionHeader, ItemRow, ProgressLine } from './components/SetupAccordion';

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { id: 'music_festival', label: 'Music festival' },
  { id: 'food_wine',      label: 'Food and wine' },
  { id: 'fringe_arts',    label: 'Fringe / arts' },
  { id: 'corporate',      label: 'Corporate event' },
  { id: 'community',      label: 'Community event' },
  { id: 'other',          label: 'Other' },
];

const STOCK_MODELS = [
  { id: 'sale_or_return', label: 'Sale or return',           sub: 'Unsold stock returned to supplier' },
  { id: 'venue_owned',    label: 'Venue owned',              sub: 'You purchase and own all stock' },
  { id: 'consignment',    label: 'Consignment',              sub: 'Pay for what you sell after the event' },
  { id: 'mixed',          label: 'Mixed (varies by supplier)', sub: 'Different arrangements per supplier' },
];

const LOCATION_TYPES = [
  { id: '20ft_container', label: '20ft container',          l: '5.9',  w: '2.35', h: '2.4' },
  { id: '40ft_container', label: '40ft container',          l: '12.0', w: '2.35', h: '2.4' },
  { id: 'ref_20ft',       label: 'Refrigerated 20ft',       l: '5.9',  w: '2.35', h: '2.4' },
  { id: 'ref_40ft',       label: 'Refrigerated 40ft',       l: '12.0', w: '2.35', h: '2.4' },
  { id: 'cool_room',      label: 'Cool room / walk-in chiller', l: '', w: '', h: '' },
  { id: 'dry_store',      label: 'Dry store',               l: '', w: '', h: '' },
  { id: 'custom',         label: 'Custom',                  l: '', w: '', h: '' },
];

const CATEGORIES = [
  { id: 'beer_cans',     label: 'Beer (cans/bottles)' },
  { id: 'beer_draught',  label: 'Beer (draught/keg)' },
  { id: 'wine_still',    label: 'Wine (still)' },
  { id: 'wine_sparkling',label: 'Wine (sparkling)' },
  { id: 'spirits',       label: 'Spirits' },
  { id: 'rtd',           label: 'RTD / premix' },
  { id: 'non_alcoholic', label: 'Non-alcoholic' },
  { id: 'cocktails',     label: 'Cocktails' },
  { id: 'cider',         label: 'Cider' },
];

const PRICE_POSITIONS = [
  { id: 'budget',    label: 'Budget',     sub: 'Value brands' },
  { id: 'mid_range', label: 'Mid-range',  sub: 'Mainstream brands' },
  { id: 'premium',   label: 'Premium',    sub: 'Craft / premium brands' },
  { id: 'mixed',     label: 'Mixed',      sub: 'Varies by bar' },
];

const RETURN_POLICIES = [
  { id: 'sale_or_return',   label: 'Sale or return' },
  { id: 'no_returns',       label: 'No returns' },
  { id: 'partial_returns',  label: 'Partial returns (negotiated)' },
  { id: 'consignment',      label: 'Consignment' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type BarForm = {
  id: string; name: string; location: string;
  fridgeService: string; fridgeDisplay: string; fridgeUnderBar: string;
};

type LocationForm = {
  id: string; name: string; type: string;
  dimensionL: string; dimensionW: string; dimensionH: string;
  hasAisle: boolean; aisleWidth: string; barsServed: string[];
};

type Progress = {
  basics: boolean; bars: boolean; sourceLocations: boolean;
  productPlanning: boolean; suppliers: boolean; historicalData: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFirstIncompleteSection(prog: Progress): number {
  if (!prog.basics)          return 1;
  if (!prog.bars)            return 2;
  if (!prog.sourceLocations) return 3;
  if (!prog.suppliers)       return 4;
  if (!prog.productPlanning) return 5;
  if (!prog.historicalData)  return 6;
  return 1; // all complete — unchanged behaviour for initial-load use
}

function getNextSection(prog: Progress): number {
  if (!prog.basics)          return 1;
  if (!prog.bars)            return 2;
  if (!prog.sourceLocations) return 3;
  if (!prog.suppliers)       return 4;
  if (!prog.productPlanning) return 5;
  if (!prog.historicalData)  return 6;
  return 0; // all complete — collapse all
}

// ─── Small UI helpers (unchanged) ─────────────────────────────────────────────

function RadioCard({ label, sub, selected, onPress }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={[S.radio, selected && S.radioSelected]}>
      <Text style={[S.radioLabel, selected && S.radioLabelSelected]}>
        {selected ? '●' : '○'} {label}
      </Text>
      {sub ? <Text style={S.radioSub}>{sub}</Text> : null}
    </TouchableOpacity>
  );
}

function Chip({ label, selected, onPress }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={[S.chip, selected && S.chipOn]}>
      <Text style={[S.chipText, selected && S.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function LockedBox({ text }: { text: string }) {
  return (
    <View style={S.lockedBox}>
      <Text style={S.lockedText}>{text}</Text>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function FestivalEventSetupScreen() {
  const venueId    = useVenueId();
  const navigation = useNavigation<any>();
  const c          = useColours();
  const headerHeight = useHeaderHeight();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();

  // ── Section 1 state ──────────────────────────────────────────────────────
  const [eventName,      setEventName]      = useState('');
  const [eventType,      setEventType]      = useState('music_festival');
  const [startDate,      setStartDate]      = useState('');
  const [endDate,        setEndDate]        = useState('');
  const [dailyAttend,    setDailyAttend]    = useState('');
  const [numBars,        setNumBars]        = useState('1');
  const [stockModel,     setStockModel]     = useState('sale_or_return');
  const [cycleOverride,  setCycleOverride]  = useState<string>('');
  const [totalBudget,    setTotalBudget]    = useState('');
  const [deliveryVerificationMode, setDeliveryVerificationMode] =
    useState<'off' | 'fixed_location' | 'live_handshake'>('off');

  // ── Date picker visibility ────────────────────────────────────────────────
  const [showStartPicker,   setShowStartPicker]   = useState(false);
  const [showEndPicker,     setShowEndPicker]     = useState(false);
  const [deliveryPickerFor, setDeliveryPickerFor] = useState<string | null>(null);

  // ── Section 2 state ──────────────────────────────────────────────────────
  const [barForms, setBarForms] = useState<BarForm[]>([
    { id: `bar_${Date.now()}`, name: '', location: '', fridgeService: '', fridgeDisplay: '', fridgeUnderBar: '' },
  ]);

  // ── Section 3 state ──────────────────────────────────────────────────────
  const [locationForms, setLocationForms] = useState<LocationForm[]>([
    { id: `loc_${Date.now()}`, name: '', type: '20ft_container', dimensionL: '5.9', dimensionW: '2.35', dimensionH: '2.4', hasAisle: true, aisleWidth: '800', barsServed: [] },
  ]);

  // ── Section 4 state ──────────────────────────────────────────────────────
  const [venueSuppliers, setVenueSuppliers] = useState<any[]>([]);
  const [supplierCfg,    setSupplierCfg]    = useState<Record<string, any>>({});
  const [products,       setProducts]       = useState<any[]>([]);

  // ── Section 5 state ──────────────────────────────────────────────────────
  const [categories,      setCategories]      = useState<string[]>(['beer_cans', 'beer_draught']);
  const [pricePosition,   setPricePosition]   = useState('mid_range');
  const [hasExclusivity,  setHasExclusivity]  = useState(false);
  const [exclusivityNote, setExclusivityNote] = useState('');

  // ── Section 6 state ──────────────────────────────────────────────────────
  const [isNewEvent,      setIsNewEvent]      = useState(true);
  const [priorAttendance, setPriorAttendance] = useState('');
  const [historyNotes,    setHistoryNotes]    = useState('');

  // ── Counts for Section 6 card ─────────────────────────────────────────────
  const [contractCount,       setContractCount]       = useState(0);
  const [historicalDataCount, setHistoricalDataCount] = useState(0);

  // ── Collapsible section state ─────────────────────────────────────────────
  const [expandedSection,  setExpandedSection]  = useState(1);
  const [expandedBar,      setExpandedBar]      = useState<string | null>(null);
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [progress,     setProgress]     = useState<Progress>({ basics: false, bars: false, sourceLocations: false, productPlanning: false, suppliers: false, historicalData: false });
  const [saving,       setSaving]       = useState<string | null>(null);
  const [toast,        setToast]        = useState<string | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [barsReady,    setBarsReady]    = useState(false);
  const [locsReady,    setLocsReady]    = useState(false);
  const toastTimer = useRef<any>(null);

  // ── Refs: scroll, layout ──────────────────────────────────────────────────
  const scrollViewRef         = useRef<any>(null);
  const sectionLayouts        = useRef<Record<number, number>>({});
  const pendingScrollSection  = useRef<number | null>(null);
  const pendingScrollBarId    = useRef<string | null>(null);
  const pendingScrollLocId    = useRef<string | null>(null);

  // ── Refs: unsaved changes ─────────────────────────────────────────────────
  const baselines             = useRef<Record<number, string>>({});
  const baselineInitialized   = useRef(false);
  const barsBaselineSet       = useRef(false);
  const locsBaselineSet       = useRef(false);
  const stateRef              = useRef<any>({});

  // ── Mirror current state into stateRef on every render ───────────────────
  // Enables closures (onSnapshot, beforeRemove) to read current values without
  // stale capture. This is a ref assignment — no re-render triggered.
  stateRef.current = {
    eventName, eventType, startDate, endDate, dailyAttend, numBars, stockModel,
    cycleOverride, totalBudget, deliveryVerificationMode,
    barForms, locationForms, supplierCfg,
    categories, pricePosition, hasExclusivity, exclusivityNote,
    isNewEvent, priorAttendance, historyNotes,
  };

  // ── Baseline helpers ──────────────────────────────────────────────────────
  function makeBaseline(n: number): string {
    const s = stateRef.current;
    switch (n) {
      case 1: return JSON.stringify({ eventName: s.eventName, eventType: s.eventType, startDate: s.startDate, endDate: s.endDate, dailyAttend: s.dailyAttend, numBars: s.numBars, stockModel: s.stockModel, cycleOverride: s.cycleOverride, totalBudget: s.totalBudget, deliveryVerificationMode: s.deliveryVerificationMode });
      case 2: return JSON.stringify(s.barForms);
      case 3: return JSON.stringify(s.locationForms);
      case 4: return JSON.stringify(s.supplierCfg);
      case 5: return JSON.stringify({ categories: s.categories, pricePosition: s.pricePosition, hasExclusivity: s.hasExclusivity, exclusivityNote: s.exclusivityNote });
      case 6: return JSON.stringify({ isNewEvent: s.isNewEvent, priorAttendance: s.priorAttendance, historyNotes: s.historyNotes });
      default: return '';
    }
  }

  function isDirty(n: number): boolean {
    if (baselines.current[n] === undefined) return false;
    return makeBaseline(n) !== baselines.current[n];
  }

  // ── Section summaries (from live form state) ──────────────────────────────
  function getSectionSummary(n: number): string {
    const notStarted = 'Not started';
    switch (n) {
      case 1: {
        const parts: string[] = [];
        const etLabel = EVENT_TYPES.find(e => e.id === eventType)?.label;
        if (etLabel) parts.push(etLabel);
        if (startDate && endDate) parts.push(`${startDate} → ${endDate}`);
        else if (startDate) parts.push(startDate);
        if (dailyAttend) parts.push(`${parseInt(dailyAttend, 10).toLocaleString('en-NZ')}/day`);
        return parts.length > 0 ? parts.join(' · ') : notStarted;
      }
      case 2: {
        if (!progress.basics) return 'Unlocks after Event basics';
        if (barForms.length === 0) return notStarted;
        const named = barForms.map((b, i) => b.name.trim() || `Bar ${i + 1}`);
        const preview = named.slice(0, 2).join(', ');
        const rest = named.length - 2;
        return `${barForms.length} bar${barForms.length !== 1 ? 's' : ''} · ${preview}${rest > 0 ? ` +${rest}` : ''}`;
      }
      case 3: {
        if (!progress.basics) return 'Unlocks after Event basics';
        if (locationForms.length === 0) return notStarted;
        const named = locationForms.map((l, i) => l.name.trim() || `Location ${i + 1}`);
        const preview = named.slice(0, 2).join(', ');
        const rest = named.length - 2;
        return `${locationForms.length} space${locationForms.length !== 1 ? 's' : ''} · ${preview}${rest > 0 ? ` +${rest}` : ''}`;
      }
      case 4: {
        const total = venueSuppliers.length;
        if (total === 0) return 'No suppliers yet';
        const included = Object.values(supplierCfg).filter((cfg: any) => cfg.selected).length;
        return `${included} of ${total} included`;
      }
      case 5: {
        const parts: string[] = [];
        if (categories.length > 0) parts.push(`${categories.length} categor${categories.length !== 1 ? 'ies' : 'y'}`);
        const ppLabel = PRICE_POSITIONS.find(p => p.id === pricePosition)?.label;
        if (ppLabel) parts.push(ppLabel);
        return parts.length > 0 ? parts.join(' · ') : notStarted;
      }
      case 6: {
        if (isNewEvent) return 'New event';
        if (priorAttendance) return `Prior year: ${parseInt(priorAttendance, 10).toLocaleString('en-NZ')}`;
        return notStarted;
      }
      default: return '';
    }
  }

  // ── Item summaries + hints ────────────────────────────────────────────────
  function getBarSummary(bar: BarForm): string {
    const parts: string[] = [];
    if (bar.location.trim()) parts.push(bar.location.trim());
    if (bar.fridgeService)   parts.push(`${bar.fridgeService} cases service`);
    return parts.join(' · ');
  }
  function getBarHint(bar: BarForm): string | null {
    return bar.fridgeService ? null : 'Add fridge capacity';
  }

  function getLocationSummary(loc: LocationForm): string {
    const typeLabel = LOCATION_TYPES.find(t => t.id === loc.type)?.label || '';
    const dimParts  = [loc.dimensionL, loc.dimensionW, loc.dimensionH].filter(Boolean);
    const dimStr    = dimParts.length === 3 ? `${loc.dimensionL} × ${loc.dimensionW} × ${loc.dimensionH} m` : '';
    return [typeLabel, dimStr].filter(Boolean).join(' · ');
  }
  function getLocationHint(loc: LocationForm): string | null {
    return loc.name.trim() ? null : 'Add a name';
  }

  function getSupplierSummary(sup: any): string {
    const cfg = supplierCfg[sup.id] || {};
    if (!cfg.selected) return 'Not included';
    const rpLabel = RETURN_POLICIES.find(r => r.id === (cfg.returnPolicy || 'sale_or_return'))?.label;
    const parts   = ['Included'];
    if (rpLabel)          parts.push(rpLabel);
    if (cfg.deliveryDate) parts.push(`Delivery ${cfg.deliveryDate}`);
    return parts.join(' · ');
  }
  function getSupplierHint(sup: any): string | null {
    const cfg = supplierCfg[sup.id] || {};
    return (cfg.selected && !cfg.deliveryDate) ? 'Add delivery date' : null;
  }

  // ── Scroll helpers ────────────────────────────────────────────────────────
  function openSection(n: number) {
    setExpandedSection(n);
    if (n > 0) pendingScrollSection.current = n;
  }

  function handleSectionPress(n: number) {
    if (expandedSection === n) {
      setExpandedSection(0);
    } else {
      pendingScrollSection.current = n;
      setExpandedSection(n);
    }
  }

  // ── One-time initialisation after first Firestore load ───────────────────
  const hasInitialisedSection = useRef(false);
  useEffect(() => {
    if (hasInitialisedSection.current) return;
    if (loadingEvent) return;
    hasInitialisedSection.current = true;
    setExpandedSection(getFirstIncompleteSection(progress));
  }, [loadingEvent, progress]);

  // Set baselines for event-details sections (1, 4, 5, 6) once after initial load
  useEffect(() => {
    if (loadingEvent || baselineInitialized.current) return;
    baselineInitialized.current = true;
    [1, 4, 5, 6].forEach(n => { baselines.current[n] = makeBaseline(n); });
  }, [loadingEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set baseline for section 2 (bars) once after getDocs completes
  useEffect(() => {
    if (!barsReady || barsBaselineSet.current) return;
    barsBaselineSet.current = true;
    baselines.current[2] = makeBaseline(2);
  }, [barsReady, barForms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set baseline for section 3 (locations) once after getDocs completes
  useEffect(() => {
    if (!locsReady || locsBaselineSet.current) return;
    locsBaselineSet.current = true;
    baselines.current[3] = makeBaseline(3);
  }, [locsReady, locationForms]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── beforeRemove — warn on unsaved changes ────────────────────────────────
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      const dirtyNames: string[] = [];
      if (isDirty(1)) dirtyNames.push('Event basics');
      if (isDirty(2)) dirtyNames.push('Bar configuration');
      if (isDirty(3)) dirtyNames.push('Storage spaces');
      if (isDirty(4)) dirtyNames.push('Supplier setup');
      if (isDirty(5)) dirtyNames.push('Product planning');
      if (isDirty(6)) dirtyNames.push('Historical data');
      if (dirtyNames.length === 0) return;
      e.preventDefault();
      confirm({
        title: 'Leave without saving?',
        message: `You have unsaved changes in ${dirtyNames.join(', ')}.`,
        confirmLabel: 'Leave',
        cancelLabel: 'Stay',
        onConfirm: () => navigation.dispatch(e.data.action),
      });
    });
    return unsubscribe;
  }, [navigation]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load event data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      setLoadingEvent(false);
      if (!snap.exists()) return;
      const d = snap.data() as any;

      // Section 1 — apply only if not dirty
      if (!isDirty(1)) {
        if (d.eventName)        setEventName(d.eventName);
        if (d.eventType)        setEventType(d.eventType);
        if (d.startDate)        setStartDate(d.startDate);
        if (d.endDate)          setEndDate(d.endDate);
        if (d.dailyAttendance)  setDailyAttend(String(d.dailyAttendance));
        if (d.numBars)          setNumBars(String(d.numBars));
        if (d.stockModel)       setStockModel(d.stockModel);
        if (d.cycleOverride)    setCycleOverride(d.cycleOverride);
        if (d.totalBudget != null) setTotalBudget(String(d.totalBudget));
        if (d.deliveryVerificationMode === 'fixed_location' || d.deliveryVerificationMode === 'live_handshake') {
          setDeliveryVerificationMode(d.deliveryVerificationMode);
        } else {
          setDeliveryVerificationMode('off');
        }
      }

      // Section 4 (supplierConfigs) — apply only if not dirty
      if (!isDirty(4) && d.supplierConfigs) {
        const cfgMap: Record<string, any> = {};
        Object.entries(d.supplierConfigs).forEach(([suppId, cfg]: [string, any]) => {
          cfgMap[suppId] = {
            selected: true,
            supplierName: cfg.supplierName || '',
            deliveryDate: cfg.deliveryDate || '',
            returnPolicy: cfg.returnPolicy || 'sale_or_return',
            chepEnabled: cfg.chepEnabled || false,
            chepPalletCount: cfg.chepPalletCount ? String(cfg.chepPalletCount) : '',
            chepAccountNumber: cfg.chepAccountNumber || '',
            returnAllowancePercent: cfg.returnAllowancePercent ?? 5,
          };
        });
        setSupplierCfg(prev => ({ ...prev, ...cfgMap }));
      }

      // Section 5 — apply only if not dirty
      if (!isDirty(5)) {
        if (d.categories)       setCategories(d.categories);
        if (d.pricePositioning) setPricePosition(d.pricePositioning);
        if (d.exclusivity != null) {
          setHasExclusivity(!!d.exclusivity);
          setExclusivityNote(d.exclusivity || '');
        }
      }

      // Section 6 — apply only if not dirty
      if (!isDirty(6)) {
        if (d.isNewEvent != null)  setIsNewEvent(d.isNewEvent);
        if (d.priorAttendance)     setPriorAttendance(String(d.priorAttendance));
        if (d.historicalNotes)     setHistoryNotes(d.historicalNotes);
      }

      // Progress always updates
      if (d.setupProgress) setProgress(p => ({ ...p, ...d.setupProgress }));
    }, () => setLoadingEvent(false));
    return () => unsub();
  }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fail-safe if venueId never resolves
  useEffect(() => {
    if (venueId) return;
    const timeout = setTimeout(() => {
      showError('Connection issue — could not connect to your venue. Please close and reopen the app.');
    }, 10000);
    return () => clearTimeout(timeout);
  }, [venueId]);

  // ── Load existing bars ────────────────────────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'departments')).then(snap => {
      const barDocs = snap.docs.filter(d => (d.data() as any).isFestivalBar === true);
      if (barDocs.length > 0) {
        setBarForms(barDocs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || '',
            location: data.location || '',
            fridgeService: String(data.fridgeCapacity?.service || ''),
            fridgeDisplay: String(data.fridgeCapacity?.display || ''),
            fridgeUnderBar: String(data.fridgeCapacity?.underBar || ''),
          };
        }));
      }
      setBarsReady(true);
    }).catch(() => { setBarsReady(true); });
  }, [venueId]);

  // ── Load existing storage locations ──────────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'departments', 'hq', 'areas')).then(snap => {
      const locDocs = snap.docs.filter(d => d.id !== 'main-storage');
      if (locDocs.length > 0) {
        setLocationForms(locDocs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || '',
            type: data.type || '20ft_container',
            dimensionL: String(data.dimensions?.l || ''),
            dimensionW: String(data.dimensions?.w || ''),
            dimensionH: String(data.dimensions?.h || ''),
            hasAisle: data.hasAisle !== false,
            aisleWidth: String(data.aisleWidth || '800'),
            barsServed: data.servingBarIds || [],
          };
        }));
      }
      setLocsReady(true);
    }).catch(() => { setLocsReady(true); });
  }, [venueId]);

  // ── Load suppliers ────────────────────────────────────────────────────────
  function loadSuppliers() {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'suppliers')).then(snap => {
      setVenueSuppliers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }).catch(() => {});
  }
  useEffect(() => { loadSuppliers(); }, [venueId]);
  useFocusEffect(useCallback(() => { loadSuppliers(); }, [venueId]));

  // ── Load products ─────────────────────────────────────────────────────────
  function loadProducts() {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }).catch(() => {});
  }
  useEffect(() => { loadProducts(); }, [venueId]);
  useFocusEffect(useCallback(() => { loadProducts(); }, [venueId]));

  // ── Load contracts ────────────────────────────────────────────────────────
  function loadContracts() {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'contracts')).then(snap => {
      setContractCount(snap.size);
    }).catch(() => {});
  }
  useEffect(() => { loadContracts(); }, [venueId]);
  useFocusEffect(useCallback(() => { loadContracts(); }, [venueId]));

  // ── Load historical data count ────────────────────────────────────────────
  function loadHistoricalData() {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'event', 'details', 'historicalData')).then(snap => {
      setHistoricalDataCount(snap.size);
    }).catch(() => {});
  }
  useEffect(() => { loadHistoricalData(); }, [venueId]);
  useFocusEffect(useCallback(() => { loadHistoricalData(); }, [venueId]));

  // ── Date helpers ──────────────────────────────────────────────────────────
  function ddmmyyyyToDate(s: string): Date | null {
    const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  function dateToDdmmyyyy(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }
  function parseDuration(start: string, end: string): number {
    try {
      const [ds, ms, ys] = start.split('/');
      const [de, me, ye] = end.split('/');
      const startDt = new Date(parseInt(ys), parseInt(ms) - 1, parseInt(ds));
      const endDt   = new Date(parseInt(ye), parseInt(me) - 1, parseInt(de));
      return Math.max(1, Math.ceil((endDt.getTime() - startDt.getTime()) / 86400000) + 1);
    } catch { return 1; }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // ── Save: Event basics ────────────────────────────────────────────────────
  async function saveBasics() {
    if (!venueId) {
      showInfo('Not connected — your venue is still loading. Please wait a moment and try again.');
      return;
    }
    if (!eventName.trim()) { showInfo('Event name is required.'); return; }
    if (!startDate || !endDate) { showInfo('Start and end dates are required.'); return; }

    const parseEventDate = (s: string): Date | null => {
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return null;
      const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
      return isNaN(d.getTime()) ? null : d;
    };
    const startParsed = parseEventDate(startDate);
    const endParsed   = parseEventDate(endDate);
    if (!startParsed || !endParsed) {
      showInfo('Invalid dates — please enter dates as DD/MM/YYYY (e.g. 13/04/2027).');
      return;
    }
    if (endParsed < startParsed) {
      showInfo('Invalid dates — end date must be on or after start date.');
      return;
    }
    const eventDurationDays = Math.ceil((endParsed.getTime() - startParsed.getTime()) / 86400000) + 1;

    // Capture baseline before any state changes
    const captured1 = JSON.stringify({ eventName, eventType, startDate, endDate, dailyAttend, numBars, stockModel, cycleOverride, totalBudget, deliveryVerificationMode });

    setSaving('basics');
    try {
      const nb = parseInt(numBars) || 1;
      const newProgress = { ...progress, basics: true };
      const durationDays = (startDate && endDate) ? parseDuration(startDate, endDate) : 1;
      const autoDetectedCycle = determineCycleLength(durationDays);
      const finalCycle = cycleOverride || autoDetectedCycle;
      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), {
        eventName: eventName.trim(), eventType, startDate, endDate,
        dailyAttendance: parseInt(dailyAttend) || null,
        eventDurationDays,
        numBars: nb, stockModel,
        cycleLength: finalCycle,
        cycleOverride: cycleOverride || null,
        totalBudget: parseFloat(totalBudget) || null,
        deliveryVerificationMode,
        setupProgress: newProgress,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProgress(newProgress);
      // Auto-create HQ / Central Store department if not yet created
      try {
        const hqRef  = doc(db, 'venues', venueId, 'departments', 'hq');
        const hqSnap = await getDoc(hqRef);
        if (!hqSnap.exists()) {
          await setDoc(hqRef, {
            name: 'HQ — Central Store', type: 'hq', isFestivalHQ: true,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          await setDoc(
            doc(db, 'venues', venueId, 'departments', 'hq', 'areas', 'main-storage'),
            { name: 'Main storage', type: 'storage', createdAt: serverTimestamp() },
          );
        }
      } catch (_) {}
      // Pad bar forms to match numBars if user hasn't added them manually
      if (barForms.length < nb) {
        const toAdd = nb - barForms.length;
        setBarForms(prev => [
          ...prev,
          ...Array.from({ length: toAdd }, (_, i) => ({
            id: `bar_${Date.now()}_${i}`,
            name: '', location: '', fridgeService: '', fridgeDisplay: '', fridgeUnderBar: '',
          })),
        ]);
      }
      baselines.current[1] = captured1;
      showToast('✓ Event basics saved');
      openSection(getNextSection(newProgress));
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally { setSaving(null); }
  }

  // ── Save: Bars ────────────────────────────────────────────────────────────
  async function saveBars() {
    if (!venueId) return;
    const captured2 = JSON.stringify(barForms);
    setSaving('bars');
    try {
      for (let i = 0; i < barForms.length; i++) {
        const bar = barForms[i];
        await setDoc(doc(db, 'venues', venueId, 'departments', bar.id), {
          name: bar.name.trim() || `Bar ${i + 1}`,
          location: bar.location.trim(),
          type: 'festival-bar',
          isFestivalBar: true,
          fridgeCapacity: {
            service: parseFloat(bar.fridgeService) || 0,
            display: parseFloat(bar.fridgeDisplay) || null,
            underBar: parseFloat(bar.fridgeUnderBar) || null,
          },
          primaryStorageId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        const bohRef  = doc(db, 'venues', venueId, 'departments', bar.id, 'areas', 'back-of-house');
        const bohSnap = await getDoc(bohRef);
        if (!bohSnap.exists()) {
          await setDoc(bohRef, {
            name: 'Back of house', type: 'bar-storage', isDefault: true, createdAt: serverTimestamp(),
          });
        }
      }
      const newProgress = { ...progress, bars: true };
      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), { setupProgress: newProgress, updatedAt: serverTimestamp() }, { merge: true });
      setProgress(newProgress);
      baselines.current[2] = captured2;
      showToast('✓ Bars saved');
      openSection(getNextSection(newProgress));
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally { setSaving(null); }
  }

  // ── Save: Locations ───────────────────────────────────────────────────────
  async function saveLocations() {
    if (!venueId) return;
    const captured3 = JSON.stringify(locationForms);
    setSaving('locations');
    try {
      for (let i = 0; i < locationForms.length; i++) {
        const loc = locationForms[i];
        await setDoc(doc(db, 'venues', venueId, 'departments', 'hq', 'areas', loc.id), {
          name: loc.name.trim() || `Location ${i + 1}`,
          type: loc.type,
          dimensions: {
            l: parseFloat(loc.dimensionL) || 0,
            w: parseFloat(loc.dimensionW) || 0,
            h: parseFloat(loc.dimensionH) || 0,
          },
          hasAisle: loc.hasAisle,
          aisleWidth: parseFloat(loc.aisleWidth) || 800,
          servingBarIds: loc.barsServed,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      const newProgress = { ...progress, sourceLocations: true };
      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), { setupProgress: newProgress, updatedAt: serverTimestamp() }, { merge: true });
      setProgress(newProgress);
      baselines.current[3] = captured3;
      showToast('✓ Storage spaces saved');
      openSection(getNextSection(newProgress));
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally { setSaving(null); }
  }

  // ── Save: Suppliers ───────────────────────────────────────────────────────
  async function saveSuppliers() {
    if (!venueId) return;
    const captured4 = JSON.stringify(supplierCfg);
    setSaving('suppliers');
    try {
      const configs: Record<string, any> = {};
      for (const supplierId of Object.keys(supplierCfg)) {
        const cfg = supplierCfg[supplierId];
        if (!cfg.selected) continue;
        configs[supplierId] = {
          supplierId,
          supplierName: cfg.supplierName || '',
          deliveryDate: cfg.deliveryDate || null,
          returnPolicy: cfg.returnPolicy || 'sale_or_return',
          chepEnabled: cfg.chepEnabled || false,
          chepPalletCount: cfg.chepEnabled ? (parseInt(cfg.chepPalletCount) || null) : null,
          chepAccountNumber: cfg.chepEnabled ? (cfg.chepAccountNumber || null) : null,
          returnAllowancePercent: cfg.returnAllowancePercent ?? 5,
        };
      }
      const newProgress = { ...progress, suppliers: true };
      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), {
        supplierConfigs: configs,
        setupProgress: newProgress,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProgress(newProgress);
      baselines.current[4] = captured4;
      showToast('✓ Supplier config saved');
      openSection(getNextSection(newProgress));
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally { setSaving(null); }
  }

  // ── Save: Product planning ────────────────────────────────────────────────
  async function saveProductPlanning() {
    if (!venueId) return;
    const captured5 = JSON.stringify({ categories, pricePosition, hasExclusivity, exclusivityNote });
    setSaving('products');
    try {
      const newProgress = { ...progress, productPlanning: true };
      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), {
        categories,
        pricePositioning: pricePosition,
        exclusivity: hasExclusivity ? (exclusivityNote.trim() || 'Yes') : null,
        setupProgress: newProgress,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProgress(newProgress);
      baselines.current[5] = captured5;
      showToast('✓ Product planning saved');
      openSection(getNextSection(newProgress));
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally { setSaving(null); }
  }

  // ── Save: Historical data ─────────────────────────────────────────────────
  async function saveHistorical() {
    if (!venueId) return;
    const captured6 = JSON.stringify({ isNewEvent, priorAttendance, historyNotes });
    setSaving('historical');
    try {
      const newProgress = { ...progress, historicalData: true };
      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), {
        isNewEvent,
        priorAttendance: isNewEvent ? null : (parseInt(priorAttendance) || null),
        historicalNotes: isNewEvent ? null : (historyNotes.trim() || null),
        setupProgress: newProgress,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProgress(newProgress);
      baselines.current[6] = captured6;
      showToast('✓ Historical data saved');
      openSection(getNextSection(newProgress));
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally { setSaving(null); }
  }

  // ── Bar form helpers ──────────────────────────────────────────────────────
  function addBar() {
    const newId = `bar_${Date.now()}`;
    setBarForms(prev => [...prev, { id: newId, name: '', location: '', fridgeService: '', fridgeDisplay: '', fridgeUnderBar: '' }]);
    setExpandedBar(newId);
    pendingScrollBarId.current = newId;
  }
  function updateBar(id: string, field: string, value: string) {
    setBarForms(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  }

  // ── Location form helpers ─────────────────────────────────────────────────
  function addLocation() {
    const newId = `loc_${Date.now()}`;
    setLocationForms(prev => [...prev, { id: newId, name: '', type: '20ft_container', dimensionL: '5.9', dimensionW: '2.35', dimensionH: '2.4', hasAisle: true, aisleWidth: '800', barsServed: [] }]);
    setExpandedLocation(newId);
    pendingScrollLocId.current = newId;
  }
  function updateLocation(id: string, field: string, value: any) {
    setLocationForms(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  }
  function toggleLocationBar(locId: string, barId: string) {
    setLocationForms(prev => prev.map(loc => {
      if (loc.id !== locId) return loc;
      const served = loc.barsServed.includes(barId)
        ? loc.barsServed.filter(b => b !== barId)
        : [...loc.barsServed, barId];
      return { ...loc, barsServed: served };
    }));
  }

  // ── Supplier config helpers ───────────────────────────────────────────────
  function updateSup(supId: string, field: string, value: any) {
    setSupplierCfg(prev => ({ ...prev, [supId]: { ...(prev[supId] || {}), [field]: value } }));
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.comingSoon}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loadingEvent) {
    return (
      <View style={S.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  // Derived
  const doneCount = [progress.basics, progress.bars, progress.sourceLocations, progress.suppliers, progress.productPlanning, progress.historicalData].filter(Boolean).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f5f3ee' }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={S.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {modal}

        {/* Slim progress line */}
        <ProgressLine done={doneCount} total={6} />

        {/* ── SECTION 1: Event basics ── */}
        <View
          style={S.section}
          onLayout={(e) => {
            const y = e.nativeEvent.layout.y;
            sectionLayouts.current[1] = y;
            if (pendingScrollSection.current === 1) {
              pendingScrollSection.current = null;
              scrollViewRef.current?.scrollTo({ y: y - 8, animated: true });
            }
          }}
        >
          <SectionHeader
            n="1" title="Event basics"
            complete={progress.basics}
            expanded={expandedSection === 1}
            onPress={() => handleSectionPress(1)}
            summary={getSectionSummary(1)}
            unsaved={isDirty(1)}
          />
          {expandedSection === 1 && (<>

          <Text style={S.label}>Event name *</Text>
          <TextInput value={eventName} onChangeText={setEventName} placeholder="e.g. Winery Summer Fest 2025" placeholderTextColor="#9ca3af" style={S.input} />

          <Text style={S.label}>Event type</Text>
          {EVENT_TYPES.map(et => (
            <RadioCard key={et.id} label={et.label} selected={eventType === et.id} onPress={() => setEventType(et.id)} />
          ))}

          <Text style={S.label}>Start date *</Text>
          <TouchableOpacity
            style={[S.input, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => setShowStartPicker(true)}
          >
            <Text style={{ fontSize: 14, color: startDate ? c.navy : c.slateMid }}>
              {startDate || 'Select date'}
            </Text>
          </TouchableOpacity>
          {showStartPicker && (
            <DateTimePicker
              value={ddmmyyyyToDate(startDate) || new Date()}
              mode="date"
              display="default"
              onChange={(event: any, selectedDate?: Date) => {
                setShowStartPicker(false);
                if (event?.type === 'dismissed' || !selectedDate) return;
                setStartDate(dateToDdmmyyyy(selectedDate));
              }}
            />
          )}

          <Text style={S.label}>End date *</Text>
          <Text style={S.helper}>Same as start date = single-day event</Text>
          <TouchableOpacity
            style={[S.input, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => setShowEndPicker(true)}
          >
            <Text style={{ fontSize: 14, color: endDate ? c.navy : c.slateMid }}>
              {endDate || 'Select date'}
            </Text>
          </TouchableOpacity>
          {showEndPicker && (
            <DateTimePicker
              value={ddmmyyyyToDate(endDate) || ddmmyyyyToDate(startDate) || new Date()}
              mode="date"
              display="default"
              minimumDate={ddmmyyyyToDate(startDate) || undefined}
              onChange={(event: any, selectedDate?: Date) => {
                setShowEndPicker(false);
                if (event?.type === 'dismissed' || !selectedDate) return;
                setEndDate(dateToDdmmyyyy(selectedDate));
              }}
            />
          )}

          {startDate && endDate && (() => {
            const dur = parseDuration(startDate, endDate);
            if (dur <= 0) return null;
            const auto    = determineCycleLength(dur);
            const cfgAuto = getCycleConfig(auto);
            return (
              <View style={S.cycleBox}>
                <Text style={S.cycleLabel}>Reporting cycle: {cfgAuto.cycleLabel}</Text>
                <Text style={S.cycleDesc}>{cfgAuto.cycleDescription}</Text>
                <Text style={[S.label, { marginTop: 8 }]}>Override cycle? (optional)</Text>
                {(['session', 'daily', 'weekly'] as const).map(cl => {
                  const clCfg  = getCycleConfig(cl);
                  const active = (cycleOverride || auto) === cl;
                  return (
                    <RadioCard
                      key={cl}
                      label={clCfg.cycleLabel}
                      sub={clCfg.cycleDescription}
                      selected={active}
                      onPress={() => setCycleOverride(cl === auto ? '' : cl)}
                    />
                  );
                })}
              </View>
            );
          })()}

          <Text style={S.label}>Expected daily attendance</Text>
          <Text style={S.helper}>Average across all days is fine</Text>
          <TextInput value={dailyAttend} onChangeText={setDailyAttend} placeholder="e.g. 2500" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />

          <Text style={S.label}>Total beverage budget (optional)</Text>
          <Text style={S.helper}>We'll flag if your predicted order exceeds this figure.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 16, color: '#374151', fontWeight: '600' }}>$</Text>
            <TextInput value={totalBudget} onChangeText={setTotalBudget} placeholder="e.g. 50000" placeholderTextColor="#9ca3af" style={[S.input, { flex: 1 }]} keyboardType="numeric" />
            <Text style={{ fontSize: 13, color: '#9ca3af' }}>NZD</Text>
          </View>

          <Text style={S.label}>Number of bars / service points</Text>
          <TextInput value={numBars} onChangeText={setNumBars} placeholder="e.g. 3" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />

          <Text style={S.label}>Stock model</Text>
          {STOCK_MODELS.map(sm => (
            <RadioCard key={sm.id} label={sm.label} sub={sm.sub} selected={stockModel === sm.id} onPress={() => setStockModel(sm.id)} />
          ))}

          <Text style={S.label}>Delivery verification</Text>
          <Text style={S.helper}>
            Controls whether runners must scan a location QR code before a collect or arrive action is recorded.
            "Off" keeps the plain-tap behaviour. "Fixed location" requires a QR scan at the source and
            destination; staff without QR codes can still use manual entry.
          </Text>
          {([
            { id: 'off',            label: 'Off',             sub: 'Plain-tap — no QR scan required (default)' },
            { id: 'fixed_location', label: 'Fixed location',  sub: 'Runner scans the static QR code posted at each location' },
            { id: 'live_handshake', label: 'Live handshake',  sub: 'Person at each location shows a time-limited QR on their phone; runner scans it to prove co-presence' },
          ] as const).map(opt => (
            <RadioCard
              key={opt.id}
              label={opt.label}
              sub={opt.sub}
              selected={deliveryVerificationMode === opt.id}
              onPress={() => setDeliveryVerificationMode(opt.id)}
            />
          ))}

          <SaveButton label="Save and continue →" savingKey="basics" saving={saving} onPress={saveBasics} />
          </>)}
        </View>

        {/* ── SECTION 2: Bar configuration ── */}
        <View
          style={S.section}
          onLayout={(e) => {
            const y = e.nativeEvent.layout.y;
            sectionLayouts.current[2] = y;
            if (pendingScrollSection.current === 2) {
              pendingScrollSection.current = null;
              scrollViewRef.current?.scrollTo({ y: y - 8, animated: true });
            }
          }}
        >
          <SectionHeader
            n="2" title="Bar configuration"
            complete={progress.bars}
            expanded={expandedSection === 2}
            onPress={() => handleSectionPress(2)}
            summary={getSectionSummary(2)}
            unsaved={isDirty(2)}
          />
          {expandedSection === 2 && (<>
          {!progress.basics ? (
            <LockedBox text="Complete Event Basics first to configure your bars." />
          ) : (
            <>
              {barForms.map((bar, i) => (
                <View
                  key={bar.id}
                  style={S.subCard}
                  onLayout={(e) => {
                    if (pendingScrollBarId.current === bar.id) {
                      pendingScrollBarId.current = null;
                      const sectionY = sectionLayouts.current[2] || 0;
                      scrollViewRef.current?.scrollTo({ y: sectionY + e.nativeEvent.layout.y - 8, animated: true });
                    }
                  }}
                >
                  <ItemRow
                    name={bar.name.trim() || `Bar ${i + 1}`}
                    summary={getBarSummary(bar)}
                    hint={getBarHint(bar)}
                    expanded={expandedBar === bar.id}
                    onPress={() => setExpandedBar(expandedBar === bar.id ? null : bar.id)}
                  />
                  {expandedBar === bar.id && (
                    <>
                      <Text style={S.label}>Bar name</Text>
                      <TextInput value={bar.name} onChangeText={v => updateBar(bar.id, 'name', v)} placeholder="e.g. Main Stage Bar" placeholderTextColor="#9ca3af" style={S.input} />

                      <Text style={S.label}>Location description</Text>
                      <TextInput value={bar.location} onChangeText={v => updateBar(bar.id, 'location', v)} placeholder="e.g. North side, stage left" placeholderTextColor="#9ca3af" style={S.input} />

                      <Text style={S.label}>Fridge configuration</Text>

                      <Text style={S.subLabel}>Service fridge capacity (cases)</Text>
                      <Text style={S.helper}>How many cases fit in your working fridge behind the bar?</Text>
                      <TextInput value={bar.fridgeService} onChangeText={v => updateBar(bar.id, 'fridgeService', v)} placeholder="e.g. 6" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />

                      <Text style={S.subLabel}>Display fridge capacity (cases) — optional</Text>
                      <TextInput value={bar.fridgeDisplay} onChangeText={v => updateBar(bar.id, 'fridgeDisplay', v)} placeholder="e.g. 4" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />

                      <Text style={S.subLabel}>Under-bar capacity (cases) — optional</Text>
                      <TextInput value={bar.fridgeUnderBar} onChangeText={v => updateBar(bar.id, 'fridgeUnderBar', v)} placeholder="e.g. 2" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />

                      <View style={S.infoBox}>
                        <Text style={S.infoText}>Primary storage space set up after adding storage spaces in Section 3.</Text>
                      </View>
                    </>
                  )}
                </View>
              ))}

              <TouchableOpacity style={S.addBtn} onPress={addBar}>
                <Text style={S.addBtnText}>+ Add another bar</Text>
              </TouchableOpacity>

              <SaveButton label="Save bars →" savingKey="bars" saving={saving} onPress={saveBars} />
            </>
          )}
          </>)}
        </View>

        {/* ── SECTION 3: Storage spaces ── */}
        <View
          style={S.section}
          onLayout={(e) => {
            const y = e.nativeEvent.layout.y;
            sectionLayouts.current[3] = y;
            if (pendingScrollSection.current === 3) {
              pendingScrollSection.current = null;
              scrollViewRef.current?.scrollTo({ y: y - 8, animated: true });
            }
          }}
        >
          <SectionHeader
            n="3" title="Storage spaces"
            complete={progress.sourceLocations}
            expanded={expandedSection === 3}
            onPress={() => handleSectionPress(3)}
            summary={getSectionSummary(3)}
            unsaved={isDirty(3)}
          />
          {expandedSection === 3 && (<>
          {!progress.basics ? (
            <LockedBox text="Complete Event Basics first." />
          ) : (
            <>
              {locationForms.map((loc, i) => (
                <View
                  key={loc.id}
                  style={S.subCard}
                  onLayout={(e) => {
                    if (pendingScrollLocId.current === loc.id) {
                      pendingScrollLocId.current = null;
                      const sectionY = sectionLayouts.current[3] || 0;
                      scrollViewRef.current?.scrollTo({ y: sectionY + e.nativeEvent.layout.y - 8, animated: true });
                    }
                  }}
                >
                  <ItemRow
                    name={loc.name.trim() || `Location ${i + 1}`}
                    summary={getLocationSummary(loc)}
                    hint={getLocationHint(loc)}
                    expanded={expandedLocation === loc.id}
                    onPress={() => setExpandedLocation(expandedLocation === loc.id ? null : loc.id)}
                  />
                  {expandedLocation === loc.id && (
                    <>
                      <Text style={S.label}>Location name</Text>
                      <TextInput value={loc.name} onChangeText={v => updateLocation(loc.id, 'name', v)} placeholder="e.g. Container 1" placeholderTextColor="#9ca3af" style={S.input} />

                      <Text style={S.label}>Location type</Text>
                      {LOCATION_TYPES.map(lt => (
                        <RadioCard
                          key={lt.id}
                          label={lt.label}
                          selected={loc.type === lt.id}
                          onPress={() => {
                            updateLocation(loc.id, 'type', lt.id);
                            if (lt.l) {
                              updateLocation(loc.id, 'dimensionL', lt.l);
                              updateLocation(loc.id, 'dimensionW', lt.w);
                              updateLocation(loc.id, 'dimensionH', lt.h);
                            }
                          }}
                        />
                      ))}

                      <Text style={S.label}>Dimensions (metres)</Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {[
                          ['Length', 'dimensionL'],
                          ['Width',  'dimensionW'],
                          ['Height', 'dimensionH'],
                        ].map(([lbl, field]) => (
                          <View key={field} style={{ flex: 1 }}>
                            <Text style={S.subLabel}>{lbl}</Text>
                            <TextInput
                              value={(loc as any)[field]}
                              onChangeText={v => updateLocation(loc.id, field, v)}
                              placeholder={lbl[0]}
                              placeholderTextColor="#9ca3af"
                              style={S.input}
                              keyboardType="decimal-pad"
                            />
                          </View>
                        ))}
                      </View>

                      <View style={S.toggleRow}>
                        <Text style={S.label}>Aisle required?</Text>
                        <Switch value={loc.hasAisle} onValueChange={v => updateLocation(loc.id, 'hasAisle', v)} trackColor={{ true: '#1b4f72', false: '#d1d5db' }} />
                      </View>
                      {loc.hasAisle && (
                        <>
                          <Text style={S.subLabel}>Aisle width (mm)</Text>
                          <TextInput value={loc.aisleWidth} onChangeText={v => updateLocation(loc.id, 'aisleWidth', v)} placeholder="800" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />
                        </>
                      )}

                      {barForms.length > 0 && (
                        <>
                          <Text style={S.label}>Serves which bars?</Text>
                          <View style={S.chipRow}>
                            {barForms.map((bar, bi) => (
                              <Chip
                                key={bar.id}
                                label={bar.name.trim() || `Bar ${bi + 1}`}
                                selected={loc.barsServed.includes(bar.id)}
                                onPress={() => toggleLocationBar(loc.id, bar.id)}
                              />
                            ))}
                          </View>
                        </>
                      )}
                    </>
                  )}
                </View>
              ))}

              <TouchableOpacity style={S.addBtn} onPress={addLocation}>
                <Text style={S.addBtnText}>+ Add another location</Text>
              </TouchableOpacity>

              <SaveButton label="Save locations →" savingKey="locations" saving={saving} onPress={saveLocations} />
            </>
          )}
          </>)}
        </View>

        {/* ── SECTION 4: Supplier setup ── */}
        <View
          style={S.section}
          onLayout={(e) => {
            const y = e.nativeEvent.layout.y;
            sectionLayouts.current[4] = y;
            if (pendingScrollSection.current === 4) {
              pendingScrollSection.current = null;
              scrollViewRef.current?.scrollTo({ y: y - 8, animated: true });
            }
          }}
        >
          <SectionHeader
            n="4" title="Supplier setup"
            complete={progress.suppliers}
            expanded={expandedSection === 4}
            onPress={() => handleSectionPress(4)}
            summary={getSectionSummary(4)}
            unsaved={isDirty(4)}
          />
          {expandedSection === 4 && (<>
          <Text style={S.sectionIntro}>Which suppliers are delivering to this event?</Text>

          <Text style={S.helper}>{venueSuppliers.length} supplier{venueSuppliers.length !== 1 ? 's' : ''} configured</Text>
          <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate('Suppliers')}>
            <Text style={S.navBtnText}>View / manage suppliers →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate('Orders')}>
            <Text style={S.navBtnText}>Scan a supplier invoice →</Text>
          </TouchableOpacity>

          {venueSuppliers.length === 0 ? (
            <View style={S.infoBox}>
              <Text style={S.infoText}>No suppliers set up yet. Add suppliers in the app, then return here to configure delivery details.</Text>
            </View>
          ) : (
            venueSuppliers.map((sup, i) => {
              const cfg = supplierCfg[sup.id] || {};
              return (
                <View key={sup.id} style={S.subCard}>
                  <ItemRow
                    name={sup.name || sup.id}
                    summary={getSupplierSummary(sup)}
                    hint={getSupplierHint(sup)}
                    expanded={expandedSupplier === sup.id}
                    onPress={() => setExpandedSupplier(expandedSupplier === sup.id ? null : sup.id)}
                  />
                  {expandedSupplier === sup.id && (
                    <>
                      <View style={S.toggleRow}>
                        <Text style={S.label}>Include this supplier?</Text>
                        <Switch
                          value={!!cfg.selected}
                          onValueChange={v => updateSup(sup.id, 'selected', v)}
                          trackColor={{ true: '#1b4f72', false: '#d1d5db' }}
                        />
                      </View>
                      {cfg.selected && (
                        <>
                          <Text style={S.label}>Delivery date</Text>
                          <TouchableOpacity
                            style={[S.input, { backgroundColor: c.surface, borderColor: c.border }]}
                            onPress={() => setDeliveryPickerFor(sup.id)}
                          >
                            <Text style={{ fontSize: 14, color: cfg.deliveryDate ? c.navy : c.slateMid }}>
                              {cfg.deliveryDate || 'Select date'}
                            </Text>
                          </TouchableOpacity>
                          {deliveryPickerFor === sup.id && (
                            <DateTimePicker
                              value={ddmmyyyyToDate(cfg.deliveryDate || '') || new Date()}
                              mode="date"
                              display="default"
                              onChange={(event: any, selectedDate?: Date) => {
                                setDeliveryPickerFor(null);
                                if (event?.type === 'dismissed' || !selectedDate) return;
                                updateSup(sup.id, 'deliveryDate', dateToDdmmyyyy(selectedDate));
                              }}
                            />
                          )}

                          <Text style={S.label}>Return policy</Text>
                          {RETURN_POLICIES.map(rp => (
                            <RadioCard key={rp.id} label={rp.label} selected={(cfg.returnPolicy || 'sale_or_return') === rp.id} onPress={() => updateSup(sup.id, 'returnPolicy', rp.id)} />
                          ))}

                          <View style={S.toggleRow}>
                            <Text style={S.label}>CHEP pallets?</Text>
                            <Switch value={!!cfg.chepEnabled} onValueChange={v => updateSup(sup.id, 'chepEnabled', v)} trackColor={{ true: '#1b4f72', false: '#d1d5db' }} />
                          </View>
                          {cfg.chepEnabled && (
                            <>
                              <Text style={S.subLabel}>Expected pallet count</Text>
                              <TextInput value={cfg.chepPalletCount || ''} onChangeText={v => updateSup(sup.id, 'chepPalletCount', v)} placeholder="e.g. 12" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />
                              <Text style={S.subLabel}>CHEP account number</Text>
                              <TextInput value={cfg.chepAccountNumber || ''} onChangeText={v => updateSup(sup.id, 'chepAccountNumber', v)} placeholder="e.g. 1234567" placeholderTextColor="#9ca3af" style={S.input} />
                            </>
                          )}

                          <Text style={S.label}>Return allowance</Text>
                          <Text style={S.helper}>Maximum % of ordered stock this supplier will accept back. Check your agreement — 5% is a conservative default.</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 2 }}>
                            <TouchableOpacity
                              onPress={() => updateSup(sup.id, 'returnAllowancePercent', Math.max(1, (cfg.returnAllowancePercent ?? 5) - 1))}
                              style={S.stepperBtn}
                            >
                              <Text style={S.stepperBtnText}>−</Text>
                            </TouchableOpacity>
                            <Text style={S.stepperVal}>{cfg.returnAllowancePercent ?? 5}%</Text>
                            <TouchableOpacity
                              onPress={() => updateSup(sup.id, 'returnAllowancePercent', Math.min(20, (cfg.returnAllowancePercent ?? 5) + 1))}
                              style={S.stepperBtn}
                            >
                              <Text style={S.stepperBtnText}>+</Text>
                            </TouchableOpacity>
                          </View>
                          <Text style={S.helper}>Range: 1–20%. Some suppliers accept up to 10–20% — check your agreement first.</Text>
                        </>
                      )}
                    </>
                  )}
                </View>
              );
            })
          )}

          <SaveButton label="Save supplier config →" savingKey="suppliers" saving={saving} onPress={saveSuppliers} />
          </>)}
        </View>

        {/* ── SECTION 5: Product planning ── */}
        <View
          style={S.section}
          onLayout={(e) => {
            const y = e.nativeEvent.layout.y;
            sectionLayouts.current[5] = y;
            if (pendingScrollSection.current === 5) {
              pendingScrollSection.current = null;
              scrollViewRef.current?.scrollTo({ y: y - 8, animated: true });
            }
          }}
        >
          <SectionHeader
            n="5" title="Product planning"
            complete={progress.productPlanning}
            expanded={expandedSection === 5}
            onPress={() => handleSectionPress(5)}
            summary={getSectionSummary(5)}
            unsaved={isDirty(5)}
          />
          {expandedSection === 5 && (<>

          <Text style={S.helper}>{products.length} product{products.length !== 1 ? 's' : ''} in catalogue</Text>
          <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate('Products')}>
            <Text style={S.navBtnText}>View / manage products →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate('Products')}>
            <Text style={S.navBtnText}>Scan a barcode →</Text>
          </TouchableOpacity>

          <Text style={S.label}>Categories selling at this event</Text>
          <View style={S.chipRow}>
            {CATEGORIES.map(cat => (
              <Chip
                key={cat.id}
                label={cat.label}
                selected={categories.includes(cat.id)}
                onPress={() => setCategories(prev => prev.includes(cat.id) ? prev.filter(c => c !== cat.id) : [...prev, cat.id])}
              />
            ))}
          </View>

          <Text style={S.label}>Price positioning</Text>
          {PRICE_POSITIONS.map(pp => (
            <RadioCard key={pp.id} label={pp.label} sub={pp.sub} selected={pricePosition === pp.id} onPress={() => setPricePosition(pp.id)} />
          ))}

          <View style={S.toggleRow}>
            <Text style={S.label}>Any zone exclusivity?</Text>
            <Switch value={hasExclusivity} onValueChange={setHasExclusivity} trackColor={{ true: '#1b4f72', false: '#d1d5db' }} />
          </View>
          {hasExclusivity && (
            <>
              <Text style={S.helper}>e.g. Beer Garden — Lion brands only</Text>
              <TextInput
                value={exclusivityNote}
                onChangeText={setExclusivityNote}
                placeholder="Describe any exclusivity requirements"
                placeholderTextColor="#9ca3af"
                style={[S.input, { minHeight: 64 }]}
                multiline
              />
            </>
          )}

          <SaveButton label="Save product planning →" savingKey="products" saving={saving} onPress={saveProductPlanning} />
          </>)}
        </View>

        {/* ── SECTION 6: Historical data ── */}
        <View
          style={S.section}
          onLayout={(e) => {
            const y = e.nativeEvent.layout.y;
            sectionLayouts.current[6] = y;
            if (pendingScrollSection.current === 6) {
              pendingScrollSection.current = null;
              scrollViewRef.current?.scrollTo({ y: y - 8, animated: true });
            }
          }}
        >
          <SectionHeader
            n="6" title="Historical data"
            complete={progress.historicalData}
            expanded={expandedSection === 6}
            onPress={() => handleSectionPress(6)}
            summary={getSectionSummary(6)}
            unsaved={isDirty(6)}
          />
          {expandedSection === 6 && (<>

          <View style={S.comingSoonBadge}>
            <Text style={S.comingSoonBadgeText}>CSV import — Phase 4</Text>
          </View>

          <Text style={S.sectionIntro}>
            Have you run this event before? Upload last year's data to improve your purchasing prediction.
          </Text>

          <View style={S.toggleRow}>
            <Text style={S.label}>This is a new event</Text>
            <Switch value={isNewEvent} onValueChange={setIsNewEvent} trackColor={{ true: '#1b4f72', false: '#d1d5db' }} />
          </View>

          {!isNewEvent && (
            <>
              <Text style={S.label}>Prior year attendance</Text>
              <TextInput value={priorAttendance} onChangeText={setPriorAttendance} placeholder="e.g. 8000" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numeric" />

              <Text style={S.label}>Notes — changes, weather, context</Text>
              <TextInput
                value={historyNotes}
                onChangeText={setHistoryNotes}
                placeholder="e.g. Added second stage, expected +20% attendance"
                placeholderTextColor="#9ca3af"
                style={[S.input, { minHeight: 80 }]}
                multiline
              />

              <View style={S.infoBox}>
                <Text style={S.infoText}>📎 CSV / PDF upload coming in Phase 4. Notes above are used in the meantime.</Text>
              </View>
            </>
          )}

          {/* Contracts */}
          <View style={[S.infoBox, { marginTop: 16, borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }]}>
            <Text style={[S.infoText, { color: '#1e40af', fontWeight: '700', marginBottom: 4 }]}>
              Supplier contracts
            </Text>
            <Text style={[S.infoText, { color: '#374151' }]}>
              {contractCount > 0
                ? `${contractCount} contract${contractCount !== 1 ? 's' : ''} uploaded. We use these to track minimum volume obligations in your suggested order.`
                : 'Upload supplier contracts and we\'ll automatically track minimum volume commitments and factor them into your suggested order.'}
            </Text>
            <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate('FestivalContracts')}>
              <Text style={S.navBtnText}>
                {contractCount > 0 ? `View contracts (${contractCount}) →` : 'Upload a contract →'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Historical data import */}
          <View style={[S.infoBox, { marginTop: 16, borderColor: historicalDataCount > 0 ? '#86efac' : '#bfdbfe', backgroundColor: historicalDataCount > 0 ? '#f0fdf4' : '#eff6ff' }]}>
            <Text style={[S.infoText, { fontWeight: '700', color: historicalDataCount > 0 ? '#16a34a' : '#1e40af', marginBottom: 4 }]}>
              {historicalDataCount > 0 ? '✓ Prior year data imported' : 'Prior year data (optional)'}
            </Text>
            <Text style={[S.infoText, { color: '#374151' }]}>
              {historicalDataCount > 0
                ? `${historicalDataCount} year${historicalDataCount !== 1 ? 's' : ''} of data imported — your AI prediction uses actual history (HIGH confidence).`
                : 'Import last year\'s sales figures to improve prediction accuracy from MEDIUM to HIGH confidence.'}
            </Text>
            <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate('FestivalHistoricalData')}>
              <Text style={S.navBtnText}>
                {historicalDataCount > 0 ? 'Manage historical data →' : 'Import prior year data →'}
              </Text>
            </TouchableOpacity>
          </View>

          <SaveButton label="Save →" savingKey="historical" saving={saving} onPress={saveHistorical} />
          </>)}
        </View>

      </ScrollView>

      {/* Toast */}
      {toast ? (
        <View style={S.toast} pointerEvents="none">
          <Text style={S.toastText}>{toast}</Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ─── SaveButton ───────────────────────────────────────────────────────────────
function SaveButton({ label, savingKey, saving, onPress }: any) {
  const isThisOne = saving === savingKey;
  return (
    <TouchableOpacity
      style={[S.saveBtn, saving && S.saveBtnDisabled]}
      onPress={onPress}
      disabled={!!saving}
    >
      {isThisOne
        ? <ActivityIndicator color="#fff" size="small" />
        : <Text style={S.saveBtnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 60 },

  // Coming soon gate
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:   { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:   { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:    { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact: { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  // Section card
  section:      { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e5e1d8' },
  sectionIntro: { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 12 },

  // Form
  label:   { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 4 },
  subLabel:{ fontSize: 12, fontWeight: '600', color: '#6b7280', marginTop: 8, marginBottom: 2 },
  helper:  { fontSize: 12, color: '#9ca3af', marginBottom: 6, lineHeight: 17 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0f172a', marginBottom: 2,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },

  // Radio card
  radio:              { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 6 },
  radioSelected:      { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  radioLabel:         { fontSize: 14, fontWeight: '600', color: '#374151' },
  radioLabelSelected: { color: '#1b4f72' },
  radioSub:           { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  // Chips
  chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 8 },
  chip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  chipOn:     { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  chipText:   { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextOn: { color: '#1b4f72', fontWeight: '700' },

  // Sub card
  subCard:      { backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  subCardTitle: { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 2 },

  // Info / locked
  infoBox:  { backgroundColor: '#eff6ff', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#bfdbfe' },
  infoText: { fontSize: 13, color: '#1e40af', lineHeight: 18 },
  lockedBox:  { backgroundColor: '#f9fafb', borderRadius: 8, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  lockedText: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  // Buttons
  saveBtn:         { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnDisabled: { opacity: 0.55 },
  saveBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  addBtn:          { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  addBtnText:      { color: '#1b4f72', fontWeight: '700', fontSize: 14 },

  // Coming soon badge (Section 6)
  comingSoonBadge:    { backgroundColor: '#fef9c3', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 10, borderWidth: 1, borderColor: '#fde68a' },
  comingSoonBadgeText:{ fontSize: 11, fontWeight: '700', color: '#92400e' },

  // Cycle box
  cycleBox:  { backgroundColor: '#eff6ff', borderRadius: 10, padding: 12, marginTop: 10, marginBottom: 4, borderWidth: 1, borderColor: '#bfdbfe' },
  cycleLabel:{ fontSize: 14, fontWeight: '700', color: '#1b4f72', marginBottom: 2 },
  cycleDesc: { fontSize: 12, color: '#6b7280', marginBottom: 6 },

  // Return allowance stepper
  stepperBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepperBtnText:{ fontSize: 20, fontWeight: '700', color: '#374151' },
  stepperVal:    { fontSize: 20, fontWeight: '800', color: '#0B132B', minWidth: 52, textAlign: 'center' },

  navBtn:     { backgroundColor: '#e8f0fe', borderRadius: 10, padding: 12, marginTop: 8, alignItems: 'center' },
  navBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },

  // Toast
  toast:     { position: 'absolute', bottom: 32, left: 24, right: 24, backgroundColor: 'rgba(27,79,114,0.95)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  toastText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
