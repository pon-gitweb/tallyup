// @ts-nocheck
/**
 * ScaleSettingsScreen
 * User selects their scale type, scans, and connects.
 * Shows live weight once connected.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { ScaleService, ScaleType, ScaleInfo, ScaleStatus } from '../../services/scale/ScaleService';
import { withErrorBoundary } from '../../components/ErrorCatcher';

const SCALE_TYPES: { type: ScaleType; name: string; description: string; price: string; link: string; verified: boolean }[] = [
  {
    type: 'decent',
    name: 'Decent Scale',
    description: 'Open BLE API, 0.1g accuracy, used in specialty cafés. Best in class for precision counting.',
    price: '~$200 NZD',
    link: 'decentespresso.com/scale',
    verified: false,
  },
  {
    type: 'skale',
    name: 'SKALE by Atomax',
    description: 'Open source SDK, compact kitchen scale. Great value for bar and kitchen inventory.',
    price: '~$100 NZD',
    link: 'skale.cc',
    verified: false,
  },
  {
    type: 'generic',
    name: 'Generic Bluetooth Scale',
    description: 'Works with Xiaomi, Etekcity, RENPHO and many common kitchen scales. If it connects via Bluetooth, try this.',
    price: '$30–$80 NZD',
    link: null,
    verified: false,
  },
];

function ScaleSettingsScreen() {
  const [selectedType, setSelectedType] = useState<ScaleType>(ScaleService.getScaleType());
  const [status, setStatus] = useState<ScaleStatus>(ScaleService.getStatus());
  const [scanning, setScanning] = useState(false);
  const [foundScales, setFoundScales] = useState<ScaleInfo[]>([]);
  const [weight, setWeight] = useState<number | null>(null);
  const [stable, setStable] = useState(false);

  useEffect(() => {
    ScaleService.init();
    const unsubStatus = ScaleService.onStatus(setStatus);
    const unsubWeight = ScaleService.onWeight(r => {
      setWeight(r.weightGrams);
      setStable(r.stable);
    });
    return () => { unsubStatus(); unsubWeight(); };
  }, []);

  const onScan = useCallback(async () => {
    if (!selectedType) {
      Alert.alert('Select a scale type', 'Choose which scale you have before scanning.');
      return;
    }
    setFoundScales([]);
    setScanning(true);
    try {
      await ScaleService.scan(scale => {
        setFoundScales(prev => {
          if (prev.find(s => s.id === scale.id)) return prev;
          return [...prev, scale];
        });
      }, 8000);
    } catch (e: any) {
      Alert.alert('Scan failed', e?.message || 'Could not scan for scales.');
    } finally {
      setScanning(false);
    }
  }, [selectedType]);

  const onConnect = useCallback(async (scale: ScaleInfo) => {
    try {
      await ScaleService.connect(scale.id, selectedType);
    } catch (e: any) {
      Alert.alert('Connection failed', e?.message || 'Could not connect to scale.');
    }
  }, [selectedType]);

  const onDisconnect = useCallback(async () => {
    await ScaleService.disconnect();
    setWeight(null);
  }, []);

  const onTare = useCallback(async () => {
    await ScaleService.tare();
  }, []);

  const isConnected = status === 'connected';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <View>
        <Text style={{ fontSize: 22, fontWeight: '900' }}>Bluetooth Scale</Text>
        <Text style={{ color: '#6B7280', marginTop: 4, fontSize: 14 }}>
          Connect a Bluetooth scale for automatic weight-based counting. Works with the scales below — we're currently testing and verifying each model. If yours works, let us know!
        </Text>
      </View>

      {/* Live weight display when connected */}
      {isConnected && (
        <View style={{ backgroundColor: '#F0FDF4', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#BBF7D0', alignItems: 'center' }}>
          <Text style={{ color: '#166534', fontWeight: '700', marginBottom: 8 }}>
            ⚖️ Scale connected
          </Text>
          <Text style={{ fontSize: 56, fontWeight: '900', color: '#111' }}>
            {weight != null ? weight.toFixed(1) : '—'}
            <Text style={{ fontSize: 20, color: '#6B7280' }}> g</Text>
          </Text>
          {stable && <Text style={{ color: '#16A34A', fontWeight: '700', marginTop: 4 }}>Stable ✓</Text>}
          {!stable && weight != null && <Text style={{ color: '#D97706', fontWeight: '700', marginTop: 4 }}>Settling...</Text>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity onPress={onTare}
              style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#BBF7D0', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: '#166534' }}>Tare (Zero)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDisconnect}
              style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: '#DC2626' }}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Scale type picker */}
      {!isConnected && (
        <>
          <Text style={{ fontWeight: '900', fontSize: 16 }}>1. Choose your scale</Text>
          {SCALE_TYPES.map(s => (
            <TouchableOpacity key={s.type} onPress={() => setSelectedType(s.type)}
              style={{
                borderRadius: 14, padding: 14, borderWidth: 2,
                borderColor: selectedType === s.type ? '#0A84FF' : '#E5E7EB',
                backgroundColor: selectedType === s.type ? '#EFF6FF' : '#F9FAFB',
              }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '900', fontSize: 15, color: selectedType === s.type ? '#0A84FF' : '#111' }}>
                  {s.name}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Text style={{ color: '#6B7280', fontSize: 12, fontWeight: '700' }}>{s.price}</Text>
                  <View style={{
                    backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2,
                    borderRadius: 999, borderWidth: 1, borderColor: '#FDE68A',
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#92400E' }}>Verifying</Text>
                  </View>
                </View>
              </View>
              <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 4 }}>{s.description}</Text>
              {s.link && (
                <Text style={{ color: '#0A84FF', fontSize: 12, marginTop: 4 }}>{s.link}</Text>
              )}
              {selectedType === s.type && (
                <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#0A84FF' }} />
                  <Text style={{ color: '#0A84FF', fontWeight: '700', fontSize: 12 }}>Selected</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}

          {/* Scan button */}
          <Text style={{ fontWeight: '900', fontSize: 16, marginTop: 4 }}>2. Scan and connect</Text>
          <TouchableOpacity onPress={onScan} disabled={scanning || !selectedType}
            style={{
              backgroundColor: selectedType ? '#111' : '#E5E7EB',
              padding: 16, borderRadius: 12, alignItems: 'center',
            }}>
            {scanning
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: selectedType ? '#fff' : '#9CA3AF', fontWeight: '900', fontSize: 16 }}>
                  {scanning ? 'Scanning...' : '🔍 Scan for scales'}
                </Text>
            }
          </TouchableOpacity>

          {scanning && (
            <Text style={{ color: '#6B7280', textAlign: 'center', fontSize: 13 }}>
              Make sure your scale is powered on and in pairing mode...
            </Text>
          )}

          {/* Found scales */}
          {foundScales.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={{ fontWeight: '800', fontSize: 15 }}>Found scales:</Text>
              {foundScales.map(scale => (
                <View key={scale.id} style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  padding: 12, borderRadius: 12, backgroundColor: '#F9FAFB',
                  borderWidth: 1, borderColor: '#E5E7EB',
                }}>
                  <View>
                    <Text style={{ fontWeight: '800' }}>{scale.name || 'Unknown device'}</Text>
                    <Text style={{ color: '#6B7280', fontSize: 12 }}>
                      {scale.type} · Signal: {scale.rssi ? scale.rssi + ' dBm' : 'unknown'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => onConnect(scale)}
                    style={{ backgroundColor: '#0A84FF', padding: 10, borderRadius: 10 }}>
                    {status === 'connecting'
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: '#fff', fontWeight: '800' }}>Connect</Text>
                    }
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {!scanning && foundScales.length === 0 && status !== 'disconnected' && (
            <View style={{ backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FECACA' }}>
              <Text style={{ fontWeight: '800', color: '#DC2626', marginBottom: 4 }}>No scales found</Text>
              <Text style={{ color: '#DC2626', fontSize: 13 }}>
                Make sure your scale is on and in pairing mode. Try moving it closer to your phone.
              </Text>
            </View>
          )}
        </>
      )}

      {/* Partnership note */}
      <View style={{ backgroundColor: '#F0F9FF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BAE6FD', marginTop: 8 }}>
        <Text style={{ fontWeight: '800', color: '#0369A1', marginBottom: 4 }}>📶 About Bluetooth scales</Text>
        <Text style={{ color: '#0369A1', fontSize: 13 }}>
          Hosti-Stock is built for Bluetooth scale integration. We support Decent Scale, SKALE, and generic BLE scales — and we're actively testing hardware to confirm compatibility.{'\n\n'}
          If your scale works, we'd love to hear about it. If it doesn't, we're working on it — hardware verification partnerships are in progress.
        </Text>
      </View>

    </ScrollView>
  );
}

export default withErrorBoundary(ScaleSettingsScreen, 'ScaleSettings');
