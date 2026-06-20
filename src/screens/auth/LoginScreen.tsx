import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import AppErrorBoundary from '../../components/AppErrorBoundary';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

function mapAuthError(e: any): string {
  const code = (e?.code || '').toString();
  if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'Email or password is incorrect.';
  if (code.includes('user-not-found')) return 'No account found for that email.';
  if (code.includes('email-already-in-use')) return 'That email is already registered.';
  if (code.includes('operation-not-allowed')) return 'Email/Password sign-in is not enabled in Firebase.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please try again later.';
  return e?.message ?? 'An error occurred.';
}

function LoginScreenInner() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const venueId = useVenueId();
  const colours = useColours();
  const { fontsLoaded } = useTheme();
  const { showError, showInfo } = useToast();
  const { modal } = useConfirmModal();

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

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
      showInfo('Enter email and password.');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (e: any) {
      showError(mapAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const gotoRegister = () => nav.navigate('Register');

  const titleFont = fontsLoaded ? 'PlayfairDisplay_500Medium' : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colours.background }}>
      {modal}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, paddingBottom: 80 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Wordmark */}
          <View style={{ paddingTop: 64 }}>
            <Text style={{ fontSize: 36, letterSpacing: -0.5, fontFamily: titleFont }}>
              <Text style={{ color: colours.stellarAmber }}>H</Text>
              <Text style={{ color: colours.missionSlate }}>osti</Text>
            </Text>
          </View>

          {/* Welcome block */}
          <View style={{ paddingTop: 32 }}>
            <Text style={{ fontSize: 42, fontWeight: '800', color: colours.text, letterSpacing: -0.5, lineHeight: 48, fontFamily: titleFont }}>
              Welcome back.
            </Text>
            <Text style={{ fontSize: 15, color: colours.textSecondary, marginTop: 8, lineHeight: 22 }}>
              Know your stock. Know your numbers.
            </Text>
          </View>

          {/* Form block */}
          <View style={{ marginTop: 36 }}>
            <TextInput
              style={{
                height: 52,
                borderWidth: 1.5,
                borderColor: emailFocused ? colours.stellarAmber : colours.border,
                borderRadius: 12,
                paddingHorizontal: 16,
                marginBottom: 12,
                backgroundColor: colours.surface,
                color: colours.text,
                fontSize: 15,
              }}
              placeholder="Email"
              placeholderTextColor={colours.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <TextInput
                style={{
                  flex: 1,
                  height: 52,
                  borderWidth: 1.5,
                  borderColor: passFocused ? colours.stellarAmber : colours.border,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  backgroundColor: colours.surface,
                  color: colours.text,
                  fontSize: 15,
                }}
                placeholder="Password"
                placeholderTextColor={colours.textSecondary}
                secureTextEntry={!reveal}
                value={pass}
                onChangeText={setPass}
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
              />
              <TouchableOpacity
                onPress={() => setReveal(v => !v)}
                style={{ marginLeft: 10, height: 52, paddingHorizontal: 14, borderWidth: 1.5, borderColor: colours.border, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '700', color: colours.text, fontSize: 13 }}>{reveal ? 'Hide' : 'Show'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={{ alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 4 }} onPress={() => nav.navigate('ForgotPassword')} disabled={busy}>
              <Text style={{ color: colours.stellarAmber, fontSize: 13, fontWeight: '600' }}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Sign in pill */}
          <TouchableOpacity
            style={{ height: 54, borderRadius: 999, backgroundColor: colours.missionSlate, alignItems: 'center', justifyContent: 'center', marginTop: 8, opacity: busy ? 0.6 : 1 }}
            onPress={trySignIn}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color={colours.oat} />
              : <Text style={{ color: colours.oat, fontWeight: '700', fontSize: 16 }}>Sign in →</Text>}
          </TouchableOpacity>

          {/* Register link */}
          <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 16 }} onPress={gotoRegister} disabled={busy}>
            <Text style={{ color: colours.textSecondary, fontSize: 14 }}>
              Don't have an account?{' '}
              <Text style={{ color: colours.missionSlate, fontWeight: '600' }}>Create one</Text>
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Footer */}
      <View style={{ position: 'absolute', bottom: 32, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: colours.oatMuted }}>© 2026 Hosti Limited · Tāmaki Makaurau</Text>
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
