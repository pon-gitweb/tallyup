// @ts-nocheck
import React from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import IdentityBadge from '../../components/IdentityBadge';
import { useVenueId } from '../../context/VenueProvider';
import ReconciliationCard from './components/ReconciliationCard';

export default function ReconciliationsScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  return (
    <LocalThemeGate>
      <View style={{ flex: 1, backgroundColor: '#0F1115' }}>
        {/* Header */}
        <View
          style={{
            padding: 16,
            borderBottomColor: '#263142',
            borderBottomWidth: 1,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View>
            <MaybeTText style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>
              Invoice Reconciliations
            </MaybeTText>
            <Text style={{ color: '#94A3B8', marginTop: 4 }}>
              Read-only view of recent invoice reconciliations grouped by supplier.
            </Text>
          </View>
          <IdentityBadge align="right" />
        </View>

        {/* Body */}
        <View style={{ flex: 1, padding: 16 }}>
          <ReconciliationCard
            venueId={venueId}
            onOpenOrder={(id: string) => nav.navigate('OrderDetail', { orderId: id })}
          />
        </View>
      </View>
    </LocalThemeGate>
  );
}
