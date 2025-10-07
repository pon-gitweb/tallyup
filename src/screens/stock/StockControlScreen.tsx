import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import IdentityBadge from '../../components/IdentityBadge';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { friendlyIdentity, useVenueInfo } from '../../hooks/useIdentityLabels';

export default function StockControlScreen() {
  const nav = useNavigation<any>();
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

  const Item = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.rowText}>{title}</Text>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.wrap}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Stock Control</Text>
            <Text style={styles.subtitle}>{friendly}</Text>
          </View>
          <IdentityBadge />
        </View>

        <Item title="Manage Suppliers" onPress={() => nav.navigate('Suppliers')} />
        <Item title="Manage Products"  onPress={() => nav.navigate('Products')} />
        {/* FIX: correct, plural route names */}
        <Item title="Suggested Orders" onPress={() => nav.navigate('SuggestedOrders')} />
        <Item title="Orders"           onPress={() => nav.navigate('Orders')} />
        <Item title="Reset Stock Take" onPress={() => nav.navigate('Settings')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: 'white' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#6B7280', marginTop: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 10, backgroundColor: '#F9FAFB'
  },
  rowText: { fontSize: 16, fontWeight: '700' },
  chev: { fontSize: 22, color: '#94A3B8', marginLeft: 8 },
});
