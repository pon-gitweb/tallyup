import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from 'src/services/firebase';
import { useNavigation } from '@react-navigation/native';
import { DEV_DEFAULT_EMAIL, DEV_DEFAULT_PASSWORD } from 'src/config/devAuth';

function mapAuthError(e: any): string {
  const code = e?.code || '';
  if (code.includes('operation-not-allowed')) return 'Enable Email/Password in Firebase Console → Authentication → Sign-in method.';
  if (code.includes('invalid-credential')) return 'Invalid email or password for this project.';
  if (code.includes('user-not-found')) return 'No user with this email.';
  if (code.includes('wrong-password')) return 'Incorrect password.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Try again shortly.';
  return e?.message ?? 'Sign-in failed.';
}

export default function SignInScreen() {
  const nav = useNavigation();
  const [email, setEmail] = useState(DEV_DEFAULT_EMAIL);
  const [password, setPassword] = useState(DEV_DEFAULT_PASSWORD);
  const [busy, setBusy] = useState(false);

  const doSignIn = async (em: string, pw: string) => {
    try {
      setBusy(true);
      console.log('[SignIn] press', em);
      await signInWithEmailAndPassword(auth, em.trim(), pw);
      // Authed stack initial route is ExistingVenueDashboard
    } catch (e: any) {
      console.warn('[SignIn] error', e);
      Alert.alert('Sign-in failed', mapAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex:1, padding: 20, justifyContent:'center' }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>TallyUp</Text>

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth:1, borderColor:'#ccc', borderRadius:8, padding:12, marginBottom:12 }}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth:1, borderColor:'#ccc', borderRadius:8, padding:12, marginBottom:16 }}
      />

      <TouchableOpacity
        onPress={() => doSignIn(email, password)}
        disabled={busy}
        style={{ backgroundColor:'#2ecc71', padding:14, borderRadius:10, alignItems:'center', marginBottom:10 }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>{busy ? 'Signing in…' : 'Sign In'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => nav.navigate('Register' as never)}
        style={{ backgroundColor:'#0984e3', padding:14, borderRadius:10, alignItems:'center', marginBottom:10 }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Register</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => doSignIn(DEV_DEFAULT_EMAIL, DEV_DEFAULT_PASSWORD)}
        disabled={busy}
        style={{ backgroundColor:'#6c5ce7', padding:14, borderRadius:10, alignItems:'center' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>{busy ? 'Using test…' : 'Use Test Account'}</Text>
      </TouchableOpacity>

      <Text style={{ fontSize:12, color:'#888', marginTop:12 }}>
        Dev prefill is enabled. Change in src/config/devAuth.ts
      </Text>
    </View>
  );
}
