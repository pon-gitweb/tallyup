// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { getRecipes } from '../../services/recipes/getRecipes';

type Props = {
  onOpen?: (recipeId: string) => void; // navigation stub
};

const filters = ['all','confirmed','draft'] as const;
type Filter = typeof filters[number];

export default function RecipeListScreen({ onOpen }: Props) {
  const venueId = useVenueId();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!venueId) return;
      setBusy(true);
      try {
        const data = await getRecipes({
          venueId,
          status: filter === 'all' ? 'all' : filter,
          search,
          pageSize: 100
        });
        if (alive) setRows(data);
      } catch (e) {
        console.warn('[RecipeListScreen] load error', e);
      } finally {
        alive && setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [venueId, filter, search]);

  const header = useMemo(() => (
    <View style={{ padding:12, gap:8 }}>
      <Text style={{ fontSize:18, fontWeight:'900' }}>Recipes</Text>
      <View style={{ flexDirection:'row', gap:8 }}>
        {filters.map(f => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={{
              paddingVertical:8, paddingHorizontal:12, borderRadius:999,
              backgroundColor: filter === f ? '#111' : '#fff',
              borderWidth:1, borderColor:'#E5E7EB'
            }}>
            <Text style={{ color: filter === f ? '#fff' : '#111', fontWeight:'700' }}>
              {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        value={search}
        onChangeText={t => setSearch(t)}
        placeholder="Search by name..."
        style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12 }}
      />
    </View>
  ), [filter, search]);

  const renderItem = ({ item }: any) => {
    return (
      <TouchableOpacity
        onPress={() => onOpen && onOpen(item.id)}
        style={{ padding:12, borderBottomWidth:1, borderColor:'#F1F5F9' }}>
        <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
          <Text style={{ fontWeight:'800' }}>{item.name}</Text>
          <Chip text={item.status === 'confirmed' ? 'Confirmed' : 'Draft'} tone={item.status === 'confirmed' ? 'green' : 'amber'} />
        </View>
        <Text style={{ opacity:0.7, marginTop:4 }}>
          {(item.category || '—')}/{(item.mode || '—')} · COGS {fmtMoney(item.cogs)} · RRP {fmtMoney(item.rrp)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex:1, backgroundColor:'#fff' }}>
      {header}
      {busy ? (
        <View style={{ padding:16 }}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(x) => x.id}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={{ padding:16, opacity:0.6 }}>No recipes</Text>}
        />
      )}
    </View>
  );
}

function Chip({ text, tone }:{ text:string; tone:'green'|'amber'|'gray' }) {
  const bg = tone === 'green' ? '#DCFCE7' : tone === 'amber' ? '#FEF3C7' : '#F3F4F6';
  const fg = tone === 'green' ? '#166534' : tone === 'amber' ? '#92400E' : '#111827';
  return (
    <View style={{ backgroundColor:bg, paddingHorizontal:10, paddingVertical:4, borderRadius:999 }}>
      <Text style={{ color:fg, fontWeight:'700' }}>{text}</Text>
    </View>
  );
}
function fmtMoney(n:any) { return Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—'; }
