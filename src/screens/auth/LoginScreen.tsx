import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import Constants from 'expo-constants';
import { _devBootstrap } from '../../services/devBootstrap';

const EXTRA: any =
  (Constants?.expoConfig?.extra as any) ??
  ((Constants as any)?.manifest2?.extra as any) ??
  {};

const DEV_EMAIL = String(EXTRA.EXPO_PUBLIC_DEV_EMAIL || '');
const DEV_PASSWORD = String(EXTRA.EXPO_PUBLIC_DEV_PASSWORD || '');
const DEV_VENUE = String(EXTRA.EXPO_PUBLIC_DEV_VENUE_ID || '');

function codeToMessage(code?: string, fallback?: string) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    case 'auth/admin-restricted-operation':
      return 'Anonymous sign-in is disabled. Use email/password.';
    default:
      return fallback || 'Something went wrong. Please try again.';
  }
}

export default function LoginScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const envStatus = useMemo(
    () => ({ email: !!DEV_EMAIL, password: !!DEV_PASSWORD, venue: !!DEV_VENUE }),
    []
  );

  async function onSignIn() {
    try {
      await signInWithEmailAndPassword(auth, String(email).trim(), String(password));
      // Do NOT reset or navigate; RootNavigator will switch stacks on auth state.
    } catch (e: any) {
      console.log('[TallyUp Login] signIn error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Sign In Failed', codeToMessage(e?.code, e?.message));
    }
  }

  function goRegister() {
    nav.navigate('Register');
  }

  async function onDevLogin() {
    try {
      if (!DEV_EMAIL || !DEV_PASSWORD) {
        Alert.alert(
          'Dev Login Not Configured',
          'Set EXPO_PUBLIC_DEV_EMAIL and EXPO_PUBLIC_DEV_PASSWORD in app.json "extra", then run: npx expo start -c'
        );
        return;
      }

      await signInWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);

      // Pin known dev venue (idempotent and rule-safe when venueId is null/missing)
      const pinned = await _devBootstrap.pinDevVenueIfEnvSet();
      if (!pinned) {
        Alert.alert(
          'Dev Venue Not Pinned',
          DEV_VENUE
            ? 'Ensure this dev user is owner/member of EXPO_PUBLIC_DEV_VENUE_ID, or users/{uid}.venueId is already set differently.'
            : 'Set EXPO_PUBLIC_DEV_VENUE_ID in app.json.'
        );
      }
      // No manual reset; auth listener handles navigation.
    } catch (e: any) {
      console.log('[TallyUp Login] devLogin error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Dev Login Failed', codeToMessage(e?.code, e?.message));
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>TallyUp</Text>

      {/* small env chips to verify extras */}
      <View style={styles.envRow}>
        <Text style={[styles.envTag, envStatus.email ? styles.ok : styles.bad]}>DEV_EMAIL</Text>
        <Text style={[styles.envTag, envStatus.password ? styles.ok : styles.bad]}>DEV_PASSWORD</Text>
        <Text style={[styles.envTag, envStatus.venue ? styles.ok : styles.warn]}>DEV_VENUE</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Password</Text>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onSignIn}>
        <Text style={styles.primaryText}>Sign In</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={goRegister}>
        <Text style={styles.secondaryText}>Register</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.devBtn} onPress={onDevLogin}>
        <Text style={styles.devText}>Dev Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, justifyContent: 'center', gap: 12 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  envRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 6 },
  envTag: { fontSize: 12, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, overflow: 'hidden', color: 'white' },
  ok: { backgroundColor: '#34C759' },
  warn: { backgroundColor: '#FFA500' },
  bad: { backgroundColor: '#FF3B30' },
  field: { gap: 6 },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  primaryBtn: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { fontWeight: '700' },
  devBtn: { backgroundColor: '#E5E7EB', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  devText: { fontWeight: '700' },
});
