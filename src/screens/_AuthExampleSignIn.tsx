import React, { useState } from 'react';
import { View, TextInput, Button, Alert } from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from 'src/services/firebase';

export default function AuthExampleSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    try {
      setBusy(true);
      console.log('[SignIn] press', email);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // AuthGate will route automatically
    } catch (e: any) {
      console.warn('[SignIn] error', e);
      Alert.alert('Sign-in failed', e?.message ?? 'Check email/password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ padding: 16 }}>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail}
        autoCapitalize="none" keyboardType="email-address"
        style={{ borderWidth:1, marginBottom:12, padding:10 }} />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword}
        secureTextEntry style={{ borderWidth:1, marginBottom:12, padding:10 }} />
      <Button title={busy ? 'Signing in…' : 'Sign In'} onPress={onSignIn} disabled={busy} />
    </View>
  );
}
