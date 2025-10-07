import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { getAuth, signInWithEmailAndPassword, type UserCredential } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { devLogin } from '../../config/devAuth';

import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import LegalFooter from '../../components/LegalFooter';

// Standard project wrapper (no-op here to avoid imports shuffle)
const withErrorBoundary = (Comp: any) => Comp;

// Local dlog guard
const dlog = (...args: any[]) => { if (__DEV__) console.log(...args); };

function mapAuthError(e: any): string {
  const code = String(e?.code || '').toLowerCase();
  if (code.includes('operation-not-allowed')) return 'Email/Password is disabled for this project.';
  if (code.includes('invalid-credential') || code.includes('invalid-password')) return 'Incorrect email or password.';
  if (code.includes('user-not-found')) return 'No user with this email.';
  if (code.includes('wrong-password')) return 'Incorrect email or password.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Try again shortly.';
  if (String(e?.message || '').toLowerCase().includes('timeout')) return 'Network is slow. Please try again.';
  return 'Sign in failed. Please check your details and try again.';
}

async function hapticLight() {
  try {
    const Haptics = await import('expo-haptics');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {}
}

// Promise.race timeout guard (Firebase Auth has no native abort)
function signInWithTimeout(email: string, pass: string, ms = 15000): Promise<UserCredential> {
  const auth = getAuth();
  return Promise.race([
    signInWithEmailAndPassword(auth, email.trim(), pass),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]) as Promise<UserCredential>;
}

function LoginScreenInner() {
  const nav = useNavigation<any>();
  const net = useNetInfo();

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const passRef = useRef<TextInput>(null);
  const offline = useMemo(() => net.isConnected === false || net.isInternetReachable === false, [net.isConnected, net.isInternetReachable]);

  const handleSignIn = useCallback(async () => {
    if (busy) return; // throttle
    if (!email || !pass) {
      await hapticLight();
      Alert.alert('Required', 'Enter email and password.');
      return;
    }
    if (offline) {
      await hapticLight();
      Alert.alert('You’re offline', 'Reconnect to sign in.');
      return;
    }

    setBusy(true);
    const startedAt = Date.now();
    dlog('[TallyUp Login] signIn start', JSON.stringify({ email }));

    try {
      const cred = await signInWithTimeout(email, pass, 15000);
      const { user } = cred;
      dlog('[TallyUp Login] success', JSON.stringify({ uid: user?.uid }));
      Keyboard.dismiss();
      // Root navigator will swap to app phase automatically.
    } catch (e: any) {
      const msg = mapAuthError(e);
      dlog('[TallyUp Login] signIn error', JSON.stringify({ code: e?.code, message: e?.message, tookMs: Date.now() - startedAt }));
      await hapticLight();
      // Clear + refocus password
      setPass('');
      requestAnimationFrame(() => passRef.current?.focus());
      Alert.alert('Sign in failed', msg);
    } finally {
      setBusy(false);
    }
  }, [busy, email, pass, offline]);

  const handleDevLogin = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await devLogin();
      dlog('[TallyUp Login] devLogin ok', JSON.stringify(out));
      if (!offline) {
        const { email: em, password: pw } = out || {};
        if (em && pw) {
          const cred = await signInWithTimeout(String(em), String(pw), 15000);
          const { user } = cred;
          dlog('[TallyUp Login] success (dev)', JSON.stringify({ uid: user?.uid }));
        }
      } else {
        await hapticLight();
        Alert.alert('You’re offline', 'Reconnect to use the dev login.');
      }
    } catch (e: any) {
      dlog('[TallyUp Login] devLogin error', JSON.stringify({ message: e?.message }));
      await hapticLight();
      Alert.alert('Dev login failed', mapAuthError(e));
    } finally {
      setBusy(false);
    }
  }, [busy, offline]);

  const goRegister = useCallback(() => {
    if (busy) return;
    nav.navigate('Register');
  }, [busy, nav]);

  return (
    <LocalThemeGate>
      <View style={{ flex: 1, padding: 16, backgroundColor: '#0F1115', justifyContent: 'center' }}>
        <MaybeTText style={{ color: 'white', fontSize: 22, fontWeight: '700', marginBottom: 16 }}>
          Welcome to TallyUp
        </MaybeTText>

        <TextInput
          placeholder="Email"
          placeholderTextColor="#6B7787"
          autoCapitalize="none"
          keyboardType="email-address"
          returnKeyType="next"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={() => passRef.current?.focus()}
          style={{
            backgroundColor: '#171B22',
            color: 'white',
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#263142',
            marginBottom: 12,
          }}
          editable={!busy}
        />

        <View style={{ position: 'relative' }}>
          <TextInput
            ref={passRef}
            placeholder="Password"
            placeholderTextColor="#6B7787"
            secureTextEntry={!showPass}
            returnKeyType="done"
            onSubmitEditing={handleSignIn}
            value={pass}
            onChangeText={setPass}
            style={{
              backgroundColor: '#171B22',
              color: 'white',
              paddingHorizontal: 12,
              paddingVertical: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: '#263142',
              paddingRight: 64,
            }}
            editable={!busy}
          />
          <TouchableOpacity
            onPress={() => setShowPass(s => !s)}
            style={{ position: 'absolute', right: 8, top: 8, padding: 8 }}
            disabled={busy}
            accessibilityLabel={showPass ? 'Hide password' : 'Show password'}
          >
            <Text style={{ color: '#9CA3AF', fontWeight: '600' }}>{showPass ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={handleSignIn}
          disabled={busy || offline}
          style={{
            marginTop: 16,
            backgroundColor: (busy || offline) ? '#2B3442' : '#3B82F6',
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          {busy ? <ActivityIndicator /> :
            <Text style={{ color: 'white', fontWeight: '700' }}>{offline ? 'Offline' : 'Sign In'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={goRegister}
          disabled={busy}
          style={{
            marginTop: 12,
            backgroundColor: busy ? '#2B3442' : '#7C3AED',
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          {busy ? <ActivityIndicator /> : <Text style={{ color: 'white', fontWeight: '700' }}>Register</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleDevLogin}
          disabled={busy || offline}
          style={{
            marginTop: 12,
            backgroundColor: (busy || offline) ? '#2B3442' : '#10B981',
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          {busy ? <ActivityIndicator /> :
            <Text style={{ color: 'white', fontWeight: '700' }}>{offline ? 'Offline' : 'Dev Login'}</Text>}
        </TouchableOpacity>

        {offline && (
          <Text style={{ color: '#94A3B8', textAlign: 'center', marginTop: 10 }}>
            You’re offline — reconnect to sign in.
          </Text>
        )}

        <View style={{ marginTop: 28 }}>
          <LegalFooter />
        </View>
      </View>
    </LocalThemeGate>
  );
}

export default withErrorBoundary(LoginScreenInner);
