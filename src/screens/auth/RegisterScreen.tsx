import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from 'src/services/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigation } from '@react-navigation/native';

export default function RegisterScreen() {
  const nav = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onRegister = async () => {
    try {
      setBusy(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
      }, { merge: true });
      // Go straight to venue setup path
      nav.reset({ index: 0, routes: [{ name: 'CreateVenueDashboard' as never }] });
    } catch (e: any) {
      console.warn('[Register] error', e);
      Alert.alert('Registration failed', e?.message ?? 'Please try a different email/password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex:1, padding: 20, justifyContent:'center' }}>
      <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>Create your account</Text>
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
        onPress={onRegister}
        disabled={busy}
        style={{ backgroundColor:'#6c5ce7', padding:14, borderRadius:10, alignItems:'center' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>{busy ? 'Registering…' : 'Register'}</Text>
      </TouchableOpacity>
    </View>
  );
}
