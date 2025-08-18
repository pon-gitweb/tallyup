import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, signOut } from 'firebase/auth';
import { createVenueOwnedByCurrentUser } from '../services/venues'; // <-- fixed path

export default function CreateVenueScreen() {
  const nav = useNavigation<any>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Venue Name Required', 'Please enter a name.');
      return;
    }
    setBusy(true);
    try {
      console.log('[TallyUp CreateVenue] start', JSON.stringify({ name: trimmed }));
      const venueId = await createVenueOwnedByCurrentUser(trimmed);
      console.log('[TallyUp CreateVenue] success', JSON.stringify({ venueId }));
      nav.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
    } catch (e: any) {
      const code = e?.code ?? 'unknown';
      const message = e?.message ?? 'Missing or insufficient permissions.';
      const details = {
        code,
        message,
        name: e?.name ?? null,
        stack: e?.stack ? String(e.stack).slice(0, 500) : null,
      };
      console.log('[TallyUp CreateVenue] error', JSON.stringify(details));
      Alert.alert('Create Failed', `${code}: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onBackToLogin() {
    try {
      const auth = getAuth();
      await signOut(auth); // signOut only; no nav.reset('Login')
      console.log('[TallyUp CreateVenue] back-to-login signOut ok');
    } catch (e: any) {
      console.log('[TallyUp CreateVenue] back-to-login signOut error', JSON.stringify({ code: e?.code, message: e?.message }));
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Create your first venue</Text>
      <Text style={{ opacity: 0.7 }}>
        You’re almost there—name your venue to finish setup.
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Venue name"
        autoCapitalize="words"
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={onCreate}
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      />

      <Button title={busy ? 'Creating…' : 'Create Venue'} onPress={onCreate} disabled={busy} />

      <View style={{ height: 16 }} />

      <Button title="Back to Login" onPress={onBackToLogin} disabled={busy} />
    </View>
  );
}
