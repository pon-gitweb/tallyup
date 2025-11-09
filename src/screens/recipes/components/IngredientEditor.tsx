// @ts-nocheck
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList } from 'react-native';
import { searchProductsLite } from '../../../services/products/searchProductsLite';

export type RecipeItem = {
  productId?: string | null;
  productName: string;
  qty: number;
  unit: string;
  packSizeMl?: number | null;
  packSizeG?: number | null;
  packEach?: number | null;
  packPrice?: number | null;
};

const UNIT_CHOICES = ['ml','l','g','kg','each','custom'];

export default function IngredientEditor({
  venueId,
  items,
  onChange
}:{
  venueId: string;
  items: RecipeItem[];
  onChange: (next: RecipeItem[]) => void;
}) {
  const addRow = () => onChange([...items, { productId: null, productName: '', qty: 0, unit: 'ml' }]);
  const removeRow = (idx:number) => onChange(items.filter((_,i)=>i!==idx));
  const update = (idx:number, patch:Partial<RecipeItem>) => {
    const next = items.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <View style={{ gap:12 }}>
      {items.map((row, idx) => (
        <Row
          key={idx}
          row={row}
          onRemove={()=>removeRow(idx)}
          onChange={(patch)=>update(idx, patch)}
          venueId={venueId}
        />
      ))}
      <TouchableOpacity onPress={addRow} style={{ padding:12, borderRadius:12, backgroundColor:'#F3F4F6' }}>
        <Text style={{ fontWeight:'800', textAlign:'center' }}>+ Add Ingredient</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ row, onChange, onRemove, venueId }:{
  row: RecipeItem; onChange:(p:Partial<RecipeItem>)=>void; onRemove:()=>void; venueId:string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);

  const runSearch = useCallback(async () => {
    const res = await searchProductsLite(venueId, term, 25);
    setResults(res);
  }, [term, venueId]);

  const choose = (p:any) => {
    onChange({
      productId: p.id,
      productName: p.name,
      packSizeMl: p.packSizeMl ?? null,
      packSizeG: p.packSizeG ?? null,
      packEach: p.packEach ?? null,
      packPrice: p.price ?? null
    });
    setPickerOpen(false);
  };

  return (
    <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12, gap:8 }}>
      <Text style={{ fontWeight:'700' }}>Ingredient</Text>

      <TouchableOpacity onPress={()=>setPickerOpen(true)} style={{ padding:10, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, backgroundColor:'#fff' }}>
        <Text style={{ fontWeight:'700' }}>{row.productName ? row.productName : 'Search products…'}</Text>
        {row.packPrice != null && (
          <Text style={{ color:'#6B7280', marginTop:4 }}>
            Pack price: ${Number(row.packPrice).toFixed(2)}
            {row.packSizeMl ? ` · ${row.packSizeMl}ml` : row.packSizeG ? ` · ${row.packSizeG}g` : row.packEach ? ` · ${row.packEach} each` : ''}
          </Text>
        )}
      </TouchableOpacity>

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={()=>setPickerOpen(false)}>
        <View style={{ flex:1, backgroundColor:'#fff' }}>
          <View style={{ padding:12, borderBottomWidth:1, borderColor:'#E5E7EB' }}>
            <Text style={{ fontWeight:'900', fontSize:18 }}>Choose Product</Text>
          </View>
          <View style={{ padding:12, gap:8 }}>
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder="Type to search…"
              style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' }}
            />
            <TouchableOpacity onPress={runSearch} style={{ padding:12, borderRadius:8, backgroundColor:'#111' }}>
              <Text style={{ color:'#fff', textAlign:'center', fontWeight:'800' }}>Search</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={results}
            keyExtractor={(it)=>it.id}
            renderItem={({item})=>(
              <TouchableOpacity onPress={()=>choose(item)} style={{ padding:12, borderBottomWidth:1, borderColor:'#F3F4F6' }}>
                <Text style={{ fontWeight:'700' }}>{item.name}</Text>
                <Text style={{ color:'#6B7280', marginTop:4 }}>
                  {item.packSizeMl ? `${item.packSizeMl}ml` : item.packSizeG ? `${item.packSizeG}g` : item.packEach ? `${item.packEach} each` : '—'}
                  {item.price!=null ? ` · $${Number(item.price).toFixed(2)}/pack` : ''}
                </Text>
              </TouchableOpacity>
            )}
          />
          <View style={{ padding:12, gap:8 }}>
            <Text style={{ color:'#6B7280' }}>Not in products? Enter a free-text ingredient:</Text>
            <TextInput
              value={row.productName}
              onChangeText={(t)=>onChange({ productName:t, productId:null })}
              placeholder="e.g., Fresh Lime Juice"
              style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' }}
            />
            <TouchableOpacity onPress={()=>setPickerOpen(false)} style={{ padding:12, borderRadius:8, backgroundColor:'#F3F4F6' }}>
              <Text style={{ textAlign:'center', fontWeight:'800' }}>Use Free-Text</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={{ flexDirection:'row', gap:8 }}>
        <TextInput
          value={String(row.qty ?? '')}
          onChangeText={(t)=>onChange({ qty: t ? Number(t) : 0 })}
          placeholder="Qty"
          keyboardType="decimal-pad"
          style={{ flex:1, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' }}
        />
        <UnitPicker value={row.unit || 'ml'} onChange={(u)=>onChange({ unit:u })} />
      </View>

      <TouchableOpacity onPress={onRemove} style={{ padding:10, borderRadius:8, backgroundColor:'#FEF2F2', borderWidth:1, borderColor:'#FCA5A5' }}>
        <Text style={{ textAlign:'center', color:'#991B1B', fontWeight:'800' }}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

function UnitPicker({ value, onChange }:{ value:string; onChange:(u:string)=>void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={()=>setOpen(true)} style={{ flex:1, padding:10, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, backgroundColor:'#fff' }}>
        <Text style={{ fontWeight:'700', textAlign:'center' }}>{value}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.2)', justifyContent:'center', padding:24 }}>
          <View style={{ backgroundColor:'#fff', borderRadius:12, padding:12 }}>
            <Text style={{ fontWeight:'900', fontSize:16, marginBottom:8 }}>Pick a unit</Text>
            {UNIT_CHOICES.map(u=>(
              <TouchableOpacity key={u} onPress={()=>{onChange(u); setOpen(false);}} style={{ padding:10 }}>
                <Text style={{ fontWeight:'700' }}>{u}</Text>
              </TouchableOpacity>
            ))}
            <Text style={{ color:'#6B7280', marginTop:4 }}>Tip: Use "custom" if you need dash/splash etc.</Text>
            <TouchableOpacity onPress={()=>setOpen(false)} style={{ marginTop:8, padding:10, borderRadius:8, backgroundColor:'#F3F4F6' }}>
              <Text style={{ textAlign:'center', fontWeight:'800' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
