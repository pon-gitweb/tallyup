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

function formatDate(v: any): string {
  const d = toDate(v);
  if (!d) return 'Unknown date';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(v: any): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

function formatCurrency(n: number): string {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + n.toFixed(2);
}

function fmtDuration(mins: number | null): string | null {
  if (mins == null || mins <= 0) return null;
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h}h ${m}m`;
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
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    load();
  }, [load]);

  const onPressRow = (item: CompletedStockTakeRow) => {
    const lines: string[] = [];
    lines.push(`Completed: ${formatDate(item.completedAt)}`);
    if (item.completedByName) lines.push(`By: ${item.completedByName}`);
    lines.push(`Items counted: ${item.totalItemsCounted}`);
    if (item.totalStockValue != null && item.totalStockValue > 0) {
      lines.push(`Stock value: ${formatCurrency(item.totalStockValue)}`);
    }
    if (item.itemsBelowPAR > 0) {
      lines.push(`Below PAR: ${item.itemsBelowPAR} item${item.itemsBelowPAR !== 1 ? 's' : ''}`);
    }
    const dur = fmtDuration(item.durationMinutes);
    if (dur) lines.push(`Duration: ${dur}`);

    Alert.alert(
      `${item.departmentName} — Cycle ${item.cycleNumber}`,
      lines.join('\n'),
      [{ text: 'OK' }],
    );
  };

  const renderItem = ({ item }: { item: CompletedStockTakeRow }) => {
    const dateStr = formatDateShort(item.completedAt);
    const dur = fmtDuration(item.durationMinutes);

    return (
      <TouchableOpacity
        onPress={() => onPressRow(item)}
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
        {/* Header row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#E5E7EB', fontWeight: '800', fontSize: 15 }}>
              {item.departmentName}
            </Text>
            <Text style={{ color: '#64748B', fontSize: 12, marginTop: 1 }}>
              Cycle {item.cycleNumber} · {dateStr}
            </Text>
          </View>
          {item.totalStockValue != null && item.totalStockValue > 0 && (
            <Text style={{ color: '#4ADE80', fontWeight: '800', fontSize: 15 }}>
              {formatCurrency(item.totalStockValue)}
            </Text>
          )}
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: '#60A5FA', fontSize: 13, fontWeight: '700' }}>
              {item.totalItemsCounted}
            </Text>
            <Text style={{ color: '#64748B', fontSize: 12 }}>items</Text>
          </View>

          {item.itemsBelowPAR > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#F87171', fontSize: 13, fontWeight: '700' }}>
                {item.itemsBelowPAR}
              </Text>
              <Text style={{ color: '#64748B', fontSize: 12 }}>below PAR</Text>
            </View>
          )}

          {dur && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#94A3B8', fontSize: 12 }}>⏱ {dur}</Text>
            </View>
          )}
        </View>

        {item.completedByName && (
          <Text style={{ color: '#64748B', fontSize: 11, marginTop: 6 }}>
            {item.completedByName}
          </Text>
        )}

        <Text style={{ color: '#334155', fontSize: 11, marginTop: 4 }}>
          Tap for details
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
    if (loading) return null;
    return (
      <View>
        <Text style={{ color: '#E5E7EB', fontWeight: '600', marginBottom: 4 }}>
          No completed stocktakes yet
        </Text>
        <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
          Complete a stocktake and it will appear here with counts, stock value, and duration.
        </Text>
      </View>
    );
  };

  return (
    <LocalThemeGate>
      <View style={{ flex: 1, backgroundColor: '#020617' }}>
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
            <MaybeTText style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>
              Stocktake History
            </MaybeTText>
            <Text style={{ color: '#94A3B8', marginTop: 4, fontSize: 13 }}>
              All completed stocktake cycles — tap any row for details.
            </Text>
          </View>
          <IdentityBadge align="right" />
        </View>

        <View style={{ flex: 1, padding: 16 }}>
          <FlatList
            data={rows}
            keyExtractor={(r) => `${r.departmentId}-${r.id}`}
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
