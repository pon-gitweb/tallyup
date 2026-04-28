import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { devLogin } from '../../config/devAuth';
import LegalFooter from '../../components/LegalFooter';
import { useVenueId } from '../../context/VenueProvider';
import AppErrorBoundary from '../../components/AppErrorBoundary';
import { db } from '../../services/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { DEV_VENUE_ID } from '../../config/devVenue';
import { useColours } from '../../context/ThemeContext';

function mapAuthError(e: any): string {
  const code = (e?.code || '').toString();
  if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'Email or password is incorrect.';
  if (code.includes('user-not-found')) return 'No account found for that email.';
  if (code.includes('email-already-in-use')) return 'That email is already registered.';
  if (code.includes('operation-not-allowed')) return 'Email/Password sign-in is not enabled in Firebase.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please try again later.';
  return e?.message ?? 'An error occurred.';
}

async function attachToDevVenue(uid: string, email: string | null) {
  const vref = doc(db, 'venues', DEV_VENUE_ID);
  const mref = doc(db, 'venues', DEV_VENUE_ID, 'members', uid);
  const uref = doc(db, 'users', uid);

  const vSnap = await getDoc(vref);
  if (!vSnap.exists()) {
    await setDoc(vref, { venueId: DEV_VENUE_ID, name: 'TallyUp Dev Venue', createdAt: serverTimestamp(), dev: true }, { merge: true });
  }
  await setDoc(mref, { uid, role: 'owner', joinedAt: serverTimestamp(), dev: true }, { merge: true });
  await setDoc(uref, { uid, email: email ?? null, venueId: DEV_VENUE_ID, updatedAt: serverTimestamp() }, { merge: true });
}

function LoginScreenInner() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const venueId = useVenueId();
  const colours = useColours();

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) return;
      if (!venueId) {
        nav.navigate('Setup');
      }
    });
    return () => unsub();
  }, [auth, nav, venueId]);

  const trySignIn = async () => {
    if (!email.trim() || !pass) {
      Alert.alert('Missing info', 'Enter email and password.');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (e: any) {
      Alert.alert('Sign-in failed', mapAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const doDevLogin = async () => {
    setBusy(true);
    try {
      const { email: em, password: pw } = await devLogin();
      const cred = await signInWithEmailAndPassword(auth, em, pw);
      await attachToDevVenue(cred.user.uid, cred.user.email ?? em);
      Alert.alert('Dev Login', 'Attached to Dev Venue');
    } catch (e: any) {
      Alert.alert('Dev login failed', mapAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const gotoRegister = () => nav.navigate('Register');

  const S = StyleSheet.create({
    container: { flex: 1, backgroundColor: colours.background },
    inner: { flex: 1, padding: 20, justifyContent: 'center' },
    title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center', color: colours.text },
    input: { borderWidth: 1, borderColor: colours.border, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: colours.surface, color: colours.text },
    passRow: { flexDirection: 'row', alignItems: 'center' },
    revealBtn: { marginLeft: 8, paddingHorizontal: 10, paddingVertical: 12, borderWidth: 1, borderColor: colours.border, borderRadius: 10 },
    revealText: { fontWeight: '700', color: colours.text },
    primary: { backgroundColor: colours.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
    primaryText: { color: colours.primaryText, fontWeight: '700' },
    secondary: { padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: colours.border },
    secondaryText: { color: colours.text, fontWeight: '700' },
    disabled: { opacity: 0.6 },
    ghost: { padding: 10, alignItems: 'center', marginTop: 12 },
    ghostText: { color: colours.textSecondary },
    footer: { paddingHorizontal: 16, paddingBottom: 16 },
  });

  return (
    <View style={S.container}>
      <View style={S.inner}>
        <Text style={S.title}>Welcome to Hosti-Stock</Text>

        <TextInput
          style={S.input}
          placeholder="Email"
          placeholderTextColor={colours.textSecondary}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <View style={S.passRow}>
          <TextInput
            style={[S.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Password"
            placeholderTextColor={colours.textSecondary}
            secureTextEntry={!reveal}
            value={pass}
            onChangeText={setPass}
          />
          <TouchableOpacity onPress={() => setReveal(v => !v)} style={S.revealBtn}>
            <Text style={S.revealText}>{reveal ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[S.primary, busy && S.disabled]} onPress={trySignIn} disabled={busy}>
          {busy ? <ActivityIndicator color={colours.primaryText} /> : <Text style={S.primaryText}>Sign In</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={S.secondary} onPress={gotoRegister} disabled={busy}>
          <Text style={S.secondaryText}>Create Account</Text>
        </TouchableOpacity>

        <TouchableOpacity style={S.ghost} onPress={doDevLogin} disabled={busy}>
          <Text style={S.ghostText}>Dev Login</Text>
        </TouchableOpacity>
      </View>

      <View style={S.footer}>
        <LegalFooter />
      </View>
    </View>
  );
}

export default function LoginScreen() {
  return (
    <AppErrorBoundary>
      <LoginScreenInner />
    </AppErrorBoundary>
  );
}
