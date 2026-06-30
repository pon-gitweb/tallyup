// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { duplicateRecipe } from '../../services/recipes/duplicateRecipe';
import { useToast } from '../../components/common/Toast';

type Props = {
  recipeId: string;
  onBack?: () => void;
  onOpenDraft?: (draftId: string) => void; // consumer can navigate to Draft editor
};

export default function RecipeDetailScreen({ recipeId, onBack, onOpenDraft }: Props) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const [docData, setDocData] = useState<any>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number | null>>({});
  const { showSuccess, showError } = useToast();

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
        const rd = { id: snap.id, ...snap.data() };
        setDocData(rd);
        // Load live costPrices for linked ingredients
        const items = (rd as any).items || [];
        const linkedIds = [...new Set(items.filter((it: any) => it.productId).map((it: any) => it.productId))];
        if (linkedIds.length > 0 && venueId) {
          const prices: Record<string, number | null> = {};
          await Promise.all(linkedIds.map(async (pid: string) => {
            try {
              const pSnap = await getDoc(doc(db, 'venues', venueId, 'products', pid));
              prices[pid] = pSnap.exists() ? (pSnap.data() as any).costPrice ?? null : null;
            } catch { prices[pid] = null; }
          }));
          alive && setLivePrices(prices);
        }
      } catch (e:any) {
        console.warn('[RecipeDetailScreen] load error', e);
        showError(e?.message || 'Could not load recipe.');
      } finally {
        alive && setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [venueId, recipeId]);

  const isConfirmed = docData?.status === 'confirmed';
  const title = docData?.name || 'Recipe';

  // ---------- Live GP% calculation from loaded prices ----------
  const liveTotalCost = useMemo(() => {
    if (!docData?.items?.length) return null;
    let total = 0;
    for (const it of docData.items) {
      const livePrice = it.productId ? livePrices[it.productId] : undefined;
      const hasLive = livePrice != null;
      const liveCost = hasLive && it.qty != null && it.packSize > 0
        ? (it.qty / it.packSize) * livePrice
        : null;
      const cost = liveCost ?? (Number.isFinite(Number(it.cost)) ? Number(it.cost) : 0);
      total += cost;
    }
    return total;
  }, [docData?.items, livePrices]);

  const liveGP = useMemo(() => {
    const sp = Number(docData?.rrp ?? docData?.sellingPrice ?? 0);
    if (sp <= 0 || liveTotalCost == null) return null;
    return ((sp - liveTotalCost) / sp) * 100;
  }, [liveTotalCost, docData?.rrp, docData?.sellingPrice]);

  // ---------- POS & consumption clarity (read-only) ----------
  const hasConsumption = useMemo(() => {
    const c = docData?.consumptionPerServe;
    return !!c && typeof c === 'object' && Object.keys(c).length > 0;
  }, [docData]);

  const posLinkInfo = useMemo(() => {
    const single = docData?.posProductId ? 1 : 0;
    const multi  = Array.isArray(docData?.posProductIds) ? docData.posProductIds.length : 0;
    const total  = single + multi;
    return {
      count: total,
      label: total === 0 ? 'None' : `${total} linked`
    };
  }, [docData]);

  const onDuplicate = async () => {
    try {
      if (!venueId || !docData?.id) return;
      setBusy(true);
      const res = await duplicateRecipe(venueId, docData.id);
      showSuccess('A new draft copy was created.');
      onOpenDraft && onOpenDraft(res.id);
    } catch (e:any) {
      showError(e?.message || 'Could not duplicate recipe.');
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
          <Row label="COGS (per serve)" value={liveTotalCost != null ? fmtMoney(liveTotalCost) : fmtMoney(docData.cogs)} />
          <Row label="RRP" value={fmtMoney(docData.rrp)} />
          <Row
            label="GP %"
            value={
              liveGP != null
                ? `${liveGP.toFixed(1)}% (live)`
                : docData.gpPct != null
                  ? `${Number(docData.gpPct).toFixed(1)}% (last saved)`
                  : '—'
            }
          />
        </Card>

        <Card>
          <Text style={{ fontWeight:'800', marginBottom:6 }}>Usage / POS</Text>
          <Row label="POS links" value={posLinkInfo.label} />
          <Row label="Consumption baseline" value={hasConsumption ? 'Ready' : 'Not set'} />
        </Card>

        <Card>
          <Text style={{ fontWeight:'800', marginBottom:6 }}>Ingredients</Text>
          {Array.isArray(docData.items) && docData.items.length > 0 ? (
            docData.items.map((it:any) => {
              const livePrice = it.productId ? livePrices[it.productId] : undefined;
              const hasLive = livePrice != null;
              const hasNoPrice = it.productId && livePrice === null;
              const liveCost = hasLive && it.qty != null && it.packSize > 0
                ? (it.qty / it.packSize) * livePrice
                : null;
              const displayCost = liveCost != null ? liveCost : (Number.isFinite(Number(it.cost)) ? Number(it.cost) : null);
              return (
                <View key={it.lineId || it.name} style={{ paddingVertical:6, borderBottomWidth:1, borderColor:'#F1F5F9' }}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <Text style={{ fontWeight:'700', flex:1 }}>{it.name || '(ingredient)'}</Text>
                    {displayCost != null && (
                      <Text style={{ fontWeight:'700', color: hasLive ? '#0D9488' : '#374151' }}>
                        {fmtMoney(displayCost)}
                      </Text>
                    )}
                  </View>
                  <Text style={{ opacity:0.7, marginTop:2 }}>
                    {it.qty != null ? `${it.qty}` : ''}{it.unit ? ` ${it.unit}` : ''}
                    {it.packSize ? ` · pack ${it.packSize}` : ''}
                  </Text>
                  {hasLive && (
                    <Text style={{ fontSize:11, color:'#0D9488', marginTop:2 }}>🔗 Live price — updates with invoices</Text>
                  )}
                  {!it.productId && Number.isFinite(Number(it.cost)) && (
                    <Text style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>✏️ Manual price</Text>
                  )}
                  {hasNoPrice && (
                    <Text style={{ fontSize:11, color:'#F59E0B', marginTop:2 }}>⚠️ No price set on linked product</Text>
                  )}
                </View>
              );
            })
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
