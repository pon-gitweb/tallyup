import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { auth, db } from '../../services/firebase';
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { resetVenueCycle } from '../../services/session';

type Totals = { total: number; started: number; complete: number };

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const [venueId, setVenueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [totals, setTotals] = useState<Totals>({ total: 0, started: 0, complete: 0 });

  const areaUnsubs = useRef<Array<() => void>>([]);

  // Load user's attached venue; if none -> CreateVenue (app)
  useEffect(() => {
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) { setLoading(false); return; }
      const uSnap = await getDoc(doc(db, 'users', uid));
      const vId = uSnap.exists() ? (uSnap.data() as any)?.venueId ?? null : null;
      if (!vId) {
        nav.reset({ index: 0, routes: [{ name: 'CreateVenue', params: { origin: 'app' } }] });
        return;
      }
      setVenueId(vId);
      setLoading(false);
    })();
    return () => {
      // Cleanup any area listeners on unmount
      areaUnsubs.current.forEach(u => { try { u(); } catch {} });
      areaUnsubs.current = [];
    };
  }, []);

  // Live session status + live area aggregates (across all departments)
  useEffect(() => {
    if (!venueId) return;

    const unsubSession = onSnapshot(doc(db, 'venues', venueId, 'sessions', 'current'), (d) => {
      const status = (d.exists() ? (d.data() as any)?.status : 'idle') ?? 'idle';
      setSessionActive(status === 'active');
    });

    const unsubDepts = onSnapshot(collection(db, 'venues', venueId, 'departments'), (ds) => {
      // Clear previous area listeners
      areaUnsubs.current.forEach(u => { try { u(); } catch {} });
      areaUnsubs.current = [];

      // Track per-dept counters and recompute global totals on every area snapshot update
      const perDept: Record<string, Totals> = {};

      ds.forEach((dept) => {
        const u = onSnapshot(collection(db, 'venues', venueId, 'departments', dept.id, 'areas'), (as) => {
          let t = 0, s = 0, c = 0;
          as.forEach(a => {
            t++;
            const ad: any = a.data();
            if (ad?.completedAt) c++; else if (ad?.startedAt) s++;
          });
          perDept[dept.id] = { total: t, started: s, complete: c };

          // Recompute global
          const g = Object.values(perDept).reduce((acc, x) => ({
            total: acc.total + x.total,
            started: acc.started + x.started,
            complete: acc.complete + x.complete,
          }), { total: 0, started: 0, complete: 0 });
          setTotals(g);
        });
        areaUnsubs.current.push(u);
      });
    });

    return () => {
      unsubSession();
      unsubDepts();
      areaUnsubs.current.forEach(u => { try { u(); } catch {} });
      areaUnsubs.current = [];
    };
  }, [venueId]);

  const anyStarted = totals.started > 0;
  const allComplete = totals.total > 0 && totals.complete === totals.total;

  const primaryLabel = useMemo(() => {
    if (anyStarted) return 'Return to Active Stock Take';
    if (allComplete) return 'Start New Stock Take';
    return 'Start Stock Take';
  }, [anyStarted, allComplete]);

  const caption = useMemo(() => {
    if (anyStarted) return `Live • ${totals.started} area(s) in progress`;
    if (allComplete) return 'All departments complete. Start a new cycle when ready.';
    return 'No areas currently in progress';
  }, [anyStarted, allComplete, totals.started]);

  const onPrimary = async () => {
    if (!venueId) return;
    if (allComplete) {
      try {
        await resetVenueCycle(venueId);
        await setDoc(doc(db, 'venues', venueId, 'sessions', 'current'),
          { status: 'active', startedAt: serverTimestamp() }, { merge: true });
      } catch (e: any) {
        Alert.alert('Reset failed', e?.message ?? 'Unknown error');
        return;
      }
    } else {
      // Ensure session is active before navigating
      const sRef = doc(db, 'venues', venueId, 'sessions', 'current');
      const sSnap = await getDoc(sRef);
      if (!sSnap.exists() || (sSnap.exists() && (sSnap.data() as any)?.status !== 'active')) {
        await setDoc(sRef, { status: 'active', startedAt: serverTimestamp() }, { merge: true });
      }
    }
    nav.navigate('DepartmentSelection', { venueId, sessionId: 'current' });
  };

  if (loading) return <View style={S.center}><ActivityIndicator/></View>;

  return (
    <View style={S.container}>
      <Text style={S.h1}>TallyUp</Text>
      <View style={S.card}>
        <Text style={S.caption}>{caption}</Text>
        <TouchableOpacity style={S.primary} onPress={onPrimary}>
          <Text style={S.primaryText}>{primaryLabel}</Text>
        </TouchableOpacity>
        <View style={{height:12}}/>
        <TouchableOpacity style={S.dark} onPress={() => nav.navigate('Settings')}>
          <Text style={S.darkText}>Settings</Text>
        </TouchableOpacity>
        <View style={{height:8}}/>
        <TouchableOpacity style={S.dark} onPress={() => nav.navigate('Reports')}>
          <Text style={S.darkText}>Reports</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container:{flex:1,backgroundColor:'#fff',padding:16},
  center:{flex:1,alignItems:'center',justifyContent:'center'},
  h1:{fontSize:24,fontWeight:'800',marginBottom:12},
  card:{backgroundColor:'#F3F4F6',borderRadius:16,padding:16},
  caption:{color:'#6B7280',marginBottom:12},
  primary:{backgroundColor:'#0A84FF',padding:14,borderRadius:12,alignItems:'center'},
  primaryText:{color:'#fff',fontWeight:'700'},
  dark:{backgroundColor:'#111827',padding:12,borderRadius:10,alignItems:'center'},
  darkText:{color:'#fff',fontWeight:'700'},
});
