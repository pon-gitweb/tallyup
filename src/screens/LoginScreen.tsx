import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { auth, db } from '../services/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const DEV_EMAIL = 'test@example.com';
const DEV_PASS  = 'test1234';

type Mode = 'signIn' | 'register';

export default function LoginScreen() {
  const nav = useNavigation<any>();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    if (!email || !password) { Alert.alert('Missing info', 'Please enter email and password.'); return; }
    try {
      setBusy(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // App.tsx observer handles redirect into main app.
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message ?? 'Unknown error');
    } finally { setBusy(false); }
  };

  const onRegister = async () => {
    if (!email || !password) { Alert.alert('Missing info', 'Please enter email and password.'); return; }
    try {
      setBusy(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      // Ensure users/{uid} exists (no venueId yet for cold onboarding)
      const uRef = doc(db, 'users', cred.user.uid);
      const uSnap = await getDoc(uRef);
      if (!uSnap.exists()) await setDoc(uRef, { email: cred.user.email ?? email.trim() }, { merge: true });
      // Go to CreateVenue in AUTH flow
      nav.navigate('CreateVenue', { origin: 'auth' });
    } catch (e: any) {
      Alert.alert('Registration failed', e?.message ?? 'Unknown error');
    } finally { setBusy(false); }
  };

  const onDevLogin = async () => {
    try {
      setBusy(true);
      await signInWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASS);
      // App.tsx observer routes to main app
    } catch (e: any) {
      Alert.alert('Dev login failed', e?.message ?? 'Unknown error');
    } finally { setBusy(false); }
  };

  const isRegister = mode === 'register';

  return (
    <View style={S.container}>
      <Text style={S.title}>TallyUp</Text>

      <View style={S.modeRow}>
        <TouchableOpacity style={[S.pill, !isRegister ? S.pillOn : S.pillOff]} onPress={() => setMode('signIn')}>
          <Text style={S.pillText}>{!isRegister ? '● ' : ''}Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[S.pill, isRegister ? S.pillOn : S.pillOff]} onPress={() => setMode('register')}>
          <Text style={S.pillText}>{isRegister ? '● ' : ''}Register</Text>
        </TouchableOpacity>
      </View>

      <View style={S.card}>
        <TextInput style={S.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}/>
        <TextInput style={S.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/>
        {!isRegister ? (
          <TouchableOpacity style={[S.btn, busy && S.btnDisabled]} onPress={onSignIn} disabled={busy}>
            <Text style={S.btnText}>{busy ? 'Signing in…' : 'Sign In'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[S.btn, busy && S.btnDisabled]} onPress={onRegister} disabled={busy}>
            <Text style={S.btnText}>{busy ? 'Creating…' : 'Register'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={[S.btnSecondary, busy && S.btnDisabled]} onPress={onDevLogin} disabled={busy}>
        <Text style={S.btnText}>Dev Login (test@example.com)</Text>
      </TouchableOpacity>

      <Text style={S.note}>New here? Register, then create your venue. Dev Login jumps into the dev venue.</Text>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 18 },
  card: { backgroundColor: '#F3F4F6', padding: 16, borderRadius: 12, marginBottom: 12 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 10 },
  btn: { backgroundColor: '#0A84FF', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#111827', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700' },
  note: { color: '#6B7280', fontSize: 12, textAlign: 'center', marginTop: 10 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 12 },
  pill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, marginHorizontal: 4 },
  pillOn: { backgroundColor: '#0A84FF' },
  pillOff: { backgroundColor: '#E5E7EB' },
  pillText: { color: '#fff', fontWeight: '700' },
});
