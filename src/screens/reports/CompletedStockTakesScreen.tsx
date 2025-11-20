// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';

import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import IdentityBadge from '../../components/IdentityBadge';
import { useVenueId } from '../../context/VenueProvider';
import {
  listCompletedStockTakes,
  CompletedStockTakeRow,
} from '../../services/reports/completedStockTakes';

function toDate(v: any): Date | null {
  if (!v) return null;
  try {
    if (typeof v.toDate === 'function') return v.toDate();
    if (v._seconds) return new Date(v._seconds * 1000);
    const n = Date.parse(v);
    return Number.isFinite(n) ? new Date(n) : null;
  } catch {
    return null;
  }
}

function formatDuration(startRaw: any, endRaw: any): string | null {
  const start = toDate(startRaw);
  const end = toDate(endRaw);
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;

  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${totalMinutes} min${totalMinutes === 1 ? '' : 's'}`;
  }
  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${hours}h ${minutes}m`;
}

function sortByCompletedDesc(a: CompletedStockTakeRow, b: CompletedStockTakeRow) {
  const aCompleted = toDate((a as any).completedAt);
  const bCompleted = toDate((b as any).completedAt);
  const aCreated = toDate((a as any).createdAt);
  const bCreated = toDate((b as any).createdAt);

  const aTime = (aCompleted || aCreated)?.getTime() ?? 0;
  const bTime = (bCompleted || bCreated)?.getTime() ?? 0;

  // Descending (newest first)
  if (aTime > bTime) return -1;
  if (aTime < bTime) return 1;
  return 0;
}

export default function CompletedStockTakesScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CompletedStockTakeRow[]>([]);

  const load = useCallback(async () => {
    if (!venueId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listCompletedStockTakes(venueId);
      setRows(res || []);
    } catch (e: any) {
      // Defensive: if Firestore denies access or the doc doesn't exist,
      // we just show an empty state. ReportsIndex already logs details in dev.
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    load();
  }, [load]);

  const onLongPressRow = () => {
    Alert.alert(
      'Deeper insights coming soon',
      'This is a beta view of completed stock takes. In a future update, you’ll be able to drill into full variance, GP impact, and history per cycle.',
      [{ text: 'OK' }],
    );
  };

  const renderItem = ({ item }: { item: CompletedStockTakeRow }) => {
    const completedAt = toDate((item as any).completedAt);
    const createdAt = toDate((item as any).createdAt);
    const whenBase = completedAt || createdAt;

    const dateLabel = whenBase ? whenBase.toLocaleDateString() : 'Unknown date';
    const timeLabel = whenBase ? whenBase.toLocaleTimeString() : '';
    const when =
      whenBase != null
        ? `${dateLabel}${timeLabel ? ` · ${timeLabel}` : ''}`
        : 'Completed time not recorded';

    const durationLabel = formatDuration(createdAt, completedAt);
    const completedBy =
      (item as any).completedBy ||
      (item as any).runBy ||
      null;

    const shortId = String(item.id || '').slice(-6) || '…';

    return (
      <TouchableOpacity
        onLongPress={onLongPressRow}
        activeOpacity={0.8}
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: '#020617',
          borderWidth: 1,
          borderColor: '#1E293B',
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            color: '#E5E7EB',
            fontWeight: '800',
            marginBottom: 4,
            fontSize: 15,
          }}
        >
          Stock take · {dateLabel}
        </Text>

        <Text
          style={{
            color: '#9CA3AF',
            fontSize: 13,
          }}
        >
          Status: {item.status || 'unknown'}
        </Text>

        <Text
          style={{
            color: '#9CA3AF',
            fontSize: 13,
            marginTop: 2,
          }}
        >
          Completed at: {when}
        </Text>

        {durationLabel && (
          <Text
            style={{
              color: '#9CA3AF',
              fontSize: 13,
              marginTop: 2,
            }}
          >
            Duration: {durationLabel}
          </Text>
        )}

        {completedBy && (
          <Text
            style={{
              color: '#9CA3AF',
              fontSize: 13,
              marginTop: 2,
            }}
          >
            Completed by: {String(completedBy)}
          </Text>
        )}

        <Text
          style={{
            color: '#64748B',
            fontSize: 11,
            marginTop: 6,
          }}
        >
          Cycle ID: {shortId}
        </Text>

        <Text
          style={{
            color: '#64748B',
            fontSize: 12,
            marginTop: 8,
          }}
        >
          Long-press for a preview of upcoming insights.
        </Text>
      </TouchableOpacity>
    );
  };

  const emptyState = () => {
    if (!venueId) {
      return (
        <Text style={{ color: '#F97316' }}>
          No venue selected — pick a venue to see completed stock takes.
        </Text>
      );
    }

    if (loading) {
      return null;
    }

    return (
      <View>
        <Text style={{ color: '#E5E7EB', fontWeight: '600', marginBottom: 4 }}>
          No completed stock takes yet
        </Text>
        <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
          Once you run and finalize a full stock take, it will appear here as a
          completed cycle.
        </Text>
      </View>
    );
  };

  const sortedRows = (rows || []).slice().sort(sortByCompletedDesc);

  return (
    <LocalThemeGate>
      <View style={{ flex: 1, backgroundColor: '#020617' }}>
        {/* Header */}
        <View
          style={{
            padding: 16,
            borderBottomColor: '#1E293B',
            borderBottomWidth: 1,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <MaybeTText
              style={{ color: 'white', fontSize: 20, fontWeight: '700' }}
            >
              Completed Stock Takes
            </MaybeTText>
            <Text style={{ color: '#94A3B8', marginTop: 4, fontSize: 13 }}>
              Read-only list of fully completed stock takes under the new
              session flow.
            </Text>
            <Text style={{ color: '#64748B', marginTop: 2, fontSize: 11 }}>
              Deeper insights and history per cycle are coming in a future
              update.
            </Text>
          </View>
          <IdentityBadge align="right" />
        </View>

        {/* Body */}
        <View style={{ flex: 1, padding: 16 }}>
          <FlatList
            data={sortedRows}
            keyExtractor={(r) => r.id}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={load} />
            }
            ListEmptyComponent={emptyState()}
          />
        </View>
      </View>
    </LocalThemeGate>
  );
}
