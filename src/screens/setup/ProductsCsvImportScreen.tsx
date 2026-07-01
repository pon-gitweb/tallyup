// @ts-nocheck
// Single source of truth for client-side CSV product import.
// The duplicate at src/screens/imports/ProductsCsvImportScreen.tsx has been removed.
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useToast } from '../../components/common/Toast';
import { getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp, writeBatch, doc, setDoc } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { parseCsv, toObjects, autoHeaderMap, remapObjects } from '../../services/imports/csv';
import { guessCategory } from '../../services/festival/purchasingPrediction';
import { uploadText } from '../../services/firebase/storage';
import { listSuppliers } from '../../services/suppliers';

const WANTED = ['name','unit','supplierId','supplierName','parLevel','costPrice','packSize'];
const BATCH_SIZE = 400; // FIX 6: stay under Firestore 500-write limit per batch

// FIX 5: Parse price strings — strips $, handles European decimal commas
function parsePrice(raw: any): number | null {
  if (raw == null || raw === '') return null;
  const cleaned = String(raw)
    .replace(/[$£€NZD\s]/g, '')            // strip currency symbols
    .replace(/^([^.]+),(\d{1,2})$/, '$1.$2') // "24,50" → "24.50" (European decimal)
    .replace(/,/g, '');                       // strip remaining thousand separators
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function slugId(s:string){
  return String(s||'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/(^-|-$)/g,'')
    .slice(0,48) || ('p_' + Math.random().toString(36).slice(2,8));
}

export default function ProductsCsvImportScreen(){
  const venueId = useVenueId();
  const db = getFirestore(getApp());
  const { showError, showSuccess } = useToast();

  const [csvText,setCsvText] = useState('');
  const [headers,setHeaders] = useState<string[]>([]);
  const [rowsObj,setRowsObj] = useState<any[]>([]);
  const [map,setMap] = useState<Record<string,string|null>>({});
  const [stage,setStage] = useState<'paste'|'map'|'preview'|'done'>('paste');
  const [busy,setBusy] = useState(false);
  const [filename,setFilename] = useState('products.csv');
  const [suppliers, setSuppliers] = useState([]);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState<string|null>(null); // FIX 7

  const parsedRows = useMemo(()=>{
    if(!headers.length || !rowsObj.length) return [];
    return remapObjects(rowsObj, map);
  },[rowsObj, headers, map]);

  const onParse = useCallback(()=>{
    try{
      const parsed = parseCsv(csvText || '');
      const objs = toObjects(parsed);
      const m = autoHeaderMap(parsed.headers, WANTED);
      setHeaders(parsed.headers);
      setRowsObj(objs);
      setMap(m);
      setStage('map');
    }catch(e:any){
      showError(e?.message || 'Could not parse CSV.');
    }
  },[csvText]);

  useEffect(() => {
    if (!venueId) return;
    listSuppliers(venueId).then(setSuppliers).catch(() => {});
  }, [venueId]);

  // FIX 3: onPickFile now wired to the "Choose CSV file" button (was dead code before)
  const onPickFile = useCallback(async () => {
    setLoadingMessage('Preparing file…'); // FIX 7
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      const canceled = pick.canceled ?? (pick as any).type === 'cancel';
      if (canceled) {
        setLoadingMessage(null);
        return;
      }
      const asset = (pick as any).assets ? (pick as any).assets[0] : pick;
      const name = String(asset?.name || 'products.csv');
      const uri = String(asset?.uri || '');
      setLoadingMessage('Reading file…'); // FIX 7
      const content = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      setFilename(name);
      setCsvText(content);
      setLoadingMessage('Parsing…'); // FIX 7
      try {
        const { parseCsv: pc, toObjects: to, autoHeaderMap: ahm } = require('../../services/imports/csv');
        const parsed = pc(content);
        const objs = to(parsed);
        const m = ahm(parsed.headers, WANTED);
        setHeaders(parsed.headers);
        setRowsObj(objs);
        setMap(m);
        setStage('map');
      } catch { /* will parse manually */ }
    } catch (e) {
      showError((e as any)?.message || 'Could not read file');
    } finally {
      setLoadingMessage(null); // FIX 7
    }
  }, []);

  const cycleHeader = useCallback((key:string)=>{
    const list = ['(none)', ...headers];
    const cur = map[key] || '(none)';
    const idx = list.indexOf(cur);
    const next = list[(idx+1) % list.length];
    setMap(prev => ({ ...prev, [key]: next === '(none)' ? null : next }));
  },[headers, map]);

  const canUpload = useMemo(()=>{
    const nameSrc = map['name'];
    return !!nameSrc && parsedRows.length>0 && !busy && !!venueId;
  },[map, parsedRows, busy, venueId]);

  const onUpload = useCallback(async()=>{
    if(!venueId) { showError('No venue selected.'); return; }
    if(!canUpload) return;

    setBusy(true);
    try{
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

      // 3) FIX 6: Prepare valid rows, then commit in BATCH_SIZE chunks
      let done = 0, errs = 0;
      const errors: any[] = [];
      const validRows: Array<{ pref: any; data: any }> = [];

      for(const r of parsedRows){
        try{
          const name = String(r.name || '').trim();
          if(!name) throw new Error('Missing name');

          const unit = (r.unit || '').trim() || null;
          const supplierId = (r.supplierId || '').trim() || null;
          const supplierName = (r.supplierName || '').trim() || null;
          const parLevel = Number.isFinite(Number(r.parLevel)) ? Number(r.parLevel) : null;
          const costPrice = parsePrice(r.costPrice); // FIX 5
          const packSize = Number.isFinite(Number(r.packSize)) ? Number(r.packSize) : null;

          const pid = slugId(name);
          const pref = doc(db, 'venues', venueId, 'products', pid);

          const inferredCategory = guessCategory(name) || null;
          validRows.push({
            pref,
            data: {
              name,
              ...(unit!=null?{unit}:{}),
              supplierId: supplierId || null,
              supplierName: supplierName || null,
              ...(parLevel!=null?{parLevel}:{}),
              ...(costPrice!=null?{costPrice}:{}),
              ...(packSize!=null?{packSize}:{}),
              category: inferredCategory,
              categorySuggested: inferredCategory,
              active: true,
              updatedAt: serverTimestamp(),
            },
          });
          done++;
        }catch(e:any){
          errs++;
          errors.push({ row: r, message: e?.message || 'row error' });
        }
      }

      // FIX 6: Chunk into BATCH_SIZE batches (safe below Firestore 500-write limit)
      const chunks: Array<typeof validRows> = [];
      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        chunks.push(validRows.slice(i, i + BATCH_SIZE));
      }

      for (let ci = 0; ci < chunks.length; ci++) {
        const batch = writeBatch(db);
        for (const { pref, data } of chunks[ci]) {
          batch.set(pref, data, { merge: true });
        }
        await batch.commit();
        // FIX 7: Show progress for large imports
        if (chunks.length > 1) {
          const soFar = Math.min((ci + 1) * BATCH_SIZE, validRows.length);
          setLoadingMessage(`Importing… ${soFar} of ${validRows.length} products`);
        }
      }

      // 4) Mark job complete
      await setDoc(jobRef, {
        status: errs>0 ? 'completed_with_errors' : 'completed',
        finishedAt: serverTimestamp(),
        counts: { total: parsedRows.length, done, errors: errs },
        errors,
      }, { merge: true });

      setStage('done');
      showSuccess(errs>0
        ? `Imported ${done} item(s) with ${errs} error(s).`
        : `Imported ${done} item(s).`);
    }catch(e:any){
      showError(e?.message || 'Please try again.');
    }finally{
      setBusy(false);
      setLoadingMessage(null); // FIX 7
    }
  },[db, venueId, filename, csvText, parsedRows, canUpload]);

  return (
    <>
    <View style={S.wrap}>
      <View style={S.top}>
        <Text style={S.title}>Import Products (CSV)</Text>
      </View>

      {/* FIX 7: Loading overlay for file reading and batch import progress */}
      {!!loadingMessage && (
        <View style={S.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={S.loadingText}>{loadingMessage}</Text>
        </View>
      )}

      {stage==='paste' && (
        <ScrollView contentContainerStyle={{padding:16}}>
          {/* FIX 3: Primary file picker button — was dead code before, now wired */}
          <TouchableOpacity
            onPress={onPickFile}
            style={S.pickFileBtn}
            disabled={busy}
          >
            <Text style={S.pickFileBtnText}>📄  Choose CSV file</Text>
            <Text style={S.pickFileBtnSub}>From Files, iCloud, or email</Text>
          </TouchableOpacity>
          <Text style={S.orDivider}>— or paste CSV text below —</Text>

          <Text style={S.label}>Filename (stored with upload):</Text>
          <TextInput
            style={S.input}
            value={filename}
            onChangeText={setFilename}
            placeholder="products.csv"
            autoCapitalize="none"
          />

          <Text style={[S.label,{marginTop:12}]}>Paste CSV:</Text>
          <TextInput
            style={[S.input,{height:200,textAlignVertical:'top'}]}
            value={csvText}
            onChangeText={setCsvText}
            placeholder={'name,unit,costPrice,packSize,supplierId,supplierName,parLevel\nLimes,each,0.45,12,SUP1,Supplier One,24'}
            autoCapitalize="none"
            multiline
          />

          <TouchableOpacity onPress={onParse} style={[S.btn, {marginTop:12}]} disabled={!csvText.trim() || busy}>
            {busy ? <ActivityIndicator/> : <Text style={S.btnText}>Parse</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}

      {stage==='map' && (
        <ScrollView contentContainerStyle={{padding:16}}>
          <Text style={S.sectionTitle}>Map Columns</Text>
          {suppliers.length > 0 && (
            <View style={{ marginBottom: 12, padding: 12, backgroundColor: '#F0FDF4', borderRadius: 10, borderWidth: 1, borderColor: '#BBF7D0' }}>
              <Text style={{ fontWeight: '700', marginBottom: 6 }}>Assign to supplier (optional)</Text>
              <TouchableOpacity
                onPress={() => setSupplierPickerOpen(true)}
                style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 10, backgroundColor: '#fff' }}
              >
                <Text style={{ color: selectedSupplier ? '#111' : '#9CA3AF' }}>
                  {selectedSupplier ? (selectedSupplier as any).name : 'No supplier (assign later)'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={S.help}>Tap each field to cycle through headers (or set to none).</Text>

          {WANTED.map((k)=>(
            <View key={k} style={S.mapRow}>
              <Text style={S.mapKey}>{k}</Text>
              <TouchableOpacity onPress={()=>cycleHeader(k)} style={S.mapBtn}>
                <Text style={S.mapVal}>{map[k] ?? '(none)'}</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity onPress={()=>setStage('preview')} style={[S.btn, {marginTop:12}]}>
            <Text style={S.btnText}>Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>setStage('paste')} style={[S.btnGhost, {marginTop:8}]}>
            <Text style={S.btnGhostText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {stage==='preview' && (
        <ScrollView contentContainerStyle={{padding:16}}>
          <Text style={S.sectionTitle}>Preview ({parsedRows.length})</Text>
          {parsedRows.slice(0,50).map((r,idx)=>(
            <View key={idx} style={S.card}>
              <Text style={S.name}>{r.name || '(no name)'}</Text>
              <Text style={S.sub}>
                {(r.unit||'—')} · {(r.packSize||'—')} · ${(r.costPrice||'—')}
              </Text>
              {!!r.supplierName || !!r.supplierId ? (
                <View style={S.pill}><Text style={S.pillText}>{r.supplierName || r.supplierId}</Text></View>
              ) : null}
            </View>
          ))}
          {parsedRows.length > 50 && (
            <Text style={S.help}>…and {parsedRows.length - 50} more (all will be imported)</Text>
          )}

          <TouchableOpacity onPress={onUpload} style={[S.btn,{marginTop:12}]} disabled={!canUpload}>
            {busy ? <ActivityIndicator/> : (
              <Text style={S.btnText}>
                Upload{parsedRows.length > BATCH_SIZE ? ` (${parsedRows.length} — chunked)` : ''}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={()=>setStage('map')} style={[S.btnGhost, {marginTop:8}]}>
            <Text style={S.btnGhostText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {stage==='done' && (
        <View style={{padding:16}}>
          <Text style={S.sectionTitle}>Done</Text>
          <Text style={S.help}>Your CSV and import job have been saved.</Text>
          <TouchableOpacity onPress={()=>{ setCsvText(''); setHeaders([]); setRowsObj([]); setMap({}); setStage('paste'); }} style={[S.btn,{marginTop:12}]}>
            <Text style={S.btnText}>Import another file</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>

    {/* Supplier picker modal */}
    <Modal visible={supplierPickerOpen} transparent animationType="fade" onRequestClose={() => setSupplierPickerOpen(false)}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setSupplierPickerOpen(false)}>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, width: '85%', maxHeight: '70%' }}>
          <Text style={{ fontWeight: '900', fontSize: 16, marginBottom: 12 }}>Select Supplier</Text>
          <TouchableOpacity onPress={() => { setSelectedSupplier(null); setSupplierPickerOpen(false); }}
            style={{ padding: 12, borderBottomWidth: 1, borderColor: '#F3F4F6' }}>
            <Text style={{ fontWeight: '700', color: !selectedSupplier ? '#0A84FF' : '#111' }}>No supplier</Text>
          </TouchableOpacity>
          <ScrollView>
            {(suppliers as any[]).map(s => (
              <TouchableOpacity key={s.id} onPress={() => { setSelectedSupplier(s); setSupplierPickerOpen(false); }}
                style={{ padding: 12, borderBottomWidth: 1, borderColor: '#F3F4F6' }}>
                <Text style={{ fontWeight: '700', color: selectedSupplier && (selectedSupplier as any).id === s.id ? '#0A84FF' : '#111' }}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
    </>
  );
}

const S = StyleSheet.create({
  wrap:{ flex:1, backgroundColor:'#fff' },
  top:{ paddingHorizontal:16, paddingVertical:12, borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#E5E7EB' },
  title:{ fontSize:20, fontWeight:'800' },

  label:{ fontSize:12, color:'#4B5563', marginBottom:6 },
  input:{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, padding:10, fontSize:14, backgroundColor:'#fff' },

  sectionTitle:{ fontSize:16, fontWeight:'800', marginBottom:8 },
  help:{ fontSize:12, color:'#6B7280' },

  btn:{ backgroundColor:'#111827', paddingVertical:10, borderRadius:10, alignItems:'center' },
  btnText:{ color:'#fff', fontWeight:'800' },

  btnGhost:{ backgroundColor:'#F3F4F6', paddingVertical:10, borderRadius:10, alignItems:'center' },
  btnGhostText:{ color:'#111827', fontWeight:'800' },

  mapRow:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:10, borderBottomWidth:StyleSheet.hairlineWidth, borderColor:'#E5E7EB' },
  mapKey:{ fontWeight:'700' },
  mapBtn:{ paddingVertical:6, paddingHorizontal:10, borderRadius:8, borderWidth:1, borderColor:'#E5E7EB' },
  mapVal:{ fontSize:12, color:'#111827' },

  card:{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12, marginBottom:10 },
  name:{ fontWeight:'700' },
  sub:{ color:'#6B7280', marginTop:4 },
  pill:{ marginTop:6, alignSelf:'flex-start', paddingHorizontal:8, paddingVertical:3, borderRadius:999, backgroundColor:'#F3F4F6' },
  pillText:{ fontSize:11, fontWeight:'700', color:'#374151' },

  // FIX 3: File picker button
  pickFileBtn:{ backgroundColor:'#111827', borderRadius:12, paddingVertical:14, paddingHorizontal:16, alignItems:'center', marginBottom:12 },
  pickFileBtnText:{ color:'#fff', fontSize:15, fontWeight:'800' },
  pickFileBtnSub:{ color:'rgba(255,255,255,0.75)', fontSize:12, marginTop:3 },
  orDivider:{ textAlign:'center', color:'#9CA3AF', fontSize:13, marginVertical:12 },

  // FIX 7: Loading overlay
  loadingOverlay:{ position:'absolute', left:0, right:0, top:0, bottom:0, backgroundColor:'rgba(0,0,0,0.55)', alignItems:'center', justifyContent:'center', zIndex:100 },
  loadingText:{ color:'#fff', fontSize:15, fontWeight:'700', marginTop:12, textAlign:'center', paddingHorizontal:24 },
});
