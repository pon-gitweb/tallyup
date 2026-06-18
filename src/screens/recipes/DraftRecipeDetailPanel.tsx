// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { updateRecipeDraft } from '../../services/recipes/updateRecipeDraft';
import { confirmRecipe } from '../../services/recipes/confirmRecipe';
import IngredientEditor from './components/IngredientEditor';
import { makeFirestoreItemSnapshot } from '../../services/recipes/itemSnapshot';

type Props = {
  recipeId: string;
  onClose: () => void;
  initialName?: string | null;
  initialCategory?: 'food' | 'beverage' | null;
  initialMode?: 'batch' | 'single' | 'dish' | null;
  prefill?: any | null;
};

const GST_RATE = 0.15; // NZ

function buildPrefillMethod(p: any): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.description) parts.push(String(p.description));
  if (p.method) parts.push(String(p.method));

  const meta: string[] = [];
  if (p.glassware) meta.push(`Glassware: ${p.glassware}`);
  if (p.garnish) meta.push(`Garnish: ${p.garnish}`);
  if (meta.length) parts.push(meta.join('\n'));

  if (p.iceIngredient) {
    const ice: string[] = [];
    if (p.iceIngredient.dilutionPct != null) ice.push(`Dilution: ${p.iceIngredient.dilutionPct}%`);
    if (p.iceIngredient.volumeNote) ice.push(String(p.iceIngredient.volumeNote));
    if (p.iceIngredient.batchColdWaterNote) ice.push(String(p.iceIngredient.batchColdWaterNote));
    if (ice.length) parts.push(`Ice & dilution:\n${ice.join('\n')}`);
  }

  if (p.batchRecipe) {
    const b = p.batchRecipe;
    const lines = [`Batch recipe (×${b.serves || 10} serves):`];
    (Array.isArray(b.ingredients) ? b.ingredients : []).forEach((i: any) => lines.push(`- ${i.name}: ${i.qty} ${i.unit}`));
    if (b.coldWaterMl) lines.push(`- Cold water: ${b.coldWaterMl} ml`);
    if (b.storageNotes) lines.push(String(b.storageNotes));
    if (b.shelfLife) lines.push(`Shelf life: ${b.shelfLife}`);
    parts.push(lines.join('\n'));
  }

  if (p.bartenderNotes) parts.push(`Notes: ${p.bartenderNotes}`);

  return parts.join('\n\n');
}

