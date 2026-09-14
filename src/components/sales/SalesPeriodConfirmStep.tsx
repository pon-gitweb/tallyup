/**
 * SalesPeriodConfirmStep
 *
 * Rendered inline inside SalesReportUploadPanel and SalesImportPanel after a
 * sales file has been parsed.  It shows a date-range picker pre-filled with
 * any period the parser extracted from the file, then requires the user to
 * explicitly confirm (or correct) the dates before the report is uploaded.
 *
 * The parser's suggested values are NEVER silently accepted — the Confirm
 * button is always required, even when both dates are pre-filled.
 */
// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

function toYMD(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function parseYMD(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + 'T12:00:00'); // noon local to avoid DST-midnight ambiguity
  return isFinite(d.getTime()) ? d : null;
}

function fmtDisplay(d: Date | null): string {
  if (!d) return 'Select date';
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Props = {
  /** Pre-fill values from the CSV/PDF parser — YYYY-MM-DD or null. */
  suggestedStart: string | null;
  suggestedEnd: string | null;
  /** Summary line shown above the pickers, e.g. "48 products parsed". */
  summaryLine?: string;
  /** Called with confirmed YYYY-MM-DD strings once the user taps Confirm. */
  onConfirm: (start: string, end: string) => void;
  /** Called when the user taps Cancel (goes back to the upload button). */
  onCancel: () => void;
  busy?: boolean;
};

export default function SalesPeriodConfirmStep({
  suggestedStart,
  suggestedEnd,
  summaryLine,
  onConfirm,
  onCancel,
  busy = false,
}: Props) {
  const [startDate, setStartDate] = useState<Date | null>(parseYMD(suggestedStart));
  const [endDate,   setEndDate]   = useState<Date | null>(parseYMD(suggestedEnd));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker,   setShowEndPicker]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasPrefilled = !!(suggestedStart && suggestedEnd);

  function handleConfirm() {
    if (!startDate || !endDate) {
      setError('Please select both a start date and an end date.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setError(null);
    onConfirm(toYMD(startDate), toYMD(endDate));
  }

  return (
    <View style={{ gap: 12 }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#EFF6FF',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#DBEAFE',
        padding: 12,
      }}>
        <Text style={{ fontWeight: '800', fontSize: 14, color: '#1D4ED8', marginBottom: 4 }}>
          Confirm report period
        </Text>
        {summaryLine ? (
          <Text style={{ fontSize: 13, color: '#1D4ED8', opacity: 0.85, marginBottom: 6 }}>
            {summaryLine}
          </Text>
        ) : null}
        <Text style={{ fontSize: 12, color: '#374151', lineHeight: 17 }}>
          {wasPrefilled
            ? 'Dates were read from your file — please confirm they are correct before uploading.'
            : 'Your file did not include period dates. Select the date range this report covers before uploading.'}
        </Text>
      </View>

      {/* Start date */}
      <View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 4 }}>
          Period start
        </Text>
        <TouchableOpacity
          onPress={() => { setShowStartPicker(true); setShowEndPicker(false); }}
          style={{
            borderWidth: 1.5,
            borderColor: startDate ? '#1D4ED8' : '#D1D5DB',
            borderRadius: 10,
            padding: 12,
            backgroundColor: '#fff',
          }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 14, color: startDate ? '#0B132B' : '#9CA3AF' }}>
            {fmtDisplay(startDate)}
          </Text>
        </TouchableOpacity>
        {showStartPicker && (
          <DateTimePicker
            value={startDate ?? new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, selected) => {
              if (Platform.OS !== 'ios') setShowStartPicker(false);
              if (event?.type === 'dismissed' || !selected) return;
              setStartDate(selected);
              setError(null);
            }}
          />
        )}
        {Platform.OS === 'ios' && showStartPicker && (
          <TouchableOpacity
            onPress={() => setShowStartPicker(false)}
            style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 }}
          >
            <Text style={{ color: '#1D4ED8', fontWeight: '700' }}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* End date */}
      <View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 4 }}>
          Period end
        </Text>
        <TouchableOpacity
          onPress={() => { setShowEndPicker(true); setShowStartPicker(false); }}
          style={{
            borderWidth: 1.5,
            borderColor: endDate ? '#1D4ED8' : '#D1D5DB',
            borderRadius: 10,
            padding: 12,
            backgroundColor: '#fff',
          }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 14, color: endDate ? '#0B132B' : '#9CA3AF' }}>
            {fmtDisplay(endDate)}
          </Text>
        </TouchableOpacity>
        {showEndPicker && (
          <DateTimePicker
            value={endDate ?? startDate ?? new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={startDate ?? undefined}
            onChange={(event, selected) => {
              if (Platform.OS !== 'ios') setShowEndPicker(false);
              if (event?.type === 'dismissed' || !selected) return;
              setEndDate(selected);
              setError(null);
            }}
          />
        )}
        {Platform.OS === 'ios' && showEndPicker && (
          <TouchableOpacity
            onPress={() => setShowEndPicker(false)}
            style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 }}
          >
            <Text style={{ color: '#1D4ED8', fontWeight: '700' }}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Validation error */}
      {error ? (
        <Text style={{ fontSize: 13, color: '#DC2626', fontWeight: '600' }}>{error}</Text>
      ) : null}

      {/* Action buttons */}
      <TouchableOpacity
        disabled={busy}
        onPress={handleConfirm}
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: '#111',
          opacity: busy ? 0.7 : 1,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>
          {busy ? 'Uploading…' : 'Confirm & upload'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        disabled={busy}
        onPress={onCancel}
        style={{ padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6' }}
      >
        <Text style={{ color: '#111', fontWeight: '800', textAlign: 'center' }}>
          ← Back
        </Text>
      </TouchableOpacity>
    </View>
  );
}
