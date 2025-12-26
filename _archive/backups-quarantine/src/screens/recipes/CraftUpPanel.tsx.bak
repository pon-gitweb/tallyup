// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Modal, SafeAreaView } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { createRecipeDraft } from '../../services/recipes/createRecipeDraft';
import DraftRecipeDetailPanel from './DraftRecipeDetailPanel';

export default function CraftUpPanel({ onClose }: { onClose: () => void }) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<'food' | 'beverage' | null>(null);
  const [mode, setMode] = useState<'batch' | 'single' | 'dish' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const tip = useMemo(
    () => 'Craft-It: choose type and mode, we’ll handle the rest. Name + ingredients are set in the draft screen.',
    []
  );
  const dataPath = `venues/${venueId || '…'}/recipes/<recipeId> · status: draft | confirmed`;

  const saveDraft = async () => {
    try {
      if (!category) throw new Error('Choose Food or Beverage');
      if (!mode) throw new Error('Choose Batch/Single/Dish');
      setBusy(true);
      // No name here — it will be entered/edited in the Draft screen
      const res = await createRecipeDraft({ venueId, name: 'Untitled', category, mode });
      if (!res?.id) throw new Error('Draft not created');
      setDetailId(res.id);
    } catch (e:any) {
      Alert.alert('Could not start Craft-It', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const Pill = ({ label, active, onPress }:{label:string; active:boolean; onPress:()=>void}) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingVertical:8, paddingHorizontal:12, borderRadius:999,
        borderWidth:1, borderColor: active ? '#111' : '#E5E7EB',
        backgroundColor: active ? '#111' : '#F9FAFB', marginRight:8, marginBottom:8
      }}
    >
      <Text style={{ color: active ? '#fff' : '#111', fontWeight:'700' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex:1, backgroundColor:'#fff', padding:16 }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Craft-It (Recipe Creator)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>{tip}</Text>

      <View style={{ padding:12, borderRadius:12, borderWidth:1, borderColor:'#E5E7EB', backgroundColor:'#F9FAFB', marginBottom:12 }}>
        <Text style={{ fontWeight:'700' }}>Planned data path</Text>
        <Text style={{ color:'#6B7280', marginTop:4 }}>{dataPath}</Text>
      </View>

      <View style={{ marginBottom:12 }}>
        <Text style={{ fontWeight:'700', marginBottom:8 }}>What kind of recipe?</Text>
        <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
          <Pill label="Food" active={category==='food'} onPress={()=>{ setCategory('food'); setMode(null); }} />
          <Pill label="Beverage" active={category==='beverage'} onPress={()=>{ setCategory('beverage'); setMode(null); }} />
        </View>
      </View>

      {category && (
        <View style={{ marginBottom:12 }}>
          <Text style={{ fontWeight:'700', marginBottom:8 }}>How will you make it?</Text>
          <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
            {category==='beverage' && (
              <>
                <Pill label="Single Serve" active={mode==='single'} onPress={()=>setMode('single')} />
                <Pill label="Batch" active={mode==='batch'} onPress={()=>setMode('batch')} />
              </>
            )}
            {category==='food' && (
              <>
                <Pill label="Dish" active={mode==='dish'} onPress={()=>setMode('dish')} />
                <Pill label="Batch" active={mode==='batch'} onPress={()=>setMode('batch')} />
              </>
            )}
          </View>
        </View>
      )}

      <TouchableOpacity
        disabled={busy || !category || !mode}
        onPress={saveDraft}
        style={{ marginTop:12, padding:14, borderRadius:12, backgroundColor: (!category||!mode) ? '#9CA3AF' : '#111' }}
      >
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>
          {busy ? 'Starting…' : 'Create Draft & Continue'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onClose}
        style={{ marginTop:12, padding:14, borderRadius:12, backgroundColor:'#F3F4F6' }}>
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>

      <Modal visible={!!detailId} animationType="slide" onRequestClose={() => setDetailId(null)}>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }}>
          {detailId ? <DraftRecipeDetailPanel recipeId={detailId} onClose={() => setDetailId(null)} /> : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
