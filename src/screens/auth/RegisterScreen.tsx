import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useNavigation } from '@react-navigation/native';
import { useColours, useTheme } from '../../context/ThemeContext';

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

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);

  const titleFont = fontsLoaded ? 'PlayfairDisplay_500Medium' : undefined;

  const onCreate = async () => {
    const em = email.trim();
    const pw = pass;

    if (!em || !pw) {
      Alert.alert('Missing info', 'Enter email and password.');
      return;
    }
    if (pw.length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, em, pw);

      // Write the user doc, but don't block navigation on it.
      // If the write is slow or fails, CreateVenueScreen re-creates it anyway.
      const writePromise = setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
        venueId: null,
        activeVenueId: null,
        venueIds: [],
      });
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Write timed out')), 10000)
      );

      try {
        await Promise.race([writePromise, timeoutPromise]);
      } catch {
        // Write timed out or failed — navigate anyway.
        // CreateVenueScreen will ensure the user doc exists before creating the venue.
      }

      navigation.navigate('CreateVenue');
    } catch (e: any) {
      if (e?.code) {
        // Firebase auth error — show to user
        Alert.alert('Registration failed', mapRegisterError(e));
      }
      // else: navigate already happened (timeout path) or this is an unreachable catch
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
