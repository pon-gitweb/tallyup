// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert } from 'react-native';
import { searchProductsLite } from '../../../services/products/searchProductsLite';

// Beverage quick measures
const QUICK_MEASURES = [
  { label: '15ml', ml: 15 },
  { label: '30ml', ml: 30 },
  { label: '45ml', ml: 45 },
  { label: '60ml', ml: 60 },
  { label: 'Custom…', ml: -1 },
];

// The row "unit" is what the user measures by for the portion.
type RowUnit = 'ml' | 'g' | 'each';

type Ingredient = {
  key: string;
  productId?: string | null;
  name: string;               // free text if not matched
  qty: number;
  unit: RowUnit;
  packSize?: number | null;   // from inventory
  packUnit?: 'ml' | 'l' | 'g' | 'kg' | 'each' | null; // from inventory
  packPrice?: number | null;  // from inventory
  thumbUrl?: string | null;
};

export default function IngredientEditor({
  onSummary,
  category,
  mode,
}:{
  onSummary: (s:{ totalCost:number; totalMl:number; totalG:number; totalEach:number }) => void;
  category?: 'food' | 'beverage' | null;
  mode?: 'batch' | 'single' | 'dish' | null;
}) {
  const [rows, setRows] = useState<Ingredient[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);

  // which row is showing the inline unit selector (long-press)
  const [unitChooserKey, setUnitChooserKey] = useState<string | null>(null);

  // ——— Search with house-first & sensible ordering ———
  useEffect(() => {
    let alive = true;
    (async () => {
      const q = (query || '').trim();
      if (!q) { setResults([]); return; }
      const raw = await searchProductsLite(q);
      if (!alive) return;
      const sorted = (raw || []).slice().sort((a,b) => {
        const ah = (a.isHouse || /house/i.test(a.supplierName || '')) ? 0 : 1;
        const bh = (b.isHouse || /house/i.test(b.supplierName || '')) ? 0 : 1;
        if (ah !== bh) return ah - bh; // house first
        const ap = Number(a.price ?? a.cost ?? 0);
        const bp = Number(b.price ?? b.cost ?? 0);
        return ap - bp; // then cheapest
      });
      setResults(sorted);
    })();
    return () => { alive = false; };
  }, [query]);

  // ——— Helpers ———
  const unitToBase = (unit:string) => {
    if (unit === 'ml') return { base:'ml', f: 1 };
    if (unit === 'l')  return { base:'ml', f: 1000 };
    if (unit === 'g')  return { base:'g',  f: 1 };
    if (unit === 'kg') return { base:'g',  f: 1000 };
    if (unit === 'each') return { base:'each', f: 1 };
    return { base:unit, f:1 };
  };

  const portionCost = (row:Ingredient): number => {
    const qty = Number(row.qty || 0);
    if (!qty) return 0;
    const packSize = Number(row.packSize || 0);
    const packPrice = Number(row.packPrice || 0);
    const packUnit = (row.packUnit || '').toLowerCase();
    if (!packSize || !packPrice || !packUnit) return 0;

    const req = unitToBase(row.unit);
    const pack = unitToBase(packUnit);
    if (req.base !== pack.base) return 0;

    const qtyBase = qty * req.f;
    const packBase = packSize * pack.f;
    if (!packBase) return 0;
    return packPrice * (qtyBase / packBase);
  };

  const maxUnitPriceForBase = (base:'ml'|'g'|'each'): number => {
    let best = 0;
    for (const r of rows) {
      const unit = (r.packUnit || '').toLowerCase();
      const pack = unitToBase(unit);
      if (pack.base !== base) continue;
      const p = Number(r.packPrice || 0);
      const s = Number(r.packSize || 0) * pack.f;
      if (p > 0 && s > 0) {
        const per = p / s; // $ per base unit
        if (per > best) best = per;
      }
    }
    return best;
  };

  const defaultUnitForCategory = (category === 'beverage') ? 'ml' : 'g';

  const addRow = (patch?:Partial<Ingredient>) => {
    setRows(r => [
      ...r,
      {
        key: String(Date.now() + Math.random()),
        name: '',
        qty: 0,
        unit: (patch?.unit as RowUnit) || (defaultUnitForCategory as RowUnit),
        ...patch,
      },
    ]);
  };
  const updateRow = (key:string, patch:Partial<Ingredient>) => setRows(r => r.map(x => x.key === key ? { ...x, ...patch } : x));
  const removeRow = (key:string) => setRows(r => r.filter(x => x.key !== key));

  // ——— Summary ———
  const summary = useMemo(() => {
    let totalCost = 0, totalMl = 0, totalG = 0, totalEach = 0;
    for (const r of rows) {
      totalCost += portionCost(r);
      if (r.unit === 'ml') totalMl += Number(r.qty || 0);
      if (r.unit === 'g')  totalG  += Number(r.qty || 0);
      if (r.unit === 'each') totalEach += Number(r.qty || 0);
    }
    return {
      totalCost: Number(totalCost.toFixed(6)),
      totalMl: Math.round(totalMl),
      totalG: Math.round(totalG),
      totalEach: Math.round(totalEach),
    };
  }, [rows]);
  useEffect(() => { onSummary?.(summary); }, [summary, onSummary]);

  // ——— Fast pick handler ———
  const pickProduct = useCallback((item:any) => {
    const patch: Partial<Ingredient> = {
      productId: item.id || null,
      name: item.name || '',
      packSize: item.packSize ?? item.size ?? null,
      packUnit: (item.packUnit || item.unit || '').toLowerCase() || null,
      packPrice: item.price ?? item.cost ?? null,
      thumbUrl: item.thumbnail || item.image || null,
      qty: 0,
      unit: defaultUnitForCategory as RowUnit,
    };
    addRow(patch);
    setQuery('');
    setResults([]);
  }, [defaultUnitForCategory]);

  // ——— Add misc when no match ———
  const addMiscFromQuery = useCallback(() => {
    const q = (query || '').trim();
    if (!q) { Alert.alert('Nothing to add'); return; }
    const base: 'ml'|'g'|'each' = (defaultUnitForCategory as any);
    const perUnit = maxUnitPriceForBase(base) || (base === 'each' ? 2.0 : 0.02);
    const patch: Partial<Ingredient> = {
      productId: null,
      name: q,
      packSize: 1,
      packUnit: base,
      packPrice: perUnit, // $ per base unit
      qty: 0,
      unit: base as RowUnit,
    };
    addRow(patch);
    setQuery('');
    setResults([]);
  }, [query, defaultUnitForCategory, rows]);

  // ——— Unit picker behaviour ———
  const allowedCycle = useMemo<RowUnit[]>(() => {
    // Tap-cycle list is short; long-press shows full.
    return (category === 'beverage') ? ['ml', 'each'] : ['g', 'each'];
  }, [category]);

  const cycleUnit = (current:RowUnit): RowUnit => {
    const list = allowedCycle;
    const i = Math.max(0, list.indexOf(current));
    return list[(i + 1) % list.length];
  };

  const fullUnitList: RowUnit[] = ['ml', 'g', 'each']; // long-press menu

  // ——— UI ———
  return (
    <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' }}>
      <Text style={{ fontWeight:'800', marginBottom:8 }}>Ingredients</Text>

      {/* Search */}
      <View style={{ flexDirection:'row', gap:8 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search inventory (house first)…"
          style={[I, { flex:1 }]}
        />
        <TouchableOpacity onPress={addMiscFromQuery} style={[Btn, { backgroundColor:'#FFF7ED', borderColor:'#FDBA74' }]}>
          <Text style={{ fontWeight:'800', color:'#9A3412' }}>+ Misc</Text>
        </TouchableOpacity>
      </View>

      {/* Results */}
      {!!results?.length && (
        <View style={{ marginTop:8, maxHeight:240, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, overflow:'hidden' }}>
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={results.slice(0, 30)}
            keyExtractor={(item, idx) => String(item.id || idx)}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => pickProduct(item)}
                style={{ padding:10, backgroundColor:'#fff', borderBottomWidth:1, borderColor:'#F3F4F6', flexDirection:'row', alignItems:'center', gap:10 }}
              >
                <View style={{ width:36, height:36, borderRadius:6, backgroundColor:'#F3F4F6', alignItems:'center', justifyContent:'center' }}>
                  <Text style={{ fontSize:10, color:'#6B7280' }}>img</Text>
                </View>
                <View style={{ flex:1 }}>
                  <Text style={{ fontWeight:'700' }}>
                    {(item.isHouse || /house/i.test(item.supplierName || '')) ? '🏠 ' : ''}{item.name || 'Unnamed'}
                  </Text>
                  <Text style={{ color:'#6B7280' }}>
                    {item.packSize || item.size || '—'} {String(item.packUnit || item.unit || '').toUpperCase()}
                    {' · $'}{Number(item.price ?? item.cost ?? 0).toFixed(2)}
                    {item.supplierName ? ` · ${item.supplierName}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Rows */}
      {rows.map(r => (
        <View key={r.key} style={{ marginTop:12, padding:10, backgroundColor:'#fff', borderWidth:1, borderColor:'#E5E7EB', borderRadius:10 }}>
          <Text style={{ fontWeight:'700', marginBottom:6 }}>{r.name || 'Misc ingredient'}</Text>

          {/* Beverage quick chips when unit is ml */}
          { (category === 'beverage' && r.unit === 'ml') && (
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:6 }}>
              {QUICK_MEASURES.map(q => (
                <TouchableOpacity
                  key={q.label}
                  onPress={() => {
                    if (q.ml < 0) {
                      const v = promptNumber('Enter ml quantity');
                      if (v != null) updateRow(r.key, { qty: v, unit: 'ml' });
                    } else {
                      updateRow(r.key, { qty: q.ml, unit: 'ml' });
                    }
                  }}
                  style={Pill}
                >
                  <Text style={{ fontWeight:'700' }}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Qty + Unit */}
          <View style={{ flexDirection:'row', gap:8, width:'100%', alignItems:'center' }}>
            <TextInput
              value={String(r.qty || '')}
              onChangeText={v => updateRow(r.key, { qty: Number(v || '0') || 0 })}
              placeholder="Qty"
              keyboardType="decimal-pad"
              style={[I, { flex:1 }]}
            />

            {/* Unit chip: tap = cycle, long-press = inline chooser */}
            <TouchableOpacity
              onPress={() => updateRow(r.key, { unit: cycleUnit(r.unit) as RowUnit })}
              onLongPress={() => setUnitChooserKey(k => (k === r.key ? null : r.key))}
              delayLongPress={250}
              style={[I, { minWidth:84, alignItems:'center', justifyContent:'center' }]}
            >
              <Text style={{ fontWeight:'800' }}>{String(r.unit).toUpperCase()}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => removeRow(r.key)} style={[Btn, { backgroundColor:'#FEE2E2', borderColor:'#FCA5A5' }]}>
              <Text style={{ fontWeight:'800', color:'#991B1B' }}>Remove</Text>
            </TouchableOpacity>
          </View>

          {/* Inline unit chooser (appears on long press) */}
          {unitChooserKey === r.key && (
            <View style={{ flexDirection:'row', gap:8, marginTop:8 }}>
              {fullUnitList.map(u => (
                <TouchableOpacity
                  key={u}
                  onPress={() => { updateRow(r.key, { unit: u }); setUnitChooserKey(null); }}
                  style={[Pill, r.unit === u ? { borderColor:'#111', backgroundColor:'#111' } : null]}
                >
                  <Text style={{ fontWeight:'800', color: r.unit === u ? '#fff' : '#111' }}>{u.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => setUnitChooserKey(null)} style={[Btn]}>
                <Text style={{ fontWeight:'800' }}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Cost line */}
          <Text style={{ marginTop:8, color:'#6B7280' }}>
            {r.packPrice && r.packSize && r.packUnit
              ? `Cost: $${portionCost(r).toFixed(4)} · Pack: ${r.packSize}${String(r.packUnit).toUpperCase()} @ $${Number(r.packPrice).toFixed(2)}`
              : 'Estimated (misc). Link later for exact costing.'}
          </Text>
        </View>
      ))}

      <TouchableOpacity onPress={() => addRow()} style={[Btn, { marginTop:12 }]}>
        <Text style={{ fontWeight:'800', color:'#111' }}>+ Add Ingredient</Text>
      </TouchableOpacity>

      {/* Summary */}
      <View style={{ marginTop:12, paddingTop:10, borderTopWidth:1, borderColor:'#E5E7EB', flexDirection:'row', justifyContent:'space-between' }}>
        <Text style={{ fontWeight:'700' }}>Batch Cost</Text>
        <Text style={{ fontWeight:'700' }}>${summary.totalCost.toFixed(4)}</Text>
      </View>
    </View>
  );
}

// Minimal prompt for numeric input (RN-friendly stand-in)
function promptNumber(title:string): number | null {
  // Expo Go won’t show a native prompt; this is a graceful no-op for most builds.
  // eslint-disable-next-line no-alert
  const s = prompt?.(title) ?? null;
  const n = Number(s || 'NaN');
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const I   = { borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' };
const Btn = { paddingVertical:10, paddingHorizontal:12, borderRadius:10, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F3F4F6', alignItems:'center' };
const Pill= { paddingVertical:6, paddingHorizontal:10, borderRadius:999, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' };
