// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, StyleSheet } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import CraftUpPanel from './CraftUpPanel';
import RecipeListScreen from './RecipeListScreen';
import RecipeDetailScreen from './RecipeDetailScreen';

/**
 * Embedded hub with a local toggle:
 *  - Craft: existing CraftUp tools (no changes)
 *  - Recipes: list + detail, no navigation edits required
 */
export default function CraftUpListScreen() {
  const venueId = useVenueId();
  const [tab, setTab] = useState<'craft' | 'recipes'>('recipes'); // default can be 'craft' if you prefer
  const [openRecipeId, setOpenRecipeId] = useState<string | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <Header tab={tab} setTab={setTab} canBack={tab === 'recipes' && !!openRecipeId} onBack={() => setOpenRecipeId(null)} />
      <View style={{ flex: 1 }}>
        {tab === 'craft' ? (
          <CraftUpPanel />
        ) : (
          openRecipeId ? (
            <RecipeDetailScreen
              recipeId={openRecipeId}
              onBack={() => setOpenRecipeId(null)}
              onOpenDraft={(draftId) => setOpenRecipeId(draftId)}
            />
          ) : (
            <RecipeListScreen onOpen={(id) => setOpenRecipeId(id)} />
          )
        )}
      </View>
    </SafeAreaView>
  );
}

function Header({
  tab, setTab, canBack, onBack,
}: {
  tab: 'craft' | 'recipes';
  setTab: (t: 'craft' | 'recipes') => void;
  canBack: boolean;
  onBack: () => void;
}) {
  return (
    <View style={S.header}>
      <View style={S.topRow}>
        {canBack ? (
          <TouchableOpacity onPress={onBack}><Text style={S.back}>‹ Back</Text></TouchableOpacity>
        ) : <View style={{ width: 50 }} />}
        <Text style={S.title}>{tab === 'craft' ? 'CraftUp — Tools' : 'CraftUp — Recipes'}</Text>
        <View style={{ width: 50 }} />
      </View>
      <View style={S.tabs}>
        <TabButton label="Craft" active={tab === 'craft'} onPress={() => setTab('craft')} />
        <TabButton label="Recipes" active={tab === 'recipes'} onPress={() => setTab('recipes')} />
      </View>
    </View>
  );
}

function TabButton({ label, active, onPress }:{
  label: string; active: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        S.tab,
        { backgroundColor: active ? '#111' : '#fff', borderColor: '#E5E7EB', borderWidth: 1 },
      ]}
    >
      <Text style={{ color: active ? '#fff' : '#111', fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
}

const S = StyleSheet.create({
  header: { padding: 16, gap: 12, borderBottomWidth: 1, borderColor: '#E5E7EB' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#2563EB', fontSize: 16 },
  title: { fontSize: 18, fontWeight: '900' },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
});
