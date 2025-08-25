import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, Alert, FlatList } from 'react-native';
import { getAuth } from 'firebase/auth';
import { db } from '../../../services/firebase';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { getCurrentVenueForUser } from '../../../services/devBootstrap';

export default function DepartmentsStep() {
  const [items, setItems] = useState<string[]>([]);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    (async () => {
      const venueId = await getCurrentVenueForUser();
      if (!venueId) return;
      const col = collection(db, 'venues', venueId, 'departments');
      const snap = await getDocs(col);
      setItems(snap.docs.map(d => d.id).sort());
    })();
  }, []);

  async function addDepartment() {
    const name = newName.trim();
    if (!name) return;
    const venueId = await getCurrentVenueForUser(); if (!venueId) return;
    const ref = doc(db, 'venues', venueId, 'departments', name);
    await setDoc(ref, { name, updatedAt: new Date() }, { merge: true });
    setItems(prev => Array.from(new Set([...prev, name])).sort());
    setNewName('');
  }

  async function removeDepartment(id: string) {
    const venueId = await getCurrentVenueForUser(); if (!venueId) return;
    await deleteDoc(doc(db, 'venues', venueId, 'departments', id));
    setItems(prev => prev.filter(x => x !== id));
  }

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Text>Add or remove departments.</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={newName} onChangeText={setNewName} placeholder="e.g. Bar" style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8 }} />
        <Button title="Add" onPress={addDepartment} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(id) => id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
            <Text>{item}</Text>
            <Button title="Remove" onPress={() => removeDepartment(item)} />
          </View>
        )}
      />
    </View>
  );
}
