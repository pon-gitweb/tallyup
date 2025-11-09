// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, Switch } from 'react-native';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { db } from '../../services/firebase';
import { updateRecipeDraft } from '../../services/recipes/updateRecipeDraft';

type Props = { recipeId: string; onClose: () => void };

// Simple unit helper for volume/qty display only (no hard conversions yet)
const UNITS = ['ml','l','g','kg','oz','lb','each','serve'];

export default function DraftRecipeDetailPanel({ recipeId, onClose }: Props) {
  const venueId = useVenueId();

  // Loaded from Firestore
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [yieldQty, setYieldQty] = useState<string>('');   // number as text for input
  const [unit, setUnit] = useState<string>('serve');
  const [items, setItems] = useState<any[]>([]);

  // Pricing state (derived + inputs)
  const [cogs, setCogs] = useState<number>(0);            // derived from items
  const [gpTarget, setGpTarget] = useState<string>('65'); // % as text; default 65
  const [rrp, setRrp] = useState<string>('');             // sell price

  const [method, setMethod] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // ---- Load existing draft so Name etc. prefill ----
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
        setItems(Array.isArray(r?.items) ? r.items : []);
        setMethod(r?.method ?? '');
        // Persisted pricing (optional)
        const initialCogs = Number(r?.cogs ?? 0);
        setCogs(Number.isFinite(initialCogs) ? initialCogs : 0);
        setGpTarget(r?.gpTarget != null ? String(r.gpTarget) : '65');
        setRrp(r?.rrp != null ? String(r.rrp) : '');
      } catch (e:any) {
        Alert.alert('Load failed', String(e?.message || e));
      } finally {
        setLoaded(true);
      }
    })();
  }, [venueId, recipeId]);

  // ---- Derived COGS from items (sum of qty * costPerUnit when included) ----
  useEffect(() => {
    const total = (items || []).reduce((sum:number, it:any) => {
      const include = it?.includeInCost !== false; // default include unless explicitly false
      const qty = Number(it?.qty ?? 0);
      const cpu = Number(it?.costPerUnit ?? 0);
      return include ? sum + (Number.isFinite(qty) && Number.isFinite(cpu) ? qty * cpu : 0) : sum;
    }, 0);
    setCogs(Number(total.toFixed(4)));
  }, [items]);

  // When GP% or COGS changes and user hasn't typed RRP in the last edit, recompute RRP
  const recomputeRrpFromGp = useCallback(() => {
    const gp = Number(gpTarget);
    const c = Number(cogs);
    if (!Number.isFinite(gp) || !Number.isFinite(c)) return;
    if (gp >= 100) return;
    const price = gp >= 0 ? (c / (1 - gp/100)) : c;
    if (Number.isFinite(price)) setRrp(price.toFixed(2));
  }, [gpTarget, cogs]);

  useEffect(() => { recomputeRrpFromGp(); }, [cogs]); // recompute when items change
  // Allow user to edit either field:
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

  // ---- Ingredients editing ----
  const addItem = () => {
    setItems(prev => [
      ...prev,
      { key: String(Date.now()), name: '', qty: 0, unit: 'ml', costPerUnit: 0, includeInCost: true }
    ]);
  };
  const updateItem = (key:string, patch:any) => {
    setItems(prev => prev.map(it => it.key === key ? { ...it, ...patch } : it));
  };
  const removeItem = (key:string) => {
    setItems(prev => prev.filter(it => it.key !== key));
  };

  const saveAll = useCallback(async () => {
    try {
      setBusy(true);
      // Persist everything; cogs derived; rrp & gpTarget coupled
      await updateRecipeDraft(venueId!, recipeId, {
        name: name?.trim() || null,
        yield: yieldQty ? Number(yieldQty) : null,
        unit: unit || null,
        items,
        cogs,                                // derived, read-only in UI
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
        {/* Name comes from previous screen and is editable if needed */}
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="e.g., House Margarita"
            style={I} autoCapitalize="words" />
          <Hint>Pre-filled from the previous step.</Hint>
        </Field>

        {/* Yield / Unit with explanation */}
        <Field label="Yield / Unit" row>
          <TextInput value={yieldQty} onChangeText={setYieldQty} placeholder="e.g., 4"
            keyboardType="numeric" style={[I, { flex:1, marginRight:8 }]} />
          <TextInput value={unit} onChangeText={setUnit} placeholder="e.g., serves"
            style={[I, { flex:1 }]} />
        </Field>
        <Hint>“Yield” is how much this recipe makes (e.g., 4). “Unit” is what that number represents (e.g., serves, ml, L).</Hint>

        {/* Ingredients */}
        <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' }}>
          <Text style={{ fontWeight:'800', marginBottom:8 }}>Ingredients</Text>
          {items.length === 0 && (
            <Text style={{ color:'#6B7280', marginBottom:8 }}>Add ingredients with qty, units and costs. Turn off “Include in COGS” for ice/water/“free” items.</Text>
          )}
          {items.map((it) => (
            <View key={it.key} style={{ marginBottom:10, padding:10, borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, backgroundColor:'#fff' }}>
              <TextInput
                value={String(it.name ?? '')}
                onChangeText={(v)=>updateItem(it.key, { name: v })}
                placeholder="Ingredient name (e.g., Blanco Tequila 100% agave)"
                style={[I, { marginBottom:6 }]}
              />
              <View style={{ flexDirection:'row', gap:8 }}>
                <TextInput
                  value={String(it.qty ?? '')}
                  onChangeText={(v)=>updateItem(it.key, { qty: v.replace(',', '.') })}
                  placeholder="Qty"
                  keyboardType="decimal-pad"
                  style={[I, { flex:1 }]}
                />
                <TextInput
                  value={String(it.unit ?? 'ml')}
                  onChangeText={(v)=>updateItem(it.key, { unit: v })}
                  placeholder="Unit (e.g., ml)"
                  style={[I, { flex:1 }]}
                />
              </View>
              <View style={{ height:8 }} />
              <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
                <TextInput
                  value={String(it.costPerUnit ?? '')}
                  onChangeText={(v)=>updateItem(it.key, { costPerUnit: v.replace(',', '.') })}
                  placeholder="Cost per unit (e.g., 0.025)"
                  keyboardType="decimal-pad"
                  style={[I, { flex:1 }]}
                />
                <View style={{ flexDirection:'row', alignItems:'center' }}>
                  <Switch
                    value={it.includeInCost !== false}
                    onValueChange={(v)=>updateItem(it.key, { includeInCost: v })}
                  />
                  <Text style={{ marginLeft:6 }}>Include in COGS</Text>
                </View>
              </View>
              <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:6 }}>
                <Text style={{ color:'#6B7280' }}>
                  Line cost: {formatMoney((Number(it.qty||0) * Number(it.costPerUnit||0)) || 0)}
                </Text>
                <TouchableOpacity onPress={()=>removeItem(it.key)}>
                  <Text style={{ color:'#DC2626', fontWeight:'800' }}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={addItem}
            style={{ padding:12, borderRadius:10, backgroundColor:'#111' }}>
            <Text style={{ color:'#fff', textAlign:'center', fontWeight:'800' }}>+ Add ingredient</Text>
          </TouchableOpacity>
        </View>

        {/* Pricing summary */}
        <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB' }}>
          <Text style={{ fontWeight:'800', marginBottom:8 }}>Pricing</Text>
          <Field label="COGS (derived)">
            <TextInput value={formatMoney(cogs)} editable={false} style={[I, { backgroundColor:'#F3F4F6' }]} />
            <Hint>Automatically calculated from included ingredients; read-only.</Hint>
          </Field>

          <Field label="Target GP %  ↔  RRP ($)">
            <View style={{ flexDirection:'row', gap:8 }}>
              <TextInput value={gpTarget} onChangeText={onChangeGp} keyboardType="decimal-pad" style={[I, { flex:1 }]} />
              <TextInput value={rrp} onChangeText={onChangeRrp} keyboardType="decimal-pad" style={[I, { flex:1 }]} />
            </View>
            <Hint>Adjust either field — the other updates. Default GP is 65%.</Hint>
          </Field>
        </View>

        {/* Method / Notes */}
        <Field label="Method / Notes">
          <TextInput value={method} onChangeText={setMethod} placeholder="Steps, prep notes…"
            style={[I, { height:120, textAlignVertical:'top' }]} multiline />
        </Field>

        <TouchableOpacity disabled={busy} onPress={saveAll}
          style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}>
          <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>{busy ? 'Saving…' : 'Save Draft'}</Text>
        </TouchableOpacity>
      </ScrollView>
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

function formatMoney(n:number) {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

const I = { borderWidth:1, borderColor:'#E5E7EB', borderRadius:8, padding:10, backgroundColor:'#fff' };
