import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { getAuth } from 'firebase/auth';
import { collection, doc, serverTimestamp, setDoc, getFirestore } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../../components/common/Toast';

export default function VenueSetupScreen() {
  const auth = getAuth();
  const db = getFirestore();
  const { showError, showSuccess } = useToast();

  const [name, setName] = useState('');
  const [openSignup, setOpenSignup] = useState(true);
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    const user = auth.currentUser;
    if (!user) {
      showError('Please log in first.');
      return;
    }
    if (!name.trim()) {
      showError('Please enter a venue name.');
      return;
    }

    setBusy(true);
    try {
      const venueId = `v_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
      const venueRef = doc(collection(db, 'venues'), venueId);
      await setDoc(venueRef, {
        config: {
          name: name.trim(),
          openSignup,
          createdAt: serverTimestamp(),
        }
      });

      await setDoc(doc(db, 'venues', venueId, 'members', user.uid), {
        role: 'owner',
        email: user.email ?? null,
        joinedAt: serverTimestamp()
      });

      await setDoc(doc(db, 'users', user.uid), {
        email: user.email ?? null,
        defaultVenueId: venueId,
        venues: [venueId],
        updatedAt: serverTimestamp()
      }, { merge: true });

      showSuccess("Your venue is ready — let's go!");
      // Root gate will detect defaultVenueId and send to Dashboard
    } catch (e: any) {
      showError('Failed to create venue: ' + (e?.message ?? 'Unknown error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.c}>
      <Text style={S.h1}>Set up your venue</Text>
      <TextInput placeholder="Venue name (e.g. Hosti Dev Venue)" value={name} onChangeText={setName} style={S.input} />
      <View style={S.row}>
        <Text style={{ fontWeight: '600' }}>Allow open signup (dev-friendly)</Text>
        <Switch value={openSignup} onValueChange={setOpenSignup} />
      </View>
      <TouchableOpacity style={S.primary} onPress={onCreate} disabled={busy}>
        {busy ? <ActivityIndicator /> : <Text style={S.btnText}>Create & Continue</Text>}
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  c: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  h1: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 12, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  primary: { backgroundColor: '#0A84FF', padding: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
