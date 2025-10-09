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
  // Attach the current user to the known dev venue (create missing docs if needed).
  const vref = doc(db, 'venues', DEV_VENUE_ID);
  const mref = doc(db, 'venues', DEV_VENUE_ID, 'members', uid);
  const uref = doc(db, 'users', uid);

  const vSnap = await getDoc(vref);
  if (!vSnap.exists()) {
    // Only minimal fields; we're attaching to an existing venue id you've been using
    await setDoc(vref, { venueId: DEV_VENUE_ID, name: 'TallyUp Dev Venue', createdAt: serverTimestamp(), dev: true }, { merge: true });
  }
  await setDoc(mref, { uid, role: 'owner', joinedAt: serverTimestamp(), dev: true }, { merge: true });
  await setDoc(uref, { uid, email: email ?? null, venueId: DEV_VENUE_ID, updatedAt: serverTimestamp() }, { merge: true });
}

function LoginScreenInner() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const venueId = useVenueId();

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  // Signed in + no venue => Auth.Setup (prod-oriented; dev flow handled explicitly below)
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
      // Providers will route; if this user has no venue, Setup screen will be shown.
    } catch (e:any) {
      Alert.alert('Sign-in failed', mapAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const doDevLogin = async () => {
    setBusy(true);
    try {
      const { email: em, password: pw } = await devLogin(); // test@example.com / test1234
      const cred = await signInWithEmailAndPassword(auth, em, pw);
      // Force attach to your dev venue id every time
      await attachToDevVenue(cred.user.uid, cred.user.email ?? em);
      Alert.alert('Dev Login', 'Attached to Dev Venue');
    } catch (e:any) {
      Alert.alert('Dev login failed', mapAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const gotoRegister = () => nav.navigate('Register');

  return (
    <View style={S.container}>
      <View style={S.inner}>
        <Text style={S.title}>Welcome to TallyUp</Text>

        <TextInput
          style={S.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <View style={S.passRow}>
          <TextInput
            style={[S.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Password"
            secureTextEntry={!reveal}
            value={pass}
            onChangeText={setPass}
          />
          <TouchableOpacity onPress={() => setReveal(v => !v)} style={S.revealBtn}>
            <Text style={{ fontWeight: '700' }}>{reveal ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[S.primary, busy && S.disabled]} onPress={trySignIn} disabled={busy}>
          {busy ? <ActivityIndicator /> : <Text style={S.primaryText}>Sign In</Text>}
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

// Error boundary wrapper
export default function LoginScreen() {
  return (
    <AppErrorBoundary>
      <LoginScreenInner />
    </AppErrorBoundary>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, padding: 20, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 10 },
  passRow: { flexDirection: 'row', alignItems: 'center' },
  revealBtn: { marginLeft: 8, paddingHorizontal: 10, paddingVertical: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 10 },
  primary: { backgroundColor: '#0A84FF', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#D1D5DB' },
  secondaryText: { color: '#111827', fontWeight: '700' },
  disabled: { opacity: 0.6 },
  ghost: { padding: 10, alignItems: 'center', marginTop: 12 },
  ghostText: { color: '#6B7280' },
  footer: { paddingHorizontal: 16, paddingBottom: 16 },
});
