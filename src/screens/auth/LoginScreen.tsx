import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { devLogin } from '../../config/devAuth';

// V2 theme (flag-guarded)
import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import LegalFooter from '../../components/LegalFooter';

export default function LoginScreen() {
  const nav = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    if (!email || !pass) {
      Alert.alert('Required', 'Enter email and password.');
      return;
    }
    setBusy(true);
    try {
      const { user } = await signInWithEmailAndPassword(getAuth(), email.trim(), pass);
      console.log('[TallyUp Login] success', JSON.stringify({ uid: user.uid }));
    } catch (e: any) {
      console.log('[TallyUp Login] signIn error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Sign in failed', e?.message || 'Check your credentials.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDevLogin() {
    setBusy(true);
    try {
      const out = await devLogin();
      console.log('[TallyUp Login] devLogin ok', JSON.stringify(out));
    } catch (e: any) {
      console.log('[TallyUp Login] devLogin error', JSON.stringify({ message: e?.message }));
      Alert.alert('Dev login failed', e?.message || 'Could not sign in to the dev account.');
    } finally {
      setBusy(false);
    }
  }

  function goRegister() {
    nav.navigate('Register');
  }

  return (
    <LocalThemeGate>
      <View style={{ flex: 1, padding: 16, backgroundColor: '#0F1115', justifyContent: 'center' }}>
        {/* Title swaps to MaybeTText when flag is ON; otherwise remains RN Text */}
        <MaybeTText style={{ color: 'white', fontSize: 22, fontWeight: '700', marginBottom: 16 }}>
          Welcome to TallyUp
        </MaybeTText>

        <TextInput
          placeholder="Email"
          placeholderTextColor="#6B7787"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
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
        <TextInput
          placeholder="Password"
          placeholderTextColor="#6B7787"
          secureTextEntry
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
          }}
          editable={!busy}
        />

        <TouchableOpacity
          onPress={handleSignIn}
          disabled={busy}
          style={{
            marginTop: 16,
            backgroundColor: busy ? '#2B3442' : '#3B82F6',
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          {busy ? <ActivityIndicator /> : <Text style={{ color: 'white', fontWeight: '700' }}>Sign In</Text>}
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
          disabled={busy}
          style={{
            marginTop: 12,
            backgroundColor: busy ? '#2B3442' : '#10B981',
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          {busy ? <ActivityIndicator /> : <Text style={{ color: 'white', fontWeight: '700' }}>Dev Login</Text>}
        </TouchableOpacity>

        {/* Legal footer (no visual change while flag is OFF) */}
        <View style={{ marginTop: 28 }}>
          <LegalFooter />
        </View>
      </View>
    </LocalThemeGate>
  );
}
