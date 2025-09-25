import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { signInEmail, registerEmail } from '../../services/auth';
import { ensureDevMembership } from '../../services/devBootstrap';
import { DEV_EMAIL, DEV_PASSWORD } from '../../config/dev';

type Tab = 'signin' | 'register' | 'dev';

export default function AuthEntryScreen() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('dev'); // default to Dev for MVP demos
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const requireFields = () => {
    if (!email.trim()) { Alert.alert('Missing email', 'Please enter your email.'); return false; }
    if (!password) { Alert.alert('Missing password', 'Please enter your password.'); return false; }
    return true;
  };

  const onSignIn = async () => {
    if (!requireFields()) return;
    try {
      await signInEmail(email, password);
      nav.reset({ index: 0, routes: [{ name: 'ExistingVenueDashboard' }] });
    } catch (e: any) {
      Alert.alert('Sign In Failed', e?.message ?? 'Unknown error');
    }
  };

  const onRegister = async () => {
    if (!requireFields()) return;
    try {
      await registerEmail(email, password);
      nav.reset({ index: 0, routes: [{ name: 'OnboardingCreateVenue' }] });
    } catch (e: any) {
      Alert.alert('Register Failed', e?.message ?? 'Unknown error');
    }
  };

  const onDevLogin = async () => {
    try {
      await signInEmail(DEV_EMAIL, DEV_PASSWORD);
      const { venueId } = await ensureDevMembership();
      nav.reset({ index: 0, routes: [{ name: 'ExistingVenueDashboard', params: { venueId } }] });
    } catch (e: any) {
      Alert.alert('Dev Login Failed', e?.message ?? 'Unknown error');
    }
  };

  return (
    <View style={S.container}>
      <Text style={S.title}>Welcome to TallyUp</Text>
      <View style={S.tabs}>
        <TouchableOpacity onPress={() => setTab('signin')} style={[S.tab, tab === 'signin' && S.tabActive]}><Text>Sign In</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('register')} style={[S.tab, tab === 'register' && S.tabActive]}><Text>Register</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('dev')} style={[S.tab, tab === 'dev' && S.tabActive]}><Text>Dev Login</Text></TouchableOpacity>
      </View>

      {tab !== 'dev' && (
        <>
          <TextInput style={S.input} placeholder="Email" autoCapitalize="none" value={email} onChangeText={setEmail} />
          <TextInput style={S.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
          <TouchableOpacity style={S.primary} onPress={tab === 'signin' ? onSignIn : onRegister}>
            <Text style={S.primaryText}>{tab === 'signin' ? 'Sign In' : 'Register'}</Text>
          </TouchableOpacity>
        </>
      )}

      {tab === 'dev' && (
        <View style={{ width: '100%' }}>
          <Text style={{ marginBottom: 8 }}>Use the pinned dev account for quick testing:</Text>
          <Text style={{ marginBottom: 12, color: '#555' }}>{DEV_EMAIL} / {DEV_PASSWORD}</Text>
          <TouchableOpacity style={S.primary} onPress={onDevLogin}>
            <Text style={S.primaryText}>Dev Login</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  tabs: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  tab: { flex: 1, alignItems: 'center', padding: 10, borderWidth: 1, borderColor: '#ddd' },
  tabActive: { backgroundColor: '#F3F4F6' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 10 },
  primary: { backgroundColor: '#0A84FF', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700' },
});
