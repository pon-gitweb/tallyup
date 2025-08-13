import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, FlatList, SafeAreaView
} from 'react-native';
import { db } from '../services/firebase';
import {
  collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, writeBatch
} from 'firebase/firestore';

const SAMPLE_ITEMS = [
  { name: 'Beer (Bottle)', expectedQty: 24 },
  { name: 'House Wine (Bottle)', expectedQty: 12 },
  { name: 'Soda Can', expectedQty: 36 },
];

export default function StockTakeAreaInventoryScreen({ route, navigation }) {
  const { venueId, departmentId, areaId, areaName = 'Area' } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);        // [{id,name,expectedQty,count}]
  const [counts, setCounts] = useState({});      // id -> string

  const itemsCol = venueId && departmentId && areaId
    ? collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items')
    : null;

  const ensureSeeded = useCallback(async () => {
    if (!itemsCol) return;
    const snap = await getDocs(itemsCol);
    if (!snap.empty) return false;
    for (const it of SAMPLE_ITEMS) {
      await addDoc(itemsCol, {
        name: it.name,
        expectedQty: Number(it.expectedQty || 0),
        count: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return true;
  }, [itemsCol]);

  const load = useCallback(async () => {
    if (!itemsCol) return;
    setLoading(true);
    try {
      // seed if empty
      await ensureSeeded();

      // now load
      const snap = await getDocs(itemsCol);
      const rows = [];
      snap.forEach(d => {
        const data = d.data() || {};
        rows.push({
          id: d.id,
          name: String(data.name || 'Item'),
          expectedQty: Number(data.expectedQty || 0),
          count: (data.count === null || data.count === undefined) ? '' : String(data.count),
        });
      });

      // sort by name
      rows.sort((a, b) => a.name.localeCompare(b.name));

      // bind counts to current values
      const next = {};
      rows.forEach(r => { next[r.id] = r.count; });

      setItems(rows);
      setCounts(next);
    } catch (err) {
      console.error('[StockTakeAreaInventory] load error', err);
      Alert.alert('Items', err?.message || 'Could not load items.');
    } finally {
      setLoading(false);
    }
  }, [itemsCol, ensureSeeded]);

  useEffect(() => { load(); }, [load]);

  const commit = async () => {
    try {
      const uncounted = items.filter(i => !counts[i.id] || String(counts[i.id]).trim() === '');
      if (uncounted.length > 0) {
        Alert.alert(
          'Uncounted Items',
          `There are ${uncounted.length} uncounted item(s). Enter them or skip?`,
          [
            { text: 'Enter Now', style: 'default' },
            { text: 'Skip & Commit', style: 'destructive', onPress: () => finalize(true) },
          ]
        );
      } else {
        await finalize(false);
      }
    } catch (err) {
      console.error('[StockTakeAreaInventory] commit error', err);
      Alert.alert('Commit', err?.message || 'Could not commit area.');
    }
  };

  const finalize = async (skipMissing) => {
    if (!itemsCol) return;
    setLoading(true);
    try {
      const batch = writeBatch(db);

      // write all counts (skip missing if requested)
      for (const it of items) {
        const val = counts[it.id];
        if (!skipMissing && (val === undefined || String(val).trim() === '')) {
          continue; // safety; usually handled above
        }
        batch.update(doc(itemsCol.path, it.id), {
          count: (val === '' || val === undefined) ? null : Number(val),
          updatedAt: serverTimestamp(),
        });
      }

      // mark area completed at area doc
      const areaDocRef = doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
      batch.update(areaDocRef, {
        status: 'completed',
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      navigation.goBack();
    } catch (err) {
      console.error('[StockTakeAreaInventory] finalize error', err);
      Alert.alert('Commit', err?.message || 'Could not finalize area.');
    } finally {
      setLoading(false);
    }
  };

  const renderRow = ({ item }) => (
    <View style={styles.row}>
      <Text style={styles.itemName}>{item.name}</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder={item.expectedQty ? `Expected: ${item.expectedQty}` : 'Enter'}
        value={counts[item.id] ?? ''}
        onChangeText={(v) => setCounts(prev => ({ ...prev, [item.id]: v }))}
      />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop:8 }}>Loading items…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 12 }}>
            {areaName} — Enter Counts
          </Text>

          {items.length === 0 ? (
            <View style={styles.center}><Text>No items yet.</Text></View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              renderItem={renderRow}
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          )}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.commitButton} onPress={commit}>
            <Text style={styles.commitText}>Commit Area</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 12,
    justifyContent: 'space-between',
  },
  itemName: { flex: 1, fontSize: 16, fontWeight: '500' },
  input: {
    width: 110, borderWidth: 1, borderColor: '#ccc',
    borderRadius: 6, padding: 8, textAlign: 'center',
  },
  footer: { padding: 16, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fff' },
  commitButton: { backgroundColor: '#1976d2', padding: 14, borderRadius: 8 },
  commitText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
});
