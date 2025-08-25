import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, Alert } from 'react-native';
import { db } from '../../../services/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getCurrentVenueForUser } from '../../../services/devBootstrap';

export default function AreasStep() {
  const [dept, setDept] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [newArea, setNewArea] = useState('');

  useEffect(() => {
    (async () => {
      const venueId = await getCurrentVenueForUser(); if (!venueId) return;
      const snap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      setDepartments(snap.docs.map(d => d.id).sort());
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const venueId = await getCurrentVenueForUser(); if (!venueId || !dept) { setAreas([]); return; }
      const snap = await getDocs(collection(db, 'venues', venueId, 'departments', dept, 'areas'));
      setAreas(snap.docs.map(d => d.id).sort());
    })();
  }, [dept]);

  async function addArea() {
    const name = newArea.trim();
    if (!name || !dept) return;
    const venueId = await getCurrentVenueForUser(); if (!venueId) return;
    const ref = doc(db, 'venues', venueId, 'departments', dept, 'areas', name);
    await setDoc(ref, { name, startedAt: null, completedAt: null, updatedAt: new Date() }, { merge: true });
    setAreas(prev => Array.from(new Set([...prev, name])).sort());
    setNewArea('');
  }

  async function removeArea(name: string) {
    if (!dept) return;
    const venueId = await getCurrentVenueForUser(); if (!venueId) return;
    await deleteDoc(doc(db, 'venues', venueId, 'departments', dept, 'areas', name));
    setAreas(prev => prev.filter(x => x !== name));
  }

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Text>Select a department, then manage its areas.</Text>
      <FlatList
        horizontal
        data={departments}
        keyExtractor={(id) => id}
        contentContainerStyle={{ gap: 8 }}
        renderItem={({ item }) => (
          <Button title={dept === item ? `• ${item}` : item} onPress={() => setDept(item)} />
        )}
      />
      {dept ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Text style={{ fontWeight: '600' }}>{dept} areas</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={newArea} onChangeText={setNewArea} placeholder="e.g. Cellar" style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8 }} />
            <Button title="Add" onPress={addArea} />
          </View>
          <FlatList
            data={areas}
            keyExtractor={(id) => id}
            renderItem={({ item }) => (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                <Text>{item}</Text>
                <Button title="Remove" onPress={() => removeArea(item)} />
              </View>
            )}
          />
        </View>
      ) : <Text style={{ opacity: 0.7 }}>Choose a department above.</Text>}
    </View>
  );
}
