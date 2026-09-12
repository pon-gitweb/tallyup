// @ts-nocheck
/**
 * FestivalLiveQRModal
 *
 * Displays a short-lived QR code that the location-holder shows to a runner.
 * The runner scans it with FestivalLocationScannerModal to prove co-presence.
 *
 * Payload: hosti-loc:{departmentId}:{areaId}:{generatedAtEpochMs}
 *
 * The timestamp is appended so the scanner can validate freshness entirely
 * on-device — no network round-trip, works offline.
 *
 * LIVE_QR_EXPIRY_MS is exported so callers can reason about expiry, but
 * the authoritative copy lives here. FestivalLocationScannerModal.tsx
 * defines its own matching constant (single-file duplication preferred
 * over cross-sibling import coupling).
 *
 * Phase 4b of the Festival Physical Handoff System.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useColours } from '../../../context/ThemeContext';

/**
 * How long a live code is valid.
 *
 * 3 minutes (180 000 ms): long enough that a runner standing right there can
 * open the scanner before it expires even after a phone-lock + navigate;
 * short enough that a screenshot from minutes ago cannot be reused.
 *
 * MUST match the same constant in FestivalLocationScannerModal.tsx.
 */
export const LIVE_QR_EXPIRY_MS = 3 * 60 * 1000;

/** Seconds remaining below which the countdown turns red */
const WARN_THRESHOLD_SEC = 30;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Department portion of the payload, e.g. 'hq' or a bar's departmentId */
  departmentId: string;
  /** Area portion of the payload, e.g. 'container-1' or 'back-of-house' */
  areaId: string;
  /** Human-readable name shown to the location-holder */
  locationDisplayName: string;
};

export default function FestivalLiveQRModal({
  visible, onClose, departmentId, areaId, locationDisplayName,
}: Props) {
  const c = useColours();

  // generatedAt: epoch ms when the current code was generated (reset on renew)
  const [generatedAt,   setGeneratedAt]   = useState<number | null>(null);
  const [remainingSec,  setRemainingSec]  = useState(Math.floor(LIVE_QR_EXPIRY_MS / 1000));

  const timerRef = useRef<any>(null);

  // Generate a fresh code whenever the modal becomes visible
  useEffect(() => {
    if (visible) {
      const now = Date.now();
      setGeneratedAt(now);
      setRemainingSec(Math.floor(LIVE_QR_EXPIRY_MS / 1000));
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [visible]);

  // Countdown — ticks every 500 ms to stay visually responsive without hammering the bridge
  useEffect(() => {
    if (!visible || generatedAt == null) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.floor((generatedAt + LIVE_QR_EXPIRY_MS - Date.now()) / 1000));
      setRemainingSec(remaining);
      if (remaining <= 0) clearInterval(timerRef.current);
    }, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [visible, generatedAt]);

  // Cleanup on unmount
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  if (!visible) return null;

  const expired  = remainingSec <= 0;
  const payload  = generatedAt != null
    ? `hosti-loc:${departmentId}:${areaId}:${generatedAt}`
    : '';
  const isWarning = !expired && remainingSec <= WARN_THRESHOLD_SEC;

  function formatRemaining(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function renewCode() {
    const now = Date.now();
    setGeneratedAt(now);
    setRemainingSec(Math.floor(LIVE_QR_EXPIRY_MS / 1000));
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={[S.sheet, { backgroundColor: c.surface, borderColor: c.border }]}>

          {/* ── Header ── */}
          <View style={S.header}>
            <View>
              <Text style={[S.title, { color: c.navy }]}>Live Location Code</Text>
              <Text style={[S.subtitle, { color: c.deepBlue }]}>{locationDisplayName}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Text style={{ fontSize: 20, color: c.slateMid }}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={[S.instructions, { color: c.slateMid }]}>
            Show this code to the runner. They scan it on their phone to confirm they're at the right location.
            The code expires in 3 minutes — generate a new one if needed.
          </Text>

          {/* ── QR area ── */}
          <View style={[S.qrWrapper, { backgroundColor: c.oat, borderColor: c.border }]}>
            {!expired && !!payload ? (
              <>
                <QRCode
                  value={payload}
                  size={200}
                  color={c.navy}
                  backgroundColor={c.oat}
                  quietZone={14}
                />
                <View style={[
                  S.timerPill,
                  isWarning
                    ? { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }
                    : { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
                ]}>
                  <Text style={[
                    S.timerText,
                    { color: isWarning ? '#DC2626' : '#16A34A' },
                  ]}>
                    {isWarning ? '⚠ Expiring soon · ' : ''}Expires in {formatRemaining(remainingSec)}
                  </Text>
                </View>
              </>
            ) : (
              /* Expired state */
              <View style={S.expiredBlock}>
                <Text style={{ fontSize: 44, marginBottom: 12 }}>⏱</Text>
                <Text style={[S.expiredTitle, { color: c.navy }]}>Code expired</Text>
                <Text style={[S.expiredSub,   { color: c.slateMid }]}>
                  This code is no longer valid.{'\n'}Generate a new one to continue.
                </Text>
              </View>
            )}
          </View>

          {/* ── Actions ── */}
          {expired ? (
            <TouchableOpacity
              style={[S.primaryBtn, { backgroundColor: c.deepBlue }]}
              onPress={renewCode}
            >
              <Text style={S.primaryBtnText}>Generate new code</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[S.secondaryBtn, { borderColor: c.border }]}
              onPress={onClose}
            >
              <Text style={[S.secondaryBtnText, { color: c.slateMid }]}>Done</Text>
            </TouchableOpacity>
          )}

        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 1, borderBottomWidth: 0,
    padding: 24, paddingBottom: 44,
  },

  header:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  title:        { fontSize: 18, fontWeight: '800' },
  subtitle:     { fontSize: 14, fontWeight: '700', marginTop: 2 },
  instructions: { fontSize: 13, lineHeight: 19, marginBottom: 20 },

  qrWrapper: {
    alignItems: 'center',
    borderRadius: 16, borderWidth: 1,
    padding: 20, marginBottom: 20,
  },
  timerPill: {
    marginTop: 14, borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  timerText:  { fontSize: 13, fontWeight: '700' },

  expiredBlock:  { alignItems: 'center', paddingVertical: 16 },
  expiredTitle:  { fontSize: 17, fontWeight: '800', marginBottom: 8 },
  expiredSub:    { fontSize: 13, textAlign: 'center', lineHeight: 20 },

  primaryBtn:     { borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn:   { borderRadius: 999, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5 },
  secondaryBtnText: { fontWeight: '700', fontSize: 15 },
});
