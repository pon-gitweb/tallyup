// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { db } from '../../services/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useColours } from '../../context/ThemeContext';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff Member',
};

type InviteDetails = {
  email: string;
  role: string;
  venueName: string;
  status: string;
};

export default function AcceptInviteScreen() {
  const colours = useColours();
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, inviteId } = (route.params || {}) as { venueId: string; inviteId: string };

  const auth = getAuth();
  const [user, setUser] = useState(auth.currentUser);

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Auth form state (shown when not signed in)
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  // Track auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // Load invite details
  useEffect(() => {
    if (!venueId || !inviteId) {
      setInviteError('Invalid invite link.');
      setLoadingInvite(false);
      return;
    }
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        const venueName = (venueSnap.data() as any)?.name || 'your venue';

        const inviteSnap = await getDoc(doc(db, 'venues', venueId, 'invites', inviteId));
        if (!inviteSnap.exists()) {
          setInviteError('This invite link is invalid or has already been used.');
          setLoadingInvite(false);
          return;
        }
        const data = inviteSnap.data() as any;
        if (data.status === 'accepted') {
          setInviteError('This invite has already been accepted.');
          setLoadingInvite(false);
          return;
        }
        if (data.status === 'expired') {
          setInviteError('This invite has expired. Ask your manager to send a new invite.');
          setLoadingInvite(false);
          return;
        }

        setInvite({
          email: data.email || '',
          role: data.role || 'staff',
          venueName,
          status: data.status,
        });
        // Pre-fill auth email
        if (data.email) setEmail(data.email);
      } catch (e: any) {
        setInviteError('Could not load invite. Please try again.');
      } finally {
        setLoadingInvite(false);
      }
    })();
  }, [venueId, inviteId]);

  const doAuth = async () => {
    const em = email.trim().toLowerCase();
    if (!em || !password) {
      Alert.alert('Missing info', 'Enter email and password.');
      return;
    }
    setAuthBusy(true);
    try {
      if (authMode === 'signin') {
        await signInWithEmailAndPassword(auth, em, password);
      } else {
        await createUserWithEmailAndPassword(auth, em, password);
      }
      // auth state change will update user state → AcceptInvite button appears
    } catch (e: any) {
      const code = e?.code || '';
      let msg = e?.message || 'Authentication failed.';
      if (code.includes('wrong-password') || code.includes('invalid-credential')) msg = 'Incorrect email or password.';
      if (code.includes('user-not-found')) msg = 'No account found. Try creating one.';
      if (code.includes('email-already-in-use')) msg = 'An account with this email already exists. Sign in instead.';
      if (code.includes('weak-password')) msg = 'Password must be at least 6 characters.';
      Alert.alert('Error', msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const doAccept = async () => {
    if (!user) return;
    setAccepting(true);
    try {
      const functions = getFunctions();
      const acceptInvite = httpsCallable(functions, 'acceptInviteCallable');
      const result = await acceptInvite({ venueId, inviteId });
      const data = result.data as any;
      if (!data?.ok) throw new Error('Accept failed');
      setAccepted(true);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('different email')) {
        Alert.alert(
          'Wrong account',
          `This invite was sent to ${invite?.email}. Please sign in with that email address.`
        );
      } else if (msg.includes('expired')) {
        Alert.alert('Invite expired', 'This invite has expired. Ask your manager to send a new one.');
      } else {
        Alert.alert('Could not accept invite', msg);
      }
    } finally {
      setAccepting(false);
    }
  };

  const S = makeStyles(colours);

  if (loadingInvite) {
    return (
      <View style={S.center}>
        <ActivityIndicator color={colours.primary} size="large" />
        <Text style={{ color: colours.textSecondary, marginTop: 12 }}>Loading invite…</Text>
      </View>
    );
  }

  if (inviteError) {
    return (
      <View style={S.center}>
        <Text style={{ fontSize: 40, marginBottom: 12 }}>🔗</Text>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colours.text, textAlign: 'center', marginBottom: 8 }}>
          Invalid invite
        </Text>
        <Text style={{ color: colours.textSecondary, textAlign: 'center', paddingHorizontal: 32 }}>
          {inviteError}
        </Text>
        <TouchableOpacity
          style={[S.btn, { marginTop: 24 }]}
          onPress={() => nav.navigate('Dashboard')}
        >
          <Text style={S.btnText}>Go to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (accepted) {
    return (
      <View style={S.center}>
        <Text style={{ fontSize: 48, marginBottom: 12 }}>🎉</Text>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colours.text, marginBottom: 8 }}>
          Welcome to {invite?.venueName}!
        </Text>
        <Text style={{ color: colours.textSecondary, textAlign: 'center', paddingHorizontal: 32 }}>
          You've joined as {ROLE_LABELS[invite?.role] || invite?.role}. Your venue is now loading.
        </Text>
        <ActivityIndicator color={colours.primary} style={{ marginTop: 24 }} />
        <Text style={{ color: colours.textSecondary, fontSize: 12, marginTop: 8 }}>Setting up your account…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colours.background }} contentContainerStyle={{ padding: 24 }}>
      {/* Invite summary card */}
      <View style={S.card}>
        <Text style={{ fontSize: 13, color: colours.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          You've been invited
        </Text>
        <Text style={{ fontSize: 22, fontWeight: '900', color: colours.text, marginTop: 4 }}>
          {invite?.venueName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <View style={S.rolePill}>
            <Text style={S.rolePillText}>{ROLE_LABELS[invite?.role] || invite?.role}</Text>
          </View>
          {invite?.email ? (
            <Text style={{ color: colours.textSecondary, fontSize: 13 }}>→ {invite.email}</Text>
          ) : null}
        </View>
      </View>

      {!user ? (
        /* Not signed in — show auth form */
        <View style={{ marginTop: 24 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colours.text, marginBottom: 16 }}>
            {authMode === 'signin' ? 'Sign in to accept' : 'Create account to accept'}
          </Text>

          <TextInput
            style={S.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colours.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[S.input, { marginTop: 10 }]}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colours.textSecondary}
            secureTextEntry
          />

          <TouchableOpacity
            style={[S.btn, { marginTop: 16 }, authBusy && S.btnDisabled]}
            onPress={doAuth}
            disabled={authBusy}
          >
            {authBusy ? <ActivityIndicator color="#fff" /> : (
              <Text style={S.btnText}>
                {authMode === 'signin' ? 'Sign in' : 'Create account'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={{ marginTop: 12, alignItems: 'center' }}
            onPress={() => setAuthMode(authMode === 'signin' ? 'register' : 'signin')}
          >
            <Text style={{ color: colours.primary, fontWeight: '700' }}>
              {authMode === 'signin'
                ? "Don't have an account? Create one"
                : 'Already have an account? Sign in'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* Signed in — show accept button */
        <View style={{ marginTop: 24 }}>
          <Text style={{ color: colours.textSecondary, fontSize: 14, marginBottom: 20, textAlign: 'center' }}>
            Signed in as <Text style={{ fontWeight: '700', color: colours.text }}>{user.email}</Text>
          </Text>

          <TouchableOpacity
            style={[S.btn, accepting && S.btnDisabled]}
            onPress={doAccept}
            disabled={accepting}
          >
            {accepting ? <ActivityIndicator color="#fff" /> : (
              <Text style={S.btnText}>Accept Invite & Join {invite?.venueName}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={{ marginTop: 12, alignItems: 'center' }}
            onPress={() => auth.signOut()}
          >
            <Text style={{ color: colours.textSecondary, fontSize: 13 }}>Sign out and use a different account</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, padding: 24 },
    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    rolePill: {
      backgroundColor: c.primary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
    },
    rolePillText: { color: c.primaryText, fontWeight: '800', fontSize: 13 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      padding: 14,
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
    },
    btn: {
      backgroundColor: c.primary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnText: { color: c.primaryText, fontWeight: '800', fontSize: 16 },
    btnDisabled: { opacity: 0.6 },
  });
}
