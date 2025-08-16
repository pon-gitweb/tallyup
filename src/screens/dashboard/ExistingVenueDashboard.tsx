import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { auth, db } from '../../services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { ensureDevMembership, getCurrentVenueForUser } from '../../services/devBootstrap';
import { ensureActiveSession } from '../../services/finalization';

type SessionStatus = 'idle' | 'active';

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(true);
  const [venueId, setVenueId] = useState<string | null>(null);

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [lastCompletedAt, setLastCompletedAt] = useState<Date | null>(null);
  const [hasActiveWork, setHasActiveWork] = useState(false);
  const [activityHint, setActivityHint] = useState<string | null>(null);

  const unsubs = useRef<Unsubscribe[]>([]);
  const clear = () => { unsubs.current.forEach(u => { try { u(); } catch {}; }); unsubs.current = []; };

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    (async () => {
      if (!user) { setBusy(false); return; }
      try {
        setBusy(true);
        // Prefer user's venue; fallback to DEV if none
        const prof = await getCurrentVenueForUser();
        let v = prof.venueId;
        if (!v) {
          const dev = await ensureDevMembership();
          v = dev.venueId;
        }
        setVenueId(v);
        wireLive(v);
      } catch (e: any) {
        Alert.alert('Setup error', e?.message ?? 'Unknown error');
      } finally {
        setBusy(false);
      }
    })();
    return () => clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const wireLive = async (v: string) => {
    clear();

    // 1) Session live
    const sRef = doc(db, 'venues', v, 'sessions', 'current');
    const u1 = onSnapshot(sRef, (snap) => {
      if (!snap.exists()) {
        setSessionStatus('idle');
        setLastCompletedAt(null);
        return;
      }
      const data = snap.data() as any;
      setSessionStatus((data?.status as SessionStatus) || 'idle');
      const lc = data?.lastCompletedAt?.toDate?.() ?? null;
      setLastCompletedAt(lc);
    });
    unsubs.current.push(u1);

    // 2) Light live hint: first in-progress area (if any) across departments
    const depts = await getDocs(collection(db, 'venues', v, 'departments'));
    const nameMap: Record<string,string> = {};
    depts.forEach(d => { nameMap[d.id] = (d.data() as any)?.name ?? d.id; });

    const cache: Record<string, Record<string, any>> = {};
    const recompute = () => {
      let hint: string | null = null;
      let active = false;
      Object.entries(cache).forEach(([deptId, map]) => {
        Object.entries(map).forEach(([areaId, a]: any) => {
          const started = a?.startedAt?.toDate?.() ?? null;
          const completed = a?.completedAt?.toDate?.() ?? null;
          if (!hint && started && !completed) {
            active = true;
            const dn = nameMap[deptId] ?? deptId;
            const an = a?.name ?? areaId;
            hint = `${dn} • ${an} in progress`;
          }
        });
      });
      setHasActiveWork(active);
      setActivityHint(hint);
    };

    depts.forEach(d => {
      const u = onSnapshot(collection(db, 'venues', v, 'departments', d.id, 'areas'), (snap) => {
        cache[d.id] = cache[d.id] || {};
        snap.forEach(a => { cache[d.id][a.id] = a.data(); });
        recompute();
      }, (err) => console.log('[Dashboard] areas snap err', err));
      unsubs.current.push(u);
    });
  };

  const primaryLabel = useMemo(() => {
    // If session is active OR any area is in progress → Return
    if (sessionStatus === 'active' || hasActiveWork) return 'Return to Active Stock Take';
    return 'Start Stock Take';
  }, [sessionStatus, hasActiveWork]);

  const onPrimary = async () => {
    if (!venueId) { Alert.alert('No Venue', 'Could not determine venue for this user.'); return; }
    try {
      setBusy(true);
      const sessionId = await ensureActiveSession(venueId);
      nav.navigate('DepartmentSelection', { venueId, sessionId });
    } catch (e: any) {
      Alert.alert('Session error', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <View style={S.center}><ActivityIndicator /></View>;

  return (
    <View style={S.container}>
      <Text style={S.title}>TallyUp</Text>

      <TouchableOpacity style={S.buttonPrimary} onPress={onPrimary}>
        <Text style={S.buttonText}>{primaryLabel}</Text>
      </TouchableOpacity>

      {activityHint && <Text style={S.caption}>{activityHint}</Text>}
      {!activityHint && lastCompletedAt && (
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
