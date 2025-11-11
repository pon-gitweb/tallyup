// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Modal } from 'react-native';
import { getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, orderBy, startAt, endAt, limit, query } from 'firebase/firestore';
import { useVenueId } from '../../../context/VenueProvider';

type Props = {
  onSummary: (s: {
    totalCost: number;
    totalMl: number;
    totalG: number;
    totalEach: number;
    rows: any[];
  }) => void;
  category?: 'food'|'beverage'|null;
  mode?: 'batch'|'single'|'dish'|null;
};

type ProductHit = {
  id: string;
  name: string;
  packSize?: number|null;
  packUnit?: string|null;   // 'ml'|'L'|'g'|'kg'|'each'
  packPrice?: number|null;  // price per pack
  supplierName?: string|null;
};

type Row = {
  key: string;
  name: string;
  qty: number;
  unit: 'ml'|'g'|'each';
  link?: { productId: string; packSize?: number|null; packUnit?: string|null; packPrice?: number|null };
};

const unitFamily = (c:'food'|'beverage'|null|undefined) => (c==='beverage' ? 'ml' : 'g');
const toBase = (u:string|undefined|null):'ml'|'g'|'each' => {
  if (u==='ml'||u==='L') return 'ml';
  if (u==='g'||u==='kg') return 'g';
  return 'each';
};
const normPackSize = (size?:number|null, unit?:string|null):{qty:number, base:'ml'|'g'|'each'} => {
  if (!size || size <= 0) return { qty: 1, base: toBase(unit) };
  if (unit === 'L') return { qty: size * 1000, base:'ml' };
  if (unit === 'kg') return { qty: size * 1000, base:'g' };
  return { qty: size, base: toBase(unit) };
};

const LEXICON = [
  { label:'dash',      qty:1,  unit:'ml'  },
  { label:'splash',    qty:5,  unit:'ml'  },
  { label:'single',    qty:30, unit:'ml'  }, // NZ
  { label:'double',    qty:60, unit:'ml'  }, // NZ
  { label:'pinch',     qty:1,  unit:'g'   },
  { label:'sprinkle',  qty:2,  unit:'g'   },
  { label:'spray',     qty:1,  unit:'ml'  },
];

const BEV_CHIPS = [15,30,45,60];
const FOOD_CHIPS = [1,5,10,50];

