// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, Switch, Modal, SafeAreaView } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { db } from '../../services/firebase';
import { updateRecipeDraft } from '../../services/recipes/updateRecipeDraft';
import { UNIT_PRESETS, SHOT_ALIASES, normalizePortion, toBaseFromContainer } from '../../services/recipes/units';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';

type Props = { recipeId: string; onClose: () => void };

type Ingredient = {
  key: string;
  name: string;
  qty: string;           // user input; can be numeric or alias (e.g., "single")
  unit: string;          // e.g., ml, g, each
  includeInCost: boolean;

  // Linking to product
  productId?: string | null;
  productName?: string | null;

  // Container specs for costing (prefilled from product, editable)
  containerSize: string; // numeric text
  containerUnit: string; // ml/g/each/L/kg
  containerCost: string; // numeric text
};

export default function DraftRecipeDetailPanel({ recipeId, onClose }: Props) {
  const venueId = useVenueId();

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [yieldQty, setYieldQty] = useState<string>(''); // number as text
  const [unit, setUnit] = useState<string>('serve');
  const [items, setItems] = useState<Ingredient[]>([]);

  const [cogs, setCogs] = useState<number>(0);
  const [gpTarget, setGpTarget] = useState<string>('65');
  const [rrp, setRrp] = useState<string>('');
  const [method, setMethod] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Product picker modal state
  const [pickerOpen, setPickerOpen] = useState<{open:boolean, key?:string}>({open:false});
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // ---- Load draft to prefill ----
  useEffect(() => {
    (async () => {
      try {
        const ref = doc(db, 'venues', venueId!, 'recipes', recipeId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Draft not found');
        const r = snap.data() as any;
        setName(r?.name ?? '');
        setYieldQty(r?.yield != null ? String(r.yield) : '');
        setUnit(r?.unit ?? 'serve');
        const incoming = Array.isArray(r?.items) ? r.items : [];
        setItems(incoming.map((x:any, idx:number) => ({
          key: x.key ?? String(Date.now()+idx),
          name: x.name ?? '',
          qty: String(x.qty ?? ''),
          unit: x.unit ?? 'ml',
          includeInCost: x.includeInCost !== false,
          productId: x.productId ?? null,
          productName: x.productName ?? null,
          containerSize: String(x.containerSize ?? ''),
          containerUnit: x.containerUnit ?? 'ml',
          containerCost: String(x.containerCost ?? ''),
        })));
        setMethod(r?.method ?? '');
        setCogs(Number(r?.cogs ?? 0));
        setGpTarget(r?.gpTarget != null ? String(r.gpTarget) : '65');
        setRrp(r?.rrp != null ? String(r.rrp) : '');
      } catch (e:any) {
        Alert.alert('Load failed', String(e?.message || e));
      } finally {
        setLoaded(true);
      }
    })();
  }, [venueId, recipeId]);

  // ---- Derived COGS from portions of container ----
  useEffect(() => {
    const total = (items || []).reduce((sum:number, it:Ingredient) => {
      if (it.includeInCost === false) return sum;

      const { qtyBase, base: portionBase } = normalizePortion(it.qty, it.unit);
      const { sizeBase, base: containerBase } = toBaseFromContainer(it.containerSize, it.containerUnit);
      const cost = Number(String(it.containerCost).replace(',', '.'));

      if (!Number.isFinite(qtyBase) || !Number.isFinite(sizeBase) || sizeBase <= 0 || !Number.isFinite(cost)) return sum;

      // Only cost if bases match (ml vs g vs each). If not, try a simple fallback:
      if (portionBase !== containerBase) {
        // if user picked incompatible unit, skip costing for this line
        return sum;
      }
      const line = (qtyBase / sizeBase) * cost;
      return sum + (Number.isFinite(line) ? line : 0);
    }, 0);
    setCogs(Number(total.toFixed(4)));
  }, [items]);

  // GP ↔ RRP coupling
  const recomputeRrpFromGp = useCallback(() => {
    const gp = Number(gpTarget);
    const c = Number(cogs);
    if (!Number.isFinite(gp) || !Number.isFinite(c) || gp >= 100) return;
    const price = c / (1 - gp/100);
    if (Number.isFinite(price)) setRrp(price.toFixed(2));
  }, [gpTarget, cogs]);
  useEffect(() => { recomputeRrpFromGp(); }, [cogs]);
  const onChangeGp = (s:string) => { setGpTarget(s); recomputeRrpFromGp(); };
  const onChangeRrp = (s:string) => {
    setRrp(s);
    const price = Number(s);
    const c = Number(cogs);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(c) && c >= 0) {
      const gp = (1 - (c / price)) * 100;
      setGpTarget(gp.toFixed(1));
    }
  };

  // ---- UI helpers ----
  const addItem = () => {
    setItems(prev => [
      ...prev,
      {
        key: String(Date.now()),
        name: '',
        qty: '',
        unit: 'ml',
        includeInCost: true,
        productId: null,
        productName: null,
        containerSize: '',
        containerUnit: 'ml',
        containerCost: '',
      }
    ]);
  };
  const updateItem = (key:string, patch:any) => {
    setItems(prev => prev.map(it => it.key === key ? { ...it, ...patch } : it));
  };
  const removeItem = (key:string) => setItems(prev => prev.filter(it => it.key !== key));

  // ---- Product picker (client filter to avoid new indexes today) ----
  const openPicker = async (key:string) => {
    try {
      setPickerOpen({open:true, key});
      setSearch('');
      const dbi = getFirestore(getApp());
      const snap = await getDocs(collection(dbi, 'venues', venueId!, 'products'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setSearchResults(all.slice(0, 100)); // initial
    } catch (e) {
      Alert.alert('Product list failed', String(e?.message || e));
    }
  };
  const filterResults = useMemo(() => {
    const q = (search || '').toLowerCase();
    if (!q) return searchResults;
    return searchResults.filter(p =>
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.supplierName || '').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [search, searchResults]);

  const pickProduct = (prod:any) => {
    const key = pickerOpen.key!;
    // Try to infer container size & unit from product fields (very tolerant)
    const volMl = Number(prod?.volumeMl ?? prod?.sizeMl ?? prod?.bottleMl ?? prod?.packMl ?? 0);
    const wtG   = Number(prod?.weightG ?? prod?.packG ?? 0);
    const each  = 1;

    // prefer volume if present, else weight, else each
    let containerUnit = 'ml';
    let containerSize = volMl > 0 ? volMl : wtG > 0 ? wtG : each;
    if (volMl > 0) containerUnit = 'ml';
    else if (wtG > 0) containerUnit = 'g';
    else containerUnit = 'each';

    // cost: prefer costPrice, then latestPrice, then 0
    const cost = Number(prod?.costPrice ?? prod?.lastCost ?? prod?.price ?? 0);

    updateItem(key, {
      productId: prod.id,
      productName: prod.name || null,
      name: prod.name || '',
      containerSize: String(containerSize || ''),
      containerUnit,
      containerCost: String(Number.isFinite(cost) ? cost : ''),
    });
    setPickerOpen({open:false});
  };

  const saveAll = useCallback(async () => {
    try {
      setBusy(true);
      await updateRecipeDraft(venueId!, recipeId, {
        name: name?.trim() || null,
        yield: yieldQty ? Number(yieldQty) : null,
        unit: unit || null,
        items,
        cogs,
        rrp: rrp ? Number(rrp) : null,
        gpTarget: gpTarget ? Number(gpTarget) : null,
        method: method || null,
      });
      Alert.alert('Saved', 'Draft updated.');
      onClose();
    } catch (e:any) {
      Alert.alert('Save failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [venueId, recipeId, name, yieldQty, unit, items, cogs, rrp, gpTarget, method, onClose]);

  if (!loaded) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#fff' }}>
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      <View style={{ padding:16, borderBottomWidth:1, borderColor:'#E5E7EB', flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
        <TouchableOpacity onPress={onClose}><Text style={{ color:'#2563EB', fontSize:16 }}>‹ Back</Text></TouchableOpacity>
        <Text style={{ fontSize:18, fontWeight:'900' }}>Craft-It · Draft</Text>
        <View style={{ width:60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding:16, gap:12 }}>
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="e.g., House Margarita"
            style={I} autoCapitalize="words" />
          <Hint>Pre-filled from the previous step. You can tweak it here.</Hint>
        </Field>

        <Field label="Yield / Unit" row>
          <TextInput value={yieldQty} onChangeText={setYieldQty} placeholder="e.g., 4"
            keyboardType="numeric" style={[I, { flex:1, marginRight:8 }]} />
          <TextInput value={unit} onChangeText={setUnit} placeholder="e.g., serves"
            style={[I, { flex:1 }]} />
        </Field>
        <Hint>“Yield” = how much this recipe makes (4). “Unit” = what that number means (serves, ml, g).</Hint>

        {/* Ingredients */}
        <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' }}>
          <Text style={{ fontWeight:'800', marginBottom:8 }}>Ingredients</Text>
          {items.length === 0 && (
            <Text style={{ color:'#6B7280', marginBottom:8 }}>
              Link to a stock product (auto-fills bottle/pack size and cost) or use “Misc/manual”.
              Turn off “Include in COGS” for water/ice.
            </Text>
          )}
          {items.map((it) => {
            const portion = normalizePortion(it.qty, it.unit);
            const cont = toBaseFromContainer(it.containerSize, it.containerUnit);
            const cost = Number(String(it.containerCost).replace(',', '.'));
            const lineCost = (it.includeInCost !== false && portion.base === cont.base && cont.sizeBase > 0 && Number.isFinite(cost))
              ? (portion.qtyBase / cont.sizeBase) * cost
              : 0;

            return (
              <View key={it.key} style={{ marginBottom:12, padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, backgroundColor:'#fff' }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <Text style={{ fontWeight:'700' }}>{it.productName || 'Misc/manual'}</Text>
                  <TouchableOpacity onPress={()=>removeItem(it.key)}><Text style={{ color:'#DC2626', fontWeight:'800' }}>Remove</Text></TouchableOpacity>
                </View>

                {/* Name & link */}
                <View style={{ flexDirection:'row', gap:8 }}>
                  <TextInput
                    value={it.name}
                    onChangeText={(v)=>updateItem(it.key, { name: v })}
                    placeholder="Ingredient (e.g., Blanco Tequila)"
                    style={[I, { flex:1 }]}
                  />
                  <TouchableOpacity onPress={()=>openPicker(it.key)} style={{ paddingHorizontal:12, justifyContent:'center', borderRadius:8, borderWidth:1, borderColor:'#111' }}>
                    <Text style={{ fontWeight:'800' }}>{it.productId ? 'Change' : 'Link'}</Text>
                  </TouchableOpacity>
                </View>

                {/* Portion */}
                <View style={{ height:8 }} />
                <View style={{ flexDirection:'row', gap:8 }}>
                  <TextInput
                    value={it.qty}
                    onChangeText={(v)=>updateItem(it.key, { qty: v })}
                    placeholder="Qty (e.g., 45 or 'single', 'double', 'dash')"
                    style={[I, { flex:1 }]}
                  />
                  <TextInput
                    value={it.unit}
                    onChangeText={(v)=>updateItem(it.key, { unit: v })}
                    placeholder="Unit (ml/g/each)"
                    style={[I, { flex:1 }]}
                  />
                </View>
                <Text style={{ color:'#6B7280', marginTop:4 }}>
                  Aliases: {Object.keys(SHOT_ALIASES).join(', ')}
                </Text>

                {/* Container */}
                <View style={{ height:8 }} />
                <Text style={{ fontWeight:'700', marginBottom:4 }}>Container (for costing)</Text>
                <View style={{ flexDirection:'row', gap:8 }}>
                  <TextInput
                    value={it.containerSize}
                    onChangeText={(v)=>updateItem(it.key, { containerSize: v })}
                    placeholder="Size (e.g., 750)"
                    keyboardType="decimal-pad"
                    style={[I, { flex:1 }]}
                  />
                  <TextInput
                    value={it.containerUnit}
                    onChangeText={(v)=>updateItem(it.key, { containerUnit: v })}
                    placeholder="Unit (ml/g/each)"
                    style={[I, { flex:1 }]}
                  />
                  <TextInput
                    value={it.containerCost}
                    onChangeText={(v)=>updateItem(it.key, { containerCost: v })}
                    placeholder="Container cost (e.g., 32.50)"
                    keyboardType="decimal-pad"
                    style={[I, { flex:1 }]}
                  />
                </View>

                {/* Include toggle + line cost */}
                <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop:8 }}>
                  <View style={{ flexDirection:'row', alignItems:'center' }}>
                    <Switch
                      value={it.includeInCost !== false}
                      onValueChange={(v)=>updateItem(it.key, { includeInCost: v })}
                    />
                    <Text style={{ marginLeft:6 }}>Include in COGS</Text>
                  </View>
                  <Text style={{ fontWeight:'700' }}>Line: ${Number(lineCost).toFixed(2)}</Text>
                </View>
              </View>
            );
          })}

          <TouchableOpacity onPress={addItem}
            style={{ padding:12, borderRadius:10, backgroundColor:'#111' }}>
            <Text style={{ color:'#fff', textAlign:'center', fontWeight:'800' }}>+ Add ingredient</Text>
          </TouchableOpacity>
        </View>

        {/* Pricing */}
        <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' }}>
          <Text style={{ fontWeight:'800', marginBottom:8 }}>Pricing</Text>
          <Field label="COGS (derived)">
            <TextInput value={(Number.isFinite(cogs) ? cogs : 0).toFixed(2)} editable={false} style={[I, { backgroundColor:'#F3F4F6' }]} />
            <Hint>Calculated from (portion / container_size) × container_cost across included ingredients.</Hint>
          </Field>

          <Field label="Target GP %  ↔  RRP ($)">
            <View style={{ flexDirection:'row', gap:8 }}>
              <TextInput value={gpTarget} onChangeText={onChangeGp} keyboardType="decimal-pad" style={[I, { flex:1 }]} />
              <TextInput value={rrp} onChangeText={onChangeRrp} keyboardType="decimal-pad" style={[I, { flex:1 }]} />
            </View>
            <Hint>Edit either field — the other updates. Default GP is 65%.</Hint>
          </Field>
        </View>

        <Field label="Method / Notes">
          <TextInput value={method} onChangeText={setMethod} placeholder="Steps, prep notes…"
            style={[I, { height:120, textAlignVertical:'top' }]} multiline />
        </Field>

        <TouchableOpacity disabled={busy} onPress={saveAll}
          style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}>
          <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Saving…' : 'Save Draft'}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Product picker */}
      <Modal visible={pickerOpen.open} animationType="slide" onRequestClose={()=>setPickerOpen({open:false})}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          <View style={{ padding:12, borderBottomWidth:1, borderColor:'#E5E7EB' }}>
            <Text style={{ fontSize:18, fontWeight:'900' }}>Link product</Text>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search products…"
              style={[I, { marginTop:8 }]}
            />
          </View>
          <ScrollView contentContainerStyle={{ padding:12 }}>
            {filterResults.map((p:any) => (
              <TouchableOpacity key={p.id} onPress={()=>pickProduct(p)}
                style={{ padding:12, borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, marginBottom:8 }}>
                <Text style={{ fontWeight:'700' }}>{p.name || '(no name)'}</Text>
                <Text style={{ color:'#6B7280' }}>{p.supplierName || ''}</Text>
              </TouchableOpacity>
            ))}
            {filterResults.length === 0 && (
              <Text style={{ color:'#6B7280' }}>No matches. You can cancel and use “Misc/manual”.</Text>
            )}
          </ScrollView>
          <View style={{ padding:12 }}>
            <TouchableOpacity onPress={()=>setPickerOpen({open:false})}
              style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6' }}>
              <Text style={{ textAlign:'center', fontWeight:'800' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function Field({ label, children, row }:{ label:string; children:any; row?:boolean }) {
  return (
    <View style={{ marginBottom:10 }}>
      <Text style={{ fontWeight:'700', marginBottom:6 }}>{label}</Text>
      <View style={{ flexDirection: row ? 'row' : 'column' }}>{children}</View>
    </View>
  );
}
function Hint({ children }:{ children:any }) {
  return <Text style={{ color:'#6B7280', marginTop:4 }}>{children}</Text>;
}
const I = { borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' };
