import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

export default function RegisterScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onRegister = async () => {
    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
      nav.replace('VenueSetup');
    } catch (e: any) {
      Alert.alert('Register failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.c}>
      <Text style={S.h1}>Create your account</Text>
      <TextInput placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={S.input} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} style={S.input} />

      <TouchableOpacity style={S.primary} onPress={onRegister} disabled={busy}>
        {busy ? <ActivityIndicator /> : <Text style={S.btnText}>Continue</Text>}
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  c: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  h1: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 12, padding: 12 },
  primary: { backgroundColor: '#0A84FF', padding: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
