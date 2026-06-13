// TODO: 2FA via Firebase Phone Auth
// Requires Blaze plan SMS quota
// and reCAPTCHA configuration
// Implement post-pilot

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

export default function ForgotPasswordScreen() {
  const nav = useNavigation<any>();
  const auth = getAuth();
  const colours = useColours();
  const { showSuccess, showError, showInfo } = useToast();
  const { modal } = useConfirmModal();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    const trimmed = email.trim();
    if (!trimmed) {
      showInfo('Please enter your email address.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setSent(true);
      showSuccess('✓ Reset email sent.');
    } catch (e: any) {
      const code = (e?.code || '').toString();
      if (code.includes('user-not-found') || code.includes('invalid-email')) {
        showError('No account found for that email address.');
      } else if (code.includes('too-many-requests')) {
        showError('Too many attempts. Please try again later.');
      } else {
        showError(e?.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const S = StyleSheet.create({
    container:   { flex: 1, backgroundColor: colours.background },
    scroll:      { flexGrow: 1, padding: 24, paddingTop: 48 },
    heading:     { fontSize: 26, fontWeight: '700', color: colours.navy, marginBottom: 8 },
    sub:         { fontSize: 15, color: colours.textSecondary, lineHeight: 22, marginBottom: 32 },
    input:       { borderWidth: 1, borderColor: colours.border, borderRadius: 10, padding: 12, marginBottom: 8, backgroundColor: colours.surface, color: colours.text, fontSize: 15 },
    primary:     { backgroundColor: colours.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
    primaryText: { color: colours.primaryText, fontWeight: '700', fontSize: 15 },
    disabled:    { opacity: 0.6 },
    backLink:    { marginTop: 20, alignItems: 'center' },
    backText:    { color: colours.textSecondary, fontSize: 14 },
    successBox:  { backgroundColor: colours.positiveSoft, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: colours.success + '40' },
    successTitle:{ fontSize: 18, fontWeight: '700', color: colours.success, marginBottom: 8 },
    successBody: { fontSize: 15, color: colours.success, lineHeight: 22 },
    doneBtn:     { backgroundColor: colours.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 20 },
    doneBtnText: { color: colours.primaryText, fontWeight: '700', fontSize: 15 },
  });

  return (
    <KeyboardAvoidingView
      style={S.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {modal}
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {sent ? (
          <View style={S.successBox}>
            <Text style={S.successTitle}>Check your inbox</Text>
            <Text style={S.successBody}>
              Reset email sent to {email.trim()}.{'\n\n'}
              Follow the link in the email to set a new password. Check your spam folder if it doesn't arrive within a minute.
            </Text>
            <TouchableOpacity style={S.doneBtn} onPress={() => nav.goBack()}>
              <Text style={S.doneBtnText}>Back to sign in</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={S.heading}>Reset password</Text>
            <Text style={S.sub}>
              Enter the email address linked to your account and we'll send you a reset link.
            </Text>

            <TextInput
              style={S.input}
              placeholder="Email address"
              placeholderTextColor={colours.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={handleSend}
              returnKeyType="send"
            />

            <TouchableOpacity
              style={[S.primary, (busy || !email.trim()) && S.disabled]}
              onPress={handleSend}
              disabled={busy || !email.trim()}
            >
              {busy
                ? <ActivityIndicator color={colours.primaryText} />
                : <Text style={S.primaryText}>Send reset email</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={S.backLink} onPress={() => nav.goBack()}>
              <Text style={S.backText}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}
