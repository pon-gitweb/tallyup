import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';

export default function RegisterScreen() {
  const auth = getAuth();
  const colours = useColours();
  const navigation = useNavigation<any>();

  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    const em = email.trim();
    const pw = pass;

    if (!em || !pw) {
      Alert.alert('Missing info', 'Enter email and password.');
      return;
    }

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, em, pw);
      await setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
        venueId: null,
        activeVenueId: null,
        venueIds: [],
      });
      navigation.navigate('CreateVenue');
    } catch (e: any) {
      Alert.alert('Registration failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const S = StyleSheet.create({
    container: { flex: 1, padding: 20, backgroundColor: colours.background, justifyContent: 'center' },
    title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center', color: colours.text },
    input: { borderWidth: 1, borderColor: colours.border, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: colours.surface, color: colours.text },
    primary: { backgroundColor: colours.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
    primaryText: { color: colours.primaryText, fontWeight: '700' },
    disabled: { opacity: 0.6 },
  });

  return (
    <View style={S.container}>
      <Text style={S.title}>Create your account</Text>

      <TextInput
        style={S.input}
        placeholder="Email"
        placeholderTextColor={colours.textSecondary}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        style={S.input}
        placeholder="Password"
        placeholderTextColor={colours.textSecondary}
        secureTextEntry
        value={pass}
        onChangeText={setPass}
      />

      <TouchableOpacity style={[S.primary, busy && S.disabled]} onPress={onCreate} disabled={busy}>
        {busy ? <ActivityIndicator color={colours.primaryText} /> : <Text style={S.primaryText}>Create Account</Text>}
      </TouchableOpacity>
    </View>
  );
}
