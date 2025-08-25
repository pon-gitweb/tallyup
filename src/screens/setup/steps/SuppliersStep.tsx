import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, Alert } from 'react-native';
import { db } from '../../../services/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { getCurrentVenueForUser } from '../../../services/devBootstrap';

export default function SuppliersStep() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; email?: string }[]>([]);

  useEffect(() => {
    (async () => {
      const venueId = await getCurrentVenueForUser(); if (!venueId) return;
      const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
      setSuppliers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    })();
  }, []);

  async function addSupplier() {
    const venueId = await getCurrentVenueForUser(); if (!venueId) return;
    if (!name.trim()) { Alert.alert('Supplier name required'); return; }
    const ref = await addDoc(collection(db, 'venues', venueId, 'suppliers'), { name: name.trim(), email: email.trim() || null, active: true });
    setSuppliers(prev => [...prev, { id: ref.id, name: name.trim(), email: email.trim() || undefined }]);
    setName(''); setEmail('');
  }

  async function removeSupplier(id: string) {
    const venueId = await getCurrentVenueForUser(); if (!venueId) return;
    await deleteDoc(doc(db, 'venues', venueId, 'suppliers', id));
    setSuppliers(prev => prev.filter(s => s.id !== id));
  }

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Text>Add your suppliers (used later for predictive ordering).</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={name} onChangeText={setName} placeholder="Supplier name" style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8 }} />
        <TextInput value={email} onChangeText={setEmail} placeholder="Email (optional)" style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8 }} />
        <Button title="Add" onPress={addSupplier} />
      </View>
      <FlatList
        data={suppliers}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
            <Text>{item.name}{item.email ? ` — ${item.email}` : ''}</Text>
            <Button title="Remove" onPress={() => removeSupplier(item.id)} />
          </View>
        )}
      />
    </View>
  );
}
