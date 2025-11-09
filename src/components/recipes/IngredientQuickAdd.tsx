// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useProductSearch } from '../../services/hooks/useProductSearch';

type Props = {
  venueId: string;
  category: 'beverage'|'food';
  onAddLinked: (item: {
    productId: string;
    name: string;
    qty: number;
    unit: 'ml'|'g'|'each';
    packRef?: { packSize?: number|null; packUnit?: string|null; packPrice?: number|null }
  }) => void;
  onAddMisc: (item: { name: string; qty: number; unit: 'ml'|'g'|'each'; }) => void;
};

const UNIT_CHIPS = {
  beverage: { unit: 'ml' as const, qtys: [15,30,45,60] },
  food: { unit: 'g' as const, qtys: [1,5,10,50] },
};

const LEXICON = [
  { label: 'dash', toQty: 1, unit: 'ml' },
  { label: 'splash', toQty: 5, unit: 'ml' },
  { label: 'pinch', toQty: 1, unit: 'g' },
  { label: 'sprinkle', toQty: 2, unit: 'g' },
  { label: 'spray', toQty: 1, unit: 'ml' },
];

function familyDefault(category:'beverage'|'food'){ return category==='beverage' ? 'ml' : 'g'; }
function toBaseUnit(u:string):'ml'|'g'|'each'{
  if (u==='ml'||u==='L') return 'ml';
  if (u==='g'||u==='kg') return 'g';
  return 'each';
}

export default function IngredientQuickAdd({ venueId, category, onAddLinked, onAddMisc }:Props) {
  const [term, setTerm] = useState('');
  const [qty, setQty] = useState<string>('');
  const [unit, setUnit] = useState<'ml'|'g'|'each'>(familyDefault(category));
  const [requireInventory, setRequireInventory] = useState(true);

  const { hits, loading } = useProductSearch(venueId, term);
  const unitSet = UNIT_CHIPS[category];

  const commit = (selected?: any) => {
    const qtyNum = qty ? Number(qty) : (unitSet.qtys[0] ?? 1);
    if (!selected) {
      const lex = LEXICON.find(l => l.label.toLowerCase() === term.trim().toLowerCase());
      if (lex) {
        onAddMisc({ name: lex.label, qty: lex.toQty, unit: toBaseUnit(lex.unit) });
        setTerm(''); setQty('');
        return;
      }
      if (requireInventory) return;
      const name = term.trim() || 'Misc';
      onAddMisc({ name, qty: qtyNum, unit });
      setTerm(''); setQty('');
      return;
    }
    onAddLinked({
      productId: selected.id,
      name: selected.name,
      qty: qtyNum,
      unit,
      packRef: {
        packSize: selected.packSize ?? null,
        packUnit: selected.packUnit ?? null,
        packPrice: selected.packPrice ?? null
      }
    });
    setTerm(''); setQty('');
  };

  return (
    <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12, backgroundColor:'#fff', gap:8 }}>
      <Text style={{ fontWeight:'800' }}>Add ingredient</Text>

      <View style={{ flexDirection:'row', gap:8 }}>
        <TextInput
          value={term}
          onChangeText={setTerm}
          placeholder="Search products (e.g., Vodka)…"
          style={{ flex:1, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10 }}
        />
        <TouchableOpacity
          onPress={() => commit(hits[0])}
          style={{ paddingHorizontal:14, justifyContent:'center', borderRadius:8, backgroundColor:'#111' }}>
          <Text style={{ color:'#fff', fontWeight:'800' }}>Enter</Text>
        </TouchableOpacity>
      </View>

      <View style={{ maxHeight:200 }}>
        {loading ? (
          <View style={{ paddingVertical:8 }}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={hits}
            keyExtractor={(x)=>x.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({item}) => (
              <TouchableOpacity onPress={()=>commit(item)} style={{ paddingVertical:8, borderBottomWidth:1, borderColor:'#F3F4F6' }}>
                <Text style={{ fontWeight:'700' }}>{item.name}</Text>
                <Text style={{ color:'#6B7280' }}>
                  {item.packSize ?? '—'} {item.packUnit ?? ''} · {item.packPrice != null ? `$${Number(item.packPrice).toFixed(2)}` : 'no price'}
                  {item.supplierName ? ` · ${item.supplierName}` : ''}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={!!term ? <Text style={{ color:'#9CA3AF' }}>No matches — Enter to add Misc</Text> : null}
          />
        )}
      </View>

      <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
        {unitSet.qtys.map(v => (
          <TouchableOpacity key={v} onPress={()=>setQty(String(v))}
            style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor:'#F3F4F6' }}>
            <Text style={{ fontWeight:'700' }}>{v}</Text>
          </TouchableOpacity>
        ))}
        {LEXICON.filter(l => (category==='beverage' ? l.unit==='ml' : l.unit==='g')).map(l => (
          <TouchableOpacity key={l.label} onPress={() => { setTerm(l.label); setQty(String(l.toQty)); setUnit(toBaseUnit(l.unit)); }}
            style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor:'#FEF3C7' }}>
            <Text style={{ fontWeight:'700' }}>{l.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flexDirection:'row', gap:8 }}>
        <TextInput value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="Qty"
          style={{ width:100, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10 }} />
        <TouchableOpacity onPress={() => setUnit('ml')}
          style={{ padding:10, borderRadius:8, borderWidth:1, borderColor: unit==='ml' ? '#111' : '#E5E7EB', backgroundColor: unit==='ml' ? '#111' : '#fff' }}>
          <Text style={{ color: unit==='ml' ? '#fff' : '#111', fontWeight:'700' }}>ml</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setUnit('g')}
          style={{ padding:10, borderRadius:8, borderWidth:1, borderColor: unit==='g' ? '#111' : '#E5E7EB', backgroundColor: unit==='g' ? '#111' : '#fff' }}>
          <Text style={{ color: unit==='g' ? '#fff' : '#111', fontWeight:'700' }}>g</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setUnit('each')}
          style={{ padding:10, borderRadius:8, borderWidth:1, borderColor: unit==='each' ? '#111' : '#E5E7EB', backgroundColor: unit==='each' ? '#111' : '#fff' }}>
          <Text style={{ color: unit==='each' ? '#fff' : '#111', fontWeight:'700' }}>each</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={()=>setRequireInventory(v => !v)} style={{ marginTop:4, alignSelf:'flex-start' }}>
        <Text style={{ color:'#6B7280' }}>
          {requireInventory ? 'Inventory link required (tap to allow Misc)' : 'Misc allowed (tap to require inventory)'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
