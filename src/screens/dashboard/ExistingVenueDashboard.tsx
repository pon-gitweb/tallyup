// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';
import { useColours } from '../../context/ThemeContext';

type Stats = { totalAreas: number; inProgress: number; completed: number };

export default function ExistingVenueDashboard() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const db = getFirestore();
  const colours = useColours();

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

  const S = StyleSheet.create({
    container: { flex: 1, backgroundColor: colours.background },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
    greetTitle: { color: colours.text, fontWeight: '800', fontSize: 20 },
    greetSub: { color: colours.textSecondary, marginTop: 4 },
    card: { backgroundColor: colours.surface, borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colours.border },
    cardTitle: { color: colours.text, fontWeight: '800', marginBottom: 6, fontSize: 16 },
    cardText: { color: colours.textSecondary },
    bold: { fontWeight: '800', color: colours.text },
    row: { flexDirection: 'row', gap: 10, marginTop: 12 },
    rowSpread: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' },
    primaryBtn: { backgroundColor: colours.primary, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, flex: 1, alignItems: 'center' },
    primaryText: { color: colours.primaryText, fontWeight: '700' },
    secondaryBtn: { backgroundColor: colours.border, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center' },
    secondaryText: { color: colours.text, fontWeight: '700' },
    quickBtnAmber: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colours.amber },
    quickBtnSuccess: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colours.success },
    quickText: { color: colours.primaryText, fontWeight: '800' },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    caption: { color: colours.textSecondary, marginTop: 12, fontSize: 12, textAlign: 'center' },
  });

  return (
    <ScrollView style={S.container} contentContainerStyle={{ padding: 16 }}>
      <View style={S.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={S.greetTitle}>Hi {friendly}</Text>
          <Text style={S.greetSub}>Your venue overview at a glance.</Text>
        </View>
        <IdentityBadge />
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Stock Take Session</Text>
        <Text style={S.cardText}>Status: <Text style={S.bold}>{sessionStatus}</Text></Text>
        <View style={S.row}>
          <TouchableOpacity onPress={goStockTake} style={S.primaryBtn}>
            <Text style={S.primaryText}>Open Stock Take</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goReports} style={S.secondaryBtn}>
            <Text style={S.secondaryText}>Reports</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Areas</Text>
        {loading ? (
          <View style={S.center}><ActivityIndicator color={colours.primary} /></View>
        ) : (
          <View style={S.rowSpread}>
            <StatPill label="Total" value={stats.totalAreas} colours={colours} />
            <StatPill label="In progress" value={stats.inProgress} colours={colours} />
            <StatPill label="Completed" value={stats.completed} colours={colours} />
          </View>
        )}
      </View>

      <View style={S.row}>
        <TouchableOpacity onPress={goSuppliers} style={S.quickBtnAmber}>
          <Text style={S.quickText}>Suppliers</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goSalesImport} style={S.quickBtnSuccess}>
          <Text style={S.quickText}>Sales Import</Text>
        </TouchableOpacity>
      </View>

      <Text style={S.caption}>Tip: tap the badge to see your full identity.</Text>
    </ScrollView>
  );
}

function StatPill({ label, value, colours }: { label: string; value: number; colours: any }) {
  return (
    <View style={{
      backgroundColor: colours.navy,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      minWidth: 90,
      alignItems: 'center',
    }}>
      <Text style={{ color: colours.textSecondary, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colours.primaryText, fontWeight: '800', fontSize: 18 }}>{value}</Text>
    </View>
  );
}
