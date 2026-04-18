import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { createVenueOwnedByCurrentUser } from '../../services/venues';
import { useColours } from '../../context/ThemeContext';

export default function RegisterScreen() {
  const auth = getAuth();
  const colours = useColours();

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
      await createUserWithEmailAndPassword(auth, em, pw);
      const venueId = await createVenueOwnedByCurrentUser(vn);
      Alert.alert('Welcome', `Your venue "${vn}" is ready (id: ${venueId}).`, [{ text: 'OK' }]);
    } catch (e: any) {
      Alert.alert('Registration failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const S = StyleSheet.create({
    container: { flex: 1, padding: 20, backgroundColor: colours.background, justifyContent: 'center' },
    title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center', color: colours.text },
    input: { borderWidth: 1, borderColor: colours.border, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: colours.surface, color: colours.text },
    primary: { backgroundColor: colours.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
    primaryText: { color: colours.primaryText, fontWeight: '700' },
    disabled: { opacity: 0.6 },
  });

  return (
    <View style={S.container}>
      <Text style={S.title}>Create your account</Text>

      <TextInput
        style={S.input}
        placeholder="Email"
        placeholderTextColor={colours.textSecondary}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={S.input}
        placeholder="Password"
        placeholderTextColor={colours.textSecondary}
        secureTextEntry
        value={pass}
        onChangeText={setPass}
      />

      <TextInput
        style={S.input}
        placeholder="Venue name (e.g., Riverside Hotel)"
        placeholderTextColor={colours.textSecondary}
        value={venueName}
        onChangeText={setVenueName}
      />

      <TouchableOpacity style={[S.primary, busy && S.disabled]} onPress={onCreate} disabled={busy}>
        {busy ? <ActivityIndicator color={colours.primaryText} /> : <Text style={S.primaryText}>Create Account & Venue</Text>}
      </TouchableOpacity>
    </View>
  );
}
