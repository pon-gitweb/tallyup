import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { ensureDevMembership, ensureActiveSession } from '../../services/devBootstrap';
import { getDocs, getDoc } from 'firebase/firestore';
import { departmentsCol, areasCol, sessionDoc } from '../../services/paths';

type SessionStatus = 'idle' | 'active';

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(true);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [hasProgress, setHasProgress] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    (async () => {
      if (!user) { setBusy(false); return; }
      try {
        setBusy(true);
        const { venueId: v } = await ensureDevMembership();
        setVenueId(v);

        // session status
        const sSnap = await getDoc(sessionDoc(v, 'current'));
        setSessionStatus((sSnap.exists() ? (sSnap.data() as any)?.status : 'idle') || 'idle');

        // real progress: any area with startedAt or completedAt
        const dSnap = await getDocs(departmentsCol(v));
        let progress = false;
        for (const d of dSnap.docs) {
          const aSnap = await getDocs(areasCol(v, d.id));
          for (const a of aSnap.docs) {
            const data = a.data() as any;
            if (data?.startedAt || data?.completedAt) { progress = true; break; }
          }
          if (progress) break;
        }
        setHasProgress(progress);
      } catch (e: any) {
        Alert.alert('Setup error', e?.message ?? 'Unknown error');
      } finally {
        setBusy(false);
      }
    })();
  }, [user]);

  const primaryLabel = useMemo(() => {
    if (sessionStatus === 'active' && hasProgress) return 'Return to Active Stock Take';
    return 'Start Stock Take';
  }, [sessionStatus, hasProgress]);

  const onPrimary = async () => {
    if (!venueId) {
      Alert.alert('No Venue', 'Could not determine venue for this user.');
      return;
    }
    try {
      setBusy(true);
      const sessionId = await ensureActiveSession(venueId); // allowed by rules
      // Do NOT write to sessions/current here; navigate only.
      nav.navigate('DepartmentSelection', { venueId, sessionId });
    } catch (e: any) {
      Alert.alert('Session error', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.container}>
      <Text style={S.title}>TallyUp</Text>
      {busy ? (
        <ActivityIndicator />
      ) : (
        <View style={S.buttons}>
          <TouchableOpacity style={S.buttonPrimary} onPress={onPrimary}>
            <Text style={S.buttonText}>{primaryLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.button} onPress={() => nav.navigate('Settings')}>
            <Text style={S.buttonText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.button} onPress={() => nav.navigate('Reports')}>
            <Text style={S.buttonText}>Reports</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 24, textAlign: 'center' },
  buttons: { gap: 12 },
  button: { backgroundColor: '#222', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonPrimary: { backgroundColor: '#0A84FF', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
