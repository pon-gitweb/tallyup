// @ts-nocheck
import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  writeBatch,
  doc,
  setDoc,
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { parseCsv, toObjects, autoHeaderMap, remapObjects } from '../../services/imports/csv';
import { uploadText } from '../../services/firebase/storage';

const WANTED = ['name', 'unit', 'supplierId', 'supplierName', 'parLevel', 'costPrice', 'packSize'];

function slugId(s: string) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'p_' + Math.random().toString(36).slice(2, 8)
  );
}

export default function ProductsCsvImportScreen() {
  const venueId = useVenueId();
  const db = getFirestore(getApp());

  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowsObj, setRowsObj] = useState<any[]>([]);
  const [map, setMap] = useState<Record<string, string | null>>({});
  const [stage, setStage] = useState<'paste' | 'map' | 'preview' | 'done'>('paste');
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState('products.csv');

  const parsedRows = useMemo(() => {
    if (!headers.length || !rowsObj.length) return [];
    const mapped = remapObjects(rowsObj, map);
    return mapped;
  }, [rowsObj, headers, map]);

  const onParse = useCallback(() => {
    try {
      const parsed = parseCsv(csvText || '');
      const objs = toObjects(parsed);
      const m = autoHeaderMap(parsed.headers, WANTED);
      setHeaders(parsed.headers);
      setRowsObj(objs);
      setMap(m);
      setStage('map');
    } catch (e: any) {
      Alert.alert('Parse failed', e?.message || 'Could not parse CSV.');
    }
  }, [csvText]);

  const cycleHeader = useCallback(
    (key: string) => {
      // Cycle through headers + (none) sentinel
      const list = ['(none)', ...headers];
      const cur = map[key] || '(none)';
      const idx = list.indexOf(cur);
      const next = list[(idx + 1) % list.length];
      setMap((prev) => ({ ...prev, [key]: next === '(none)' ? null : next }));
    },
    [headers, map],
  );

  const canUpload = useMemo(() => {
    // minimally need name
    const nameSrc = map['name'];
    return !!nameSrc && parsedRows.length > 0 && !busy && !!venueId;
  }, [map, parsedRows, busy, venueId]);

  const onUpload = useCallback(async () => {
    if (!venueId) {
      Alert.alert('Missing venue', 'No venue selected.');
      return;
    }
    if (!canUpload) return;

    setBusy(true);
    try {
      // 1) Persist raw CSV
      await uploadText(venueId, filename || 'products.csv', csvText, 'text/csv');

      // 2) Create import job doc
      const jobsCol = collection(db, 'venues', venueId, 'importJobs');
      const jobRef = await addDoc(jobsCol, {
        type: 'productsCsv',
        status: 'processing',
        createdAt: serverTimestamp(),
        sourceFilename: filename || 'products.csv',
        counts: { total: parsedRows.length, done: 0, errors: 0 },
        errors: [],
      });

      // 3) Write/merge products
      const batch = writeBatch(db);
      let done = 0,
        errs = 0;
      const errors: any[] = [];

      for (const r of parsedRows) {
        try {
          const name = String(r.name || '').trim();
          if (!name) throw new Error('Missing name');

          const unit = (r.unit || '').trim() || null;
          const supplierId = (r.supplierId || '').trim() || null;
          const supplierName = (r.supplierName || '').trim() || null;
          const parLevel = Number.isFinite(Number(r.parLevel)) ? Number(r.parLevel) : null;
          const costPrice = Number.isFinite(Number(r.costPrice)) ? Number(r.costPrice) : null;
          const packSize = Number.isFinite(Number(r.packSize)) ? Number(r.packSize) : null;

          const pid = slugId(name);
          const pref = doc(db, 'venues', venueId, 'products', pid);

          batch.set(
            pref,
            {
              name,
              ...(unit != null ? { unit } : {}),
              supplierId: supplierId || null,
              supplierName: supplierName || null,
              ...(parLevel != null ? { parLevel } : {}),
              ...(costPrice != null ? { costPrice } : {}),
              ...(packSize != null ? { packSize } : {}),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
          done++;
        } catch (e: any) {
          errs++;
          errors.push({ row: r, message: e?.message || 'row error' });
        }
      }

      await batch.commit();

      // 4) Mark job complete
      await setDoc(
        jobRef,
        {
          status: errs > 0 ? 'completed_with_errors' : 'completed',
          finishedAt: serverTimestamp(),
          counts: { total: parsedRows.length, done, errors: errs },
          errors,
        },
        { merge: true },
      );

      setStage('done');
      Alert.alert(
        'Import complete',
        errs > 0
          ? `Imported ${done} item(s) with ${errs} error(s).`
          : `Imported ${done} item(s).`,
      );
    } catch (e: any) {
      Alert.alert('Import failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [db, venueId, filename, csvText, parsedRows, canUpload]);

  return (
    <View style={S.wrap}>
      <View style={S.top}>
        <Text style={S.title}>Import Products (CSV)</Text>
      </View>

      {stage === 'paste' && (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={S.label}>Filename (stored with upload):</Text>
          <TextInput
            style={S.input}
            value={filename}
            onChangeText={setFilename}
            placeholder="products.csv"
            autoCapitalize="none"
          />

          <Text style={[S.label, { marginTop: 12 }]}>Paste CSV:</Text>
          <TextInput
            style={[S.input, { height: 200, textAlignVertical: 'top' }]}
            value={csvText}
            onChangeText={setCsvText}
            placeholder={
              'name,unit,costPrice,packSize,supplierId,supplierName,parLevel\nLimes,each,0.45,12,SUP1,Supplier One,24'
            }
            autoCapitalize="none"
            multiline
          />

          <TouchableOpacity
            onPress={onParse}
            style={[S.btn, { marginTop: 12 }]}
            disabled={!csvText.trim() || busy}
          >
            {busy ? <ActivityIndicator /> : <Text style={S.btnText}>Parse</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}

      {stage === 'map' && (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={S.sectionTitle}>Map Columns</Text>
          <Text style={S.help}>Tap each field to cycle through headers (or set to none).</Text>

          {WANTED.map((k) => (
            <View key={k} style={S.mapRow}>
              <Text style={S.mapKey}>{k}</Text>
              <TouchableOpacity onPress={() => cycleHeader(k)} style={S.mapBtn}>
                <Text style={S.mapVal}>{map[k] ?? '(none)'}</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity onPress={() => setStage('preview')} style={[S.btn, { marginTop: 12 }]}>
            <Text style={S.btnText}>Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setStage('paste')}
            style={[S.btnGhost, { marginTop: 8 }]}
          >
            <Text style={S.btnGhostText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {stage === 'preview' && (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={S.sectionTitle}>Preview ({parsedRows.length})</Text>
          {parsedRows.slice(0, 50).map((r, idx) => (
            <View key={idx} style={S.card}>
              <Text style={S.name}>{r.name || '(no name)'}</Text>
              <Text style={S.sub}>
                {r.unit || '—'} · {r.packSize || '—'} · ${r.costPrice || '—'}
              </Text>
              {!!r.supplierName || !!r.supplierId ? (
                <View style={S.pill}>
                  <Text style={S.pillText}>{r.supplierName || r.supplierId}</Text>
                </View>
              ) : null}
            </View>
          ))}

          <TouchableOpacity
            onPress={onUpload}
            style={[S.btn, { marginTop: 12 }]}
            disabled={!canUpload}
          >
            {busy ? <ActivityIndicator /> : <Text style={S.btnText}>Upload</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStage('map')} style={[S.btnGhost, { marginTop: 8 }]}>
            <Text style={S.btnGhostText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {stage === 'done' && (
        <View style={{ padding: 16 }}>
          <Text style={S.sectionTitle}>Done</Text>
          <Text style={S.help}>Your CSV and import job have been saved.</Text>
          <TouchableOpacity
            onPress={() => {
              setCsvText('');
              setHeaders([]);
              setRowsObj([]);
              setMap({});
              setStage('paste');
            }}
            style={[S.btn, { marginTop: 12 }]}
          >
            <Text style={S.btnText}>Import another file</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  top: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  title: { fontSize: 20, fontWeight: '800' },

  label: { fontSize: 12, color: '#4B5563', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },

  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  help: { fontSize: 12, color: '#6B7280' },

  btn: { backgroundColor: '#111827', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800' },

  btnGhost: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnGhostText: { color: '#111827', fontWeight: '800' },

  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  mapKey: { fontWeight: '700' },
  mapBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  mapVal: { fontSize: 12, color: '#111827' },

  card: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 10 },
  name: { fontWeight: '700' },
  sub: { color: '#6B7280', marginTop: 4 },
  pill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
  },
  pillText: { fontSize: 11, fontWeight: '700', color: '#374151' },
});
