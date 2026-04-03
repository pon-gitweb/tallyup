// @ts-nocheck
/**
 * SupplierLoginScreen
 * Separate login for supplier accounts.
 * LOCKED — only accessible when FEATURES.SUPPLIER_PORTAL = true
 */
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function SupplierLoginScreen({ onLogin }: { onLogin: (supplierId: string) => void }) {
  const C = useColours();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Required', 'Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const auth = getAuth();
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const db = getFirestore();
      // Check if this user has a supplier account
      const snap = await getDoc(doc(db, 'supplierUsers', cred.user.uid));
      if (!snap.exists()) {
        await auth.signOut();
        Alert.alert('Not a supplier account', 'This account is not registered as a supplier. Please use the venue login instead.');
        return;
      }
      const supplierId = snap.data()?.supplierId;
      onLogin(supplierId);
    } catch (e: any) {
      Alert.alert('Login failed', e?.message || 'Please check your credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.background }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <View style={{ backgroundColor: C.primary, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontSize: 28, fontWeight: '900', color: '#fff' }}>Supplier Portal</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>Powered by Hosti-Stock</Text>
        </View>
        <TextInput value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address"
          autoCapitalize="none" style={{ backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, color: C.text }} />
        <TextInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry
          style={{ backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, color: C.text }} />
        <TouchableOpacity onPress={onSubmit} disabled={busy}
          style={{ backgroundColor: C.primary, borderRadius: 12, padding: 16, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{busy ? 'Signing in...' : 'Sign in as Supplier'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
export default withErrorBoundary(SupplierLoginScreen, 'SupplierLogin');
