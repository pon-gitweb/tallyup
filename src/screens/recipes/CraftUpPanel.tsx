// @ts-nocheck
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Alert, Modal, SafeAreaView,
  ScrollView, StyleSheet, TextInput
} from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useColours } from '../../context/ThemeContext';

import { createRecipeDraft } from '../../services/recipes/createRecipeDraft';
import { confirmRecipe } from '../../services/recipes/confirmRecipe';
import { duplicateToDraft } from '../../services/recipes/duplicateToDraft';
import { deleteDraft } from '../../services/recipes/deleteDraft';
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

/* ---------------- Tab 1: Create (baseline) ---------------- */
function CreateStart({ onClose }:{ onClose:()=>void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<'food' | 'beverage' | null>(null);
  const [mode, setMode] = useState<'batch' | 'single' | 'dish' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const tip = useMemo(
    () => 'Craft-It: choose type and mode, we'll handle the rest. Name + ingredients are set in the draft screen.',
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

/* ---------------- Tab 2: View Recipes (CONFIRMED only) ----------------
   Tap = view card; Long-press = Duplicate → Draft → open editor
----------------------------------------------------------------------- */
function RecipesListTab() {
  const venueId = useVenueId();
  const colours = useColours();
  const styles = makeStyles(colours);
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [viewId, setViewId] = useState<string|null>(null);
  const [viewDoc, setViewDoc] = useState<any|null>(null);
  const [editId, setEditId] = useState<string|null>(null);

  const load = useCallback(async ()=>{
    if (!venueId) return;
    const qy = query(collection(db, 'venues', venueId, 'recipes'), orderBy('name'));
    const snap = await getDocs(qy);
    const out:any[] = [];
    snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
    setRows(out);
  },[venueId]);

  useEffect(()=>{ (async()=>{ try{ await load(); }catch(e){ if(__DEV__) console.log('[RecipesListTab] load failed', e?.message||e); setRows([]);} })(); },[load]);

  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase();
    const bySearch = !q ? rows : rows.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.category||'').toLowerCase().includes(q)
    );
    // confirmed only
    return bySearch.filter(r => String(r?.status||'draft') === 'confirmed');
  },[rows,search]);

  const openView = useCallback((r:any)=>{
    setViewDoc(r);
    setViewId(r?.id ?? null);
  },[]);

  const onDuplicate = useCallback(async (r:any)=>{
    try{
      if (!venueId) throw new Error('No venue');
      const { id:newId } = await duplicateToDraft(venueId, r.id);
      Alert.alert('Duplicated', 'A new draft was created from this recipe.');
      setViewId(null); setViewDoc(null);
      await load();
      setEditId(newId);
    }catch(e:any){
      Alert.alert('Duplicate failed', String(e?.message || e));
    }
  },[venueId, load]);

  const Row = ({ r }:{ r:any })=>{
    return (
      <TouchableOpacity
        onPress={() => openView(r)}             // tap = view
        onLongPress={() => onDuplicate(r)}      // long-press = duplicate to draft
        delayLongPress={300}
        activeOpacity={0.7}
        style={styles.row}
      >
        <View style={{flex:1}}>
          <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
            <Text style={styles.rowTitle}>{r.name || 'Untitled'}</Text>
            <View style={[styles.chip, styles.chipConfirmed]}>
              <Text style={styles.chipText}>Confirmed</Text>
            </View>
          </View>
          <Text style={styles.rowSub}>{(r.category||'—')} · confirmed</Text>
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

      {/* read-only card */}
      <Modal visible={!!viewId} animationType="slide" onRequestClose={() => {setViewId(null); setViewDoc(null);}}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {viewDoc ? <RecipeCardView recipe={viewDoc} onClose={() => {setViewId(null); setViewDoc(null);}} /> : null}
        </SafeAreaView>
      </Modal>

      {/* open editor for duplicated draft */}
      <Modal visible={!!editId} animationType="slide" onRequestClose={() => setEditId(null)}>
        <SafeAreaView style={{ flex:1, backgroundColor: '#fff' }}>
          {editId ? <DraftRecipeDetailPanel recipeId={editId} onClose={() => setEditId(null)} /> : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------------- Read-only Recipe Card ---------------- */
function RecipeCardView({ recipe, onClose }) {
  const colours = useColours();
  const styles = makeStyles(colours);
  const cost = Number(recipe?.cogs ?? 0);
  const rrp = Number(recipe?.rrp ?? 0);
  const gp = rrp > 0 ? ((rrp - cost) / rrp) * 100 : 0;
  const yieldQty = recipe?.yield ?? null;
  const yieldUnit = recipe?.unit ?? 'serves';
  const category = recipe?.category ?? null;
  const mode = recipe?.mode ?? null;

  const methodSteps = (recipe?.method ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const formatIngredient = (it) => {
    const qty = it?.qty != null ? String(it.qty) : '';
    const unit = it?.unit ?? '';
    const name = it?.name ?? it?.productName ?? '—';
    return [qty, unit, name].filter(Boolean).join(' ');
  };

  const gpColor = gp >= 65 ? colours.success : gp >= 55 ? '#D97706' : colours.error;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <TouchableOpacity onPress={onClose}>
          <Text style={{ color: '#2563EB', fontSize: 16 }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 14, fontWeight: '900', color: '#6B7280', letterSpacing: 1 }}>RECIPE</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Title + badges */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 26, fontWeight: '900', color: '#111' }}>{recipe?.name || 'Untitled'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {category && (
            <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#EFF6FF' }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#1D4ED8', textTransform: 'capitalize' }}>{category}</Text>
            </View>
          )}
          {mode && (
            <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#F3F4F6' }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#374151', textTransform: 'capitalize' }}>{mode}</Text>
            </View>
          )}
          {yieldQty != null && (
            <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#F0FDF4' }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colours.success }}>Makes {yieldQty} {yieldUnit}</Text>
            </View>
          )}
          <View style={[styles.chip, styles.chipConfirmed]}>
            <Text style={styles.chipText}>Confirmed</Text>
          </View>
        </View>
      </View>

      {/* Ingredients */}
      <View style={{ marginBottom: 20, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#374151', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Ingredients
        </Text>
        {Array.isArray(recipe?.items) && recipe.items.length > 0 ? (
          recipe.items.map((it, idx) => (
            <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: idx < recipe.items.length - 1 ? 1 : 0, borderBottomColor: '#F0F0F0' }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#374151', marginRight: 12, marginTop: 1, flexShrink: 0 }} />
              <Text style={{ fontSize: 15, color: '#111', flex: 1 }}>{formatIngredient(it)}</Text>
            </View>
          ))
        ) : (
          <Text style={{ color: '#9CA3AF' }}>No ingredients recorded.</Text>
        )}
      </View>

      {/* Method */}
      {methodSteps.length > 0 && (
        <View style={{ marginBottom: 20, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#374151', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Method
          </Text>
          {methodSteps.map((step, idx) => (
            <View key={idx} style={{ flexDirection: 'row', marginBottom: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 0, flexShrink: 0 }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>{idx + 1}</Text>
              </View>
              <Text style={{ fontSize: 15, color: '#111', flex: 1, lineHeight: 22, paddingTop: 3 }}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Pricing footer */}
      <View style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', marginBottom: 16 }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#374151', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Pricing
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
          <Text style={{ color: '#6B7280', fontSize: 14 }}>Cost per serve</Text>
          <Text style={{ fontWeight: '800', color: '#111', fontSize: 14 }}>{Number.isFinite(cost) && cost > 0 ? '$' + cost.toFixed(2) : '—'}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
          <Text style={{ color: '#6B7280', fontSize: 14 }}>RRP (incl. GST)</Text>
          <Text style={{ fontWeight: '800', color: '#111', fontSize: 14 }}>{Number.isFinite(rrp) && rrp > 0 ? '$' + rrp.toFixed(2) : '—'}</Text>
        </View>
        <View style={{ height: 1, backgroundColor: '#E5E7EB', marginVertical: 8 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontWeight: '800', color: '#111', fontSize: 15 }}>Gross Profit</Text>
          <Text style={{ fontWeight: '900', fontSize: 20, color: gpColor }}>
            {Number.isFinite(gp) && gp > 0 ? gp.toFixed(1) + '%' : '—'}
          </Text>
        </View>
      </View>

      <TouchableOpacity onPress={onClose} style={{ padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6' }}>
        <Text style={{ color: '#111', fontWeight: '800', textAlign: 'center' }}>Close</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ---------------- Tab 3: Drafts (DRAFTS only) ----------------
   Tap = edit; Long-press = Confirm/Delete (dev-relaxed confirm)
-------------------------------------------------------------- */
function DraftsTab() {
  const venueId = useVenueId();
  const colours = useColours();
  const styles = makeStyles(colours);
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string|null>(null);

  const load = useCallback(async ()=>{
    if (!venueId) return;
    const qy = query(collection(db, 'venues', venueId, 'recipes'), orderBy('name'));
    const snap = await getDocs(qy);
    const out:any[] = [];
    snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
    setRows(out);
  },[venueId]);

  useEffect(() => { (async()=>{ try{ await load(); }catch(e){ if(__DEV__) console.log('[DraftsTab] load failed', e?.message||e); setRows([]);} })(); }, [load]);

  const filtered = useMemo(()=>{
    const q = search.trim().toLowerCase();
    const bySearch = !q ? rows : rows.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.category||'').toLowerCase().includes(q)
    );
    // drafts only
    return bySearch.filter(r => String(r?.status||'draft') === 'draft');
  },[rows, search]);

  const onConfirm = useCallback(async (r:any) => {
    try {
      if (!venueId) throw new Error('No venue');
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

  const onDelete = useCallback(async (r:any) => {
    try {
      if (!venueId) throw new Error('No venue');
      await deleteDraft(venueId, r.id);
      Alert.alert('Deleted', 'Draft removed.');
      await load();
    } catch (e:any) {
      Alert.alert('Delete failed', String(e?.message || e));
    }
  }, [venueId, load]);

  const Row = ({ r }:{ r:any }) => (
    <TouchableOpacity
      onPress={() => setOpenId(r.id)} // tap = edit
      onLongPress={() =>
        Alert.alert(
          r?.name || 'Draft',
          'Choose an action',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => onDelete(r) },
            { text: 'Confirm', onPress: () => onConfirm(r) },
          ]
        )
      }
      delayLongPress={300}
      activeOpacity={0.7}
      style={styles.row}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
          <Text style={styles.rowTitle}>{r.name || 'Untitled'}</Text>
          <View style={[styles.chip, styles.chipDraft]}><Text style={styles.chipText}>Draft</Text></View>
        </View>
        <Text style={styles.rowSub}>{(r.category||'—')} · {(r.mode||'—')}</Text>
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
        <Text style={{ color:'#6B7280', marginTop:8 }}>Tip: Long-press a draft to Confirm or Delete. Tap to edit.</Text>
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

function makeStyles(c: ReturnType<typeof useColours>) {
  return StyleSheet.create({
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
    chip: { paddingHorizontal:8, paddingVertical:2, borderRadius:999 },
    chipText: { fontSize:12, fontWeight:'700', color:'#111' },
    chipDraft: { backgroundColor:'#FEF3C7', borderWidth:1, borderColor:'#F59E0B' },
    chipConfirmed: { backgroundColor:'#DCFCE7', borderWidth:1, borderColor: c.success },
  });
}
