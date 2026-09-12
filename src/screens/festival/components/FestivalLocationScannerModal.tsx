// @ts-nocheck
/**
 * FestivalLocationScannerModal
 *
 * Scans a hosti-loc QR code and validates it against the expected location.
 * On match → calls onVerified() so the caller can proceed with the write.
 * On mismatch → shows inline error with a "scan again" path (never blocks forever).
 * Manual entry fallback shows the expected payload so staff can type/paste it.
 *
 * QR payload format: hosti-loc:{departmentId}:{areaId}
 *
 * Phase 4a of the Festival Physical Handoff System.
 * Phase 4b (live_handshake) is NOT built here.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, Vibration, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Department portion of the expected QR payload, e.g. 'hq' or the bar's departmentId */
  expectedDepartmentId: string;
  /** Area portion of the expected QR payload, e.g. 'container-1' or 'back-of-house' */
  expectedAreaId: string;
  /** Human-readable name shown in the prompt and error messages */
  locationDisplayName: string;
  /** Called when the scanned (or manually entered) payload exactly matches the expected location */
  onVerified: () => void;
};

export default function FestivalLocationScannerModal({
  visible,
  onClose,
  expectedDepartmentId,
  expectedAreaId,
  locationDisplayName,
  onVerified,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError]             = useState<string | null>(null);
  const [showManual, setShowManual]   = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [hintVisible, setHintVisible] = useState(false);

  // Cooldown prevents double-fires on a single QR detection event
  const cooldown  = useRef(false);
  const hintTimer = useRef<any>(null);

  // Reset all state each time the modal opens or closes
  useEffect(() => {
    if (visible) {
      setError(null);
      setShowManual(false);
      setManualValue('');
      setHintVisible(false);
      cooldown.current = false;
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHintVisible(true), 8000);
    } else {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    }
  }, [visible]);

  // Cleanup on unmount
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  // ── Validation ──────────────────────────────────────────────────────────────

  function validatePayload(raw: string) {
    const trimmed = (raw ?? '').trim();

    if (!trimmed.startsWith('hosti-loc:')) {
      setError('Not a location QR code — make sure you\'re scanning the Hosti location code.');
      cooldown.current = false;
      return;
    }

    // Split carefully: parts[1] = departmentId, parts[2..] = areaId (join in case areaId contains ':')
    const parts = trimmed.split(':');
    if (parts.length < 3) {
      setError('QR code is incomplete — scan again or use manual entry.');
      cooldown.current = false;
      return;
    }

    const scannedDept = parts[1];
    const scannedArea = parts.slice(2).join(':');

    if (scannedDept !== expectedDepartmentId || scannedArea !== expectedAreaId) {
      // Double-vibrate: tactile mismatch signal
      Vibration.vibrate([0, 80, 100, 80]);
      const scannedName = `${scannedDept} / ${scannedArea}`;
      setError(
        `Wrong location.\n\nExpected: ${locationDisplayName}\nScanned: ${scannedName}\n\nMake sure you're at the right spot before continuing.`
      );
      cooldown.current = false;
      return;
    }

    // Match — single long vibrate for success
    Vibration.vibrate(150);
    onVerified();
  }

  // ── Scan handler ────────────────────────────────────────────────────────────

  function onBarcodeScanned({ data }: { data: string }) {
    if (!data || cooldown.current) return;
    cooldown.current = true;
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHintVisible(false);
    validatePayload(data);
  }

  // ── Manual entry submit ─────────────────────────────────────────────────────

  function submitManual() {
    const v = manualValue.trim();
    if (!v) return;
    setManualValue('');
    setShowManual(false);
    validatePayload(v);
  }

  // ── Early-exit guards ────────────────────────────────────────────────────────

  if (!visible) return null;

  if (!permission) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
          <ActivityIndicator color="#fff" />
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#111' }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 12, textAlign: 'center' }}>
            Camera permission needed
          </Text>
          <Text style={{ color: '#9CA3AF', textAlign: 'center', marginBottom: 24, lineHeight: 21 }}>
            Hosti needs camera access to scan location QR codes.
          </Text>
          <TouchableOpacity
            onPress={requestPermission}
            style={{ backgroundColor: '#0A84FF', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginBottom: 12 }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Grant permission</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: '#9CA3AF', fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  const expectedPayload = `hosti-loc:${expectedDepartmentId}:${expectedAreaId}`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>

        {/* Live camera — hidden while showing the error panel to remove distraction */}
        {!error && (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcodeScanned}
          />
        )}

        {/* Static dark backdrop shown while error is displayed */}
        {!!error && <View style={{ flex: 1, backgroundColor: '#111' }} />}

        {/* ── Overlay ── */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' }}>

          {/* Top bar */}
          <View style={{ backgroundColor: 'rgba(0,0,0,0.72)', padding: 16, paddingTop: 52, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>
              Scan Location QR
            </Text>
            <Text style={{ color: '#9CA3AF', fontSize: 13, marginTop: 4, textAlign: 'center' }}>
              {locationDisplayName}
            </Text>
          </View>

          {/* Centre: scan frame or error */}
          <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>

            {!error ? (
              <>
                {/* Square QR scan frame */}
                <View style={{
                  width: 220, height: 220, borderRadius: 16,
                  borderWidth: 3, borderColor: '#0A84FF',
                  backgroundColor: 'transparent',
                }}>
                  {/* Corner accent marks */}
                  {[
                    { top: -2, left: -2 }, { top: -2, right: -2 },
                    { bottom: -2, left: -2 }, { bottom: -2, right: -2 },
                  ].map((style, i) => (
                    <View key={i} style={[{
                      position: 'absolute', width: 22, height: 22,
                      borderColor: '#fff', borderWidth: 3,
                    }, style]} />
                  ))}
                </View>

                {/* Lighting/stability hint after 8 s */}
                {hintVisible && (
                  <Text style={{
                    color: 'rgba(255,255,255,0.7)', fontSize: 12,
                    textAlign: 'center', marginTop: 14, lineHeight: 18,
                  }}>
                    Having trouble? Try better lighting or hold the phone steadier.
                  </Text>
                )}
              </>
            ) : (
              /* Error panel — inline, always visible, no Alert */
              <View style={{
                backgroundColor: 'rgba(239,68,68,0.14)',
                borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(239,68,68,0.55)',
                padding: 20, width: '100%',
              }}>
                <Text style={{ color: '#FCA5A5', fontSize: 16, fontWeight: '800', marginBottom: 10, textAlign: 'center' }}>
                  ✗ Wrong location
                </Text>
                <Text style={{ color: '#FEE2E2', fontSize: 13, lineHeight: 21, textAlign: 'center' }}>
                  {error}
                </Text>
                <TouchableOpacity
                  onPress={() => { setError(null); cooldown.current = false; }}
                  style={{
                    backgroundColor: '#0A84FF', borderRadius: 10,
                    paddingVertical: 12, alignItems: 'center', marginTop: 16,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Scan again</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Manual entry fallback */}
            <View style={{ marginTop: 18, width: '100%', alignItems: 'center' }}>
              {!showManual ? (
                <TouchableOpacity onPress={() => setShowManual(true)}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, textDecorationLine: 'underline' }}>
                    Can't scan? Enter the location code manually
                  </Text>
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={{
                    color: 'rgba(255,255,255,0.5)', fontSize: 11,
                    marginBottom: 6, textAlign: 'center',
                  }}>
                    Expected: {expectedPayload}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                    <TextInput
                      style={{
                        flex: 1,
                        backgroundColor: 'rgba(255,255,255,0.13)',
                        borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
                        color: '#fff', fontSize: 13,
                        borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
                      }}
                      value={manualValue}
                      onChangeText={setManualValue}
                      placeholder={expectedPayload}
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="go"
                      onSubmitEditing={submitManual}
                    />
                    <TouchableOpacity
                      onPress={submitManual}
                      disabled={!manualValue.trim()}
                      style={{
                        backgroundColor: '#0A84FF', borderRadius: 8,
                        paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
                        opacity: manualValue.trim() ? 1 : 0.45,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Verify</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* Bottom cancel */}
          <View style={{ backgroundColor: 'rgba(0,0,0,0.72)', padding: 24 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ backgroundColor: '#1F2937', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}
