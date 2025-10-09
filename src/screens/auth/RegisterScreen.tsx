import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { createVenueOwnedByCurrentUser } from '../../services/venues';

export default function RegisterScreen() {
  const auth = getAuth();

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [venueName, setVenueName] = useState('');
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    const em = email.trim();
    const pw = pass;
    const vn = venueName.trim();

    if (!em || !pw) {
      Alert.alert('Missing info', 'Enter email and password.');
      return;
    }
    if (!vn) {
      Alert.alert('Venue name required', 'Please enter the venue name.');
      return;
    }

    setBusy(true);
    try {
      // 1) Create the user
      await createUserWithEmailAndPassword(auth, em, pw);

      // 2) Immediately create & attach the venue (service returns the venueId as a string)
      const venueId = await createVenueOwnedByCurrentUser(vn);

      // 3) Done. Providers will see users/{uid}.venueId and route to Dashboard.
      Alert.alert('Welcome', `Your venue “${vn}” is ready (id: ${venueId}).`, [{ text: 'OK' }]);
    } catch (e:any) {
      Alert.alert('Registration failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.container}>
      <Text style={S.title}>Create your account</Text>

      <TextInput
        style={S.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={S.input}
        placeholder="Password"
        secureTextEntry
        value={pass}
        onChangeText={setPass}
      />

      <TextInput
        style={S.input}
        placeholder="Venue name (e.g., Riverside Hotel)"
        value={venueName}
        onChangeText={setVenueName}
      />

      <TouchableOpacity style={[S.primary, busy && S.disabled]} onPress={onCreate} disabled={busy}>
        {busy ? <ActivityIndicator /> : <Text style={S.primaryText}>Create Account & Venue</Text>}
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#fff' },
  primary: { backgroundColor: '#0A84FF', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
