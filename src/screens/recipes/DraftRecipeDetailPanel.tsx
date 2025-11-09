// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, Switch } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { updateRecipeDraft } from '../../services/recipes/updateRecipeDraft';
import IngredientEditor from './components/IngredientEditor';

type Props = {
  recipeId: string;
  onClose: () => void;
  initialName?: string | null;
  initialCategory?: 'food' | 'beverage' | null;
  initialMode?: 'batch' | 'single' | 'dish' | null;
};

const GST_RATE = 0.15; // NZ

export default function DraftRecipeDetailPanel({
  recipeId, onClose, initialName = null, initialCategory = null, initialMode = null
}: Props) {
  const venueId = useVenueId();

  // Prefill & state
  const [name, setName] = useState<string>(initialName || '');
  const [mode, setMode] = useState<'batch' | 'single' | 'dish' | null>(initialMode ?? null);
  const [category] = useState<'food' | 'beverage' | null>(initialCategory ?? null);

  // Yield/portion (moved near bottom; still drives COGS/serve math)
  const [yieldQty, setYieldQty] = useState<string>('');
  const [unit, setUnit] = useState<string>('serve');
  const [portionSize, setPortionSize] = useState<string>(''); // number string
  const [portionUnit, setPortionUnit] = useState<'ml' | 'g' | 'each' | 'serve'>('serve');

  // Derived from ingredients
  const [derivedBatchCost, setDerivedBatchCost] = useState<number>(0);
  const [derivedBatchVolumeMl, setDerivedBatchVolumeMl] = useState<number>(0);
  const [derivedBatchWeightG, setDerivedBatchWeightG] = useState<number>(0);
  const [derivedBatchCount, setDerivedBatchCount] = useState<number>(0);

  // Pricing: GP ↔︎ RRP (with GST toggle)
  const [gpPct, setGpPct] = useState<string>('70'); // default 70%
  const [rrp, setRrp] = useState<string>('');       // user override
  const [rrpIncludesGst, setRrpIncludesGst] = useState<boolean>(true);

  // Notes
  const [method, setMethod] = useState<string>('');

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === 'single') {
      setYieldQty('1');
      setUnit('serve');
      if (!portionUnit) setPortionUnit('serve');
    }
  }, [mode, portionUnit]);

  // Suggest serves for batch from totals + portion size
  const servesFromBatch = useMemo(() => {
    if (mode !== 'batch') return null;
    const ps = Number(portionSize || '0') || 0;
    if (ps <= 0) return null;

    if (portionUnit === 'ml' && derivedBatchVolumeMl > 0) return Math.max(1, Math.floor(derivedBatchVolumeMl / ps));
    if (portionUnit === 'g'  && derivedBatchWeightG  > 0) return Math.max(1, Math.floor(derivedBatchWeightG  / ps));
    if (portionUnit === 'each' && derivedBatchCount  > 0) return Math.max(1, Math.floor(derivedBatchCount   / ps));
    if (portionUnit === 'serve') {
      const y = Number(yieldQty || '0') || 0;
      return y > 0 ? y : null;
    }
    return null;
  }, [mode, portionSize, portionUnit, derivedBatchVolumeMl, derivedBatchWeightG, derivedBatchCount, yieldQty]);

  // Derived COGS per serve
  const cogsPerServe = useMemo(() => {
    const serves = mode === 'single' ? 1 : (servesFromBatch ?? (Number(yieldQty || '0') || 0));
    return serves > 0 ? (derivedBatchCost / serves) : 0;
  }, [mode, servesFromBatch, yieldQty, derivedBatchCost]);

  // Two-way GP/RRP
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

  const save = useCallback(async () => {
    try {
      if (!venueId) throw new Error('No venueId');
      if (!recipeId) throw new Error('No recipeId');
      if (!name || !name.trim()) throw new Error('Please enter a name');

      const y   = Number(yieldQty || '0') || (servesFromBatch ?? 0);
      const cgs = Number.isFinite(cogsPerServe) ? Number(cogsPerServe.toFixed(4)) : null;
      const rrpVal = (rrp?.trim()?.length ? toNumber(rrp) : toNumber(rrpDisplay)) || 0;

      await updateRecipeDraft(venueId, recipeId, {
        name: name.trim(),
        yield: y || null,
        unit: unit || (mode === 'single' ? 'serve' : 'serves'),
        cogs: cgs,
        rrp: Number.isFinite(rrpVal) ? Number(rrpVal.toFixed(2)) : null,
        method: method || null
      });
      Alert.alert('Saved', 'Draft updated.');
      onClose();
    } catch (e:any) {
      Alert.alert('Save failed', String(e?.message || e));
    }
  }, [venueId, recipeId, name, yieldQty, servesFromBatch, unit, cogsPerServe, rrp, rrpDisplay, method, onClose, mode]);

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      <Header title="Craft-It: Draft" onBack={onClose} />

      {/* IMPORTANT: allow taps to pass to nested lists */}
      <ScrollView contentContainerStyle={{ padding:16, gap:12 }} keyboardShouldPersistTaps="handled">
        {/* Name first */}
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="e.g., House Margarita" style={I} autoCapitalize="words" />
          {mode ? <Text style={Subtle}>Mode: {mode}</Text> : null}
          {category ? <Text style={Subtle}>Category: {category}</Text> : null}
        </Field>

        {/* Ingredients FIRST – fastest flow */}
        <IngredientEditor onSummary={onIngredientsSummary} category={category} mode={mode} />

        {/* Pricing card (derived COGS + GP↔︎RRP) */}
        <Card>
          <Row label="Derived COGS (per serve)" value={formatMoney(cogsPerServe)} />
          <View style={{ height:8 }} />
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
            <Text style={{ fontWeight:'700' }}>RRP includes GST (15%)</Text>
            <Switch value={rrpIncludesGst} onValueChange={setRrpIncludesGst} />
          </View>
          <FieldSmall label="Target GP %">
            <TextInput value={gpPct} onChangeText={setGpPct} placeholder="e.g., 70" keyboardType="decimal-pad" style={I} />
          </FieldSmall>
          <FieldSmall label="RRP">
            <TextInput value={rrp.length ? rrp : rrpDisplay} onChangeText={onChangeRrp} placeholder="e.g., 15.00" keyboardType="decimal-pad" style={I} />
          </FieldSmall>
          <Row label="Live GP %" value={`${(Number(gpPct || '0') || 0).toFixed(1)}%`} />
        </Card>

        {/* Yield / Portion moved DOWN here */}
        <Field label="Yield / Unit" row>
          <TextInput
            value={yieldQty || (mode==='batch' && servesFromBatch!=null ? String(servesFromBatch) : '')}
            onChangeText={setYieldQty}
            placeholder={mode === 'single' ? '1' : (servesFromBatch != null ? String(servesFromBatch) : 'e.g., 10')}
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
              <Dropdown value={portionUnit} options={['ml','g','each','serve']} onChange={setPortionUnit} />
            </View>
            <Text style={Hint}>
              Batch totals from ingredients: {derivedBatchVolumeMl} ml · {derivedBatchWeightG} g · {derivedBatchCount} each
            </Text>
          </Field>
        )}

        <Field label="Method / Notes">
          <TextInput value={method} onChangeText={setMethod} placeholder="Steps, prep notes…" style={[I, { height:120, textAlignVertical:'top' }]} multiline />
        </Field>

        <TouchableOpacity disabled={busy} onPress={save} style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}>
          <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Saving…' : 'Save Draft'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Header({ title, onBack }:{ title:string; onBack:()=>void }) {
  return (
    <View style={{ padding:16, borderBottomWidth:1, borderColor:'#E5E7EB', flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
      <TouchableOpacity onPress={onBack}><Text style={{ color:'#2563EB', fontSize:16 }}>‹ Back</Text></TouchableOpacity>
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
  return <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' }}>{children}</View>;
}
function Row({ label, value }:{ label:string; value:string }) {
  return (
    <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
      <Text style={{ fontWeight:'700' }}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}
function Dropdown({ value, options, onChange }:{ value:string; options:string[]; onChange:(v:any)=>void }) {
  return (
    <TouchableOpacity
      onPress={() => {
        const idx = Math.max(0, options.indexOf(value));
        onChange(options[(idx + 1) % options.length]);
      }}
      style={[I, { paddingVertical:12, alignItems:'center', justifyContent:'center', minWidth:96 }]}
    >
      <Text style={{ fontWeight:'700' }}>{value}</Text>
    </TouchableOpacity>
  );
}

const Subtle = { color:'#6B7280', marginTop:4 };
const Hint   = { color:'#6B7280', marginTop:6 };
const I = { borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' };
const formatMoney = (n:number) => (!Number.isFinite(n) ? '—' : `$${n.toFixed(2)}`);