export default function IngredientEditor({ onSummary, category=null }: Props) {
  const venueId = useVenueId();

  // search state
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);

  // entry state
  const defaultUnit:'ml'|'g'|'each' = unitFamily(category ?? 'beverage') as any;
  const [qty, setQty]   = useState<string>('');
  const [unit, setUnit] = useState<'ml'|'g'|'each'>(defaultUnit);
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

  // current rows
  const [rows, setRows] = useState<Row[]>([]);

  // fetch product hits by name prefix
  useEffect(() => {
    let stop=false;
    (async () => {
      if (!venueId || !term.trim()) { setHits([]); return; }
      setLoading(true);
      try {
        const db = getFirestore(getApp());
        const col = collection(db, 'venues', venueId, 'products');
        const q = query(col, orderBy('name'), startAt(term), endAt(term + '\uf8ff'), limit(25));
        const snap = await getDocs(q);
        if (stop) return;
        const list: ProductHit[] = [];
        snap.forEach(d => {
          const x:any = d.data() || {};
          list.push({
            id: d.id,
            name: x.name ?? '(unnamed)',
            packSize: x.packSize ?? x.pack?.size ?? null,
            packUnit: x.packUnit ?? x.pack?.unit ?? null,
            packPrice: x.packPrice ?? x.price ?? null,
            supplierName: x.supplierName ?? null,
          });
        });
        setHits(list);
      } catch(e) {
        setHits([]);
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => { stop = true; };
  }, [venueId, term]);

  const estimateMaxUnitPrice = (u:'ml'|'g'|'each'):number => {
    let maxPU = 0;

    // from current results
    for (const p of hits) {
      if (p.packPrice && p.packPrice > 0) {
        const { qty:packQty, base } = normPackSize(p.packSize, p.packUnit);
        if (base === u && packQty > 0) {
          maxPU = Math.max(maxPU, p.packPrice / packQty);
        }
      }
    }
    // from existing linked rows
    for (const r of rows) {
      if (r.link && r.link.packPrice && r.link.packPrice > 0) {
        const { qty:packQty, base } = normPackSize(r.link.packSize, r.link.packUnit);
        if (base === u && packQty > 0) {
          maxPU = Math.max(maxPU, r.link.packPrice / packQty);
        }
      }
    }
    return maxPU; // may be 0 if nothing to infer
  };

  // add linked product row
  const addLinked = (p:ProductHit) => {
    const chosenQty = qty ? Number(qty) : (defaultUnit==='ml' ? 30 : defaultUnit==='g' ? 5 : 1);
    const r:Row = {
      key: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: p.name,
      qty: chosenQty,
      unit,
      link: { productId: p.id, packSize: p.packSize ?? null, packUnit: p.packUnit ?? null, packPrice: p.packPrice ?? null }
    };
    setRows(prev => [r, ...prev]);
    setTerm(''); setQty('');
  };

  // add misc row (with temporary high per-unit price if we can infer)
  const addMisc = (label?:string) => {
    const chosenQty = qty ? Number(qty) : (defaultUnit==='ml' ? 30 : defaultUnit==='g' ? 5 : 1);
    const name = (label ?? term).trim() || 'Misc';
    const pu = estimateMaxUnitPrice(unit); // per-unit
    const r:Row = {
      key: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: `${name} (misc)`,
      qty: chosenQty,
      unit,
      link: pu > 0 ? { productId: 'misc', packSize: 1, packUnit: unit, packPrice: pu } : undefined
    };
    setRows(prev => [r, ...prev]);
    setTerm(''); setQty('');
  };

  // Enter: choose top result or add misc if none
  const commit = () => {
    // lexicon shortcut if exact word
    const lex = LEXICON.find(l => l.label.toLowerCase() === term.trim().toLowerCase());
    if (lex) {
      setUnit(toBase(lex.unit));
      setQty(String(lex.qty));
      addMisc(lex.label);
      return;
    }
    if (hits.length > 0) { addLinked(hits[0]); return; }
    addMisc();
  };

  const removeRow = (key:string) => setRows(prev => prev.filter(r => r.key !== key));

  // cost math (proportional by pack size)
  const rowCost = (r:Row):number => {
    if (!r.link || !r.link.packPrice || r.link.packPrice <= 0) return 0;
    const { qty:packQty, base:packBase } = normPackSize(r.link.packSize, r.link.packUnit);
    const u = r.unit;
    if ((u==='ml' && packBase!=='ml') || (u==='g' && packBase!=='g') || (u==='each' && packBase!=='each')) {
      if (packBase==='each') {
        const denom = packQty > 0 ? packQty : 1;
        return (r.qty / denom) * r.link.packPrice;
      }
      return 0;
    }
    const denom = packQty > 0 ? packQty : 1;
    return (r.qty / denom) * r.link.packPrice;
  };

  // totals
  const totals = useMemo(() => {
    let totalCost = 0, totalMl = 0, totalG = 0, totalEach = 0;
    rows.forEach(r => {
      totalCost += rowCost(r);
      if (r.unit==='ml') totalMl += r.qty;
      else if (r.unit==='g') totalG += r.qty;
      else totalEach += r.qty;
    });
    return { totalCost, totalMl, totalG, totalEach };
  }, [rows]);

  useEffect(() => {
    onSummary?.({ ...totals, rows });
  }, [totals, rows, onSummary]);

  const chips = (category==='beverage' ? BEV_CHIPS : FOOD_CHIPS);

  return (
    <View style={{ gap:12 }}>
      {/* Search + Enter */}
      <View style={{ flexDirection:'row', gap:8 }}>
        <TextInput
          value={term}
          onChangeText={setTerm}
          placeholder={category==='beverage' ? 'Search (e.g., Vodka)…' : 'Search (e.g., Flour)…'}
          style={{ flex:1, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' }}
        />
        <TouchableOpacity onPress={commit} style={{ paddingHorizontal:14, justifyContent:'center', borderRadius:8, backgroundColor:'#111' }}>
          <Text style={{ color:'#fff', fontWeight:'800' }}>Enter</Text>
        </TouchableOpacity>
      </View>

      {/* Results (tap to add). FlatList does not scroll; parent ScrollView handles it */}
      <View style={{ borderWidth:1, borderColor:'#F3F4F6', borderRadius:8, overflow:'hidden' }}>
        {loading ? (
          <View style={{ paddingVertical:8 }}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={hits}
            keyExtractor={(x)=>x.id}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={false}
            renderItem={({item}) => (
              <TouchableOpacity
                onPress={()=>addLinked(item)}
                style={{ paddingVertical:8, paddingHorizontal:10, borderBottomWidth:1, borderColor:'#F3F4F6' }}>
                <Text style={{ fontWeight:'700' }}>{item.name}</Text>
                <Text style={{ color:'#6B7280' }}>
                  {(item.packSize ?? '—')} {(item.packUnit ?? '')}
                  {item.packPrice != null ? ` · $${Number(item.packPrice).toFixed(2)}` : ' · no price'}
                  {item.supplierName ? ` · ${item.supplierName}` : ''}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={!!term ? <Text style={{ padding:10, color:'#9CA3AF' }}>No matches — press Enter to add Misc</Text> : null}
          />
        )}
      </View>

      {/* qty chips + lexicon */}
      <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
        {chips.map(v => (
          <TouchableOpacity key={`chip-${v}`} onPress={()=>setQty(String(v))}
            style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>{v}</Text>
          </TouchableOpacity>
        ))}
        {LEXICON.filter(l => (category==='beverage' ? l.unit==='ml' : l.unit==='g')).map(l => (
          <TouchableOpacity key={l.label} onPress={() => { setTerm(l.label); setQty(String(l.qty)); setUnit(toBase(l.unit)); }}
            style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor:'#FEF3C7' }}>
            <Text style={{ fontWeight:'700' }}>{l.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* qty + unit (single chip, long-press to choose) */}
      <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
        <TextInput
          value={qty}
          onChangeText={setQty}
          placeholder="Qty"
          keyboardType="numeric"
          style={{ width:100, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' }}
        />
        <TouchableOpacity
          onLongPress={() => setUnitPickerOpen(true)}
          activeOpacity={0.7}
          style={{ paddingVertical:10, paddingHorizontal:14, borderRadius:8, borderWidth:1, borderColor:'#111', backgroundColor:'#111' }}
        >
          <Text style={{ color:'#fff', fontWeight:'800' }}>{unit}</Text>
        </TouchableOpacity>
      </View>

      {/* Unit picker modal */}
      <Modal visible={unitPickerOpen} transparent animationType="fade" onRequestClose={()=>setUnitPickerOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.25)', justifyContent:'center', alignItems:'center' }}>
          <View style={{ width:220, backgroundColor:'#fff', borderRadius:12, overflow:'hidden' }}>
            {(['ml','g','each'] as const).map(opt => (
              <TouchableOpacity key={opt}
                onPress={()=>{ setUnit(opt); setUnitPickerOpen(false); }}
                style={{ padding:14, borderBottomWidth:1, borderColor:'#F3F4F6', backgroundColor: unit===opt ? '#F3F4F6' : '#fff' }}>
                <Text style={{ fontWeight:'700' }}>{opt}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={()=>setUnitPickerOpen(false)} style={{ padding:14 }}>
              <Text style={{ textAlign:'center', color:'#6B7280' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Table of added ingredients */}
      <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, overflow:'hidden' }}>
        <View style={{ padding:10, backgroundColor:'#F9FAFB', borderBottomWidth:1, borderColor:'#E5E7EB', flexDirection:'row' }}>
          <Text style={{ flex:5, fontWeight:'800' }}>Ingredient</Text>
          <Text style={{ flex:2, fontWeight:'800' }}>Qty</Text>
          <Text style={{ flex:2, fontWeight:'800' }}>Unit</Text>
          <Text style={{ flex:2, fontWeight:'800', textAlign:'right' }}>Cost</Text>
          <Text style={{ width:48 }} />
        </View>
        {rows.length === 0 ? (
          <Text style={{ padding:12, color:'#9CA3AF' }}>No ingredients yet.</Text>
        ) : rows.map(r => (
          <View key={r.key} style={{ padding:10, borderBottomWidth:1, borderColor:'#F3F4F6', flexDirection:'row', alignItems:'center' }}>
            <Text style={{ flex:5 }}>{r.name}</Text>
            <Text style={{ flex:2 }}>{r.qty}</Text>
            <Text style={{ flex:2 }}>{r.unit}</Text>
            <Text style={{ flex:2, textAlign:'right' }}>${rowCost(r).toFixed(2)}</Text>
            <TouchableOpacity onPress={()=>removeRow(r.key)} style={{ width:48, alignItems:'flex-end' }}>
              <Text style={{ color:'#EF4444', fontWeight:'800' }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={{ padding:10, flexDirection:'row' }}>
          <Text style={{ flex:9, fontWeight:'800' }}>Totals</Text>
          <Text style={{ flex:2, textAlign:'right', fontWeight:'800' }}>${totals.totalCost.toFixed(2)}</Text>
        </View>
      </View>
    </View>
  );
}
