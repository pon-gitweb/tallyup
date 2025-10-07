// @ts-nocheck
import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../context/VenueProvider';
import IdentityBadge from '../components/IdentityBadge';
import { friendlyIdentity, useVenueInfo } from '../hooks/useIdentityLabels';

export default function DashboardScreen() {
  const nav = useNavigation<any>();

  // identity (friendly + badge)
  const auth = getAuth();
  const user = auth.currentUser;
  const venueId = useVenueId();
  const { name: venueName } = useVenueInfo(venueId);
  const friendly = useMemo(() => {
    return friendlyIdentity(
      { displayName: user?.displayName ?? null, email: user?.email ?? null, uid: user?.uid ?? null },
      { name: venueName ?? null, venueId: venueId ?? null }
    );
  }, [user?.displayName, user?.email, user?.uid, venueName, venueId]);

  const [busy, setBusy] = useState(false);

  const onOpenStockTake = async () => {
    if (busy) return;
    try {
      setBusy(true);
      nav.navigate('DepartmentSelection');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      {/* Header with badge */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSub}>Hi {friendly}</Text>
        </View>
        <IdentityBadge />
      </View>

      {/* Legacy center panel preserved */}
      <View style={styles.panel}>
        <Text style={styles.title}>TallyUp</Text>

        <TouchableOpacity style={[styles.button, styles.primary]} onPress={onOpenStockTake} disabled={busy}>
          {busy ? <ActivityIndicator /> : <Text style={styles.buttonText}>Start / Return Stock Take</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.dark]} onPress={() => nav.navigate('StockControl')}>
          <Text style={styles.buttonText}>Stock Control</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.dark]} onPress={() => nav.navigate('Settings')}>
          <Text style={styles.buttonText}>Settings</Text>
        </TouchableOpacity>

        {/* FIX: use existing route name 'Reports' */}
        <TouchableOpacity style={[styles.button, styles.dark]} onPress={() => nav.navigate('Reports')}>
          <Text style={styles.buttonText}>Reports</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '800' },
  headerSub: { color: '#6B7280', marginTop: 2 },

  panel: { marginTop: 8, paddingHorizontal: 8 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginVertical: 16 },

  button: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  primary: { backgroundColor: '#3B82F6' },
  dark: { backgroundColor: '#111827' },
  buttonText: { color: 'white', fontWeight: '700' },
});
