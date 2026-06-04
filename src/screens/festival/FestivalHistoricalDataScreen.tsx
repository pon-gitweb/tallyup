// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { apiBase } from '../../services/apiBase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { guessCategory } from '../../services/festival/purchasingPrediction';

// ─── Simple CSV parser ────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines.map(line => {
    const cols: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    cols.push(current.trim());
    return cols;
  });
}

function detectProductAndQtyColumns(rows: string[][]): { nameCol: number; qtyCol: number } {
  if (rows.length < 2) return { nameCol: 0, qtyCol: 1 };
  const headers = rows[0].map(h => h.toLowerCase());
  const nameCol = headers.findIndex(h => h.includes('product') || h.includes('name') || h.includes('item') || h.includes('description'));
  const qtyCol  = headers.findIndex(h => h.includes('qty') || h.includes('quantity') || h.includes('sold') || h.includes('units') || h.includes('total'));
  return {
    nameCol: nameCol >= 0 ? nameCol : 0,
    qtyCol:  qtyCol  >= 0 ? qtyCol  : 1,
  };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type ImportedProduct = { productName: string; qtySold: number };
type Mode = null | 'csv' | 'photo' | 'manual';

export default function FestivalHistoricalDataScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();

  const [mode,       setMode]       = useState<Mode>(null);
  const [products,   setProducts]   = useState<any[]>([]);        // venue products for manual entry
  const [imported,   setImported]   = useState<ImportedProduct[]>([]); // detected from CSV/photo
  const [manualQtys, setManualQtys] = useState<Record<string, string>>({});

  const [year,       setYear]       = useState(String(new Date().getFullYear() - 1));
  const [attendance, setAttendance] = useState('');
  const [duration,   setDuration]   = useState('3');
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [existingYears, setExistingYears] = useState<number[]>([]);

  // Load existing historical data + venue products
  useEffect(() => {
    if (!venueId) return;
    (async () => {
      try {
        const histSnap = await getDocs(collection(db, 'venues', venueId, 'event', 'historicalData'));
        setExistingYears(histSnap.docs.map(d => (d.data() as any).year).filter(Boolean).sort((a, b) => b - a));
      } catch {}
      try {
        const prodSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
        setProducts(prodSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch {}
    })();
  }, [venueId]);

  // ── CSV import ──────────────────────────────────────────────────────────────
  async function handleCSVPick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      setLoading(true);
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const rows = parseCSV(content);
      if (rows.length < 2) { Alert.alert('Could not read file', 'No data rows found.'); return; }
      const { nameCol, qtyCol } = detectProductAndQtyColumns(rows);
      const dataRows = rows.slice(1);
      const detected: ImportedProduct[] = dataRows
        .map(r => ({ productName: r[nameCol] || '', qtySold: parseFloat(r[qtyCol]) || 0 }))
        .filter(p => p.productName.length > 1 && p.qtySold > 0);
      setImported(detected);
      setMode('csv');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not read file.');
    } finally {
      setLoading(false);
    }
  }

  // ── Photo OCR import ────────────────────────────────────────────────────────
  async function handlePhotoOCR(source: 'camera' | 'library') {
    try {
      let result: any;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') { Alert.alert('Camera permission required'); return; }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7 });
      }
      if (result.canceled || !result.assets?.length) return;
      setLoading(true);
      const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
      const token = await auth.currentUser?.getIdToken();
      const resp = await fetch(`${apiBase()}/extract-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, imageBase64: base64, mimeType: 'image/jpeg', mode: 'catalogue' }),
      });
      const data = await resp.json();
      if (data.ok && Array.isArray(data.products)) {
        const detected: ImportedProduct[] = data.products
          .filter((p: any) => p.name && p.price)
          .map((p: any) => ({ productName: p.name, qtySold: parseFloat(p.price) || 0 }));
        if (detected.length === 0) {
          Alert.alert('No data detected', 'Try a clearer photo or use manual entry.');
          return;
        }
        setImported(detected);
        setMode('photo');
      } else {
        Alert.alert('OCR failed', 'Could not extract data from photo. Try manual entry.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not process photo.');
    } finally {
      setLoading(false);
    }
  }

  // ── Save to Firestore ────────────────────────────────────────────────────────
  async function saveHistoricalData() {
    const yearNum = parseInt(year, 10);
    const attendNum = parseInt(attendance, 10);
    const durNum = parseInt(duration, 10);
    if (!yearNum || yearNum < 2000 || yearNum > 2100) { Alert.alert('Invalid year'); return; }
    if (!attendNum || attendNum <= 0) { Alert.alert('Attendance required', 'Enter the total daily attendance for that year.'); return; }
    if (!durNum || durNum <= 0) { Alert.alert('Duration required'); return; }

    let productList: ImportedProduct[] = [];
    if (mode === 'csv' || mode === 'photo') {
      productList = imported;
    } else if (mode === 'manual') {
      productList = Object.entries(manualQtys)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([productId, v]) => {
          const prod = products.find(p => p.id === productId);
          return { productName: prod?.name || productId, qtySold: parseFloat(v) || 0 };
        });
    }

    if (productList.length === 0) { Alert.alert('No products', 'Add at least one product quantity.'); return; }

    setSaving(true);
    try {
      const uid = auth.currentUser?.uid ?? 'unknown';
      const yearRef = doc(collection(db, 'venues', venueId, 'event', 'historicalData'));
      await setDoc(yearRef, {
        year: yearNum,
        source: mode,
        attendance: attendNum,
        durationDays: durNum,
        products: productList.map(p => ({
          productName: p.productName,
          totalSold: p.qtySold,
          impliedDailyVelocity: p.qtySold / durNum,
          perHeadPerDay: p.qtySold / attendNum / durNum,
          category: guessCategory(p.productName),
        })),
        notes: notes.trim() || null,
        importedAt: serverTimestamp(),
        importedBy: uid,
      });
      Alert.alert('Saved', `${productList.length} products from ${yearNum} imported successfully. Your AI prediction will now use this data.`,
        [{ text: 'Done', onPress: () => nav.goBack() }]);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save historical data.');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return <View style={H.center}><ActivityIndicator color="#1b4f72" size="large" /></View>;
  }

  // Common year/attendance/duration form used by all paths in preview step
  const metaForm = (mode !== null) && (
    <View style={H.metaCard}>
      <Text style={H.metaTitle}>Prior year details</Text>
      <View style={H.metaRow}>
        <View style={{ flex: 1 }}>
          <Text style={H.metaLabel}>Year</Text>
          <TextInput style={H.metaInput} value={year} onChangeText={setYear} keyboardType="numeric" placeholder="e.g. 2025" placeholderTextColor="#9ca3af" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={H.metaLabel}>Daily attendance</Text>
          <TextInput style={H.metaInput} value={attendance} onChangeText={setAttendance} keyboardType="numeric" placeholder="e.g. 7200" placeholderTextColor="#9ca3af" />
        </View>
        <View style={{ width: 70 }}>
          <Text style={H.metaLabel}>Days</Text>
          <TextInput style={H.metaInput} value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="3" placeholderTextColor="#9ca3af" />
        </View>
      </View>
      <Text style={H.metaLabel}>Notes (optional)</Text>
      <TextInput style={[H.metaInput, { minHeight: 48 }]} value={notes} onChangeText={setNotes} placeholder="e.g. Added second stage, wet weather Saturday" placeholderTextColor="#9ca3af" multiline />
    </View>
  );

  // ── SELECT mode ───────────────────────────────────────────────────────────
  if (mode === null) {
    return (
      <ScrollView style={H.screen} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={H.title}>Prior year data</Text>
        <Text style={H.sub}>Import sales or stock data from a previous event to improve your AI prediction accuracy.</Text>

        {existingYears.length > 0 && (
          <View style={H.existingCard}>
            <Text style={H.existingTitle}>✓ {existingYears.length} year{existingYears.length !== 1 ? 's' : ''} imported</Text>
            <Text style={H.existingSub}>{existingYears.join(', ')}</Text>
          </View>
        )}

        <Text style={H.sectionLabel}>CHOOSE IMPORT METHOD</Text>

        <TouchableOpacity style={H.pathCard} onPress={handleCSVPick}>
          <Text style={H.pathIcon}>📊</Text>
          <View style={{ flex: 1 }}>
            <Text style={H.pathTitle}>Upload spreadsheet / CSV</Text>
            <Text style={H.pathSub}>Excel or CSV from any source — we detect columns automatically</Text>
          </View>
          <Text style={H.pathArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={H.pathCard} onPress={() => {
          Alert.alert('Photograph stocktake sheet', 'Choose source:', [
            { text: 'Take photo', onPress: () => handlePhotoOCR('camera') },
            { text: 'Choose from library', onPress: () => handlePhotoOCR('library') },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}>
          <Text style={H.pathIcon}>📷</Text>
          <View style={{ flex: 1 }}>
            <Text style={H.pathTitle}>Photograph stocktake sheet</Text>
            <Text style={H.pathSub}>We'll read the numbers for you using OCR</Text>
          </View>
          <Text style={H.pathArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={H.pathCard} onPress={() => setMode('manual')}>
          <Text style={H.pathIcon}>✏️</Text>
          <View style={{ flex: 1 }}>
            <Text style={H.pathTitle}>Enter manually</Text>
            <Text style={H.pathSub}>Type in your figures directly from memory or notes</Text>
          </View>
          <Text style={H.pathArrow}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── CSV / PHOTO PREVIEW ───────────────────────────────────────────────────
  if (mode === 'csv' || mode === 'photo') {
    return (
      <ScrollView style={H.screen} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={H.title}>{mode === 'csv' ? 'Preview CSV data' : 'Preview OCR data'}</Text>
        <Text style={H.sub}>{imported.length} products detected. Edit quantities if needed, then add the prior year details.</Text>

        <View style={H.previewHeader}>
          <Text style={[H.previewCell, { flex: 1, fontWeight: '700' }]}>Product</Text>
          <Text style={[H.previewCell, { width: 90, fontWeight: '700', textAlign: 'right' }]}>Qty sold</Text>
        </View>
        {imported.slice(0, 50).map((p, i) => (
          <View key={i} style={H.previewRow}>
            <Text style={[H.previewCell, { flex: 1 }]} numberOfLines={1}>{p.productName}</Text>
            <TextInput
              style={H.previewQtyInput}
              value={String(p.qtySold)}
              onChangeText={v => setImported(prev => prev.map((item, idx) => idx === i ? { ...item, qtySold: parseFloat(v) || 0 } : item))}
              keyboardType="numeric"
            />
          </View>
        ))}
        {imported.length > 50 && <Text style={H.moreTxt}>+{imported.length - 50} more products</Text>}

        {metaForm}

        <TouchableOpacity
          style={[H.cta, saving && H.ctaDisabled]}
          disabled={saving}
          onPress={saveHistoricalData}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={H.ctaTxt}>Import as prior year data →</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={H.backBtn} onPress={() => { setMode(null); setImported([]); }}>
          <Text style={H.backTxt}>← Choose different method</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── MANUAL ENTRY ──────────────────────────────────────────────────────────
  return (
    <ScrollView style={H.screen} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={H.title}>Manual entry</Text>
      <Text style={H.sub}>Enter quantities sold last year. Leave blank if unknown — blank = unknown (not zero).</Text>

      {products.length === 0 ? (
        <Text style={{ color: '#9ca3af', fontStyle: 'italic', marginBottom: 16 }}>
          No products in your catalogue yet. Add products first for the best results.
        </Text>
      ) : (
        <>
          <View style={H.previewHeader}>
            <Text style={[H.previewCell, { flex: 1, fontWeight: '700' }]}>Product</Text>
            <Text style={[H.previewCell, { width: 100, fontWeight: '700', textAlign: 'right' }]}>Qty sold</Text>
          </View>
          {products.map(p => (
            <View key={p.id} style={H.previewRow}>
              <Text style={[H.previewCell, { flex: 1 }]} numberOfLines={1}>{p.name || p.id}</Text>
              <TextInput
                style={H.previewQtyInput}
                value={manualQtys[p.id] || ''}
                onChangeText={v => setManualQtys(prev => ({ ...prev, [p.id]: v }))}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor="#9ca3af"
              />
            </View>
          ))}
        </>
      )}

      {metaForm}

      <TouchableOpacity
        style={[H.cta, saving && H.ctaDisabled]}
        disabled={saving}
        onPress={saveHistoricalData}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={H.ctaTxt}>Save historical data →</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={H.backBtn} onPress={() => setMode(null)}>
        <Text style={H.backTxt}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const H = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#f5f3ee' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f3ee' },
  title:   { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 6 },
  sub:     { fontSize: 14, color: '#6b7280', marginBottom: 20, lineHeight: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 10 },

  existingCard:  { backgroundColor: '#f0fdf4', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#86efac' },
  existingTitle: { fontSize: 14, fontWeight: '700', color: '#16a34a' },
  existingSub:   { fontSize: 12, color: '#6b7280', marginTop: 2 },

  pathCard:  { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8', gap: 12 },
  pathIcon:  { fontSize: 28 },
  pathTitle: { fontSize: 15, fontWeight: '700', color: '#0B132B', marginBottom: 2 },
  pathSub:   { fontSize: 12, color: '#6b7280', lineHeight: 17 },
  pathArrow: { fontSize: 22, color: '#9ca3af' },

  previewHeader: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: '#e5e7eb', marginBottom: 4 },
  previewRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  previewCell:   { fontSize: 13, color: '#374151' },
  previewQtyInput: { width: 90, textAlign: 'right', fontSize: 14, fontWeight: '600', color: '#0B132B', borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingVertical: 2 },
  moreTxt:       { fontSize: 12, color: '#9ca3af', marginTop: 4, fontStyle: 'italic' },

  metaCard:  { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 16, marginBottom: 8, borderWidth: 1, borderColor: '#e5e1d8' },
  metaTitle: { fontSize: 13, fontWeight: '700', color: '#0B132B', marginBottom: 10 },
  metaRow:   { flexDirection: 'row', gap: 8, marginBottom: 8 },
  metaLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase' },
  metaInput: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: '#0B132B' },

  cta:        { backgroundColor: '#1b4f72', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  ctaDisabled:{ opacity: 0.5 },
  ctaTxt:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  backBtn:    { alignItems: 'center', paddingVertical: 12 },
  backTxt:    { fontSize: 14, color: '#6b7280' },
});
