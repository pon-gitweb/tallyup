import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, FlatList, SafeAreaView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ensureItemsSeeded, listItems, markAreaStarted, markAreaCompleted
} from '../services/stockTakeService';

export default function StockTakeAreaInventoryScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { venueId, stockTakeId, deptId, areaId } = route.params;

  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});

  const load = async () => {
    try {
      await ensureItemsSeeded(venueId, stockTakeId, deptId, areaId);
      const rows = await listItems(venueId, stockTakeId, deptId, areaId);
      setItems(rows);
      await markAreaStarted(venueId, stockTakeId, deptId, areaId);
    } catch (err) {
      console.error('[StockTakeAreaInventory] load error', err);
      Alert.alert('Error', 'Could not load items.');
    }
  };

  useEffect(() => { load(); }, []);

  const commit = () => {
    const uncounted = items.filter(i => !counts[i.id] || String(counts[i.id]).trim() === '');
    if (uncounted.length > 0) {
      Alert.alert(
        'Uncounted Items',
        `There are ${uncounted.length} item(s) without a count. Do you want to enter them or skip?`,
        [
          { text: 'Enter Now', style: 'default' },
          { text: 'Skip & Commit', style: 'destructive', onPress: () => finalize() },
        ]
      );
    } else {
      finalize();
    }
  };

  const finalize = async () => {
    try {
      await markAreaCompleted(venueId, stockTakeId, deptId, areaId);
      navigation.goBack();
    } catch (err) {
      console.error('[StockTakeAreaInventory] commit error', err);
      Alert.alert('Error', 'Could not commit area.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <FlatList
          contentContainerStyle={{ padding: 16 }}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
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
          )}
        />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    justifyContent: 'space-between',
  },
  itemName: { flex: 1, fontSize: 16, fontWeight: '500' },
  input: {
    width: 100, borderWidth: 1, borderColor: '#ccc',
    borderRadius: 6, padding: 8, textAlign: 'center',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff'
  },
  commitButton: { backgroundColor: '#1976d2', padding: 14, borderRadius: 8 },
  commitText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
});
