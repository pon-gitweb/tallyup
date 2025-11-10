// @ts-nocheck
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Alert, Modal, SafeAreaView,
  ScrollView, StyleSheet, TextInput
} from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';

import { createRecipeDraft } from '../../services/recipes/createRecipeDraft';
import { confirmRecipe } from '../../services/recipes/confirmRecipe';
import DraftRecipeDetailPanel from './DraftRecipeDetailPanel';

type TabKey = 'create' | 'recipes' | 'drafts';

export default function CraftUpPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('create');
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Tabs tab={tab} onChange={setTab} />
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'create'  && <CreateStart onClose={onClose} />}
        {tab === 'recipes' && <RecipesListTab />}
        {tab === 'drafts'  && <DraftsTab />}
      </View>
    </View>
  );
}

function Tabs({ tab, onChange }:{ tab: TabKey; onChange:(k:TabKey)=>void }) {
  const Pill = ({ label, value }:{label:string; value:TabKey}) => (
    <TouchableOpacity
      onPress={() => onChange(value)}
      style={{
        paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999,
        borderWidth: 1, borderColor: tab===value ? '#111' : '#E5E7EB',
        backgroundColor: tab===value ? '#111' : '#F9FAFB', marginRight: 8, marginBottom: 8
      }}
    >
      <Text style={{ color: tab===value ? '#fff' : '#111', fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
      <Pill label="Create" value="create" />
      <Pill label="View Recipes" value="recipes" />
      <Pill label="Drafts" value="drafts" />
    </View>
  );
}

/* ---------- Tab 1: Create (baseline) ---------- */
function CreateStart({ onClose }:{ onClose:()=>void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<'food' | 'beverage' | null>(null);
  const [mode, setMode] = useState<'batch' | 'single' | 'dish' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const tip = useMemo(
    () => 'Craft-It: choose type and mode, we’ll handle the rest. Name + ingredients are set in the draft screen.',
    []
  );
  const dataPath = `venues/${venueId || '…'}/recipes/<recipeId> · status: draft | confirmed`;

  const saveDraft = async () => {
    try {
      if (!category) throw new Error('Choose Food or Beverage');
      if (!mode) throw new Error('Choose Batch/Single/Dish');
      setBusy(true);
      const res = await createRecipeDraft({ venueId, name: 'Untitled', category, mode });
      if (!res?.id) throw new Error('Draft not created');
      setDetailId(res.id);
    } catch (e:any) {
      Alert.alert('Could not start Craft-It', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const Pill = ({ label, active, onPress }:{label:string; active:boolean; onPress:()=>void}) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical:8, paddingHorizontal:12, borderRadius:999,
        borderWidth:1, borderColor: active ? '#111' : '#E5E7EB',
        backgroundColor: active ? '#111' : '#F9FAFB', marginRight:8, marginBottom:8
      }}
    >
      <Text style={{ color: active ? '#fff' : '#111', fontWeight:'700' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Craft-It (Recipe Creator)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>{tip}</Text>

      <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB', marginBottom:12 }}>
        <Text style={{ fontWeight:'700' }}>Planned data path</Text>
        <Text style={{ color:'#6B7280', marginTop:4 }}>{dataPath}</Text>
      </View>

      <View style={{ marginBottom:12 }}>
        <Text style={{ fontWeight:'700', marginBottom:8 }}>What kind of recipe?</Text>
        <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
          <Pill label="Food" active={category==='food'} onPress={()=>{ setCategory('food'); setMode(null); }} />
          <Pill label="Beverage" active={category==='beverage'} onPress={()=>{ setCategory('beverage'); setMode(null); }} />
        </View>
      </View>

      {category && (
        <View style={{ marginBottom:12 }}>
          <Text style={{ fontWeight:'700', marginBottom:8 }}>How will you make it?</Text>
          <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
            {category==='beverage' && (
              <>
                <Pill label="Single Serve" active={mode==='single'} onPress={()=>setMode('single')} />
                <Pill label="Batch" active={mode==='batch'} onPress={()=>setMode('batch')} />
              </>
            )}
            {category==='food' && (
              <>
                <Pill label="Dish" active={mode==='dish'} onPress={()=>setMode('dish')} />
                <Pill label="Batch" active={mode==='batch'} onPress={()=>setMode('batch')} />
              </>
            )}
          </View>
        </View>
      )}

      <TouchableOpacity
        disabled={busy || !category || !mode}
        onPress={saveDraft}
        style={{ marginTop:12, padding:14, borderRadius:12, backgroundColor: (!category||!mode) ? '#9CA3AF' : '#111' }}
      >
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>
          {busy ? 'Starting…' : 'Create Draft & Continue'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onClose}
        style={{ marginTop:12, padding:14, borderRadius:12, backgroundColor:'#F3F4F6' }}>
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>

      <Modal visible={!!detailId} animationType="slide" onRequestClose={() => setDetailId(null)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {detailId ? <DraftRecipeDetailPanel recipeId={detailId} onClose={() => setDetailId(null)} /> : null}
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

/* ---------- Tab 2: View Recipes (confirmed only; long-press shows card) ---------- */
function RecipesListTab() {
  const venueId = useVenueId();
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [viewDoc, setViewDoc] = useState<any|null>(null);
  const [viewId, setViewId] = useState<string|null>(null);

  useEffect(()=>{
    let alive = true;
    (async ()=>{
      try{
        if (!venueId) return;
        const snap = await getDocs(query(collection(db, 'venues', venueId, 'recipes'), orderBy('name')));
        const all:any[] = [];
        snap.forEach(d => all.push({ id: d.id, ...(d.data() as any) }));
        const confirmed = all.filter(r => String(r?.status || '').toLowerCase() === 'confirmed');
        if (!alive) return;
        if (__DEV__) console.log('[RecipesListTab] all=', all.length, 'confirmed=', confirmed.length);
        setRows(confirmed);
      }catch(e){
        if (__DEV__) console.log('[RecipesListTab] load failed', e?.message || e);
        setRows([]);
      }
    })();
    return ()=>{ alive=false; };
  },[venueId]);

  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.category||'').toLowerCase().includes(q)
    );
  },[rows,search]);

  const openView = useCallback((r:any)=>{
    setViewDoc(r);
    setViewId(r?.id ?? null);
  },[]);

  const Row = ({ r }:{ r:any })=>{
    const subtitle = `${r.category||'—'} · confirmed`;
    return (
      <TouchableOpacity onLongPress={() => openView(r)} activeOpacity={0.7} style={styles.row}>
        <View style={{flex:1}}>
          <Text style={styles.rowTitle}>{r.name || 'Untitled'}</Text>
          <Text style={styles.rowSub}>{subtitle}</Text>
        </View>
        <Text style={styles.chev}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{flex:1, backgroundColor:'#fff'}}>
      <View style={{ padding:16 }}>
        <Text style={styles.title}>Recipes</Text>
        <TextInput
          placeholder="Search confirmed recipes…"
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#64748B"
          style={styles.search}
        />
      </View>
      <ScrollView contentContainerStyle={{paddingHorizontal:16}}>
        {filtered.length === 0 ? (
          <Text style={{ color:'#94A3B8', marginTop:12 }}>No confirmed recipes yet.</Text>
        ) : filtered.map(r => <Row key={r.id} r={r} />)}
      </ScrollView>

      <Modal visible={!!viewId} animationType="slide" onRequestClose={() => {setViewId(null); setViewDoc(null);}}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {viewDoc ? <RecipeCardView recipe={viewDoc} onClose={() => {setViewId(null); setViewDoc(null);}} /> : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- Read-only Recipe Card ---------- */
function RecipeCardView({ recipe, onClose }:{ recipe:any; onClose:()=>void }) {
  const cost = Number(recipe?.cogs ?? 0);
  const rrp  = Number(recipe?.rrp ?? 0);
  const gp   = (rrp > 0 ? ((rrp - cost) / rrp) * 100 : 0);

  return (
    <ScrollView contentContainerStyle={{ padding:16 }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <TouchableOpacity onPress={onClose}><Text style={{ color:'#2563EB', fontSize:16 }}>‹ Back</Text></TouchableOpacity>
        <Text style={{ fontSize:18, fontWeight:'900' }}>Recipe</Text>
        <View style={{ width:60 }} />
      </View>

      <Text style={{ fontSize:20, fontWeight:'900' }}>{recipe?.name || 'Untitled'}</Text>
      <Text style={{ color:'#6B7280', marginTop:2 }}>{(recipe?.category||'—')} · {(recipe?.status||'—')}</Text>

      <View style={{ marginTop:12, padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, backgroundColor:'#F9FAFB' }}>
        <Text style={{ fontWeight:'700' }}>Pricing</Text>
        <Text style={{ color:'#111', marginTop:4 }}>COGS/serve: {Number.isFinite(cost) ? `$${cost.toFixed(2)}` : '—'}</Text>
        <Text style={{ color:'#111', marginTop:4 }}>RRP: {Number.isFinite(rrp) ? `$${rrp.toFixed(2)}` : '—'}</Text>
        <Text style={{ color:'#111', marginTop:4 }}>GP: {Number.isFinite(gp) ? `${gp.toFixed(1)}%` : '—'}</Text>
      </View>

      <View style={{ marginTop:12, padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12 }}>
        <Text style={{ fontWeight:'700' }}>Ingredients (snapshot)</Text>
        {Array.isArray(recipe?.items) && recipe.items.length > 0 ? (
          <View style={{ marginTop:8 }}>
            {recipe.items.map((it:any, idx:number)=>(
              <Text key={idx} style={{ color:'#111', marginTop:4 }}>
                • {it?.name ?? it?.productName ?? '—'} {it?.qty ? `· ${it.qty}` : ''} {it?.unit ?? ''}
              </Text>
            ))}
          </View>
        ) : <Text style={{ color:'#6B7280', marginTop:8 }}>No items.</Text>}
      </View>

      {recipe?.method ? (
        <View style={{ marginTop:12, padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12 }}>
          <Text style={{ fontWeight:'700' }}>Method / Notes</Text>
          <Text style={{ color:'#111', marginTop:8 }}>{recipe.method}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

/* ---------- Tab 3: Drafts (treat missing status as draft) ---------- */
function DraftsTab() {
  const venueId = useVenueId();
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string|null>(null);

  const load = useCallback(async ()=>{
    if (!venueId) return;
    const ref = collection(db, 'venues', venueId, 'recipes');
    const snap = await getDocs(query(ref, orderBy('name')));
    const all:any[] = [];
    snap.forEach(d => all.push({ id: d.id, ...(d.data() as any) }));
    // Treat missing status as draft (legacy docs)
    const drafts = all.filter(r => {
      const s = String(r?.status ?? '').toLowerCase();
      return s === '' || s === 'draft';
    });
    if (__DEV__) console.log('[DraftsTab] all=', all.length, 'drafts=', drafts.length);
    setRows(drafts);
  },[venueId]);

  useEffect(() => {
    (async () => {
      try { await load(); } catch (e) {
        if (__DEV__) console.log('[DraftsTab] load failed', e?.message || e);
        setRows([]);
      }
    })();
  }, [load]);

  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.category||'').toLowerCase().includes(q)
    );
  },[rows, search]);

  const onConfirm = useCallback(async (r:any) => {
    try {
      if (!venueId) throw new Error('No venue');
      // Dev-relaxed confirm (allows 0 cost/0 rrp/empty items)
      await confirmRecipe(venueId, r.id, {
        name: r?.name ?? null,
        yield: r?.yield ?? null,
        unit:  r?.unit ?? null,
        cogs:  typeof r?.cogs === 'number' ? r.cogs : 0,
        rrp:   typeof r?.rrp  === 'number' ? r.rrp  : 0,
        method: r?.method ?? null,
        gpPct:  typeof r?.gpPct === 'number' ? r.gpPct : null,
        rrpIncludesGst: !!r?.rrpIncludesGst,
      });
      Alert.alert('Confirmed', `${r?.name || 'Recipe'} confirmed.`);
      await load();
    } catch (e:any) {
      Alert.alert('Confirm failed', String(e?.message || e));
    }
  }, [venueId, load]);

  const Row = ({ r }:{ r:any }) => (
    <TouchableOpacity
      onPress={() => setOpenId(r.id)}
      onLongPress={() =>
        Alert.alert(
          'Confirm this draft?',
          r?.name || 'Untitled',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Confirm', style: 'destructive', onPress: () => onConfirm(r) }
          ]
        )
      }
      activeOpacity={0.7}
      style={styles.row}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{r.name || 'Untitled'}</Text>
        <Text style={styles.rowSub}>{(r.category||'—')} · {(r.mode||'—')} · draft</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
      <View style={{ padding:16 }}>
        <Text style={styles.title}>Draft Recipes</Text>
        <TextInput
          placeholder="Search drafts…"
          placeholderTextColor="#64748B"
          value={search}
          onChangeText={setSearch}
          style={styles.search}
        />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
        {filtered.length === 0 ? (
          <Text style={{ color:'#94A3B8', marginTop:12 }}>No drafts yet.</Text>
        ) : filtered.map(r => <Row key={r.id} r={r} />)}
      </ScrollView>

      <Modal visible={!!openId} animationType="slide" onRequestClose={() => setOpenId(null)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {openId ? <DraftRecipeDetailPanel recipeId={openId} onClose={() => setOpenId(null)} /> : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '900', marginBottom: 10 },
  search: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingHorizontal:12, height:42, color:'#111827' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB', marginBottom: 10
  },
  rowTitle: { fontWeight: '800' },
  rowSub: { color: '#6B7280', marginTop: 2 },
  chev: { fontSize: 22, color: '#94A3B8', marginLeft: 8 },
});
