// @ts-nocheck
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { updateRecipeDraft } from '../../services/recipes/updateRecipeDraft';
import IngredientEditor from './components/IngredientEditor';
import type { RecipeItem } from '../../types/recipes';

// Simple money helpers
const to2 = (n:number|null|undefined) => n==null ? '—' : Number(n).toFixed(2);

type Props = { recipeId: string; onClose: () => void; mode?: 'single'|'batch'|'dish'|null; nameFromWizard?: string|null };

export default function DraftRecipeDetailPanel({ recipeId, onClose }: Props) {
  const venueId = useVenueId();

  // UI state (we keep local then PATCH)
  const [name, setName] = useState('');                 // will be prefilled by Craft-It next iteration
  const [mode, setMode] = useState<'single'|'batch'|'dish'|null>(null);
  const [items, setItems] = useState<RecipeItem[]>([]);
  const [portionSize, setPortionSize] = useState<string>('');    // batch only
  const [portionUnit, setPortionUnit] = useState<string>('ml');  // batch only
  const [targetGp, setTargetGp] = useState<string>('65');        // %
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);

  // Derived totals
  const batchTotals = useMemo(() => {
    // Sum known volume/weight/each to estimate batch total in chosen portion unit
    let totalMl = 0;
    let totalG  = 0;
    let totalEach = 0;

    items.forEach(it => {
      const qty = Number(it.qty || 0);

      if (it.unit === 'l') totalMl += qty * 1000;
      else if (it.unit === 'ml') totalMl += qty;
      else if (it.unit === 'kg') totalG += qty * 1000;
      else if (it.unit === 'g') totalG += qty;
      else if (it.unit === 'each') totalEach += qty;
      // custom: ignore in batch size
    });

    return { totalMl, totalG, totalEach };
  }, [items]);

  const derivedCogsPerServe = useMemo(() => {
    // cost per ingredient:
    // liquid: cost = (qty_ml / packSizeMl) * packPrice
    // solid:  cost = (qty_g  / packSizeG ) * packPrice
    // each:   cost = (qty_each / packEach) * packPrice
    const sum = items.reduce((acc, it) => {
      const price = it.packPrice ?? 0;
      const qty = Number(it.qty || 0);
      if (!price || !qty) return acc;

      if ((it.unit === 'ml' || it.unit === 'l') && it.packSizeMl) {
        const needMl = it.unit === 'l' ? qty * 1000 : qty;
        return acc + (needMl / it.packSizeMl) * price;
      }
      if ((it.unit === 'g' || it.unit === 'kg') && it.packSizeG) {
        const needG = it.unit === 'kg' ? qty * 1000 : qty;
        return acc + (needG / it.packSizeG) * price;
      }
      if (it.unit === 'each' && it.packEach) {
        return acc + (qty / it.packEach) * price;
      }
      // Unknown pack info -> zero cost; user can fill later
      return acc;
    }, 0);

    // For single/dish: COGS per serve = sum
    // For batch: COGS per serve = sum / serves
    if (mode === 'batch') {
      const pSize = Number(portionSize || 0);
      const pUnit = portionUnit;
      let serves = 0;
      if (pSize > 0) {
        if (pUnit === 'ml') serves = batchTotals.totalMl > 0 ? batchTotals.totalMl / pSize : 0;
        else if (pUnit === 'g') serves = batchTotals.totalG > 0 ? batchTotals.totalG / pSize : 0;
        else if (pUnit === 'each') serves = batchTotals.totalEach > 0 ? batchTotals.totalEach / pSize : 0;
      }
      if (serves > 0) return sum / serves;
      return null;
    }
    return sum || null;
  }, [items, mode, batchTotals, portionSize, portionUnit]);

  const derivedRrp = useMemo(() => {
    const gp = Number(targetGp || 0) / 100;
    const c = Number(derivedCogsPerServe || 0);
    if (!c || !gp || gp >= 1) return null;
    // RRP from COGS and GP%: price = cost / (1 - GP)
    return c / (1 - gp);
  }, [derivedCogsPerServe, targetGp]);

  const servesForBatch = useMemo(() => {
    if (mode !== 'batch') return null;
    const pSize = Number(portionSize || 0);
    if (!pSize) return null;
    if (portionUnit === 'ml') return batchTotals.totalMl ? batchTotals.totalMl / pSize : null;
    if (portionUnit === 'g')  return batchTotals.totalG  ? batchTotals.totalG  / pSize : null;
    if (portionUnit === 'each') return batchTotals.totalEach ? batchTotals.totalEach / pSize : null;
    return null;
  }, [mode, portionSize, portionUnit, batchTotals]);

  const save = useCallback(async () => {
    try {
      setBusy(true);

      const patch:any = {
        name: name || null,
        items,
        method: method || null,
        targetGpPct: targetGp ? Number(targetGp) : null,
      };

      if (mode === 'batch') {
        patch.portionSize = portionSize ? Number(portionSize) : null;
        patch.portionUnit = portionUnit || null;
        patch.yield = servesForBatch ? Number(servesForBatch) : null;
        patch.unit = servesForBatch ? 'serve' : null;
        patch.cogs = derivedCogsPerServe ?? null;
        patch.rrp = derivedRrp ?? null;
      } else {
        // single/dish
        patch.yield = 1;
        patch.unit = 'serve';
        patch.cogs = derivedCogsPerServe ?? null;
        patch.rrp = derivedRrp ?? null;
      }

      await updateRecipeDraft(venueId!, recipeId, patch);
      Alert.alert('Saved', 'Draft updated.');
      onClose();
    } catch (e:any) {
      Alert.alert('Save failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [venueId, recipeId, name, items, method, targetGp, mode, portionSize, portionUnit, servesForBatch, derivedCogsPerServe, derivedRrp, onClose]);

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      <View style={{ padding:16, borderBottomWidth:1, borderColor:'#E5E7EB', flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
        <TouchableOpacity onPress={onClose}><Text style={{ color:'#2563EB', fontSize:16 }}>‹ Back</Text></TouchableOpacity>
        <Text style={{ fontSize:18, fontWeight:'900' }}>Craft-It Draft</Text>
        <View style={{ width:60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding:16, gap:12 }}>
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="House Margarita or Beef Ragu" style={I} autoCapitalize="words" />
        </Field>

        {/* MODE selector minimal (so user can flip if needed) */}
        <Field label="Type">
          <View style={{ flexDirection:'row', gap:8 }}>
            {['single','batch','dish'].map(m=>(
              <Pill key={m} label={m} active={mode===m} onPress={()=>setMode(m)} />
            ))}
          </View>
        </Field>

        <Field label="Ingredients">
          <IngredientEditor venueId={venueId!} items={items} onChange={setItems} />
        </Field>

        {mode === 'batch' && (
          <Field label="Batch portions">
            <View style={{ flexDirection:'row', gap:8 }}>
              <TextInput value={portionSize} onChangeText={setPortionSize} placeholder="Portion size" keyboardType="decimal-pad" style={[I,{flex:1}]} />
              <TextInput value={portionUnit} onChangeText={setPortionUnit} placeholder="ml/g/each" style={[I,{flex:1}]} />
            </View>
            <Text style={{ color:'#6B7280', marginTop:6 }}>
              Estimated batch size: {batchTotals.totalMl ? `${batchTotals.totalMl} ml` : batchTotals.totalG ? `${batchTotals.totalG} g` : batchTotals.totalEach ? `${batchTotals.totalEach} each` : '—'}
              {servesForBatch ? ` · ≈ ${Math.floor(servesForBatch)} serves` : ''}
            </Text>
          </Field>
        )}

        <Field label="Target GP %">
          <TextInput value={targetGp} onChangeText={setTargetGp} placeholder="e.g., 65" keyboardType="decimal-pad" style={I} />
        </Field>

        <Field label="Derived Costs (per serve)">
          <View style={{ padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, backgroundColor:'#F9FAFB' }}>
            <Text>COGS: ${to2(derivedCogsPerServe)}</Text>
            <Text>RRP: ${to2(derivedRrp)}</Text>
          </View>
        </Field>

        <Field label="Method / Notes">
          <TextInput value={method} onChangeText={setMethod} placeholder="Steps, prep notes…" style={[I,{height:120, textAlignVertical:'top'}]} multiline />
        </Field>

        <TouchableOpacity disabled={busy} onPress={save} style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}>
          <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Saving…' : 'Save Draft'}</Text>
        </TouchableOpacity>
      </ScrollView>
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

function Pill({ label, active, onPress }:{label:string; active:boolean; onPress:()=>void}) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{
        paddingVertical:8, paddingHorizontal:12, borderRadius:999,
        borderWidth:1, borderColor: active ? '#111' : '#E5E7EB',
        backgroundColor: active ? '#111' : '#F9FAFB', marginRight:8, marginBottom:8
      }}>
      <Text style={{ color: active ? '#fff' : '#111', fontWeight:'700', textTransform:'capitalize' }}>{label}</Text>
    </TouchableOpacity>
  );
}

const I = { borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' };
