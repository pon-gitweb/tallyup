// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';

type Stats = { totalAreas: number; inProgress: number; completed: number };

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ totalAreas: 0, inProgress: 0, completed: 0 });
  const [sessionStatus, setSessionStatus] = useState<string>('idle');

  const auth = getAuth();
  const user = auth.currentUser;
  const { name: venueName } = useVenueInfo(venueId);

  const friendly = useMemo(() => {
    return friendlyIdentity(
      { displayName: user?.displayName ?? null, email: user?.email ?? null, uid: user?.uid ?? null },
      { name: venueName ?? null, venueId: venueId ?? null }
    );
  }, [user?.displayName, user?.email, user?.uid, venueName, venueId]);

  // Load simple area stats (best-effort)
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!venueId) { setStats({ totalAreas: 0, inProgress: 0, completed: 0 }); setLoading(false); return; }
      setLoading(true);
      try {
        let totalAreas = 0; let inProg = 0; let comp = 0;
        const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
        for (const d of deps.docs) {
          const areas = await getDocs(collection(db, 'venues', venueId, 'departments', d.id, 'areas'));
          areas.forEach(a => {
            const ad: any = a.data();
            totalAreas++;
            if (ad?.completedAt) comp++;
            else if (ad?.startedAt) inProg++;
          });
        }
        if (!cancel) setStats({ totalAreas, inProgress: inProg, completed: comp });
      } catch (e: any) {
        if (__DEV__) console.log('[Dash] stats load error', e?.message);
        if (!cancel) setStats({ totalAreas: 0, inProgress: 0, completed: 0 });
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [db, venueId]);

  const goStockTake = () => nav.navigate('DepartmentSelection');
  const goReports = () => nav.navigate('ReportsIndex');
  const goSuppliers = () => nav.navigate('SuppliersList');
  const goSalesImport = () => nav.navigate('SalesImportHome');

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetTitle}>Hi {friendly}</Text>
          <Text style={styles.greetSub}>Your venue overview at a glance.</Text>
        </View>
        <IdentityBadge />
      </View>

      {/* Session status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Stock Take Session</Text>
        <Text style={styles.cardText}>Status: <Text style={styles.bold}>{sessionStatus}</Text></Text>
        <View style={styles.row}>
          <TouchableOpacity onPress={goStockTake} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Open Stock Take</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goReports} style={styles.secondaryBtn}>
            <Text style={styles.secondaryText}>Reports</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Areas state */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Areas</Text>
        {loading ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : (
          <View style={styles.rowSpread}>
            <StatPill label="Total" value={stats.totalAreas} />
            <StatPill label="In progress" value={stats.inProgress} />
            <StatPill label="Completed" value={stats.completed} />
          </View>
        )}
      </View>

      {/* Quick links */}
      <View style={styles.row}>
        <TouchableOpacity onPress={goSuppliers} style={[styles.quickBtn, { backgroundColor: '#F59E0B' }]}>
          <Text style={styles.quickText}>Suppliers</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goSalesImport} style={[styles.quickBtn, { backgroundColor: '#10B981' }]}>
          <Text style={styles.quickText}>Sales Import</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.caption}>Tip: tap the badge to see your full identity.</Text>
    </ScrollView>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <View style={{
      backgroundColor: '#111827',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      minWidth: 90,
      alignItems: 'center',
    }}>
      <Text style={{ color: '#9CA3AF', fontSize: 12 }}>{label}</Text>
      <Text style={{ color: 'white', fontWeight: '800', fontSize: 18 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1115' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  greetTitle: { color: 'white', fontWeight: '800', fontSize: 20 },
  greetSub: { color: '#9CA3AF', marginTop: 4 },
  card: { backgroundColor: '#111827', borderRadius: 14, padding: 14, marginTop: 12 },
  cardTitle: { color: 'white', fontWeight: '800', marginBottom: 6, fontSize: 16 },
  cardText: { color: '#D1D5DB' },
  bold: { fontWeight: '800', color: 'white' },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  rowSpread: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  primaryBtn: { backgroundColor: '#3B82F6', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, flex: 1, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#374151', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center' },
  secondaryText: { color: 'white', fontWeight: '700' },
  quickBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  quickText: { color: '#0F1115', fontWeight: '800' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  caption: { color: '#9CA3AF', marginTop: 12, fontSize: 12, textAlign: 'center' },
});
