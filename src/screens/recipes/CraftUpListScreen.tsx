// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { confirmRecipe } from '../../services/recipes/confirmRecipe';
import { createRecipeDraft } from '../../services/recipes/createRecipeDraft';
import RecipeDetailScreen from './RecipeDetailScreen';
import DraftRecipeDetailPanel from './DraftRecipeDetailPanel';
import RecipeGenerationModal from '../../components/recipes/RecipeGenerationModal';
import RecipeVariantSelector from '../../components/recipes/RecipeVariantSelector';
import RecipeGenerationResult from '../../components/recipes/RecipeGenerationResult';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

type Filter = 'all' | 'confirmed' | 'drafts';

type Recipe = {
  id: string;
  name: string;
  status?: 'draft'|'confirmed';
  category?: string|null;
  mode?: 'single'|'batch'|'dish'|string|null;
  yield?: number|null;
  portionsPerBatch?: number|null;
  cogs?: number|null;
  rrp?: number|null;
  updatedAt?: any;
};

export default function CraftUpListScreen({ filter = 'all' }: { filter?: Filter }) {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const colours = useColours();
  const S = makeStyles(colours);
  const { showError } = useToast();
  const { confirm, modal } = useConfirmModal();
  const [rows, setRows] = useState<Recipe[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string|null>(null);
  const [viewId, setViewId] = useState<string|null>(null);
  const [editDraftId, setEditDraftId] = useState<string|null>(null);

  // AI recipe generation state
  const [showGenModal, setShowGenModal] = useState(false);
  const [generatedRecipe, setGeneratedRecipe] = useState<any | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<any | null>(null);
  const [showVariants, setShowVariants] = useState(false);
  const [genResult, setGenResult] = useState<{ id: string; prefill: any } | null>(null);

  const load = useCallback(async ()=>{
    try{
      if (!venueId) return;
      const qy = query(collection(db, 'venues', venueId, 'recipes'), orderBy('name'));
      const snap = await getDocs(qy);
      const out: Recipe[] = [];
      snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
      setRows(out);
    }catch(e){
      if (__DEV__) console.log('[CraftUpList] load failed', e?.message || e);
      setRows([]);
    }
  },[venueId]);

  useEffect(()=>{ (async ()=>{ await load(); })(); },[load]);

  const onRecipeGenerated = (recipe: any) => {
    setGeneratedRecipe(recipe);
    if (Array.isArray(recipe?.variants) && recipe.variants.length > 1) {
      setShowVariants(true);
    } else {
      setSelectedVariant(recipe?.variants?.[0] ?? null);
    }
  };

  const handleSaveGenerated = async (aiRecipe: any) => {
    try {
      if (!venueId) throw new Error('No venue');

      const aiType: string = generatedRecipe?._type || 'cocktail';
      const isDrink = aiType === 'cocktail' || aiType === 'drink';
      const recCategory: 'food' | 'beverage' = isDrink || !!aiRecipe.iceIngredient ? 'beverage' : 'food';
      const recMode: 'batch' | 'single' | 'dish' = aiType === 'batch' ? 'batch' : (isDrink ? 'single' : 'dish');

      const products: any[] = Array.isArray(generatedRecipe?._products) ? generatedRecipe._products : [];
      const productByName = new Map(products.map((p) => [String(p.name).toLowerCase().trim(), p]));

      const items = (aiRecipe.ingredients || []).map((ing: any) => {
        const matched = ing.matchedProductName
          ? productByName.get(String(ing.matchedProductName).toLowerCase().trim())
          : null;
        const qty = Number(ing.qty) || 0;
        const cost = Number(ing.costPerServe) || 0;
        const pricePerUnit = qty > 0 ? cost / qty : cost;

        return {
          key: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: matched ? matched.name : ing.name,
          qty,
          unit: ing.unit || 'ml',
          link: matched
            ? { productId: matched.id, packSize: matched.packSize ?? null, packUnit: matched.unit ?? null, packPrice: matched.costPrice ?? null }
            : (cost > 0 ? { productId: 'misc', packSize: 1, packUnit: ing.unit || 'ml', packPrice: pricePerUnit } : undefined),
        };
      });

      const { id: newId } = await createRecipeDraft({
        venueId,
        name: aiRecipe.name || 'Untitled',
        category: recCategory,
        mode: recMode,
      });

      const prefill = {
        name: aiRecipe.name,
        method: aiRecipe.method,
        glassware: aiRecipe.glassware,
        garnish: aiRecipe.garnish,
        description: aiRecipe.description,
        bartenderNotes: aiRecipe.bartenderNotes,
        rrp: aiRecipe.pricing?.suggestedSellingPrice ?? null,
        items,
        batchRecipe: aiRecipe.batchRecipe ?? null,
        iceIngredient: aiRecipe.iceIngredient ?? null,
        aiGenerated: true,
      };

      setGeneratedRecipe(null);
      setSelectedVariant(null);
      setShowVariants(false);
      setGenResult({ id: newId, prefill });
    } catch (e: any) {
      showError(String(e?.message || e) || 'Could not save generated recipe');
    }
  };

  const searched = useMemo(()=>{
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.category||'').toLowerCase().includes(q)
    );
  },[rows,search]);

  const filtered = useMemo(()=>{
    if (filter === 'confirmed') return searched.filter(r => (r.status||'draft') === 'confirmed');
    if (filter === 'drafts')    return searched.filter(r => (r.status||'draft') === 'draft');
    return searched;
  },[searched, filter]);

  const title = useMemo(()=>{
    if (filter === 'confirmed') return 'Craft-It — Recipes';
    if (filter === 'drafts')    return 'Craft-It — Drafts';
    return 'Craft-It — All';
  },[filter]);

  const confirmFromList = useCallback((r: Recipe) => {
    if ((r.status||'draft') !== 'draft') return; // ignore confirmed
    if (filter !== 'drafts') return; // safety: only allow in Drafts view
    confirm({
      title: 'Confirm recipe?',
      message: `Lock "${r.name}" and freeze its current items & costs.\nYou can still duplicate to a new draft later.`,
      confirmLabel: 'Confirm',
      destructive: true,
      onConfirm: async () => {
        try{
          if (!venueId) throw new Error('No venue');
          setBusyId(r.id);
          await confirmRecipe(venueId, r.id, { name: r.name?.trim() || null });
          await load();
        }catch(e: any){
          if (e?.code === 'UNPRICED_INGREDIENTS') {
            const count = Array.isArray(e.items) ? e.items.length : 0;
            showError(`This recipe can't be confirmed yet — ${count} ingredient${count === 1 ? '' : 's'} need pricing. Open the recipe to fix them.`);
            setEditDraftId(r.id);
          } else {
            showError(String(e?.message || e) || 'Confirm failed');
          }
        }finally{
          setBusyId(null);
        }
      },
    });
  },[venueId, load, filter, confirm, showError]);

  const Row = ({ r }: { r: Recipe })=>{
    const status = (r.status||'draft');
    const chipStyle = status === 'confirmed' ? S.chipConfirmed : S.chipDraft;
    const enableLongPressConfirm = filter === 'drafts' && status === 'draft';

    return (
      <TouchableOpacity
        style={S.row}
        activeOpacity={0.9}
        onPress={status === 'confirmed' ? () => setViewId(r.id) : undefined}
        onLongPress={enableLongPressConfirm ? () => confirmFromList(r) : undefined}
        delayLongPress={300}
      >
        <View style={{flex:1}}>
          <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
            <Text style={S.rowTitle}>{r.name}</Text>
            <View style={[S.chip, chipStyle]}>
              <Text style={S.chipText}>{status === 'confirmed' ? 'Confirmed' : 'Draft'}</Text>
            </View>
          </View>
          <Text style={S.rowSub}>
            {(r.category||'—')} · {(r.mode||'—')}
            {(r.mode==='batch' && (r.yield || r.portionsPerBatch)) ? ` · yields ${(r.yield ?? r.portionsPerBatch)} serves` : ''}
          </Text>
        </View>
        <View style={{alignItems:'flex-end'}}>
          <Text style={S.rowKpi}>{formatMoney(r.cogs)}</Text>
          <Text style={S.rowKpiSub}>{r.rrp ? `RRP ${formatMoney(r.rrp)}` : '—'}</Text>
          {busyId === r.id ? <Text style={{ marginTop:6, color:'#111' }}>Confirming…</Text> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{flex:1, backgroundColor:'#fff'}}>
      <View style={S.header}>
        <Text style={S.title}>{title}</Text>
        <TextInput
          placeholder="Search recipes or category"
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#64748B"
          style={S.search}
        />
        {filter === 'drafts' ? (
          <Text style={{ color:'#6B7280', marginTop:8 }}>
            Tip: Long-press a draft to confirm it.
          </Text>
        ) : null}
      </View>
      <ScrollView style={{flex:1}} contentContainerStyle={{padding:16, paddingTop:0}}>
        {filtered.length === 0 ? (
          <View style={{ marginTop:32, alignItems:'center', paddingHorizontal:12 }}>
            <Text style={{ color:colours.text, fontSize:16, fontWeight:'800', marginBottom:6, textAlign:'center' }}>
              Build your first recipe
            </Text>
            <Text style={{ color:colours.textSecondary, fontSize:13, textAlign:'center', lineHeight:18 }}>
              Tap + and tell us what you'd like to make — we'll cost it out and match it to your products in seconds.
            </Text>
          </View>
        ) : filtered.map(r => <Row key={r.id} r={r} />)}
      </ScrollView>

      {/* Read-only detail for confirmed recipes */}
      <Modal visible={!!viewId} animationType="slide" onRequestClose={() => setViewId(null)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {viewId ? <RecipeDetailScreen recipeId={viewId} onBack={() => setViewId(null)} /> : null}
        </SafeAreaView>
      </Modal>

      {/* Draft editor — opened automatically when a confirm attempt hits unpriced ingredients */}
      <Modal visible={!!editDraftId} animationType="slide" onRequestClose={() => setEditDraftId(null)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {editDraftId ? (
            <DraftRecipeDetailPanel recipeId={editDraftId} onClose={() => { setEditDraftId(null); load(); }} />
          ) : null}
        </SafeAreaView>
      </Modal>
      {modal}

      {/* FAB — create new recipe */}
      <TouchableOpacity
        style={S.fab}
        onPress={() => setShowGenModal(true)}
        activeOpacity={0.85}
      >
        <Text style={S.fabText}>+</Text>
      </TouchableOpacity>

      <RecipeGenerationModal
        visible={showGenModal}
        onClose={() => setShowGenModal(false)}
        onRecipeGenerated={(recipe) => { setShowGenModal(false); onRecipeGenerated(recipe); }}
        onBuildManually={() => { setShowGenModal(false); nav.navigate('DraftRecipeDetail', { recipeId: 'new' }); }}
      />

      {generatedRecipe && (
        <RecipeVariantSelector
          visible={showVariants}
          variants={generatedRecipe.variants || []}
          onSelect={(variant) => { setSelectedVariant(variant); setShowVariants(false); }}
          onCancel={() => { setShowVariants(false); setGeneratedRecipe(null); setSelectedVariant(null); }}
        />
      )}

      {generatedRecipe && !showVariants && (
        <RecipeGenerationResult
          visible={!!generatedRecipe && !showVariants}
          recipeData={generatedRecipe}
          selectedVariant={selectedVariant}
          onSave={handleSaveGenerated}
          onDiscard={() => { setGeneratedRecipe(null); setSelectedVariant(null); }}
        />
      )}

      <Modal visible={!!genResult} animationType="slide" onRequestClose={() => setGenResult(null)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {genResult ? (
            <DraftRecipeDetailPanel recipeId={genResult.id} prefill={genResult.prefill} onClose={() => setGenResult(null)} />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function formatMoney(n?: number|null) {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return `$${v.toFixed(2)}`;
}

function makeStyles(c: ReturnType<typeof useColours>) {
  return StyleSheet.create({
    header: { padding:16 },
    title: { fontSize:18, fontWeight:'900', marginBottom:10 },
    search: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingHorizontal:12, height:42, color:'#111827' },
    row: { padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, marginTop:10, flexDirection:'row', gap:12 },
    rowTitle: { fontWeight:'800' },
    rowSub: { color:'#6B7280', marginTop:2 },
    rowKpi: { fontWeight:'900' },
    rowKpiSub: { color:'#6B7280', marginTop:2, fontSize:12 },
    chip: { paddingHorizontal:8, paddingVertical:2, borderRadius:999 },
    chipText: { fontSize:12, fontWeight:'700', color:'#111' },
    chipDraft: { backgroundColor:'#FEF3C7', borderWidth:1, borderColor:'#F59E0B' },
    chipConfirmed: { backgroundColor:'#DCFCE7', borderWidth:1, borderColor: c.success },
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 24,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.navy,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.navy,
      shadowOpacity: 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 5,
    },
    fabText: { color: c.primaryText, fontSize: 28, fontWeight: '300', lineHeight: 32 },
  });
}
