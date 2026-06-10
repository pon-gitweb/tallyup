// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, Modal, FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import {
  collection, doc, getDocs, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { matchProductInList } from '../../services/matching';
import {
  detectSalesPeriod, detectPOSFormat, detectColumns,
} from '../../services/festival/salesData';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase =
  | 'choose'
  | 'upload-loading'
  | 'upload-period'
  | 'upload-format'
  | 'upload-mapping'
  | 'upload-review'
  | 'manual-period'
  | 'manual-bar'
  | 'manual-entry'
  | 'manual-review';

type ProductMapping = { productId: string; productName: string } | 'skip' | null;
type BarMapping = { barId: string; barName: string } | 'all' | null;

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

function tryParseDate(s: string): Date | null {
  if (!s?.trim()) return null;
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const parts = s.split('/');
  if (parts.length === 3) {
    // DD/MM/YYYY
    d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function normBarName(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function barFuzzyMatch(posLoc: string, bars: { id: string; name: string }[]) {
  if (!posLoc.trim() || bars.length === 0) return null;
  const norm = normBarName(posLoc);
  const exact = bars.find(b => normBarName(b.name) === norm);
  if (exact) return exact;
  // partial
  for (const b of bars) {
    if (normBarName(b.name).includes(norm) || norm.includes(normBarName(b.name))) return b;
  }
  return null;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalSalesUploadScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const uid = auth.currentUser?.uid ?? 'unknown';
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();

  const [phase, setPhase] = useState<Phase>('choose');
  const [saving, setSaving] = useState(false);

  // Shared data loaded once
  const [festivalProducts, setFestivalProducts] = useState<any[]>([]);
  const [bars, setBars] = useState<{ id: string; name: string }[]>([]);
  const [eventDetails, setEventDetails] = useState<any>(null);
  const [existingMappings, setExistingMappings] = useState<any>(null);

  // Upload path state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [detectedFormat, setDetectedFormat] = useState<string>('unknown');
  const [colProduct, setColProduct] = useState(-1);
  const [colQty, setColQty] = useState(-1);
  const [colDate, setColDate] = useState(-1);
  const [colLocation, setColLocation] = useState(-1);
  const [colRevenue, setColRevenue] = useState(-1);
  const [periodStart, setPeriodStart] = useState<Date | null>(null);
  const [periodEnd, setPeriodEnd] = useState<Date | null>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [uniquePosProducts, setUniquePosProducts] = useState<string[]>([]);
  const [uniquePosLocations, setUniquePosLocations] = useState<string[]>([]);
  const [productMappings, setProductMappings] = useState<Record<string, ProductMapping>>({});
  const [barMappings, setBarMappings] = useState<Record<string, BarMapping>>({});
  const [noLocationMode, setNoLocationMode] = useState<'all' | 'specific'>('all');
  const [noLocationBarId, setNoLocationBarId] = useState<string | null>(null);

  // Picker modal state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerForKey, setPickerForKey] = useState('');
  const [pickerType, setPickerType] = useState<'product' | 'bar'>('product');
  const [pickerSearch, setPickerSearch] = useState('');

  // Column mapper (when format is unknown)
  const [showColumnMapper, setShowColumnMapper] = useState(false);

  // Manual path state
  const [manualPeriodType, setManualPeriodType] = useState<'today' | 'yesterday' | 'week' | 'custom'>('today');
  const [manualPeriodStart, setManualPeriodStart] = useState<Date>(new Date());
  const [manualPeriodEnd, setManualPeriodEnd] = useState<Date>(new Date());
  const [manualPeriodLabel, setManualPeriodLabel] = useState('');
  const [manualBarId, setManualBarId] = useState<string | null>(null);
  const [manualCounts, setManualCounts] = useState<Record<string, string>>({});
  const [showRevenue, setShowRevenue] = useState(false);
  const [manualRevenues, setManualRevenues] = useState<Record<string, string>>({});

  // Load shared data once
  useEffect(() => {
    if (!venueId) return;
    Promise.all([
      getDocs(collection(db, 'venues', venueId, 'products')),
      getDocs(collection(db, 'venues', venueId, 'bars')),
      getDoc(doc(db, 'venues', venueId, 'event', 'details')),
      getDoc(doc(db, 'venues', venueId, 'event', 'details', 'posMappings', 'current')),
    ]).then(([prodSnap, barSnap, evSnap, mappingsSnap]) => {
      setFestivalProducts(prodSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setBars(barSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })));
      setEventDetails(evSnap.exists() ? evSnap.data() : null);
      setExistingMappings(mappingsSnap.exists() ? mappingsSnap.data() : null);
    }).catch(() => {});
  }, [venueId]);

  // ── Coming-soon gate ────────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.csEmoji}>📊</Text>
        <Text style={S.csTitle}>Sales data upload</Text>
        <Text style={S.csBody}>This feature is coming soon as part of Festival Mode.</Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  // ── Phase helpers ───────────────────────────────────────────────────────────

  async function handlePickFile() {
    setPhase('upload-loading');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'text/comma-separated-values', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) {
        setPhase('choose');
        return;
      }
      const asset = result.assets[0];
      const content = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const { headers, rows } = parseCSV(content);
      if (headers.length === 0) {
        showError('Could not read file — make sure it is a CSV with column headers in the first row.');
        setPhase('choose');
        return;
      }

      const format = detectPOSFormat(headers);
      const cols = detectColumns(headers, format);

      setCsvHeaders(headers);
      setCsvRows(rows);
      setDetectedFormat(format);
      setColProduct(cols.product);
      setColQty(cols.qty);
      setColDate(cols.date);
      setColLocation(cols.location);
      setColRevenue(cols.revenue);
      setShowColumnMapper(format === 'unknown');

      // Period detection
      const allDates: Date[] = [];
      if (cols.date >= 0) {
        rows.forEach(row => {
          const d = tryParseDate(row[cols.date]);
          if (d) allDates.push(d);
        });
      }

      const eventStart = parseEventDate(eventDetails?.startDate) ?? new Date();
      const cycleLength = eventDetails?.cycleLength ?? 'daily';
      const period = detectSalesPeriod(allDates, eventStart, cycleLength);

      setPeriodStart(allDates.length > 0 ? period.periodStart : new Date());
      setPeriodEnd(allDates.length > 0 ? period.periodEnd : new Date());
      setPeriodLabel(allDates.length > 0 ? period.periodLabel : 'Today');

      // Unique POS products and locations
      const posProds = new Set<string>();
      const posLocs = new Set<string>();
      rows.forEach(row => {
        if (cols.product >= 0 && row[cols.product]?.trim()) posProds.add(row[cols.product].trim());
        if (cols.location >= 0 && row[cols.location]?.trim()) posLocs.add(row[cols.location].trim());
      });

      const prodList = [...posProds];
      const locList = [...posLocs];
      setUniquePosProducts(prodList);
      setUniquePosLocations(locList);

      // Auto-match products using existing mappings or fuzzy match
      const initialProductMappings: Record<string, ProductMapping> = {};
      for (const posName of prodList) {
        const savedId = existingMappings?.products?.[posName];
        const savedProduct = savedId ? festivalProducts.find(p => p.id === savedId) : null;
        if (savedProduct) {
          initialProductMappings[posName] = { productId: savedProduct.id, productName: savedProduct.name };
        } else {
          const match = matchProductInList(festivalProducts, { name: posName });
          if (match.match && match.confidence >= 0.6) {
            initialProductMappings[posName] = { productId: match.match.id, productName: match.match.name };
          } else {
            initialProductMappings[posName] = null;
          }
        }
      }
      setProductMappings(initialProductMappings);

      // Auto-match bars
      const initialBarMappings: Record<string, BarMapping> = {};
      for (const posLoc of locList) {
        const savedId = existingMappings?.bars?.[posLoc];
        const savedBar = savedId ? bars.find(b => b.id === savedId) : null;
        if (savedBar) {
          initialBarMappings[posLoc] = { barId: savedBar.id, barName: savedBar.name };
        } else {
          const matched = barFuzzyMatch(posLoc, bars);
          if (matched) {
            initialBarMappings[posLoc] = { barId: matched.id, barName: matched.name };
          } else {
            initialBarMappings[posLoc] = null;
          }
        }
      }
      setBarMappings(initialBarMappings);

      setPhase('upload-period');
    } catch (e: any) {
      showError(e?.message || 'Error reading file — please try a different file.');
      setPhase('choose');
    }
  }

  function parseEventDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const parts = s.split('/');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      if (!isNaN(d.getTime())) return d;
    }
    return tryParseDate(s);
  }

  function applyColumnMapAndProceed() {
    if (colProduct < 0 || colQty < 0) {
      showInfo('Please select the product name column and quantity column.');
      return;
    }
    // Re-parse unique products/locations with new column indices
    const posProds = new Set<string>();
    const posLocs = new Set<string>();
    csvRows.forEach(row => {
      if (row[colProduct]?.trim()) posProds.add(row[colProduct].trim());
      if (colLocation >= 0 && row[colLocation]?.trim()) posLocs.add(row[colLocation].trim());
    });
    const prodList = [...posProds];
    const locList = [...posLocs];
    setUniquePosProducts(prodList);
    setUniquePosLocations(locList);

    const initialProductMappings: Record<string, ProductMapping> = {};
    for (const posName of prodList) {
      const match = matchProductInList(festivalProducts, { name: posName });
      initialProductMappings[posName] = match.match && match.confidence >= 0.6
        ? { productId: match.match.id, productName: match.match.name }
        : null;
    }
    setProductMappings(initialProductMappings);

    const initialBarMappings: Record<string, BarMapping> = {};
    for (const posLoc of locList) {
      const matched = barFuzzyMatch(posLoc, bars);
      initialBarMappings[posLoc] = matched ? { barId: matched.id, barName: matched.name } : null;
    }
    setBarMappings(initialBarMappings);

    setShowColumnMapper(false);
    setPhase('upload-mapping');
  }

  function buildUploadLineItems() {
    const lineItems: any[] = [];
    const byProductBar: Record<string, { qty: number; revenue: number | null }> = {};

    for (const row of csvRows) {
      if (colProduct < 0) continue;
      const posName = row[colProduct]?.trim();
      if (!posName) continue;
      const mapping = productMappings[posName];
      if (!mapping || mapping === 'skip') continue;

      const posLoc = colLocation >= 0 ? row[colLocation]?.trim() || '' : '';
      let barId: string | null = null;
      let barName: string | null = null;

      if (posLoc) {
        const barMap = barMappings[posLoc];
        if (barMap && barMap !== 'all') {
          barId = (barMap as any).barId;
          barName = (barMap as any).barName;
        }
      } else if (noLocationMode === 'specific' && noLocationBarId) {
        const b = bars.find(x => x.id === noLocationBarId);
        barId = noLocationBarId;
        barName = b?.name ?? null;
      }

      const qty = parseFloat(row[colQty] ?? '0') || 0;
      const rev = colRevenue >= 0 ? (parseFloat(row[colRevenue] ?? '') || null) : null;

      const key = `${mapping.productId}:${barId ?? '_all'}`;
      if (!byProductBar[key]) byProductBar[key] = { qty: 0, revenue: null };
      byProductBar[key].qty += qty;
      if (rev != null) {
        if (byProductBar[key].revenue === null) byProductBar[key].revenue = 0;
        byProductBar[key].revenue! += rev;
      }

      // ensure entry exists in lineItems (will dedupe by key)
      const exists = lineItems.find(l => l._key === key);
      if (!exists) {
        lineItems.push({
          _key: key,
          productId: mapping.productId,
          productName: mapping.productName,
          barId,
          barName,
          unitsSold: 0,
          revenue: null,
        });
      }
    }

    // Fill aggregated quantities
    for (const l of lineItems) {
      const agg = byProductBar[l._key];
      l.unitsSold = agg?.qty ?? 0;
      l.revenue = agg?.revenue ?? null;
      delete l._key;
    }

    return lineItems.filter(l => l.unitsSold > 0);
  }

  async function saveUpload() {
    if (!venueId) return;
    setSaving(true);
    try {
      const lineItems = buildUploadLineItems();
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = serverTimestamp();

      await setDoc(doc(db, 'venues', venueId, 'event', 'details', 'salesData', uploadId), {
        uploadedAt: now,
        uploadedBy: uid,
        source: 'pos-upload',
        format: detectedFormat,
        periodStart: periodStart,
        periodEnd: periodEnd,
        periodLabel,
        lineItems,
        status: 'applied',
      });

      // Save mappings for future uploads
      const savedProducts: Record<string, string> = {};
      for (const [posName, mapping] of Object.entries(productMappings)) {
        if (mapping && mapping !== 'skip') savedProducts[posName] = mapping.productId;
      }
      const savedBars: Record<string, string> = {};
      for (const [posLoc, mapping] of Object.entries(barMappings)) {
        if (mapping && mapping !== 'all') savedBars[posLoc] = (mapping as any).barId;
      }
      await setDoc(doc(db, 'venues', venueId, 'event', 'details', 'posMappings', 'current'), {
        products: savedProducts,
        bars: savedBars,
        lastUpdated: now,
      }, { merge: true });

      showSuccess(`✓ ${lineItems.length} product entries recorded for ${periodLabel}.`);
      nav.goBack();
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function saveManual() {
    if (!venueId) return;
    setSaving(true);
    try {
      const lineItems: any[] = [];
      const selectedBar = manualBarId ? bars.find(b => b.id === manualBarId) : null;
      for (const p of festivalProducts) {
        const qtyStr = manualCounts[p.id];
        const qty = parseFloat(qtyStr || '0') || 0;
        if (qty <= 0) continue;
        const rev = showRevenue ? (parseFloat(manualRevenues[p.id] || '0') || null) : null;
        lineItems.push({
          productId: p.id,
          productName: p.name,
          barId: selectedBar?.id ?? null,
          barName: selectedBar?.name ?? null,
          unitsSold: qty,
          revenue: rev,
        });
      }

      if (lineItems.length === 0) {
        showInfo('Enter at least one non-zero quantity.');
        setSaving(false);
        return;
      }

      const uploadId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = serverTimestamp();

      await setDoc(doc(db, 'venues', venueId, 'event', 'details', 'salesData', uploadId), {
        uploadedAt: now,
        uploadedBy: uid,
        source: 'manual-entry',
        format: 'manual',
        periodStart: manualPeriodStart,
        periodEnd: manualPeriodEnd,
        periodLabel: manualPeriodLabel,
        lineItems,
        status: 'applied',
      });

      showSuccess(`✓ ${lineItems.length} products recorded for ${manualPeriodLabel}.`);
      nav.goBack();
    } catch (e: any) {
      showError(e?.message || 'Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }

  function computeManualPeriod(type: typeof manualPeriodType) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const weekAgo = new Date(today.getTime() - 6 * 86400000);

    const eventStart = parseEventDate(eventDetails?.startDate) ?? today;
    const dayNum = Math.max(1, Math.floor((today.getTime() - eventStart.getTime()) / 86400000) + 1);
    const weekNum = Math.ceil(dayNum / 7);

    if (type === 'today') {
      setManualPeriodStart(today);
      setManualPeriodEnd(today);
      setManualPeriodLabel(`Day ${dayNum} — ${today.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })}`);
    } else if (type === 'yesterday') {
      const yDayNum = Math.max(1, dayNum - 1);
      setManualPeriodStart(yesterday);
      setManualPeriodEnd(yesterday);
      setManualPeriodLabel(`Day ${yDayNum} — ${yesterday.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })}`);
    } else if (type === 'week') {
      setManualPeriodStart(weekAgo);
      setManualPeriodEnd(today);
      setManualPeriodLabel(`Week ${weekNum} sales`);
    }
    setManualPeriodType(type);
  }

  // ── Upload summary stats ────────────────────────────────────────────────────
  const mappedProductCount = Object.values(productMappings).filter(m => m && m !== 'skip').length;
  const skippedCount = Object.values(productMappings).filter(m => m === 'skip').length;
  const unmappedCount = uniquePosProducts.length - mappedProductCount - skippedCount;
  const mappedBarCount = uniquePosLocations.length === 0
    ? bars.length
    : Object.values(barMappings).filter(m => m && m !== 'all').length;

  const uploadLineItems = phase === 'upload-review' ? buildUploadLineItems() : [];
  const uploadTotalUnits = uploadLineItems.reduce((s, l) => s + l.unitsSold, 0);
  const uploadTotalRevenue = uploadLineItems.some(l => l.revenue != null)
    ? uploadLineItems.reduce((s, l) => s + (l.revenue ?? 0), 0)
    : null;

  // ── Product picker ──────────────────────────────────────────────────────────
  const pickerProducts = festivalProducts.filter(p =>
    !pickerSearch || p.name?.toLowerCase().includes(pickerSearch.toLowerCase())
  );
  const pickerBars = bars.filter(b =>
    !pickerSearch || b.name?.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  function openPicker(type: 'product' | 'bar', key: string) {
    setPickerType(type);
    setPickerForKey(key);
    setPickerSearch('');
    setPickerVisible(true);
  }

  function selectFromPicker(item: any) {
    if (pickerType === 'product') {
      setProductMappings(prev => ({
        ...prev,
        [pickerForKey]: { productId: item.id, productName: item.name },
      }));
    } else {
      setBarMappings(prev => ({
        ...prev,
        [pickerForKey]: { barId: item.id, barName: item.name },
      }));
    }
    setPickerVisible(false);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* ── CHOOSE ────────────────────────────────────────────────────── */}
        {phase === 'choose' && (
          <>
            <Text style={S.screenTitle}>Upload sales data</Text>
            <Text style={S.screenSub}>
              Sales data improves velocity accuracy and reconciliation precision.
              The system works without it and improves when it exists.
            </Text>

            <TouchableOpacity style={S.pathCard} onPress={handlePickFile}>
              <Text style={S.pathCardEmoji}>📄</Text>
              <View style={{ flex: 1 }}>
                <Text style={S.pathCardTitle}>Upload sales file</Text>
                <Text style={S.pathCardSub}>CSV from Square, Wavier, or any POS system</Text>
              </View>
              <Text style={S.pathCardArrow}>→</Text>
            </TouchableOpacity>

            <TouchableOpacity style={S.pathCard} onPress={() => { computeManualPeriod('today'); setPhase('manual-period'); }}>
              <Text style={S.pathCardEmoji}>✏️</Text>
              <View style={{ flex: 1 }}>
                <Text style={S.pathCardTitle}>Enter sales manually</Text>
                <Text style={S.pathCardSub}>Type in your sales figures directly</Text>
              </View>
              <Text style={S.pathCardArrow}>→</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── UPLOAD LOADING ────────────────────────────────────────────── */}
        {phase === 'upload-loading' && (
          <View style={S.centerPad}>
            <ActivityIndicator color="#1b4f72" size="large" />
            <Text style={S.loadingText}>Reading file…</Text>
          </View>
        )}

        {/* ── UPLOAD PERIOD ─────────────────────────────────────────────── */}
        {phase === 'upload-period' && (
          <>
            <Text style={S.screenTitle}>Detected period</Text>
            <View style={S.infoCard}>
              <Text style={S.infoLabel}>We detected sales data for:</Text>
              <Text style={S.infoValue}>{periodLabel || 'Unknown period'}</Text>
              {colDate < 0 && (
                <Text style={S.infoNote}>No date column found — using today as default.</Text>
              )}
            </View>
            <Text style={S.sectionLabel}>FILE DETAILS</Text>
            <View style={S.detailsCard}>
              <DetailRow label="Format" value={detectedFormat === 'unknown' ? 'Unknown — will configure' : `${detectedFormat.charAt(0).toUpperCase()}${detectedFormat.slice(1)} CSV`} />
              <DetailRow label="Rows" value={`${csvRows.length} line items`} />
              <DetailRow label="Products" value={`${uniquePosProducts.length} unique`} />
              {uniquePosLocations.length > 0 && <DetailRow label="Locations" value={`${uniquePosLocations.length} unique`} />}
            </View>

            <TouchableOpacity style={S.primaryBtn} onPress={() => {
              if (detectedFormat === 'unknown') {
                setShowColumnMapper(true);
                setPhase('upload-format');
              } else {
                setPhase('upload-mapping');
              }
            }}>
              <Text style={S.primaryBtnText}>Yes — continue →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('choose')}>
              <Text style={S.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── UPLOAD FORMAT / COLUMN MAPPER ─────────────────────────────── */}
        {phase === 'upload-format' && (
          <>
            <Text style={S.screenTitle}>Column setup</Text>
            <Text style={S.screenSub}>
              We couldn't auto-detect the format. Tell us which columns contain each value.
            </Text>
            <Text style={S.sectionLabel}>COLUMN HEADERS IN YOUR FILE</Text>
            <View style={S.infoCard}>
              {csvHeaders.map((h, i) => (
                <Text key={i} style={S.headerChip}>{i}: {h}</Text>
              ))}
            </View>

            <Text style={S.sectionLabel}>COLUMN ASSIGNMENTS</Text>
            {[
              { label: 'Product name *', value: colProduct, setter: setColProduct, required: true },
              { label: 'Quantity sold *', value: colQty, setter: setColQty, required: true },
              { label: 'Date', value: colDate, setter: setColDate, required: false },
              { label: 'Bar / location', value: colLocation, setter: setColLocation, required: false },
              { label: 'Revenue', value: colRevenue, setter: setColRevenue, required: false },
            ].map(({ label, value, setter, required }) => (
              <View key={label} style={S.colMapRow}>
                <Text style={S.colMapLabel}>{label}</Text>
                <View style={S.colMapPickers}>
                  {csvHeaders.map((h, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[S.colChip, value === i && S.colChipOn]}
                      onPress={() => setter(i)}
                    >
                      <Text style={[S.colChipText, value === i && S.colChipTextOn]}>{i}: {h.length > 12 ? h.slice(0, 12) + '…' : h}</Text>
                    </TouchableOpacity>
                  ))}
                  {!required && (
                    <TouchableOpacity style={[S.colChip, value === -1 && S.colChipOn]} onPress={() => setter(-1)}>
                      <Text style={[S.colChipText, value === -1 && S.colChipTextOn]}>None</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}

            <TouchableOpacity style={S.primaryBtn} onPress={applyColumnMapAndProceed}>
              <Text style={S.primaryBtnText}>Apply and continue →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('upload-period')}>
              <Text style={S.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── UPLOAD MAPPING ────────────────────────────────────────────── */}
        {phase === 'upload-mapping' && (
          <>
            <Text style={S.screenTitle}>Map products &amp; bars</Text>

            {/* Product mapping */}
            <Text style={S.sectionLabel}>PRODUCT MAPPING</Text>
            {uniquePosProducts.map(posName => {
              const mapping = productMappings[posName];
              return (
                <View key={posName} style={S.mapRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={S.mapPosName}>{posName}</Text>
                  </View>
                  <View style={S.mapRight}>
                    {mapping === 'skip' ? (
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <Text style={S.mapSkipText}>Skipped</Text>
                        <TouchableOpacity onPress={() => setProductMappings(p => ({ ...p, [posName]: null }))}>
                          <Text style={S.mapUndo}>undo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : mapping ? (
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <Text style={S.mapMatchText} numberOfLines={1}>{mapping.productName}</Text>
                        <TouchableOpacity onPress={() => openPicker('product', posName)}>
                          <Text style={S.mapChange}>change</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity style={S.mapSelectBtn} onPress={() => openPicker('product', posName)}>
                          <Text style={S.mapSelectBtnText}>Select ▼</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setProductMappings(p => ({ ...p, [posName]: 'skip' }))}>
                          <Text style={S.mapSkipBtn}>Skip</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}

            {/* Bar mapping */}
            {uniquePosLocations.length > 0 ? (
              <>
                <Text style={[S.sectionLabel, { marginTop: 20 }]}>BAR MAPPING</Text>
                {uniquePosLocations.map(posLoc => {
                  const mapping = barMappings[posLoc];
                  return (
                    <View key={posLoc} style={S.mapRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={S.mapPosName}>{posLoc}</Text>
                      </View>
                      <View style={S.mapRight}>
                        {mapping ? (
                          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            <Text style={S.mapMatchText} numberOfLines={1}>{(mapping as any).barName}</Text>
                            <TouchableOpacity onPress={() => openPicker('bar', posLoc)}>
                              <Text style={S.mapChange}>change</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity style={S.mapSelectBtn} onPress={() => openPicker('bar', posLoc)}>
                            <Text style={S.mapSelectBtnText}>Select ▼</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            ) : (
              <>
                <Text style={[S.sectionLabel, { marginTop: 20 }]}>BAR / LOCATION</Text>
                <Text style={S.infoNote}>No bar/location data found in file. Apply this data to:</Text>
                <View style={S.radioRow}>
                  <TouchableOpacity style={S.radioBtn} onPress={() => setNoLocationMode('all')}>
                    <View style={[S.radioCircle, noLocationMode === 'all' && S.radioCircleOn]} />
                    <Text style={S.radioLabel}>All bars combined (event total)</Text>
                  </TouchableOpacity>
                </View>
                <View style={S.radioRow}>
                  <TouchableOpacity style={S.radioBtn} onPress={() => setNoLocationMode('specific')}>
                    <View style={[S.radioCircle, noLocationMode === 'specific' && S.radioCircleOn]} />
                    <Text style={S.radioLabel}>Specific bar:</Text>
                  </TouchableOpacity>
                  {noLocationMode === 'specific' && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                      {bars.map(b => (
                        <TouchableOpacity
                          key={b.id}
                          style={[S.barChip, noLocationBarId === b.id && S.barChipOn]}
                          onPress={() => setNoLocationBarId(b.id)}
                        >
                          <Text style={[S.barChipText, noLocationBarId === b.id && S.barChipTextOn]}>{b.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </>
            )}

            <TouchableOpacity style={[S.primaryBtn, { marginTop: 24 }]} onPress={() => setPhase('upload-review')}>
              <Text style={S.primaryBtnText}>Review →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('upload-period')}>
              <Text style={S.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── UPLOAD REVIEW ─────────────────────────────────────────────── */}
        {phase === 'upload-review' && (
          <>
            <Text style={S.screenTitle}>Sales data summary</Text>
            <View style={S.reviewCard}>
              <Text style={S.reviewHeading}>SALES DATA SUMMARY</Text>
              <View style={S.reviewDivider} />
              <DetailRow label="Period" value={periodLabel} />
              <DetailRow label="Source" value={`${detectedFormat === 'unknown' ? 'CSV' : detectedFormat.charAt(0).toUpperCase() + detectedFormat.slice(1)} upload`} />
              <DetailRow label="Products mapped" value={`${mappedProductCount} of ${uniquePosProducts.length}`} />
              {uniquePosLocations.length > 0 && <DetailRow label="Bars mapped" value={`${mappedBarCount} of ${uniquePosLocations.length}`} />}
              <DetailRow label="Total units" value={`${uploadTotalUnits}`} />
              {uploadTotalRevenue != null && <DetailRow label="Total revenue" value={`$${uploadTotalRevenue.toFixed(2)}`} />}
              {skippedCount > 0 && <DetailRow label="Skipped" value={`${skippedCount} product${skippedCount > 1 ? 's' : ''}`} />}
              {unmappedCount > 0 && (
                <Text style={S.warningText}>⚠ {unmappedCount} product{unmappedCount > 1 ? 's' : ''} still unmapped — they will be skipped.</Text>
              )}
            </View>

            <TouchableOpacity
              style={[S.primaryBtn, saving && S.btnDisabled]}
              disabled={saving}
              onPress={saveUpload}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={S.primaryBtnText}>Confirm and apply</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('upload-mapping')}>
              <Text style={S.secondaryBtnText}>Edit mappings</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── MANUAL PERIOD ─────────────────────────────────────────────── */}
        {phase === 'manual-period' && (
          <>
            <Text style={S.screenTitle}>What period?</Text>
            <Text style={S.screenSub}>What period are you entering sales for?</Text>
            {(['today', 'yesterday', 'week'] as const).map(type => (
              <TouchableOpacity
                key={type}
                style={[S.periodOption, manualPeriodType === type && S.periodOptionOn]}
                onPress={() => computeManualPeriod(type)}
              >
                <View style={[S.radioCircle, manualPeriodType === type && S.radioCircleOn]} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={S.periodOptionLabel}>
                    {type === 'today' ? 'Today' : type === 'yesterday' ? 'Yesterday' : 'This week'}
                  </Text>
                  {type === 'today' && <Text style={S.periodOptionDate}>{new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>}
                  {type === 'yesterday' && <Text style={S.periodOptionDate}>{new Date(Date.now() - 86400000).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>}
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={S.primaryBtn} onPress={() => setPhase('manual-bar')}>
              <Text style={S.primaryBtnText}>Continue →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('choose')}>
              <Text style={S.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── MANUAL BAR ────────────────────────────────────────────────── */}
        {phase === 'manual-bar' && (
          <>
            <Text style={S.screenTitle}>Which bar?</Text>
            <TouchableOpacity
              style={[S.periodOption, manualBarId === null && S.periodOptionOn]}
              onPress={() => setManualBarId(null)}
            >
              <View style={[S.radioCircle, manualBarId === null && S.radioCircleOn]} />
              <Text style={[S.periodOptionLabel, { marginLeft: 12 }]}>All bars (combined total)</Text>
            </TouchableOpacity>
            {bars.map(b => (
              <TouchableOpacity
                key={b.id}
                style={[S.periodOption, manualBarId === b.id && S.periodOptionOn]}
                onPress={() => setManualBarId(b.id)}
              >
                <View style={[S.radioCircle, manualBarId === b.id && S.radioCircleOn]} />
                <Text style={[S.periodOptionLabel, { marginLeft: 12 }]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={S.primaryBtn} onPress={() => setPhase('manual-entry')}>
              <Text style={S.primaryBtnText}>Continue →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('manual-period')}>
              <Text style={S.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── MANUAL ENTRY ──────────────────────────────────────────────── */}
        {phase === 'manual-entry' && (
          <>
            <Text style={S.screenTitle}>Enter sales</Text>
            <Text style={S.screenSub}>{manualPeriodLabel} · {manualBarId ? bars.find(b => b.id === manualBarId)?.name : 'All bars'}</Text>

            <View style={S.entryHeader}>
              <Text style={[S.entryCol, { flex: 2 }]}>Product</Text>
              <Text style={S.entryCol}>Units sold</Text>
              {showRevenue && <Text style={S.entryCol}>Revenue $</Text>}
            </View>

            {festivalProducts.map(p => (
              <View key={p.id} style={S.entryRow}>
                <Text style={[S.entryProductName, { flex: 2 }]} numberOfLines={2}>{p.name}</Text>
                <TextInput
                  style={S.entryInput}
                  value={manualCounts[p.id] ?? ''}
                  onChangeText={v => setManualCounts(prev => ({ ...prev, [p.id]: v }))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#9ca3af"
                  returnKeyType="next"
                />
                {showRevenue && (
                  <TextInput
                    style={S.entryInput}
                    value={manualRevenues[p.id] ?? ''}
                    onChangeText={v => setManualRevenues(prev => ({ ...prev, [p.id]: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#9ca3af"
                  />
                )}
              </View>
            ))}

            {festivalProducts.length === 0 && (
              <View style={S.emptyCard}>
                <Text style={S.emptyText}>No festival products found. Add products in Event Setup first.</Text>
              </View>
            )}

            <TouchableOpacity
              style={S.toggleRevenue}
              onPress={() => setShowRevenue(v => !v)}
            >
              <Text style={S.toggleRevenueText}>{showRevenue ? 'Hide revenue fields' : 'Show revenue fields'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[S.primaryBtn, { marginTop: 20 }]}
              onPress={() => setPhase('manual-review')}
              disabled={festivalProducts.length === 0}
            >
              <Text style={S.primaryBtnText}>Review →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('manual-bar')}>
              <Text style={S.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── MANUAL REVIEW ─────────────────────────────────────────────── */}
        {phase === 'manual-review' && (() => {
          const selectedBar = manualBarId ? bars.find(b => b.id === manualBarId) : null;
          const entries = festivalProducts
            .map(p => ({
              id: p.id,
              name: p.name,
              qty: parseFloat(manualCounts[p.id] || '0') || 0,
              rev: showRevenue ? (parseFloat(manualRevenues[p.id] || '0') || null) : null,
            }))
            .filter(e => e.qty > 0);
          const totalUnits = entries.reduce((s, e) => s + e.qty, 0);

          return (
            <>
              <Text style={S.screenTitle}>Review sales</Text>
              <Text style={S.screenSub}>{manualPeriodLabel} · {selectedBar?.name ?? 'All bars'}</Text>

              {entries.map(e => (
                <View key={e.id} style={S.reviewRow}>
                  <Text style={S.reviewRowName} numberOfLines={1}>{e.name}</Text>
                  <Text style={S.reviewRowQty}>{e.qty} units{e.rev != null ? ` · $${e.rev.toFixed(2)}` : ''}</Text>
                </View>
              ))}

              <View style={S.reviewDivider} />
              <View style={S.reviewRow}>
                <Text style={[S.reviewRowName, { fontWeight: '800' }]}>Total</Text>
                <Text style={[S.reviewRowQty, { fontWeight: '800', color: '#0B132B' }]}>{totalUnits} units</Text>
              </View>

              {entries.length === 0 && (
                <Text style={S.infoNote}>No quantities entered yet. Go back and fill in the sales.</Text>
              )}

              <TouchableOpacity
                style={[S.primaryBtn, (saving || entries.length === 0) && S.btnDisabled]}
                disabled={saving || entries.length === 0}
                onPress={saveManual}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={S.primaryBtnText}>Save sales</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={S.secondaryBtn} onPress={() => setPhase('manual-entry')}>
                <Text style={S.secondaryBtnText}>Edit</Text>
              </TouchableOpacity>
            </>
          );
        })()}

      </ScrollView>

      {/* ── PICKER MODAL ────────────────────────────────────────────────── */}
      <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={S.modalContainer}>
          <View style={S.modalHeader}>
            <Text style={S.modalTitle}>{pickerType === 'product' ? 'Select festival product' : 'Select bar'}</Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)} style={S.modalClose}>
              <Text style={S.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={S.modalSearch}
            value={pickerSearch}
            onChangeText={setPickerSearch}
            placeholder={pickerType === 'product' ? 'Search products…' : 'Search bars…'}
            placeholderTextColor="#9ca3af"
            autoFocus
          />
          <FlatList
            data={pickerType === 'product' ? pickerProducts : pickerBars}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={S.modalItem} onPress={() => selectFromPicker(item)}>
                <Text style={S.modalItemText}>{item.name}</Text>
              </TouchableOpacity>
            )}
            ListFooterComponent={pickerType === 'product' ? (
              <TouchableOpacity style={S.modalSkipRow} onPress={() => {
                setProductMappings(p => ({ ...p, [pickerForKey]: 'skip' }));
                setPickerVisible(false);
              }}>
                <Text style={S.modalSkipText}>Skip this product — not a festival product</Text>
              </TouchableOpacity>
            ) : null}
          />
        </View>
      </Modal>
      {modal}
    </View>
  );
}

// ─── Small helper components ──────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.detailRow}>
      <Text style={S.detailLabel}>{label}</Text>
      <Text style={S.detailValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  centerPad: { paddingVertical: 60, alignItems: 'center' },
  csEmoji: { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 12 },
  csBody: { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24 },
  csContact: { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  screenSub: { fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 19 },
  loadingText: { fontSize: 14, color: '#6b7280', marginTop: 16 },

  pathCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1, borderColor: '#e5e1d8',
    padding: 18, marginBottom: 12,
  },
  pathCardEmoji: { fontSize: 28, marginRight: 14 },
  pathCardTitle: { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 2 },
  pathCardSub: { fontSize: 13, color: '#6b7280' },
  pathCardArrow: { fontSize: 18, color: '#1b4f72', fontWeight: '700', marginLeft: 8 },

  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginTop: 12, marginBottom: 8 },

  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 12 },
  infoLabel: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  infoValue: { fontSize: 17, fontWeight: '800', color: '#0B132B' },
  infoNote: { fontSize: 12, color: '#9ca3af', marginTop: 6, fontStyle: 'italic' },

  detailsCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 16 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { fontSize: 13, color: '#6b7280' },
  detailValue: { fontSize: 13, fontWeight: '600', color: '#0B132B' },

  headerChip: { fontSize: 12, color: '#374151', paddingVertical: 2 },

  colMapRow: { marginBottom: 16 },
  colMapLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6 },
  colMapPickers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  colChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  colChipOn: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  colChipText: { fontSize: 11, color: '#374151' },
  colChipTextOn: { color: '#1b4f72', fontWeight: '700' },

  mapRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e5e1d8' },
  mapPosName: { fontSize: 13, fontWeight: '700', color: '#0B132B' },
  mapRight: { alignItems: 'flex-end' },
  mapMatchText: { fontSize: 12, fontWeight: '600', color: '#16a34a', maxWidth: 140 },
  mapChange: { fontSize: 11, color: '#1b4f72', fontWeight: '700' },
  mapSkipText: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },
  mapUndo: { fontSize: 11, color: '#1b4f72', fontWeight: '700' },
  mapSelectBtn: { backgroundColor: '#eff6ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  mapSelectBtnText: { fontSize: 12, color: '#1b4f72', fontWeight: '700' },
  mapSkipBtn: { fontSize: 12, color: '#9ca3af', paddingVertical: 6 },

  radioRow: { marginBottom: 8 },
  radioBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  radioCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#d1d5db' },
  radioCircleOn: { borderColor: '#1b4f72', backgroundColor: '#1b4f72' },
  radioLabel: { marginLeft: 10, fontSize: 14, color: '#374151' },

  barChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb', marginRight: 8, marginTop: 8 },
  barChipOn: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  barChipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  barChipTextOn: { color: '#1b4f72', fontWeight: '700' },

  reviewCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 16 },
  reviewHeading: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 12 },
  reviewDivider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 10 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  reviewRowName: { fontSize: 13, color: '#374151', flex: 1 },
  reviewRowQty: { fontSize: 13, color: '#6b7280' },
  warningText: { fontSize: 12, color: '#d97706', marginTop: 8, fontWeight: '500' },

  periodOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  periodOptionOn: { borderColor: '#1b4f72' },
  periodOptionLabel: { fontSize: 15, fontWeight: '700', color: '#0B132B' },
  periodOptionDate: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  entryHeader: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', marginBottom: 4 },
  entryCol: { flex: 1, fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 0.5 },
  entryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  entryProductName: { fontSize: 13, color: '#0B132B' },
  entryInput: {
    flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#0B132B',
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 8, paddingVertical: 6, marginLeft: 8,
  },
  toggleRevenue: { alignItems: 'center', paddingVertical: 12 },
  toggleRevenueText: { fontSize: 13, color: '#1b4f72', fontWeight: '600' },

  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },

  primaryBtn: { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },

  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0B132B' },
  modalClose: { padding: 4 },
  modalCloseText: { fontSize: 15, color: '#1b4f72', fontWeight: '600' },
  modalSearch: { margin: 12, backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#0f172a' },
  modalItem: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  modalItemText: { fontSize: 15, color: '#0B132B' },
  modalSkipRow: { paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#e5e7eb', marginTop: 8 },
  modalSkipText: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },
});
