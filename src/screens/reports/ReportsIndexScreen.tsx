// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';

export default function ReportsIndexScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const hasVenue = !!venueId;

  const go = (name: string, params?: any) => () => {
    if (!hasVenue) {
      Alert.alert('Select a venue', 'Pick a venue first, then open Reports again.');
      return;
    }
    nav.navigate(name as never, { venueId, ...(params || {}) } as never);
  };

  const Tile = ({
    title,
    subtitle,
    onPress,
    color,
  }: {
    title: string;
    subtitle?: string;
    onPress: () => void;
    color: string;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={{
        backgroundColor: color,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        opacity: hasVenue ? 1 : 0.7,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{title}</Text>
      {subtitle ? (
        <Text style={{ color: '#E5E7EB', marginTop: 4, fontSize: 13 }}>{subtitle}</Text>
      ) : null}
    </TouchableOpacity>
  );

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
              Reports
            </MaybeTText>
            <Text style={{ color: '#94A3B8', marginTop: 4 }}>
              Weekly performance, variances, budgets, and invoice checks.
            </Text>
          </View>
          <IdentityBadge align="right" />
        </View>

        {/* Tiles */}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {/* Weekly Performance (renamed Last Cycle Summary) */}
          <Tile
            title="Weekly Performance"
            subtitle="State of the venue: sales, variances, shrinkage & red flags."
            onPress={go('LastCycleSummary')}
            color="#059669"
          />

          {/* Variance Snapshot */}
          <Tile
            title="Variance Snapshot"
            subtitle="Shortages and excess by value impact."
            onPress={go('VarianceSnapshot')}
            color="#0EA5E9"
          />

          {/* Completed Stock Takes – placeholder until wired to real route */}
          <Tile
            title="Completed Stock Takes"
            subtitle="List of completed full stock takes (coming soon)."
            onPress={() => {
              if (!hasVenue) {
                Alert.alert('Select a venue', 'Pick a venue first, then open Reports again.');
                return;
              }
              Alert.alert(
                'Coming soon',
                'Completed stock takes will show here once we wire this to your existing history screen.'
              );
            }}
            color="#6366F1"
          />

          {/* Budgets */}
          <Tile
            title="Budgets"
            subtitle="Supplier spend by period, vs budget targets."
            onPress={go('Budgets')}
            color="#F59E0B"
          />

          {/* Department Variance */}
          <Tile
            title="Department Variance"
            subtitle="Shortages and excess by department."
            onPress={go('DepartmentVariance')}
            color="#10B981"
          />

          {/* Invoice Reconciliations */}
          <Tile
            title="Invoice Reconciliations"
            subtitle="Review invoice matches, price deltas, and issues."
            onPress={go('Reconciliations')}
            color="#4B5563"
          />
        </ScrollView>
      </View>
    </LocalThemeGate>
  );
}
