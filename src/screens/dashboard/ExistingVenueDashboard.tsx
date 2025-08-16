import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { ensureDevMembership, ensureActiveSession, getCurrentVenueForUser } from '../../services/devBootstrap';
import { getDocs, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { departmentsCol, areasCol, sessionDoc } from '../../services/paths';

type SessionStatus = 'idle' | 'active';

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(true);
  const [venueId, setVenueId] = useState<string | null>(null);

  // Live derived state
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [hasActiveWork, setHasActiveWork] = useState(false);
  const [lastCompletedAt, setLastCompletedAt] = useState<Date | null>(null);
  const [activityHint, setActivityHint] = useState<string | null>(null);

  const unsubRefs = useRef<Unsubscribe[]>([]);
  const clearSubs = () => {
    unsubRefs.current.forEach(u => { try { u(); } catch {} });
    unsubRefs.current = [];
  };

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  // Prefer the user's assigned venue; fallback to DEV only if none
  useEffect(() => {
    (async () => {
      if (!user) { setBusy(false); return; }
      try {
        setBusy(true);
        const prof = await getCurrentVenueForUser();
        let v = prof.venueId;
        if (!v) {
          const dev = await ensureDevMembership();
          v = dev.venueId;
        }
        setVenueId(v);
        await wireLiveProgress(v);
        console.log('[TallyUp Dashboard live]', { venueId: v });
      } catch (e: any) {
        Alert.alert('Setup error', e?.message ?? 'Unknown error');
      } finally {
        setBusy(false);
      }
    })();
    return clearSubs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const wireLiveProgress = useCallback(async (v: string) => {
    clearSubs();

    // Fetch department names once
    const deptSnap = await getDocs(departmentsCol(v));
    const deptNameById: Record<string, string> = {};
    deptSnap.forEach(d => { deptNameById[d.id] = (d.data() as any)?.name ?? d.id; });

    // Session live
    const u1 = onSnapshot(sessionDoc(v, 'current'), (snap) => {
      const st = (snap.exists() ? (snap.data() as any)?.status : 'idle') as SessionStatus;
      setSessionStatus(st || 'idle');
    });
    unsubRefs.current.push(u1);

    const recompute = (allAreas: Array<{deptId:string; areaId:string; startedAt?:any; completedAt?:any; name?:string;}>) => {
      let active = false;
      let latest: Date | null = null;
      let hint: string | null = null;

      for (const a of allAreas) {
        const started = a?.startedAt?.toDate?.() || null;
        const completed = a?.completedAt?.toDate?.() || null;
        if (!hint && started && !completed) {
          active = true;
          const dn = deptNameById[a.deptId] ?? a.deptId;
          const an = a.name ?? a.areaId;
          hint = `${dn} • ${an} in progress`;
        }
        if (completed) {
          if (!latest || completed > latest) latest = completed;
        }
      }
      setHasActiveWork(!!active);
      setLastCompletedAt(latest ?? null);
      setActivityHint(hint);
    };

    const cache: Record<string, Record<string, any>> = {};
    const recomputeFromCache = () => {
      const flat: Array<any> = [];
      Object.entries(cache).forEach(([deptId, map]) =>
        Object.entries(map).forEach(([areaId, v]) => flat.push({ deptId, areaId, ...v }))
      );
      recompute(flat);
    };

    // Subscribe to each department's areas
    deptSnap.docs.forEach(d => {
      const deptId = d.id;
      const u = onSnapshot(areasCol(v, deptId), (aSnap) => {
        cache[deptId] = cache[deptId] || {};
        aSnap.docs.forEach(a => { cache[deptId][a.id] = a.data(); });
        recomputeFromCache();
      }, (err) => {
        console.log('[TallyUp Dashboard] area snapshot error', err);
      });
      unsubRefs.current.push(u);
    });
  }, []);

  const primaryLabel = useMemo(() => {
    return sessionStatus === 'active' && hasActiveWork
      ? 'Return to Active Stock Take'
      : 'Start Stock Take';
  }, [sessionStatus, hasActiveWork]);

  const onPrimary = async () => {
    if (!venueId) { Alert.alert('No Venue', 'Could not determine venue for this user.'); return; }
    try {
      setBusy(true);
      const sessionId = await ensureActiveSession(venueId);
      console.log('[TallyUp Start/Return] → DepartmentSelection', { venueId, sessionId });
      nav.navigate('DepartmentSelection', { venueId, sessionId });
    } catch (e: any) {
      Alert.alert('Session error', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  if (busy) return (<View style={S.center}><ActivityIndicator /></View>);

  return (
    <View style={S.container}>
      <Text style={S.title}>TallyUp</Text>

      <TouchableOpacity style={S.buttonPrimary} onPress={onPrimary}>
        <Text style={S.buttonText}>{primaryLabel}</Text>
      </TouchableOpacity>

      {hasActiveWork && activityHint && (
        <Text style={S.caption}>{activityHint}</Text>
      )}
      {!hasActiveWork && lastCompletedAt && (
        <Text style={S.caption}>
          Last completed: {lastCompletedAt.toLocaleDateString()} {lastCompletedAt.toLocaleTimeString()}
        </Text>
      )}

      <TouchableOpacity style={S.button} onPress={() => nav.navigate('Settings')}>
        <Text style={S.buttonText}>Settings</Text>
      </TouchableOpacity>

      <TouchableOpacity style={S.button} onPress={() => nav.navigate('Reports')}>
        <Text style={S.buttonText}>Reports</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 24, textAlign: 'center' },
  button: { backgroundColor: '#222', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  buttonPrimary: { backgroundColor: '#0A84FF', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  caption: { color: '#666', marginTop: 6, marginBottom: 12, textAlign: 'center' },
});
