import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { createVenueOwnedByCurrentUser } from '../../services/venues';
import { signOutAll } from '../../services/auth';
import { useNavigation } from '@react-navigation/native';

export default function CreateVenueScreen() {
  const nav = useNavigation<any>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Venue name required', 'Please enter a venue name.');
      return;
    }
    try {
      setBusy(true);
      const { venueId } = await createVenueOwnedByCurrentUser(trimmed);
      Alert.alert('Venue created', `Welcome to ${trimmed}!`, [
        { text: 'OK', onPress: () => nav.reset({ index: 0, routes: [{ name: 'ExistingVenueDashboard', params: { venueId } }] }) }
      ]);
    } catch (e: any) {
      Alert.alert('Create failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onJoinWithCode = () => {
    Alert.alert('Join with invite code', 'Coming soon (MVP++). Ask your admin for an invite code.');
  };

  const onBackToLogin = async () => {
    try { setBusy(true); await signOutAll(); }
    catch (e: any) { Alert.alert('Sign out failed', e?.message ?? 'Unknown error'); }
    finally { setBusy(false); }
  };

  return (
    <View style={S.container}>
      <Text style={S.title}>Create or Join a Venue</Text>
      <Text style={S.copy}>You’re signed in but not attached to any venue yet.</Text>

      <View style={S.card}>
        <Text style={S.label}>Venue name</Text>
        <TextInput
          style={S.input}
          placeholder="e.g., The Front Bar"
          value={name}
          onChangeText={setName}
          editable={!busy}
        />
        <TouchableOpacity style={[S.primary, busy && S.disabled]} onPress={onCreate} disabled={busy}>
          <Text style={S.primaryText}>{busy ? 'Creating…' : 'Create Venue'}</Text>
        </TouchableOpacity>
      </View>

      <View style={S.cardAlt}>
        <Text style={S.subhead}>Already have a venue?</Text>
        <TouchableOpacity style={S.secondary} onPress={onJoinWithCode} disabled={busy}>
          <Text style={S.secondaryText}>Join with invite code (coming soon)</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={S.link} onPress={onBackToLogin} disabled={busy}>
        <Text style={S.linkText}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  copy: { color: '#333', textAlign: 'center', marginBottom: 16 },
  card: { backgroundColor: '#F7F7F8', padding: 14, borderRadius: 12, marginBottom: 10 },
  label: { fontWeight: '600', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, backgroundColor: '#fff', marginBottom: 10 },
  primary: { backgroundColor: '#10B981', padding: 14, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
  cardAlt: { backgroundColor: '#EEF2FF', padding: 12, borderRadius: 12, marginBottom: 10, borderColor: '#DCE6FF', borderWidth: 1 },
  subhead: { fontWeight: '700', marginBottom: 6, color: '#1E3A8A' },
  secondary: { backgroundColor: '#E5E7EB', padding: 12, borderRadius: 10, alignItems: 'center' },
  secondaryText: { color: '#111', fontWeight: '600' },
  link: { alignItems: 'center', marginTop: 10 },
  linkText: { color: '#0A84FF', fontWeight: '600' },
});
