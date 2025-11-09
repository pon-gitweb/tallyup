// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { duplicateRecipe } from '../../services/recipes/duplicateRecipe';

type Props = {
  recipeId: string;
  onBack?: () => void;
  onOpenDraft?: (draftId: string) => void; // consumer can navigate to Draft editor
};

export default function RecipeDetailScreen({ recipeId, onBack, onOpenDraft }: Props) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const [docData, setDocData] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!venueId || !recipeId) return;
      setBusy(true);
      try {
        const db = getFirestore();
        const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
        const snap = await getDoc(ref);
        if (!alive) return;
        if (!snap.exists()) throw new Error('Recipe not found');
        setDocData({ id: snap.id, ...snap.data() });
      } catch (e:any) {
        console.warn('[RecipeDetailScreen] load error', e);
        Alert.alert('Load failed', String(e?.message || e));
      } finally {
        alive && setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [venueId, recipeId]);

  const isConfirmed = docData?.status === 'confirmed';
  const title = docData?.name || 'Recipe';

  const onDuplicate = async () => {
    try {
      if (!venueId || !docData?.id) return;
      setBusy(true);
      const res = await duplicateRecipe(venueId, docData.id);
      Alert.alert('Duplicated', 'A new draft copy was created.');
      onOpenDraft && onOpenDraft(res.id);
    } catch (e:any) {
      Alert.alert('Duplicate failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={{ padding:16, borderBottomWidth:1, borderColor:'#E5E7EB', flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
      <TouchableOpacity onPress={onBack}><Text style={{ color:'#2563EB', fontSize:16 }}>‹ Back</Text></TouchableOpacity>
      <Text style={{ fontSize:18, fontWeight:'900' }} numberOfLines={1}>{title}</Text>
      <View style={{ width:60 }} />
    </View>
  );

  if (busy && !docData) {
    return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><ActivityIndicator /></View>;
  }

  if (!docData) {
    return <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}><Text>Not found</Text></View>;
  }

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      {header}
      <ScrollView contentContainerStyle={{ padding:16, gap:12 }}>
        <Row label="Status" value={isConfirmed ? 'Confirmed' : 'Draft'} />
        <Row label="Category" value={docData.category || '—'} />
        <Row label="Mode" value={docData.mode || '—'} />
        <Row label="Yield" value={docData.yield != null ? String(docData.yield) : '—'} />
        <Row label="Unit" value={docData.unit || '—'} />
        <Card>
          <Text style={{ fontWeight:'800', marginBottom:6 }}>Pricing</Text>
          <Row label="COGS (per serve)" value={fmtMoney(docData.cogs)} />
          <Row label="RRP" value={fmtMoney(docData.rrp)} />
          <Row label="Target GP %" value={docData.gpPct != null ? `${Number(docData.gpPct).toFixed(1)}%` : '—'} />
        </Card>

        <Card>
          <Text style={{ fontWeight:'800', marginBottom:6 }}>Ingredients</Text>
          {Array.isArray(docData.items) && docData.items.length > 0 ? (
            docData.items.map((it:any) => (
              <View key={it.lineId || it.name} style={{ paddingVertical:6, borderBottomWidth:1, borderColor:'#F1F5F9' }}>
                <Text style={{ fontWeight:'700' }}>{it.name || '(ingredient)'}</Text>
                <Text style={{ opacity:0.7 }}>
                  {it.type === 'misc' ? 'misc' : (it.productId || 'product')}
                  {it.qty != null ? ` · ${it.qty}` : ''} {it.unit || ''}
                  {Number.isFinite(Number(it.cost)) ? ` · ${fmtMoney(it.cost)}` : ''}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ opacity:0.7 }}>No ingredients</Text>
          )}
        </Card>

        <Card>
          <Text style={{ fontWeight:'800', marginBottom:6 }}>Method / Notes</Text>
          <Text style={{ opacity:0.8 }}>{docData.method || '—'}</Text>
        </Card>

        {isConfirmed ? (
          <TouchableOpacity onPress={onDuplicate} style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}>
            <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>Duplicate to Draft</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ opacity:0.7 }}>
            Draft recipe — edit in the Draft editor screen.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function Card({ children }:{ children:any }) {
  return <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB' }}>{children}</View>;
}
function Row({ label, value }:{ label:string; value:string }) {
  return (
    <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
      <Text style={{ opacity:0.7 }}>{label}</Text>
      <Text style={{ fontWeight:'700' }}>{value}</Text>
    </View>
  );
}
function fmtMoney(n:any) { return Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—'; }
