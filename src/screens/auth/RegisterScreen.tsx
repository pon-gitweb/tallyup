import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';

function mapRegisterError(e: any): string {
  const code = (e?.code || '').toString();
  if (code.includes('email-already-in-use')) return 'That email address is already registered.';
  if (code.includes('invalid-email')) return 'Please enter a valid email address.';
  if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
  if (code.includes('operation-not-allowed')) return 'Email/Password sign-in is not enabled.';
  return e?.message ?? 'Registration failed. Please try again.';
}

export default function RegisterScreen() {
  const auth = getAuth();
  const colours = useColours();
  const { fontsLoaded } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const prefillEmail = route?.params?.prefillEmail;
  const { showError, showInfo } = useToast();

  const [email, setEmail] = useState(prefillEmail || '');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  const titleFont = fontsLoaded ? 'PlayfairDisplay_500Medium' : undefined;

  const onCreate = async () => {
    const em = email.trim();
    const pw = pass;

    if (!em || !pw) {
      showInfo('Enter your email and password.');
      return;
    }
    if (pw.length < 6) {
      showInfo('Password must be at least 6 characters.');
      return;
    }

    const AUTH_TIMEOUT = 15000; // bound the auth call itself — it has no built-in timeout

    setBusy(true);
    try {
      const authPromise = createUserWithEmailAndPassword(auth, em, pw);
      const authTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('auth-timeout')), AUTH_TIMEOUT)
      );
      const cred = await Promise.race([authPromise, authTimeoutPromise]);

      // Navigate immediately — never block on the Firestore write.
      // CreateVenueScreen ensures the user doc exists before creating the venue,
      // so a slow/failed write here is non-fatal; fire-and-forget it.
      setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
        venueId: null,
        activeVenueId: null,
        venueIds: [],
        requiresEmailVerification: true,
      }).catch((e: any) => {
        if (__DEV__) console.warn('[Register] user doc write failed:', e?.message);
      });

      // Send verification email — fire and forget.
      // If it fails, the user can resend from the verification screen.
      sendEmailVerification(cred.user).catch(e =>
        console.warn('[Register] verification email failed:', e?.message)
      );

      navigation.navigate('EmailVerification');
    } catch (e: any) {
      const code = e?.code || '';
      if (e?.message === 'auth-timeout') {
        showError('Connection is slow — please check your network and try again.');
      } else if (code === 'auth/email-already-in-use') {
        Alert.alert(
          'Account already exists',
          'An account with this email already exists. Would you like to sign in instead?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign in', onPress: () => navigation.navigate('Login', { prefillEmail: em }) },
          ]
        );
      } else if (e?.code) {
        showError(mapRegisterError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colours.background }}>
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

          {/* Heading block */}
          <View style={{ paddingTop: 32 }}>
            <Text style={{ fontSize: 42, fontWeight: '800', color: colours.text, letterSpacing: -0.5, lineHeight: 48, fontFamily: titleFont }}>
              Create your account.
            </Text>
            <Text style={{ fontSize: 15, color: colours.textSecondary, marginTop: 8, lineHeight: 22 }}>
              Get started in minutes.
            </Text>
          </View>

          {/* Form */}
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
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
            />

            <TextInput
              style={{
                height: 52,
                borderWidth: 1.5,
                borderColor: passFocused ? colours.stellarAmber : colours.border,
                borderRadius: 12,
                paddingHorizontal: 16,
                marginBottom: 4,
                backgroundColor: colours.surface,
                color: colours.text,
                fontSize: 15,
              }}
              placeholder="Password (min 6 characters)"
              placeholderTextColor={colours.textSecondary}
              secureTextEntry
              value={pass}
              onChangeText={setPass}
              onFocus={() => setPassFocused(true)}
              onBlur={() => setPassFocused(false)}
            />
          </View>

          {/* CTA pill */}
          <TouchableOpacity
            style={{
              height: 54, borderRadius: 999,
              backgroundColor: colours.missionSlate,
              alignItems: 'center', justifyContent: 'center',
              marginTop: 20,
              opacity: busy ? 0.6 : 1,
            }}
            onPress={onCreate}
            disabled={busy}
          >
            {busy
              ? <ActivityIndicator color={colours.oat} />
              : <Text style={{ color: colours.oat, fontWeight: '700', fontSize: 16 }}>Create account →</Text>}
          </TouchableOpacity>

          {/* Sign in link */}
          <TouchableOpacity
            style={{ alignItems: 'center', paddingVertical: 16 }}
            onPress={() => navigation.goBack()}
            disabled={busy}
          >
            <Text style={{ color: colours.textSecondary, fontSize: 14 }}>
              Already have an account?{' '}
              <Text style={{ color: colours.missionSlate, fontWeight: '600' }}>Sign in</Text>
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
