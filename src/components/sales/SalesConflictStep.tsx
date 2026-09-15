/**
 * SalesConflictStep
 *
 * Shown when a new sales upload's period overlaps one or more existing reports.
 * Presents the conflicting reports side-by-side and offers three choices:
 *   Replace  — the new upload supersedes the overlapping report(s)
 *   Keep both — proceed without superseding (unusual; requires explicit confirmation)
 *   Cancel   — abandon the upload entirely
 */
// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import type { OverlappingReport } from '../../services/sales/checkPeriodOverlap';

type Props = {
  /** The period the user confirmed for the new upload. */
  newStart: string; // YYYY-MM-DD
  newEnd: string;   // YYYY-MM-DD
  /** All existing active reports that overlap with the new period. */
  conflicts: OverlappingReport[];
  onReplace: () => void;
  onKeepBoth: () => void;
  /** Go back to the period-picker step; nothing is written. */
  onCancel: () => void;
  busy?: boolean;
};

function fmtPeriod(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s + 'T12:00:00');
  return isFinite(d.getTime())
    ? d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
    : s;
}

function fmtRevenue(n: number | null): string {
  if (n === null) return '';
  return '$' + n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUploadDate(d: Date | null): string {
  if (!d) return 'unknown date';
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SalesConflictStep({
  newStart,
  newEnd,
  conflicts,
  onReplace,
  onKeepBoth,
  onCancel,
  busy = false,
}: Props) {
  const [confirmKeepBoth, setConfirmKeepBoth] = useState(false);

  const replaceLabel =
    conflicts.length === 1
      ? 'Replace existing report'
      : `Replace all ${conflicts.length} existing reports`;

  return (
    <View style={{ gap: 12 }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#FEF3C7',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#FDE68A',
        padding: 12,
      }}>
        <Text style={{ fontWeight: '800', fontSize: 14, color: '#92400E', marginBottom: 4 }}>
          Period overlap detected
        </Text>
        <Text style={{ fontSize: 12, color: '#78350F', lineHeight: 18 }}>
          {'This upload covers '}
          <Text style={{ fontWeight: '700' }}>
            {fmtPeriod(newStart)} – {fmtPeriod(newEnd)}
          </Text>
          {', which overlaps with '}
          {conflicts.length === 1 ? 'an existing report' : `${conflicts.length} existing reports`}
          {'. Choose how to proceed.'}
        </Text>
      </View>

      {/* Existing report cards */}
      {conflicts.map(c => (
        <View
          key={c.id}
          style={{
            borderWidth: 1.5,
            borderColor: '#E5E7EB',
            borderRadius: 10,
            padding: 12,
            backgroundColor: '#F9FAFB',
          }}
        >
          <Text style={{ fontWeight: '700', fontSize: 13, color: '#111827', marginBottom: 3 }}>
            {fmtPeriod(c.periodStart)} – {fmtPeriod(c.periodEnd)}
          </Text>
          <Text style={{ fontSize: 12, color: '#6B7280' }}>
            {c.source.toUpperCase()}
            {' · '}
            {c.lineCount} line{c.lineCount !== 1 ? 's' : ''}
            {c.totalRevenue !== null ? ` · ${fmtRevenue(c.totalRevenue)} revenue` : ''}
          </Text>
          <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
            Uploaded {fmtUploadDate(c.createdAt)}
          </Text>
        </View>
      ))}

      {/* Keep-Both confirmation sub-step */}
      {confirmKeepBoth ? (
        <View style={{
          backgroundColor: '#FEF2F2',
          borderRadius: 10,
          borderWidth: 1,
          borderColor: '#FCA5A5',
          padding: 12,
          gap: 10,
        }}>
          <Text style={{ fontWeight: '800', fontSize: 13, color: '#991B1B' }}>
            Are you sure?
          </Text>
          <Text style={{ fontSize: 12, color: '#7F1D1D', lineHeight: 18 }}>
            Keeping both reports will double-count sales for the overlapping period in Waste Control calculations. Only do this if the reports genuinely cover different items (e.g. different venue areas or POS terminals).
          </Text>
          <TouchableOpacity
            disabled={busy}
            onPress={onKeepBoth}
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: '#DC2626',
              opacity: busy ? 0.7 : 1,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center', fontSize: 13 }}>
              {busy ? 'Uploading…' : 'Yes, keep both reports'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={busy}
            onPress={() => setConfirmKeepBoth(false)}
            style={{ padding: 12, borderRadius: 8, backgroundColor: '#F3F4F6' }}
          >
            <Text style={{ color: '#111', fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
              Go back
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Replace */}
          <TouchableOpacity
            disabled={busy}
            onPress={onReplace}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: '#111',
              opacity: busy ? 0.7 : 1,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>
              {busy ? 'Uploading…' : replaceLabel}
            </Text>
          </TouchableOpacity>

          {/* Keep Both — visually flagged as unusual */}
          <TouchableOpacity
            disabled={busy}
            onPress={() => setConfirmKeepBoth(true)}
            style={{
              padding: 14,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: '#F59E0B',
              backgroundColor: '#FFFBEB',
              opacity: busy ? 0.7 : 1,
            }}
          >
            <Text style={{ color: '#92400E', fontWeight: '700', textAlign: 'center' }}>
              Keep both (unusual — may double-count)
            </Text>
          </TouchableOpacity>

          {/* Cancel */}
          <TouchableOpacity
            disabled={busy}
            onPress={onCancel}
            style={{ padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6' }}
          >
            <Text style={{ color: '#111', fontWeight: '800', textAlign: 'center' }}>
              ← Cancel upload
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}
