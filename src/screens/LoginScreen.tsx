import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../services/firebase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onAuthStateChanged in App.tsx will take over
    } catch (e: any) {
      Alert.alert('Sign-in failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    try {
      await signOut(auth);
      Alert.alert('Signed out');
    } catch (e: any) {
      Alert.alert('Sign-out error', e?.message ?? 'Unknown error');
    }
  };

  return (
    <View style={S.container}>
      <Text style={S.title}>TallyUp — Login</Text>
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
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={S.buttonPrimary} onPress={onSignIn} disabled={busy}>
        {busy ? <ActivityIndicator /> : <Text style={S.buttonText}>Sign In</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={S.button} onPress={onSignOut}>
        <Text style={S.buttonText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 12 },
  button: { backgroundColor: '#222', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  buttonPrimary: { backgroundColor: '#0A84FF', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
