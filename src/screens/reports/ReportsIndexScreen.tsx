// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import IdentityBadge from '../../components/IdentityBadge';
import { useVenueId } from '../../context/VenueProvider';
import {
  listCompletedStockTakes,
  CompletedStockTakeRow,
} from '../../services/reports/completedStockTakes';

type TileProps = {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  color: string;
};

const Tile = ({ title, subtitle, onPress, color }: TileProps) => {
  const disabled = !onPress;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={disabled ? 1 : 0.8}
      style={{
        backgroundColor: '#020617',
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: '#1E293B',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text
            style={{
              color: '#F9FAFB',
              fontSize: 16,
              fontWeight: '700',
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: '#F3F4F6', marginTop: 4 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: color,
          }}
        />
      </View>
    </TouchableOpacity>
  );
};

export default function ReportsIndexScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [completed, setCompleted] = useState<CompletedStockTakeRow[]>([]);
  const [completedLoading, setCompletedLoading] = useState(false);

  const go = useCallback(
    (screen: string, params?: any) =>
      () => nav.navigate(screen as never, params as never),
    [nav],
  );

  // Load completed stock takes – for subtitle only. Tile is always tappable.
  useEffect(() => {
    let cancelled = false;

    const loadCompleted = async () => {
      if (!venueId) {
        if (!cancelled) {
          setCompleted([]);
          setCompletedLoading(false);
        }
        return;
      }
      setCompletedLoading(true);
      try {
        const rows = await listCompletedStockTakes(venueId);
        if (!cancelled) setCompleted(rows || []);
      } catch (e: any) {
        if (!cancelled) {
          console.log(
            '[ReportsIndex] completed stock takes load failed',
            e?.message,
          );
          setCompleted([]);
        }
      } finally {
        if (!cancelled) setCompletedLoading(false);
      }
    };

    loadCompleted();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  let completedSubtitle = 'Tap to view completed stock takes.';
  if (!venueId) {
    completedSubtitle =
      'Select a venue, then tap to view completed stock takes.';
  } else if (completedLoading) {
    completedSubtitle = 'Checking for completed stock takes…';
  } else if (completed.length === 0) {
    completedSubtitle =
      'No fully completed stock takes yet — tap for details.';
  } else {
    completedSubtitle = 'Latest completed stock take (tap to view).';
  }

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
            <MaybeTText
              style={{ color: 'white', fontSize: 20, fontWeight: '700' }}
            >
              Reports
            </MaybeTText>
            <Text style={{ color: '#94A3B8', marginTop: 4 }}>
              Weekly performance, variance, budgets, and reconciliations.
            </Text>
          </View>
          <IdentityBadge align="right" />
        </View>

        {/* Body */}
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            gap: 12,
            paddingBottom: 32,
          }}
        >
          {!venueId && (
            <Text style={{ color: '#F97316', marginBottom: 4 }}>
              No venue selected — pick a venue to see its reports.
            </Text>
          )}

          {/* Core analytics tiles */}
          <Tile
            title="Variance Snapshot"
            subtitle="Compare on-hand vs expected"
            onPress={go('VarianceSnapshot')}
            color="#0EA5E9"
          />

          <Tile
            title="Weekly Performance"
            subtitle="Venue GP, sales, spend, shrinkage"
            onPress={go('LastCycleSummary')}
            color="#059669"
          />

          <Tile
            title="Budgets"
            subtitle="Spend by period & supplier"
            onPress={go('Budgets')}
            color="#F59E0B"
          />

          <Tile
            title="Department Variance"
            subtitle="Shortage & excess by department"
            onPress={go('DepartmentVariance')}
            color="#10B981"
          />

          <Tile
            title="Invoice Reconciliations"
            subtitle="Read-only list of recent reconciliations"
            onPress={go('Reconciliations')}
            color="#6366F1"
          />

                    {/* Completed stock takes (beta) */}
          <Tile
            title="Completed Stock Takes"
            subtitle={completedSubtitle}
            // For beta: placeholder only, no navigation route yet
            onPress={() =>
              Alert.alert(
                'Coming soon',
                'Completed stock take history will land after the beta pilot. For now, use Weekly Performance and Variance reports.'
              )
            }
            color="#A855F7"
          />
        </ScrollView>
      </View>
    </LocalThemeGate>
  );
}
