import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { getAuth, signOut } from 'firebase/auth';
import { db } from '../services/firebase';
import {
  doc, setDoc, getDoc, serverTimestamp, collection,
} from 'firebase/firestore';

export default function CreateVenueScreen() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    const auth = getAuth();
    const uid = auth.currentUser?.uid || null;
    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in first.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Venue name required', 'Please enter a venue name.');
      return;
    }

    setBusy(true);
    console.log('[CreateVenue] start', JSON.stringify({ name }));

    try {
      // (A) Ensure users/{uid} exists and prime venueId:null if missing (future-proof for rules)
      const uref = doc(db, 'users', uid);
      const usnap = await getDoc(uref);
      const hasVenueIdKey = usnap.exists() && Object.prototype.hasOwnProperty.call(usnap.data() || {}, 'venueId');

      if (!usnap.exists()) {
        await setDoc(uref, { createdAt: new Date(), email: auth.currentUser?.email ?? null, venueId: null }, { merge: true });
      } else if (!hasVenueIdKey) {
        await setDoc(uref, { venueId: null }, { merge: true });
      }

      console.log('[CreateVenue] users/{uid} primed', JSON.stringify({
        path: uref.path, primedVenueIdNull: !hasVenueIdKey,
      }));

      // (B) Create the venue parent with ownerUid (rules: canCreateFirstVenue + ownerUid == uid)
      const vref = doc(collection(db, 'venues'));
      await setDoc(vref, {
        name: name.trim(),
        ownerUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log('[CreateVenue] venues/{id} created', JSON.stringify({ venueId: vref.id }));

      // (C) Set users/{uid}.venueId (first-time only, allowed by rules)
      await setDoc(uref, { venueId: vref.id, touchedAt: new Date() }, { merge: true });
      console.log('[CreateVenue] users/{uid}.venueId set', JSON.stringify({ uid, venueId: vref.id }));

      // (D) Add membership (owner)
      const mref = doc(db, 'venues', vref.id, 'members', uid);
      await setDoc(mref, { role: 'owner', createdAt: serverTimestamp() }, { merge: true });
      console.log('[CreateVenue] members/{uid} upserted', JSON.stringify({ path: mref.path }));

      // (E) Seed departments/areas sequentially (non-fatal if denied—Setup can fill later)
      const nowBase = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };

      async function seedDept(deptName: string, areaNames: string[]) {
        const dref = doc(db, 'venues', vref.id, 'departments', deptName);
        await setDoc(dref, { name: deptName, ...nowBase }, { merge: true });
        console.log('[CreateVenue] seed department', JSON.stringify({ path: dref.path }));

        for (const area of areaNames) {
          const aref = doc(db, 'venues', vref.id, 'departments', deptName, 'areas', area);
          await setDoc(aref, { name: area, startedAt: null, completedAt: null, ...nowBase }, { merge: true });
          console.log('[CreateVenue] seed area', JSON.stringify({ path: aref.path }));
        }
      }

      try {
        await seedDept('Bar', ['Front Bar', 'Back Bar', 'Fridge', 'Cellar']);
        await seedDept('Kitchen', ['Prep', 'Line', 'Dry Store', 'Cool Room']);
      } catch (e: any) {
        console.log('[CreateVenue] seed warning', JSON.stringify({ code: e?.code, message: e?.message }));
      }

      Alert.alert('Venue created', 'Your venue is ready. Redirecting to Dashboard…');
      // VenueProvider onSnapshot(users/{uid}) will switch the UI automatically
    } catch (e: any) {
      console.log('[CreateVenue] error', JSON.stringify({ code: e?.code || e?.name, msg: e?.message || String(e) }));
      Alert.alert('Could not create venue', e?.message || 'Missing or insufficient permissions.');
    } finally {
      setBusy(false);
    }
  }

  async function handleBackToLogin() {
    try {
      await signOut(getAuth());
      console.log('[CreateVenue] back-to-login signOut ok');
    } catch {}
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#0F1115' }}>
      <Text style={{ color: 'white', fontSize: 22, fontWeight: '700', marginBottom: 12 }}>Create Venue</Text>
      <Text style={{ color: '#B7C0CD' }}>
        Enter a name to create your venue. We’ll add default departments and areas; you can edit them later in Settings.
      </Text>

      <TextInput
        placeholder="e.g. Riverside Hotel"
        placeholderTextColor="#6B7787"
        value={name}
        onChangeText={setName}
        style={{
          backgroundColor: '#171B22',
          color: 'white',
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#263142',
          marginTop: 16,
        }}
        autoCapitalize="words"
        autoFocus
        editable={!busy}
      />

      <TouchableOpacity
        onPress={handleCreate}
        disabled={busy}
        style={{
          marginTop: 16,
          backgroundColor: busy ? '#2B3442' : '#3B82F6',
          paddingVertical: 12,
          borderRadius: 10,
          alignItems: 'center',
        }}
      >
        {busy ? <ActivityIndicator /> : <Text style={{ color: 'white', fontWeight: '700' }}>Create Venue</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleBackToLogin}
        disabled={busy}
        style={{
          marginTop: 24,
          paddingVertical: 10,
          borderRadius: 10,
          alignItems: 'center',
          borderColor: '#2B3442',
          borderWidth: 1,
        }}
      >
        <Text style={{ color: '#B6C0CC' }}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}
