import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { ensureDevMembership, ensureActiveSession } from '../../services/devBootstrap';
import { getDocs, getDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { departmentsCol, areasCol, sessionDoc } from '../../services/paths';

type SessionStatus = 'idle' | 'active';

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(true);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [hasProgress, setHasProgress] = useState(false);
  const unsubRefs = useRef<Unsubscribe[]>([]);

  // Tear down any prior listeners
  const clearSubs = () => {
    unsubRefs.current.forEach(u => { try { u(); } catch {} });
    unsubRefs.current = [];
  };

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const wireLiveProgress = useCallback(async (v: string) => {
    clearSubs();
    // Live session status
    const u1 = onSnapshot(sessionDoc(v, 'current'), (snap) => {
      const st = (snap.exists() ? (snap.data() as any)?.status : 'idle') as SessionStatus;
      setSessionStatus(st || 'idle');
    });
    unsubRefs.current.push(u1);

    // Live department/area progress: subscribe to each dept's areas
    const dSnap = await getDocs(departmentsCol(v));
    if (dSnap.empty) { setHasProgress(false); return; }

    const updateProgress = (areasData: Array<Record<string, any>>) => {
      const anyProgress = areasData.some(a => a?.startedAt || a?.completedAt);
      setHasProgress(anyProgress);
    };

    // For each dept, attach a snapshot to its areas
    dSnap.docs.forEach(d => {
      const u = onSnapshot(areasCol(v, d.id), (aSnap) => {
        const arr = aSnap.docs.map(a => a.data() as any);
        updateProgress(arr);
      });
      unsubRefs.current.push(u);
    });
  }, []);

  // Initial load + listeners
  useEffect(() => {
    (async () => {
      if (!user) { setBusy(false); return; }
      try {
        setBusy(true);
        const { venueId: v } = await ensureDevMembership();
        setVenueId(v);
        await wireLiveProgress(v);
        console.log('[TallyUp Dashboard]', { venueId: v });
      } catch (e: any) {
        Alert.alert('Setup error', e?.message ?? 'Unknown error');
      } finally {
        setBusy(false);
      }
    })();
    return clearSubs;
  }, [user, wireLiveProgress]);

  // Also refresh listeners when returning to this screen
  useFocusEffect(useCallback(() => {
    if (venueId) { void wireLiveProgress(venueId); }
    return () => {};
  }, [venueId, wireLiveProgress]));

  const primaryLabel = useMemo(() => {
    return sessionStatus === 'active' && hasProgress
      ? 'Return to Active Stock Take'
      : 'Start Stock Take';
  }, [sessionStatus, hasProgress]);

  const onPrimary = async () => {
    if (!venueId) {
      Alert.alert('No Venue', 'Could not determine venue for this user.');
      return;
    }
    try {
      setBusy(true);
      const sessionId = await ensureActiveSession(venueId);
      console.log('[TallyUp Start/Return] Navigating → DepartmentSelection', { venueId, sessionId });
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
