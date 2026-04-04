import React, { useEffect, useState } from 'react';
import { View, Text, Button, ActivityIndicator, Alert } from 'react-native';
import { auth } from '../services/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ensureSeededForVenue } from '../services/venueBootstrap';
import { useNavigation } from '@react-navigation/native';

export default function DashboardScreen() {
  const [user, setUser] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [busy, setBusy] = useState(true);
  const navigation = useNavigation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) { setBusy(false); return; }
      const profile = await getDoc(doc(db, 'users', u.uid));
      const id = profile.exists() ? profile.data().venueId : null;
      setVenueId(id || null);
      setBusy(false);
    });
    return () => unsub();
  }, []);

  const handleStartOrResume = async () => {
    if (!venueId) {
      Alert.alert('No venue', 'Your profile is missing a venueId. Sign out and back in.');
      return;
    }
    try {
      setBusy(true);
      await ensureSeededForVenue(venueId); // auto-heal if empty
      setBusy(false);
      navigation.navigate('DepartmentSelection', { venueId });
    } catch (e) {
      setBusy(false);
      console.error('[Dashboard] start error', e);
      Alert.alert('Error', e.message || 'Unable to start stock take.');
    }
  };

  if (busy) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading dashboard…</Text>
      </View>
    );
  }

  const title = 'Active stock take';

  return (
    <View style={{ flex:1, padding:24, gap:12 }}>
      <Text style={{ fontSize:18, fontWeight:'700' }}>TallyUp</Text>
      <Text>Signed in as {user?.email}</Text>
      <Button title={title} onPress={handleStartOrResume} />
      <View style={{ height:12 }} />
      <Button title="Sign Out" onPress={() => signOut(auth)} />
    </View>
  );
}
