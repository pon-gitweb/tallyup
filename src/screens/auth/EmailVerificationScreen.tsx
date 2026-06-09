import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getAuth, sendEmailVerification, reload } from 'firebase/auth';
import { useColours, useTheme } from '../../context/ThemeContext';

export default function EmailVerificationScreen({ navigation }: any) {
  const c = useColours();
  const { theme } = useTheme();
  const auth = getAuth();
  const user = auth.currentUser;
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mask email: marcus@harbourside.co.nz → ma***@harbourside.co.nz
  const maskedEmail = user?.email
    ? user.email.replace(/(.{2})(.*)(@.*)/, (_, a, _b, c) => `${a}***${c}`)
    : 'your email';

  const handleCheckVerification = async () => {
    setChecking(true);
    setError(null);
    try {
      await reload(user!);
      const refreshed = auth.currentUser;
      if (refreshed?.emailVerified) {
        navigation.replace('CreateVenue');
      } else {
        setError('Not verified yet. Check your inbox and tap the link first.');
      }
    } catch (e: any) {
      setError('Could not check status. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    try {
      await sendEmailVerification(user!);
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } catch (e: any) {
      setError('Could not resend. Please wait a moment and try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: c.oat || '#f5f3ee' }]}>

      {/* Wordmark */}
      <View style={styles.wordmark}>
        <Text style={[styles.wordmarkH, { color: c.stellarAmber || '#c47b2b', fontFamily: theme.fontTitle }]}>
          H
        </Text>
        <Text style={[styles.wordmarkOsti, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitle }]}>
          osti
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: '#ffffff' }]}>

        <Text style={styles.icon}>📬</Text>

        <Text style={[styles.title, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitle }]}>
          Check your inbox
        </Text>

        <Text style={[styles.subtitle, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          We sent a verification link to{'\n'}
          <Text style={{ fontFamily: theme.fontBodySemiBold, color: c.missionSlate || '#3b3f4a' }}>
            {maskedEmail}
          </Text>
        </Text>

        <Text style={[styles.instruction, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
          Tap the link in the email then come back here.
        </Text>

        {error && (
          <Text style={[styles.error, { fontFamily: theme.fontBody }]}>
            {error}
          </Text>
        )}

        {resent && (
          <Text style={[styles.resent, { fontFamily: theme.fontBody }]}>
            ✓ Email resent
          </Text>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: c.deepBlue || '#1b4f72' }]}
          onPress={handleCheckVerification}
          disabled={checking}
        >
          {checking
            ? <ActivityIndicator color="#ffffff" />
            : <Text style={[styles.primaryBtnText, { fontFamily: theme.fontBodySemiBold }]}>
                ✓ I've verified my email
              </Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleResend}
          disabled={resending}
        >
          <Text style={[styles.secondaryBtnText, { color: c.deepBlue || '#1b4f72', fontFamily: theme.fontBody }]}>
            {resending ? 'Sending...' : 'Resend email'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            auth.signOut();
            navigation.replace('Register');
          }}
        >
          <Text style={[styles.secondaryBtnText, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            Wrong email? Start over
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.footer, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
        © {new Date().getFullYear()} Hosti
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  wordmark: {
    flexDirection: 'row',
    marginBottom: 32,
  },
  wordmarkH: { fontSize: 36 },
  wordmarkOsti: { fontSize: 36 },
  card: {
    width: '100%',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  instruction: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  error: {
    color: '#c0392b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  resent: {
    color: '#2d6a4f',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  primaryBtn: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  secondaryBtnText: {
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    fontSize: 12,
    marginTop: 24,
  },
});