export default function DraftRecipeDetailPanel({
  recipeId, onClose, initialName = null, initialCategory = null, initialMode = null, prefill = null
}: Props) {
  const venueId = useVenueId();
  const colours = useColours();
  const nav = useNavigation<any>();
  const { showSuccess, showError } = useToast();

  // Prefill & state
  const [name, setName] = useState<string>(initialName || prefill?.name || '');
  const [mode] = useState<'batch' | 'single' | 'dish' | null>(initialMode ?? null);
  const [category] = useState<'food' | 'beverage' | null>(initialCategory ?? null);

  // AI prefill banner
  const [showAiBanner, setShowAiBanner] = useState<boolean>(!!prefill?.aiGenerated);

  // Items are now controlled here
  const [items, setItems] = useState<any[]>(() => Array.isArray(prefill?.items) ? prefill.items : []);

  // Yield/portion (drives per-serve math)
  const [yieldQty, setYieldQty] = useState<string>('');
  const [unit, setUnit] = useState<string>('serve');
  const [portionSize, setPortionSize] = useState<string>('');
  const [portionUnit, setPortionUnit] = useState<'ml' | 'g' | 'each' | 'serve'>('serve');

  // Derived from ingredients
  const [derivedBatchCost, setDerivedBatchCost] = useState<number>(0);
  const [derivedBatchVolumeMl, setDerivedBatchVolumeMl] = useState<number>(0);
  const [derivedBatchWeightG, setDerivedBatchWeightG] = useState<number>(0);
  const [derivedBatchCount, setDerivedBatchCount] = useState<number>(0);

    // Pricing: GP ↔︎ RRP (with GST toggle)
  const [gpPct, setGpPct] = useState<string>('70');
  const [rrp, setRrp] = useState<string>(prefill?.rrp != null ? String(prefill.rrp) : '');
  const [rrpIncludesGst, setRrpIncludesGst] = useState<boolean>(true);

  // POS linkage — which POS/menu item this recipe feeds + how many portions per sale
  const [outputProductId, setOutputProductId] = useState<string>('');   // e.g. POS button name / code
  const [outputPortionQty, setOutputPortionQty] = useState<string>('1'); // how many recipe "serves" per POS sale

  // Notes
  const [method, setMethod] = useState<string>(() => buildPrefillMethod(prefill));

  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Unpriced-ingredients confirmation guard
  const [unpricedItems, setUnpricedItems] = useState<{ name: string; qty: number|null; unit: string|null }[] | null>(null);
  const [manualCostInputs, setManualCostInputs] = useState<Record<string, string>>({});
  const [invoiceSuggestions, setInvoiceSuggestions] = useState<Record<string, number>>({});

  useEffect(() => {
    if (mode === 'single') {
      setYieldQty('1');
      setUnit('serve');
      if (!portionUnit) setPortionUnit('serve');
    }
  }, [mode, portionUnit]);

  // HYDRATE once per recipeId (explicit boundary)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!venueId || !recipeId) return;
        const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
        const snap = await getDoc(ref);
        if (!alive || !snap.exists()) return;

        const data:any = snap.data() || {};
        if (data.name && !initialName && !prefill?.name) setName(String(data.name));
        if (data.yield != null) setYieldQty(String(data.yield));
        if (data.unit) setUnit(String(data.unit));
        if (Array.isArray(data.items) && (data.items.length > 0 || !Array.isArray(prefill?.items) || prefill.items.length === 0)) {
          setItems(
            data.items.map((r:any, i:number) => ({
              key:`i${i}_${Date.now()}`,
              ...r
            }))
          );
        }
      } catch (e) {
        if (__DEV__) console.log('[DraftRecipeDetailPanel] hydrate failed', e);
      }
    })();
    return () => { alive = false; };
  }, [venueId, recipeId]);

  const servesFromBatch = useMemo(() => {
    if (mode !== 'batch') return null;
    const ps = Number(portionSize || '0') || 0;
    if (ps <= 0) return null;

    if (portionUnit === 'ml' && derivedBatchVolumeMl > 0) {
      return Math.max(1, Math.floor(derivedBatchVolumeMl / ps));
    }
    if (portionUnit === 'g'  && derivedBatchWeightG  > 0) {
      return Math.max(1, Math.floor(derivedBatchWeightG  / ps));
    }
    if (portionUnit === 'each' && derivedBatchCount  > 0) {
      return Math.max(1, Math.floor(derivedBatchCount   / ps));
    }
    if (portionUnit === 'serve') {
      const y = Number(yieldQty || '0') || 0;
      return y > 0 ? y : null;
    }
    return null;
  }, [mode, portionSize, portionUnit, derivedBatchVolumeMl, derivedBatchWeightG, derivedBatchCount, yieldQty]);

  const cogsPerServe = useMemo(() => {
    const serves = mode === 'single'
      ? 1
      : (servesFromBatch ?? (Number(yieldQty || '0') || 0));
    return serves > 0 ? (derivedBatchCost / serves) : 0;
  }, [mode, servesFromBatch, yieldQty, derivedBatchCost]);

  const toNumber = (s:string) => Number(s || '0') || 0;

  const rrpDisplay = useMemo(() => {
    const gp = Math.min(99.9, Math.max(0, toNumber(gpPct)));
    const c  = Math.max(0, cogsPerServe);
    if (gp >= 99.9) return '';
    const net = c / (1 - gp / 100);
    const gross = rrpIncludesGst ? net * (1 + GST_RATE) : net;
    return Number.isFinite(gross) ? gross.toFixed(2) : '';
  }, [gpPct, cogsPerServe, rrpIncludesGst]);

  const onChangeRrp = useCallback((value:string) => {
    setRrp(value);
    const price = toNumber(value);
    const net = rrpIncludesGst ? price / (1 + GST_RATE) : price;
    const c = Math.max(0, cogsPerServe);
    if (net > 0 && net >= c) {
      const gp = ((net - c) / net) * 100;
      setGpPct(gp.toFixed(1));
    }
  }, [rrpIncludesGst, cogsPerServe]);

  const onIngredientsSummary = useCallback((s) => {
    setDerivedBatchCost(s?.totalCost || 0);
    setDerivedBatchVolumeMl(s?.totalMl || 0);
    setDerivedBatchWeightG(s?.totalG || 0);
    setDerivedBatchCount(s?.totalEach || 0);
  }, []);

  // ---------- SMART YIELD SUGGESTIONS ----------
  type YieldSuggestion = { key: string; label: string; value: number };

  const yieldSuggestions: YieldSuggestion[] = useMemo(() => {
    const out: YieldSuggestion[] = [];
    if (mode === 'single') return out; // single serve is fixed at 1

    const addSuggestion = (k:string, label:string, value:number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      if (out.some(s => Math.abs(s.value - value) < 0.0001)) return;
      out.push({ key:k, label, value });
    };

    // 1) Serves from portion logic (strongest signal)
    if (servesFromBatch != null && servesFromBatch > 0) {
      addSuggestion('serves', `${servesFromBatch} serves`, servesFromBatch);
    }

    // 2) Raw batch totals
    if (derivedBatchVolumeMl > 0) {
      addSuggestion('ml', `${derivedBatchVolumeMl.toLocaleString()} ml`, derivedBatchVolumeMl);
    }
    if (derivedBatchWeightG > 0) {
      addSuggestion('g', `${derivedBatchWeightG.toLocaleString()} g`, derivedBatchWeightG);
    }
    if (derivedBatchCount > 0) {
      addSuggestion('each', `${derivedBatchCount.toLocaleString()} each`, derivedBatchCount);
    }

    // 3) Gentle category-based ordering
    const orderScore = (s:YieldSuggestion): number => {
      if (s.key === 'serves') return 0; // always first if present
      if (category === 'beverage') {
        if (s.key === 'ml') return 1;
        if (s.key === 'g') return 3;
      }
      if (category === 'food') {
        if (s.key === 'g') return 1;
        if (s.key === 'ml') return 3;
      }
      if (s.key === 'each') return 2;
      return 4;
    };

    out.sort((a,b)=> orderScore(a) - orderScore(b));
    return out;
  }, [
    mode,
    category,
    servesFromBatch,
    derivedBatchVolumeMl,
    derivedBatchWeightG,
    derivedBatchCount
  ]);
  // --------------------------------------------------------

  // ---------- PRICING CLARITY / GUARDRAILS ----------
  // True if the user typed an RRP manually (any non-empty string)
