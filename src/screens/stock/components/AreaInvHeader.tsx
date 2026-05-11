// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

type Stats = {
  countedCount: number;
  total: number;
  lowCount: number;
  flaggedCount: number;
  progressPct: number;
};

type Props = {
  areaName?: string;
  isCompact: boolean;
  dens: (n: number) => number;

  startedAt: Date | null;
  lastActivityDate: Date | null;

  offline: boolean;
  legendDismissed: boolean;
  dismissLegend: () => void;

  stats: Stats;
  onOpenMore: () => void;

  presenceLabel?: string | null;
};

const fmt = (d: Date | null) => (d ? d.toLocaleString() : '—');

const AreaInvHeader = React.memo(function AreaInvHeader({
  areaName,
  isCompact,
  dens,
  startedAt,
  lastActivityDate,
  offline,
  legendDismissed,
  dismissLegend,
  stats,
  onOpenMore,
  presenceLabel,
}: Props) {
  return (
    <View
      style={{
        backgroundColor: 'white',
        paddingBottom: dens(8),
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
      }}
    >
      <View style={{ padding: dens(12), gap: 8 }}>
        {/* Title + stats + ⋯ */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <Text
              style={{ fontSize: isCompact ? 16 : 18, fontWeight: '800' }}
              numberOfLines={1}
            >
              {areaName ?? 'Area Inventory'}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 4,
              }}
            >
              <Text style={{ opacity: 0.7, fontSize: 12 }} numberOfLines={1}>
                Started at: {fmt(startedAt)} • Last activity:{' '}
                {fmt(lastActivityDate)}
              </Text>
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                paddingVertical: 2,
                paddingHorizontal: 8,
                backgroundColor: '#F3F4F6',
                borderRadius: 12,
              }}
            >
              <Text style={{ fontWeight: '800', color: '#374151' }}>
                {stats.countedCount}/{stats.total} • {stats.lowCount} low •{' '}
                {stats.flaggedCount} flag • {stats.progressPct}%
              </Text>
            </View>
            <TouchableOpacity
              onPress={onOpenMore}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 12,
                backgroundColor: '#E5E7EB',
              }}
            >
              <Text style={{ fontWeight: '900' }}>⋯</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Presence pill */}
        {presenceLabel ? (
          <View
            style={{
              alignSelf: 'flex-start',
              marginTop: 2,
              paddingVertical: 2,
              paddingHorizontal: 8,
              borderRadius: 999,
              backgroundColor: '#EEF2FF',
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#3730A3' }}>
              {presenceLabel}
            </Text>
          </View>
        ) : null}

        {/* Offline banner */}
        {offline ? (
          <View
            style={{
              backgroundColor: '#FEF3C7',
              borderColor: '#F59E0B',
              borderWidth: 1,
              padding: 6,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: '#92400E', fontWeight: '700' }}>Offline</Text>
            <Text style={{ color: '#92400E' }}>
              You can keep counting; changes will sync when back online.
            </Text>
          </View>
        ) : null}

        {/* Tip legend */}
        {!legendDismissed ? (
          <View
            style={{
              backgroundColor: '#EFF6FF',
              borderColor: '#93C5FD',
              borderWidth: 1,
              padding: 8,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: '#1E3A8A', fontWeight: '700' }}>Tip</Text>
            <Text style={{ color: '#1E3A8A' }}>
              "Expected" is our guidance based on last count and movements. Type
              your Count and press Save (or Approve now).
            </Text>
            <TouchableOpacity
              onPress={dismissLegend}
              style={{
                alignSelf: 'flex-start',
                marginTop: 6,
                paddingVertical: 6,
                paddingHorizontal: 10,
                backgroundColor: '#DBEAFE',
                borderRadius: 8,
              }}
            >
              <Text style={{ color: '#1E3A8A', fontWeight: '700' }}>Got it</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
});

export default AreaInvHeader;
