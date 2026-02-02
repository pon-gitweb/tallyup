// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, FlatList, TextInput, Alert } from 'react-native';

type Proposal = {
  key: string;
  name: string;
  itemId?: string | null;
  count: number;
  confidence?: number | null;
  isNew?: boolean;
};

export default function SmartShelfModal({
  visible,
  onClose,
  jobId,
  proposals,
  loading,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  jobId: string | null;
  proposals: Proposal[];
  loading: boolean;
  onSubmit: (rows: Proposal[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<Proposal[]>([]);

  useEffect(() => {
    if (visible) setRows(proposals || []);
  }, [visible, proposals]);

  const hasAnything = rows.length > 0;

  const updateCount = (key: string, v: string) => {
    const n = v.trim() === '' ? 0 : Number(v);
    if (Number.isNaN(n)) return;
    setRows(prev => prev.map(r => (r.key === key ? { ...r, count: n } : r)));
  };

  const updateName = (key: string, name: string) => {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, name } : r)));
  };

  const doSubmit = async () => {
    if (!hasAnything) return onClose();
    const bad = rows.find(r => !r.name || r.name.trim() === '');
    if (bad) return Alert.alert('Missing name', 'One of the detected items has no name. Please enter a name.');
    await onSubmit(rows);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'flex-end' }}>
        <View style={{ backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:16, maxHeight:'85%' }}>
          <Text style={{ fontSize:18, fontWeight:'900' }}>Smart Shelf Count</Text>
          <Text style={{ color:'#6B7280', marginTop:4 }}>
            {jobId ? `Job: ${jobId}` : 'Preparing…'}
          </Text>

          {loading ? (
            <View style={{ padding:16, alignItems:'center' }}>
              <ActivityIndicator />
              <Text style={{ marginTop:10, color:'#6B7280' }}>Analysing shelf photo…</Text>
            </View>
          ) : !hasAnything ? (
            <View style={{ paddingVertical:20 }}>
              <Text style={{ color:'#6B7280' }}>No items detected yet.</Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(r)=>r.key}
              style={{ marginTop:12 }}
              renderItem={({ item }) => (
                <View style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12, marginBottom:10 }}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                    <Text style={{ fontWeight:'900' }}>{item.isNew ? 'New item' : 'Matched'}</Text>
                    {typeof item.confidence === 'number' ? (
                      <Text style={{ color:'#6B7280' }}>{Math.round(item.confidence * 100)}%</Text>
                    ) : null}
                  </View>

                  <Text style={{ marginTop:6, fontWeight:'700' }}>Name</Text>
                  <TextInput
                    value={item.name}
                    onChangeText={(t)=>updateName(item.key, t)}
                    placeholder="Item name"
                    style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingVertical:8, paddingHorizontal:10, marginTop:6 }}
                  />

                  <Text style={{ marginTop:10, fontWeight:'700' }}>Count</Text>
                  <TextInput
                    value={String(item.count ?? 0)}
                    onChangeText={(t)=>updateCount(item.key, t)}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingVertical:8, paddingHorizontal:10, marginTop:6 }}
                  />
                </View>
              )}
            />
          )}

          <View style={{ flexDirection:'row', gap:10, marginTop:12 }}>
            <TouchableOpacity onPress={onClose} style={{ padding:12, borderRadius:10, backgroundColor:'#E5E7EB', flex:1 }}>
              <Text style={{ textAlign:'center', fontWeight:'900' }}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={doSubmit}
              disabled={loading}
              style={{ padding:12, borderRadius:10, backgroundColor: loading ? '#0A84FF99' : '#0A84FF', flex:1 }}
            >
              <Text style={{ textAlign:'center', color:'#fff', fontWeight:'900' }}>
                Submit counts
              </Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}