const isRrpManual =
  typeof rrp === 'string' && rrp.trim().length > 0;

  const effectiveRrp = useMemo(() => {
    const raw = toNumber(isRrpManual ? rrp : rrpDisplay);
    return raw > 0 ? raw : 0;
  }, [isRrpManual, rrp, rrpDisplay]);

  const netPrice = useMemo(() => {
    if (!effectiveRrp) return 0;
    return rrpIncludesGst ? effectiveRrp / (1 + GST_RATE) : effectiveRrp;
  }, [effectiveRrp, rrpIncludesGst]);

  const gpLive = useMemo(() => {
    const v = Number(gpPct || '0') || 0;
    return Math.max(0, Math.min(100, v));
  }, [gpPct]);

  const minGpTarget = useMemo(() => {
    if (category === 'beverage') return 65; // many NZ venues aim 65–70% on bev
    if (category === 'food') return 60;     // many NZ venues aim 60–65% on food
    return 60;
  }, [category]);

  const gpRangeLabel = useMemo(() => {
    if (category === 'beverage') return '65–70%';
    if (category === 'food') return '60–65%';
    return '60–70%';
  }, [category]);

  const gpIsLow = useMemo(
    () => gpLive > 0 && gpLive < minGpTarget,
    [gpLive, minGpTarget]
  );
  // ---------------------------------------------------

  // Best-effort: scan recent invoice lines for a price match on an unpriced ingredient name.
  // Advisory only — never blocks or throws into the confirm flow.
  const loadInvoiceSuggestions = useCallback(async (unpriced: { name: string }[]) => {
    if (!venueId || !unpriced.length) return;
    try {
      const invoicesSnap = await getDocs(collection(db, 'venues', venueId, 'invoices'));
      const invoiceDocs = invoicesSnap.docs.slice().sort((a, b) => {
        const ad = (a.data() as any)?.date?.toMillis?.() ?? 0;
        const bd = (b.data() as any)?.date?.toMillis?.() ?? 0;
        return bd - ad;
      }).slice(0, 15);

      const lineEntries: Array<{ name: string; price: number }> = [];
      for (const invDoc of invoiceDocs) {
        const linesSnap = await getDocs(collection(db, 'venues', venueId, 'invoices', invDoc.id, 'lines'));
        linesSnap.forEach(l => {
          const data: any = l.data() || {};
          const lineName = String(data.productName || data.name || '').toLowerCase().trim();
          const price = Number(data.cost ?? data.unitCost ?? data.unitPrice ?? data.price);
          if (lineName && Number.isFinite(price) && price > 0) lineEntries.push({ name: lineName, price });
        });
      }

      const next: Record<string, number> = {};
      for (const u of unpriced) {
        const target = u.name.toLowerCase().trim();
        if (!target) continue;
        const hit = lineEntries.find(e => e.name.includes(target) || target.includes(e.name));
        if (hit) next[target] = hit.price;
      }
      setInvoiceSuggestions(next);
    } catch (e) {
      if (__DEV__) console.log('[DraftRecipeDetailPanel] invoice suggestion lookup failed', e);
      setInvoiceSuggestions({});
    }
  }, [venueId]);

  const saveManualCost = useCallback(async (ingredientName: string, rawValue: string) => {
    const cost = Number(rawValue);
    if (!Number.isFinite(cost) || cost <= 0) {
      showError('Enter a valid cost');
      return;
    }
    const nextItems = items.map((it: any) => {
      if ((it.name ?? it.productName) !== ingredientName) return it;
      const qty = Number(it.qty) > 0 ? Number(it.qty) : 1;
      return {
        ...it,
        costPerServe: cost,
        manualCost: true,
        link: { productId: 'misc', packSize: qty, packUnit: it.unit, packPrice: cost },
      };
    });
    try {
      await updateRecipeDraft(venueId, recipeId, { items: makeFirestoreItemSnapshot(nextItems) });
      setItems(nextItems);
      setUnpricedItems(prev => (prev ? prev.filter(u => u.name !== ingredientName) : prev));
      showSuccess(`✓ Cost set for ${ingredientName}`);
    } catch (e: any) {
      showError(e?.message || 'Could not save cost');
    }
  }, [venueId, recipeId, items, showError, showSuccess]);

  const goAddToInventory = useCallback((ingredientName: string) => {
    nav.navigate('EditProductScreen', { product: { name: ingredientName } });
  }, [nav]);

  const save = useCallback(async () => {
    try {
      if (!venueId) throw new Error('No venueId');
      if (!recipeId) throw new Error('No recipeId');
      if (!name || !name.trim()) throw new Error('Please enter a name');

      const y   = Number(yieldQty || '0') || (servesFromBatch ?? 0);
      const cgs = Number.isFinite(cogsPerServe) ? Number(cogsPerServe.toFixed(4)) : null;
      const rrpVal = (rrp?.trim()?.length ? toNumber(rrp) : toNumber(rrpDisplay)) || 0;

      // CLEAN snapshot for Firestore
      const itemsClean = makeFirestoreItemSnapshot(items);

      await updateRecipeDraft(venueId, recipeId, {
        name: name.trim(),
        yield: y || null,
        unit: unit || (mode === 'single' ? 'serve' : 'serves'),
        items: itemsClean,
        cogs: cgs,
        rrp: Number.isFinite(rrpVal) ? Number(rrpVal.toFixed(2)) : null,
        method: method || null
      });
      showSuccess('Draft updated.');
      onClose();
    } catch (e:any) {
      showError(String(e?.message || e) || 'Save failed');
    }
  }, [venueId, recipeId, name, yieldQty, servesFromBatch, unit, cogsPerServe, rrp, rrpDisplay, method, items, onClose, mode, showSuccess, showError]);

  const confirmNow = useCallback(async () => {
    try {
      if (!venueId) throw new Error('No venueId');
      if (!recipeId) throw new Error('No recipeId');
      if (!name || !name.trim()) throw new Error('Please enter a name');
      if (items.length === 0) throw new Error('Add at least one ingredient');

      setBusy(true);
      const y = Number(yieldQty || '0') || (servesFromBatch ?? 0);
      const cgs = Number.isFinite(cogsPerServe) ? Number(cogsPerServe.toFixed(4)) : null;
      const rrpVal = (rrp?.trim()?.length ? Number(rrp) : Number(rrpDisplay)) || 0;

      const itemsClean = makeFirestoreItemSnapshot(items);

      await confirmRecipe(venueId, recipeId, {
        name: name.trim(),
        yield: y || null,
        unit: unit || (mode === 'single' ? 'serve' : 'serves'),
        cogs: cgs,
        rrp: Number.isFinite(rrpVal) ? Number(rrpVal.toFixed(2)) : null,
        method: method || null,
        gpPct: Number(gpPct || '0') || null,
        rrpIncludesGst,
        itemsSnapshot: itemsClean,
      });

      setUnpricedItems(null);
      showSuccess('Recipe locked and saved.');
      onClose();
    } catch (e: any) {
      if (e?.code === 'UNPRICED_INGREDIENTS') {
        const list = Array.isArray(e.items) ? e.items : [];
        setUnpricedItems(list);
        loadInvoiceSuggestions(list);
      } else {
        showError(String(e?.message || e) || 'Confirm failed');
      }
    } finally {
      setBusy(false);
    }
  }, [venueId, recipeId, name, yieldQty, servesFromBatch, unit, cogsPerServe, rrp, rrpDisplay, method, gpPct, rrpIncludesGst, mode, onClose, items, showSuccess, showError, loadInvoiceSuggestions]);

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      <Header title="Craft-It: Draft" onBack={onClose} />

      <ScrollView contentContainerStyle={{ padding:16, gap:12 }} keyboardShouldPersistTaps="handled">
        {showAiBanner && (
          <View style={{
            flexDirection:'row', alignItems:'center', justifyContent:'space-between',
            padding:8, borderRadius:8,
            backgroundColor: colours.stellarAmber + '22',
            borderWidth:1, borderColor: colours.stellarAmber,
          }}>
            <Text style={{ fontSize:12, fontWeight:'700', color: colours.stellarAmber, flex:1 }}>
              ✦ AI generated — edit anything before saving
            </Text>
            <TouchableOpacity onPress={() => setShowAiBanner(false)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <Text style={{ fontSize:14, fontWeight:'800', color: colours.stellarAmber, paddingHorizontal:6 }}>×</Text>
            </TouchableOpacity>
          </View>
        )}

        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g., House Margarita"
            style={I}
            autoCapitalize="words"
          />
          {mode ? <Text style={Subtle}>Mode: {mode}</Text> : null}
          {category ? <Text style={Subtle}>Category: {category}</Text> : null}
        </Field>

        <IngredientEditor
          items={items}
          onItemsChange={setItems}
          onSummary={onIngredientsSummary}
          category={category}
          mode={mode}
        />

        {/* Nudge: unlinked ingredients don't update when prices change */}
        {items.length > 0 && (() => {
          const unlinked = items.filter(r => !r.link?.productId || r.link.productId === 'misc').length;
          return unlinked > 0 ? (
            <View style={{ padding:10, borderRadius:10, backgroundColor:'#FEF3C7', borderWidth:1, borderColor:'#F59E0B', marginTop:4 }}>
              <Text style={{ fontSize:12, color:'#92400E', fontWeight:'700' }}>
                {unlinked} ingredient{unlinked>1?'s are':' is'} not linked to venue products
              </Text>
              <Text style={{ fontSize:12, color:'#92400E', marginTop:2 }}>
                Search and select products from the ingredient search above to link them — linked ingredients get automatic price updates when invoices are scanned (🔗).
              </Text>
            </View>
          ) : null;
        })()}

        <Card>
          <Row label="Derived COGS (per serve)" value={formatMoney(cogsPerServe)} />
          <Text style={{ fontSize:11, opacity:0.7, marginTop:4 }}>
            Based on your ingredient costs, portion size and batch yield.
          </Text>

          <View style={{ height:8 }} />

          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
            <Text style={{ fontWeight:'700' }}>RRP includes GST (15%)</Text>
            <Switch value={rrpIncludesGst} onValueChange={setRrpIncludesGst} />
          </View>

          <FieldSmall label="Target GP %">
            <TextInput
              value={gpPct}
              onChangeText={setGpPct}
              placeholder="e.g., 70"
              keyboardType="decimal-pad"
              style={I}
            />
            <Text style={{ fontSize:11, opacity:0.7, marginTop:4 }}>
              Many venues aim for around {gpRangeLabel} GP — adjust to match your venue.
            </Text>
          </FieldSmall>

          <FieldSmall label="RRP">
            <TextInput
              value={rrp.length ? rrp : rrpDisplay}
              onChangeText={onChangeRrp}
              placeholder="e.g., 15.00"
              keyboardType="decimal-pad"
              style={I}
            />
            <Text style={{ fontSize:11, opacity:0.7, marginTop:4 }}>
              {isRrpManual
                ? 'Price is set manually; GP updates from your price.'
                : 'Price is auto-calculated from COGS and target GP.'}
            </Text>
          </FieldSmall>

          <Row
            label="Net price (ex GST)"
            value={formatMoney(netPrice)}
          />

          <Row
            label="Live GP %"
            value={`${gpLive.toFixed(1)}%`}
          />

          {gpIsLow && (
            <View
              style={{
                marginTop:8,
                padding:8,
                borderRadius:8,
                backgroundColor:'#FEF2F2',
                borderWidth:1,
                borderColor:'#FECACA'
              }}
            >
              <Text style={{ fontSize:12, color:'#B91C1C', fontWeight:'700' }}>
                GP is below typical target
              </Text>
              <Text style={{ fontSize:11, color:'#B91C1C', marginTop:2 }}>
                Many venues aim for around {gpRangeLabel} GP on {category || 'these'} items.
                Double-check this recipe still works for your business.
              </Text>
            </View>
          )}
        </Card>

        <Field label="Yield / Unit" row>
          <TextInput
            value={yieldQty || (mode==='batch' && servesFromBatch!=null ? String(servesFromBatch) : '')}
            onChangeText={setYieldQty}
            placeholder={mode === 'single'
              ? '1'
              : (servesFromBatch != null ? String(servesFromBatch) : 'e.g., 10')}
            keyboardType="numeric"
            style={[I, { flex:1, marginRight:8 }]}
          />
          <TextInput
            value={unit}
            onChangeText={setUnit}
            placeholder={mode === 'single' ? 'serve' : 'serves'}
            style={[I, { flex:1 }]}
          />
        </Field>

        {/* Smart suggestions for yield */}
        {yieldSuggestions.length > 0 && (
          <View
            style={{
              marginTop:4,
              padding:10,
              borderRadius:12,
              backgroundColor:'#FEF3C7',
              borderWidth:1,
              borderColor:'#FDE68A',
              gap:6
            }}
          >
            <Text style={{ fontWeight:'800', color:'#92400E' }}>
              Suggested yield
            </Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
              {yieldSuggestions.map(s => {
                const isActive = String(s.value) === (yieldQty || '');
                return (
                  <TouchableOpacity
                    key={s.key}
                    onPress={() => setYieldQty(String(s.value))}
                    style={{
                      paddingVertical:6,
                      paddingHorizontal:10,
                      borderRadius:999,
                      backgroundColor: isActive ? '#F97316' : '#FFF7ED',
                      borderWidth:1,
                      borderColor: isActive ? '#EA580C' : '#FED7AA'
                    }}
                  >
                    <Text
                      style={{
                        fontWeight:'700',
                        color: isActive ? '#FFFFFF' : '#9A3412'
                      }}
                    >
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ fontSize:11, color:'#92400E' }}>
              Tap a suggestion to use it as the batch yield. You can still edit it any time.
            </Text>
          </View>
        )}

        {mode !== 'single' && (
          <Field label="Portion size (to calculate per-serve COGS)">
            <View style={{ flexDirection:'row' }}>
              <TextInput
                value={portionSize}
                onChangeText={setPortionSize}
                placeholder="e.g., 150"
                keyboardType="numeric"
                style={[I, { flex:1, marginRight:8 }]}
              />
              <Dropdown
                value={portionUnit}
                options={['ml','g','each','serve']}
                onChange={setPortionUnit}
              />
            </View>
            <Text style={Hint}>
              Batch totals from ingredients: {derivedBatchVolumeMl} ml · {derivedBatchWeightG} g · {derivedBatchCount} each
            </Text>
          </Field>
        )}

        <Field label="Method / Notes">
          <TextInput
            value={method}
            onChangeText={setMethod}
            placeholder="Steps, prep notes…"
            style={[I, { height:120, textAlignVertical:'top' }]}
            multiline
          />
        </Field>

        <TouchableOpacity
          disabled={busy}
          onPress={confirmNow}
          style={{ padding:14, borderRadius:12, backgroundColor: colours.success }}
        >
          <Text style={{ color: colours.primaryText, fontWeight:'800', textAlign:'center' }}>
            {busy ? 'Confirming…' : 'Confirm Recipe'}
          </Text>
        </TouchableOpacity>

        <View style={{ height:8 }} />

        <TouchableOpacity
          disabled={busy}
          onPress={save}
          style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}
        >
          <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>
            {busy ? 'Saving…' : 'Save Draft'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Unpriced ingredients — non-blocking guard modal */}
      <Modal visible={!!unpricedItems} transparent animationType="slide" onRequestClose={() => setUnpricedItems(null)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.4)', justifyContent:'flex-end' }}>
          <View style={{ backgroundColor: colours.surface, borderTopLeftRadius:20, borderTopRightRadius:20, padding:20, maxHeight:'85%' }}>
            <Text style={{ fontSize:18, fontWeight:'800', color: colours.text, marginBottom:4 }}>
              Pricing needed before confirming
            </Text>
            <Text style={{ color: colours.textSecondary, marginBottom:16, fontSize:13 }}>
              These ingredients need a cost before this recipe can be confirmed.
            </Text>

            <ScrollView style={{ maxHeight: 360 }}>
              {(unpricedItems || []).map((u) => {
                const suggestion = invoiceSuggestions[u.name.toLowerCase().trim()];
                return (
                  <View key={u.name} style={{
                    borderWidth:1, borderColor: colours.amber, backgroundColor: colours.amber + '14',
                    borderRadius:12, padding:12, marginBottom:10,
                  }}>
                    <Text style={{ fontWeight:'800', color: colours.text }}>{u.name}</Text>
                    <Text style={{ color: colours.textSecondary, fontSize:12, marginTop:2 }}>
                      {u.qty != null ? u.qty : ''} {u.unit || ''}
                    </Text>

                    {suggestion != null && (
                      <TouchableOpacity onPress={() => saveManualCost(u.name, String(suggestion))} style={{ marginTop:8 }}>
                        <Text style={{ color: colours.deepBlue, fontSize:12 }}>
                          Last seen on invoice: ${suggestion.toFixed(2)} per unit — use this?
                        </Text>
                      </TouchableOpacity>
                    )}

                    <View style={{ flexDirection:'row', gap:8, marginTop:10, alignItems:'center' }}>
                      <TextInput
                        value={manualCostInputs[u.name] ?? ''}
                        onChangeText={(v) => setManualCostInputs(prev => ({ ...prev, [u.name]: v }))}
                        placeholder="$0.00"
                        keyboardType="decimal-pad"
                        style={{ flex:1, borderWidth:1, borderColor: colours.border, borderRadius:8, paddingHorizontal:10, paddingVertical:8, color: colours.text }}
                      />
                      <TouchableOpacity
                        onPress={() => saveManualCost(u.name, manualCostInputs[u.name] ?? '')}
                        style={{ backgroundColor: colours.primary, paddingHorizontal:12, paddingVertical:9, borderRadius:8 }}
                      >
                        <Text style={{ color: colours.primaryText, fontWeight:'700', fontSize:12 }}>Save</Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity onPress={() => goAddToInventory(u.name)} style={{ marginTop:8 }}>
                      <Text style={{ color: colours.deepBlue, fontSize:12, fontWeight:'700' }}>+ Add to inventory</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              disabled={retrying}
              onPress={async () => { setRetrying(true); try { await confirmNow(); } finally { setRetrying(false); } }}
              style={{ marginTop:12, padding:14, borderRadius:12, backgroundColor: colours.success }}
            >
              <Text style={{ color: colours.primaryText, fontWeight:'800', textAlign:'center' }}>
                {retrying ? 'Checking…' : 'Retry confirmation'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setUnpricedItems(null)} style={{ padding:12, alignItems:'center' }}>
              <Text style={{ color: colours.textSecondary }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ====== Local UI helpers ====== */
function Header({ title, onBack }:{ title:string; onBack:()=>void }) {
  return (
    <View
      style={{
        padding:16,
        borderBottomWidth:1,
        borderColor:'#E5E7EB',
        flexDirection:'row',
        justifyContent:'space-between',
        alignItems:'center'
      }}
    >
      <TouchableOpacity onPress={onBack}>
        <Text style={{ color:'#2563EB', fontSize:16 }}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={{ fontSize:18, fontWeight:'900' }}>{title}</Text>
      <View style={{ width:60 }} />
    </View>
  );
}
function Field({ label, children, row }:{ label:string; children:any; row?:boolean }) {
  return (
    <View>
      <Text style={{ fontWeight:'700', marginBottom:6 }}>{label}</Text>
      <View style={{ flexDirection: row ? 'row' : 'column' }}>{children}</View>
    </View>
  );
}
function FieldSmall({ label, children }:{ label:string; children:any }) {
  return (
    <View style={{ marginTop:6 }}>
      <Text style={{ fontWeight:'700', marginBottom:6 }}>{label}</Text>
      {children}
    </View>
  );
}
function Card({ children }:{ children:any }) {
  return (
    <View
      style={{
        padding:12,
        borderRadius:12,
        borderWidth:1,
        borderColor:'#E5E7EB'
      }}
    >
      {children}
    </View>
  );
}
function Row({ label, value }:{ label:string; value:string }) {
  return (
    <View style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:4 }}>
      <Text style={{ opacity:0.7 }}>{label}</Text>
      <Text style={{ fontWeight:'700' }}>{value}</Text>
    </View>
  );
}
function Dropdown({ value, options, onChange }:{ value:any; options:any[]; onChange:(v:any)=>void }) {
  const advance = () => {
    const idx = Math.max(0, options.findIndex(o => o === value));
    const next = options[(idx + 1) % options.length];
    onChange(next);
  };
  return (
    <TouchableOpacity
      onPress={advance}
      style={{
        borderWidth:1,
        borderColor:'#E5E7EB',
        borderRadius:12,
        paddingHorizontal:12,
        justifyContent:'center'
      }}
    >
      <Text style={{ paddingVertical:12, fontWeight:'700' }}>
        {String(value)}
      </Text>
    </TouchableOpacity>
  );
}
function formatMoney(n:any) {
  return Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—';
}

const I = {
  borderWidth:1,
  borderColor:'#E5E7EB',
  borderRadius:12,
  padding:12
} as const;
const Subtle = { opacity:0.7, marginTop:4 } as const;
const Hint = { opacity:0.6, marginTop:6, fontSize:12 } as const;