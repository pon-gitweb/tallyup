// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { doc, setDoc, getDoc, getDocs, collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { determineCycleLength, getCycleConfig } from '../../services/festival/cycleConfig';

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ n, title, complete }: { n: string; title: string; complete: boolean }) {
  return (
    <View style={S.sectionHeader}>
      <View style={[S.badge, complete && S.badgeDone]}>
        <Text style={S.badgeText}>{complete ? '✓' : n}</Text>
      </View>
      <Text style={S.sectionTitle}>{title}</Text>
      {complete && (
        <View style={S.doneTag}>
          <Text style={S.doneTagText}>Complete</Text>
        </View>
      )}
    </View>
  );
}

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
  const venueId = useVenueId();
  const navigation = useNavigation<any>();

  // ── Section 1 state ──────────────────────────────────────────────────────
  const [eventName,      setEventName]      = useState('');
  const [eventType,      setEventType]      = useState('music_festival');
  const [startDate,      setStartDate]      = useState('');
  const [endDate,        setEndDate]        = useState('');
  const [dailyAttend,    setDailyAttend]    = useState('');
  const [numBars,        setNumBars]        = useState('1');
  const [stockModel,     setStockModel]     = useState('sale_or_return');

  // ── Section 2 state ──────────────────────────────────────────────────────
  const [barForms, setBarForms] = useState<BarForm[]>([
    { id: `bar_${Date.now()}`, name: '', location: '', fridgeService: '', fridgeDisplay: '', fridgeUnderBar: '' },
  ]);

  // ── Section 3 state ──────────────────────────────────────────────────────
  const [locationForms, setLocationForms] = useState<LocationForm[]>([
    { id: `loc_${Date.now()}`, name: '', type: '20ft_container', dimensionL: '5.9', dimensionW: '2.35', dimensionH: '2.4', hasAisle: true, aisleWidth: '800', barsServed: [] },
  ]);

  // ── Section 4 state ──────────────────────────────────────────────────────
  const [categories,       setCategories]       = useState<string[]>(['beer_cans', 'beer_draught']);
  const [pricePosition,    setPricePosition]    = useState('mid_range');
  const [hasExclusivity,   setHasExclusivity]   = useState(false);
  const [exclusivityNote,  setExclusivityNote]  = useState('');

  // ── Section 1 extra state ────────────────────────────────────────────────
  const [cycleOverride, setCycleOverride] = useState<string>('');
  const [totalBudget,   setTotalBudget]   = useState('');

  // ── Section 3 state (suppliers) ──────────────────────────────────────────
  const [venueSuppliers,  setVenueSuppliers]  = useState<any[]>([]);
  const [supplierCfg,     setSupplierCfg]     = useState<Record<string, any>>({});
  const [products,        setProducts]        = useState<any[]>([]);

  // ── Section 6 state ──────────────────────────────────────────────────────
  const [isNewEvent,      setIsNewEvent]      = useState(true);
  const [priorAttendance, setPriorAttendance] = useState('');
  const [historyNotes,    setHistoryNotes]    = useState('');

  // ── UI state ─────────────────────────────────────────────────────────────
  const [progress,      setProgress]      = useState<Progress>({ basics: false, bars: false, sourceLocations: false, productPlanning: false, suppliers: false, historicalData: false });
  const [saving,        setSaving]        = useState<string | null>(null);
  const [toast,         setToast]         = useState<string | null>(null);
  const [loadingEvent,  setLoadingEvent]  = useState(true);
  const toastTimer = useRef<any>(null);

  // ── Load existing event data ──────────────────────────────────────────────
  useEffect(() => {
    if (!venueId) { setLoadingEvent(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      setLoadingEvent(false);
      if (!snap.exists()) return;
      const d = snap.data() as any;
      if (d.eventName)        setEventName(d.eventName);
      if (d.eventType)        setEventType(d.eventType);
      if (d.startDate)        setStartDate(d.startDate);
      if (d.endDate)          setEndDate(d.endDate);
      if (d.dailyAttendance)  setDailyAttend(String(d.dailyAttendance));
      if (d.numBars)          setNumBars(String(d.numBars));
      if (d.stockModel)       setStockModel(d.stockModel);
      if (d.categories)       setCategories(d.categories);
      if (d.pricePositioning) setPricePosition(d.pricePositioning);
      if (d.exclusivity != null) { setHasExclusivity(!!d.exclusivity); setExclusivityNote(d.exclusivity || ''); }
      if (d.isNewEvent != null)  setIsNewEvent(d.isNewEvent);
      if (d.priorAttendance)     setPriorAttendance(String(d.priorAttendance));
      if (d.historicalNotes)     setHistoryNotes(d.historicalNotes);
      if (d.setupProgress)       setProgress(p => ({ ...p, ...d.setupProgress }));
      if (d.cycleOverride)       setCycleOverride(d.cycleOverride);
      if (d.totalBudget != null) setTotalBudget(String(d.totalBudget));
      // Load saved supplier configs including returnAllowancePercent
      if (d.supplierConfigs) {
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
    }, () => setLoadingEvent(false));
    return () => unsub();
  }, [venueId]);

  // ── Load existing bars (from departments) ─────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'departments')).then(snap => {
      const barDocs = snap.docs.filter(d => (d.data() as any).isFestivalBar === true);
      if (barDocs.length === 0) return;
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
    }).catch(() => {});
  }, [venueId]);

  // ── Load existing HQ storage areas ───────────────────────────────────────
  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'departments', 'hq', 'areas')).then(snap => {
      // Exclude the auto-created main-storage default area from the form
      const locDocs = snap.docs.filter(d => d.id !== 'main-storage');
      if (locDocs.length === 0) return;
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
    }).catch(() => {});
  }, [venueId]);

  // ── Load venue suppliers ──────────────────────────────────────────────────
  function loadSuppliers() {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'suppliers')).then(snap => {
      setVenueSuppliers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }).catch(() => {});
  }
  useEffect(() => { loadSuppliers(); }, [venueId]);
  useFocusEffect(useCallback(() => { loadSuppliers(); }, [venueId]));

  // ── Load venue products ───────────────────────────────────────────────────
  function loadProducts() {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }).catch(() => {});
  }
  useEffect(() => { loadProducts(); }, [venueId]);
  useFocusEffect(useCallback(() => { loadProducts(); }, [venueId]));

  // ── Date helpers ─────────────────────────────────────────────────────────
  function parseDuration(start: string, end: string): number {
    try {
      const [ds, ms, ys] = start.split('/');
      const [de, me, ye] = end.split('/');
      const startDt = new Date(parseInt(ys), parseInt(ms) - 1, parseInt(ds));
      const endDt = new Date(parseInt(ye), parseInt(me) - 1, parseInt(de));
      return Math.max(1, Math.ceil((endDt.getTime() - startDt.getTime()) / 86400000) + 1);
    } catch { return 1; }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  // ── Save functions ────────────────────────────────────────────────────────

  async function saveBasics() {
    if (!venueId) return;
    if (!eventName.trim()) { Alert.alert('Required', 'Event name is required.'); return; }
    if (!startDate || !endDate) { Alert.alert('Required', 'Start and end dates are required.'); return; }
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
        numBars: nb, stockModel,
        cycleLength: finalCycle,
        cycleOverride: cycleOverride || null,
        totalBudget: parseFloat(totalBudget) || null,
        setupProgress: newProgress,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProgress(newProgress);
      // Auto-create HQ / Central Store department if not yet created
      try {
        const hqRef = doc(db, 'venues', venueId, 'departments', 'hq');
        const hqSnap = await getDoc(hqRef);
        if (!hqSnap.exists()) {
          await setDoc(hqRef, {
            name: 'HQ — Central Store',
            type: 'hq',
            isFestivalHQ: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
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
      showToast('✓ Event basics saved');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally { setSaving(null); }
  }

  async function saveBars() {
    if (!venueId) return;
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
        const bohRef = doc(db, 'venues', venueId, 'departments', bar.id, 'areas', 'back-of-house');
        const bohSnap = await getDoc(bohRef);
        if (!bohSnap.exists()) {
          await setDoc(bohRef, {
            name: 'Back of house',
            type: 'bar-storage',
            isDefault: true,
            createdAt: serverTimestamp(),
          });
        }
      }
      const newProgress = { ...progress, bars: true };
      await setDoc(doc(db, 'venues', venueId, 'event', 'details'), { setupProgress: newProgress, updatedAt: serverTimestamp() }, { merge: true });
      setProgress(newProgress);
      showToast('✓ Bars saved');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally { setSaving(null); }
  }

  async function saveLocations() {
    if (!venueId) return;
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
      showToast('✓ Source locations saved');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally { setSaving(null); }
  }

  async function saveProductPlanning() {
    if (!venueId) return;
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
      showToast('✓ Product planning saved');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally { setSaving(null); }
  }

  async function saveSuppliers() {
    if (!venueId) return;
    setSaving('suppliers');
    try {
      // Supplier configs stored as a map on the event details document
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
      showToast('✓ Supplier config saved');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally { setSaving(null); }
  }

  async function saveHistorical() {
    if (!venueId) return;
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
      showToast('✓ Historical data saved');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally { setSaving(null); }
  }

  // ── Bar form helpers ──────────────────────────────────────────────────────
  function addBar() {
    setBarForms(prev => [...prev, { id: `bar_${Date.now()}`, name: '', location: '', fridgeService: '', fridgeDisplay: '', fridgeUnderBar: '' }]);
  }
  function updateBar(id: string, field: string, value: string) {
    setBarForms(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  }

  // ── Location form helpers ─────────────────────────────────────────────────
  function addLocation() {
    setLocationForms(prev => [...prev, { id: `loc_${Date.now()}`, name: '', type: '20ft_container', dimensionL: '5.9', dimensionW: '2.35', dimensionH: '2.4', hasAisle: true, aisleWidth: '800', barsServed: [] }]);
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

  // ── Coming-soon gate (all hooks called above) ─────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* Progress overview */}
        <View style={S.progressCard}>
          <Text style={S.progressTitle}>Setup progress</Text>
          {[
            ['Event basics',      progress.basics],
            ['Bar configuration', progress.bars],
            ['Source locations',  progress.sourceLocations],
            ['Supplier setup',    progress.suppliers],
            ['Product planning',  progress.productPlanning],
            ['Historical data',   progress.historicalData],
          ].map(([label, done]) => (
            <View key={label as string} style={S.progressRow}>
              <Text style={(done as boolean) ? S.dotDone : S.dotPending}>{(done as boolean) ? '●' : '○'}</Text>
              <Text style={[S.progressLabel, (done as boolean) && S.progressLabelDone]}>{label as string}</Text>
              {(done as boolean) && <Text style={S.check}>✓</Text>}
            </View>
          ))}
        </View>

        {/* ── SECTION 1: Event basics ── */}
        <View style={S.section}>
          <SectionHeader n="1" title="Event basics" complete={progress.basics} />

          <Text style={S.label}>Event name *</Text>
          <TextInput value={eventName} onChangeText={setEventName} placeholder="e.g. Winery Summer Fest 2025" placeholderTextColor="#9ca3af" style={S.input} />

          <Text style={S.label}>Event type</Text>
          {EVENT_TYPES.map(et => (
            <RadioCard key={et.id} label={et.label} selected={eventType === et.id} onPress={() => setEventType(et.id)} />
          ))}

          <Text style={S.label}>Start date *</Text>
          <TextInput value={startDate} onChangeText={setStartDate} placeholder="DD/MM/YYYY" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numbers-and-punctuation" />

          <Text style={S.label}>End date *</Text>
          <Text style={S.helper}>Same as start date = single-day event</Text>
          <TextInput value={endDate} onChangeText={setEndDate} placeholder="DD/MM/YYYY" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numbers-and-punctuation" />

          {/* Cycle length auto-detection (FIX 2) */}
          {startDate && endDate && (() => {
            const dur = parseDuration(startDate, endDate);
            if (dur <= 0) return null;
            const auto = determineCycleLength(dur);
            const cfgAuto = getCycleConfig(auto);
            return (
              <View style={S.cycleBox}>
                <Text style={S.cycleLabel}>Reporting cycle: {cfgAuto.cycleLabel}</Text>
                <Text style={S.cycleDesc}>{cfgAuto.cycleDescription}</Text>
                <Text style={[S.label, { marginTop: 8 }]}>Override cycle? (optional)</Text>
                {(['session', 'daily', 'weekly'] as const).map(cl => {
                  const clCfg = getCycleConfig(cl);
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

          <SaveButton label="Save and continue →" savingKey="basics" saving={saving} onPress={saveBasics} />
        </View>

        {/* ── SECTION 2: Bar configuration ── */}
        <View style={S.section}>
          <SectionHeader n="2" title="Bar configuration" complete={progress.bars} />
          {!progress.basics ? (
            <LockedBox text="Complete Event Basics first to configure your bars." />
          ) : (
            <>
              {barForms.map((bar, i) => (
                <View key={bar.id} style={S.subCard}>
                  <Text style={S.subCardTitle}>Bar {i + 1}</Text>

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
                    <Text style={S.infoText}>Primary source location set up after adding source locations in Section 3.</Text>
                  </View>
                </View>
              ))}

              <TouchableOpacity style={S.addBtn} onPress={addBar}>
                <Text style={S.addBtnText}>+ Add another bar</Text>
              </TouchableOpacity>

              <SaveButton label="Save bars →" savingKey="bars" saving={saving} onPress={saveBars} />
            </>
          )}
        </View>

        {/* ── SECTION 3: Source locations ── */}
        <View style={S.section}>
          <SectionHeader n="3" title="Source locations" complete={progress.sourceLocations} />
          {!progress.basics ? (
            <LockedBox text="Complete Event Basics first." />
          ) : (
            <>
              {locationForms.map((loc, i) => (
                <View key={loc.id} style={S.subCard}>
                  <Text style={S.subCardTitle}>Location {i + 1}</Text>

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
                </View>
              ))}

              <TouchableOpacity style={S.addBtn} onPress={addLocation}>
                <Text style={S.addBtnText}>+ Add another location</Text>
              </TouchableOpacity>

              <SaveButton label="Save locations →" savingKey="locations" saving={saving} onPress={saveLocations} />
            </>
          )}
        </View>

        {/* ── SECTION 4: Supplier setup ── */}
        <View style={S.section}>
          <SectionHeader n="4" title="Supplier setup" complete={progress.suppliers} />
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
            venueSuppliers.map(sup => {
              const cfg = supplierCfg[sup.id] || {};
              return (
                <View key={sup.id} style={S.subCard}>
                  <View style={S.toggleRow}>
                    <Text style={S.subCardTitle}>{sup.name || sup.id}</Text>
                    <Switch
                      value={!!cfg.selected}
                      onValueChange={v => updateSup(sup.id, 'selected', v)}
                      trackColor={{ true: '#1b4f72', false: '#d1d5db' }}
                    />
                  </View>
                  {cfg.selected && (
                    <>
                      <Text style={S.label}>Delivery date</Text>
                      <TextInput value={cfg.deliveryDate || ''} onChangeText={v => updateSup(sup.id, 'deliveryDate', v)} placeholder="DD/MM/YYYY" placeholderTextColor="#9ca3af" style={S.input} keyboardType="numbers-and-punctuation" />

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
                </View>
              );
            })
          )}

          <SaveButton label="Save supplier config →" savingKey="suppliers" saving={saving} onPress={saveSuppliers} />
        </View>

        {/* ── SECTION 5: Product planning ── */}
        <View style={S.section}>
          <SectionHeader n="5" title="Product planning" complete={progress.productPlanning} />

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
        </View>

        {/* ── SECTION 6: Historical data ── */}
        <View style={S.section}>
          <SectionHeader n="6" title="Historical data" complete={progress.historicalData} />

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

          <SaveButton label="Save →" savingKey="historical" saving={saving} onPress={saveHistorical} />
        </View>

      </ScrollView>

      {/* Toast */}
      {toast ? (
        <View style={S.toast} pointerEvents="none">
          <Text style={S.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── SaveButton helper ────────────────────────────────────────────────────────
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

  // Progress card
  progressCard:      { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e5e1d8' },
  progressTitle:     { fontSize: 12, fontWeight: '700', color: '#0B132B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  progressRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  dotDone:           { fontSize: 14, color: '#1b4f72', marginRight: 10 },
  dotPending:        { fontSize: 14, color: '#d1d5db', marginRight: 10 },
  progressLabel:     { flex: 1, fontSize: 14, color: '#6b7280' },
  progressLabelDone: { color: '#0B132B', fontWeight: '600' },
  check:             { fontSize: 13, color: '#1b4f72', fontWeight: '700' },

  // Section card
  section:      { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e5e1d8' },
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  badge:        { width: 28, height: 28, borderRadius: 14, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  badgeDone:    { backgroundColor: '#1b4f72' },
  badgeText:    { fontSize: 13, fontWeight: '800', color: '#fff' },
  sectionTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: '#0B132B' },
  doneTag:      { backgroundColor: '#eff6ff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  doneTagText:  { fontSize: 11, fontWeight: '700', color: '#1b4f72' },
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
  radio:           { borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 6 },
  radioSelected:   { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  radioLabel:      { fontSize: 14, fontWeight: '600', color: '#374151' },
  radioLabelSelected: { color: '#1b4f72' },
  radioSub:        { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  // Chips
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 8 },
  chip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  chipOn:      { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  chipText:    { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextOn:  { color: '#1b4f72', fontWeight: '700' },

  // Sub card
  subCard:      { backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  subCardTitle: { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 2 },

  // Info / locked
  infoBox:  { backgroundColor: '#eff6ff', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#bfdbfe' },
  infoText: { fontSize: 13, color: '#1e40af', lineHeight: 18 },
  lockedBox:  { backgroundColor: '#f9fafb', borderRadius: 8, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  lockedText: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  // Buttons
  saveBtn:        { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnDisabled:{ opacity: 0.55 },
  saveBtnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  addBtn:         { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  addBtnText:     { color: '#1b4f72', fontWeight: '700', fontSize: 14 },

  // Coming soon badge (Section 6)
  comingSoonBadge:    { backgroundColor: '#fef9c3', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 10, borderWidth: 1, borderColor: '#fde68a' },
  comingSoonBadgeText:{ fontSize: 11, fontWeight: '700', color: '#92400e' },

  // Cycle box (FIX 2)
  cycleBox:  { backgroundColor: '#eff6ff', borderRadius: 10, padding: 12, marginTop: 10, marginBottom: 4, borderWidth: 1, borderColor: '#bfdbfe' },
  cycleLabel:{ fontSize: 14, fontWeight: '700', color: '#1b4f72', marginBottom: 2 },
  cycleDesc: { fontSize: 12, color: '#6b7280', marginBottom: 6 },

  // Return allowance stepper (FIX 1)
  stepperBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepperBtnText:{ fontSize: 20, fontWeight: '700', color: '#374151' },
  stepperVal:    { fontSize: 20, fontWeight: '800', color: '#0B132B', minWidth: 52, textAlign: 'center' },

  navBtn:        { backgroundColor: '#e8f0fe', borderRadius: 10, padding: 12, marginTop: 8, alignItems: 'center' },
  navBtnText:    { color: '#1b4f72', fontWeight: '700', fontSize: 14 },

  // Toast
  toast:     { position: 'absolute', bottom: 32, left: 24, right: 24, backgroundColor: 'rgba(27,79,114,0.95)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  toastText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
