import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { DEV_FEATURES_ENABLED, DEV_EMAIL, DEV_PASSWORD, DEV_VENUE_ID } from 'src/config/dev';
import { ensureDevMembership } from 'src/services/devBootstrap';
import { doc, setDoc, getFirestore, serverTimestamp } from 'firebase/firestore';

export default function LoginScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const db = getFirestore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onLogin = async () => {
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // Root gate will take over and route appropriately
    } catch (e: any) {
      Alert.alert('Login failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onDevLogin = async () => {
    if (!DEV_FEATURES_ENABLED) return;
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);
      const uid = cred.user.uid;

      // ensure membership in pinned venue (auto-create if allowed)
      await ensureDevMembership();

      // set defaultVenueId
      await setDoc(doc(db, 'users', uid), {
        email: cred.user.email ?? null,
        defaultVenueId: DEV_VENUE_ID,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      Alert.alert('Dev Login', 'Signed in and pinned to dev venue.');
      // Root gate handles next screen
    } catch (e: any) {
      Alert.alert('Dev Login failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.c}>
      <Text style={S.h1}>TallyUp</Text>
      <TextInput placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={S.input} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} style={S.input} />

      <TouchableOpacity style={S.primary} onPress={onLogin} disabled={busy}>
        {busy ? <ActivityIndicator /> : <Text style={S.btnText}>Login</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => nav.navigate('Register')} style={S.link}>
        <Text style={S.linkText}>New here? Register</Text>
      </TouchableOpacity>

      {DEV_FEATURES_ENABLED && (
        <TouchableOpacity style={S.dev} onPress={onDevLogin} disabled={busy}>
          <Text style={S.btnText}>Dev Login (pin dev venue)</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  c: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  h1: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 12, padding: 12 },
  primary: { backgroundColor: '#0A84FF', padding: 16, borderRadius: 12, alignItems: 'center' },
  dev: { backgroundColor: '#333', padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 6 },
  linkText: { color: '#0A84FF', fontWeight: '700' },
});
