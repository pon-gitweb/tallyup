// @ts-nocheck
/**
 * ScaleService — Bluetooth scale integration for Hosti-Stock
 *
 * Supports three scale families out of the box:
 *  1. Decent Scale (decentespresso.com) — open BLE API
 *  2. SKALE by Atomax (skale.cc) — open source SDK
 *  3. Generic BLE scales (Xiaomi, Etekcity, RENPHO, etc)
 *
 * Architecture: each scale type has its own adapter that translates
 * raw BLE bytes into a standard WeightReading event. The rest of the
 * app only ever sees { weightGrams: number }.
 *
 * User selects their scale type in Settings → Connect Scale.
 * App scans, connects, and streams weight into stocktake.
 */

import { BleManager, Device, Characteristic, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ScaleType = 'decent' | 'skale' | 'generic' | null;

export type WeightReading = {
  weightGrams: number;
  stable: boolean;
  timestamp: number;
};

export type ScaleStatus =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error';

export type ScaleInfo = {
  id: string;
  name: string | null;
  type: ScaleType;
  rssi?: number;
};

// ── Scale adapter definitions ─────────────────────────────────────────────────

const DECENT_SCALE = {
  name: 'Decent Scale',
  serviceUUID: '0000FFF0-0000-1000-8000-00805F9B34FB',
  weightCharUUID: '0000FFF4-0000-1000-8000-00805F9B34FB',
  writeCharUUID: '0000FFF4-0000-1000-8000-00805F9B34FB',
  // Commands
  ledOn: '030A0101000108',
  tare: '030F000000010E',
  heartbeat: '030A03FFFF000A',
  parseWeight: (bytes: number[]): number => {
    // Bytes 2+3 are signed 16-bit integer, value in 0.1g units
    const raw = (bytes[2] << 8) | bytes[3];
    const signed = raw > 32767 ? raw - 65536 : raw;
    return signed / 10;
  },
};

const SKALE = {
  namePrefix: 'Skale',
  serviceUUID: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
  weightCharUUID: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
  writeCharUUID: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E',
  parseWeight: (bytes: number[]): number => {
    // SKALE sends weight as big-endian 16-bit in grams * 10
    if (bytes.length < 2) return 0;
    const raw = (bytes[0] << 8) | bytes[1];
    return raw / 10;
  },
};

const GENERIC_BLE = {
  // Generic scales often use weight in bytes 1-2 or 3-4
  // We try common patterns
  parseWeight: (bytes: number[]): number | null => {
    if (bytes.length < 2) return null;
    // Pattern 1: bytes 1+2 big-endian, /100
    const p1 = ((bytes[1] << 8) | bytes[2]) / 100;
    if (p1 > 0 && p1 < 50000) return p1;
    // Pattern 2: bytes 3+4 big-endian, /10
    if (bytes.length >= 5) {
      const p2 = ((bytes[3] << 8) | bytes[4]) / 10;
      if (p2 > 0 && p2 < 50000) return p2;
    }
    return null;
  },
};

// ── ScaleService ──────────────────────────────────────────────────────────────

const STORAGE_KEY = '@hosti_scale_type';

class ScaleServiceClass {
  private manager: BleManager | null = null;
  private connectedDevice: Device | null = null;
  private scaleType: ScaleType = null;
  private status: ScaleStatus = 'disconnected';
  private weightListeners: ((reading: WeightReading) => void)[] = [];
  private statusListeners: ((status: ScaleStatus) => void)[] = [];
  private heartbeatInterval: any = null;
  private lastWeight: number = 0;
  private stableCount: number = 0;

  async init() {
    try {
      const { BleManager: BM } = require('react-native-ble-plx');
      this.manager = new BM();
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) this.scaleType = saved as ScaleType;
    } catch (e) {
      console.log('[ScaleService] init error', e);
    }
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
    }
    return true;
  }

  async setScaleType(type: ScaleType) {
    this.scaleType = type;
    await AsyncStorage.setItem(STORAGE_KEY, type || '');
  }

  getScaleType(): ScaleType { return this.scaleType; }
  getStatus(): ScaleStatus { return this.status; }

  onWeight(fn: (r: WeightReading) => void) {
    this.weightListeners.push(fn);
    return () => { this.weightListeners = this.weightListeners.filter(l => l !== fn); };
  }

  onStatus(fn: (s: ScaleStatus) => void) {
    this.statusListeners.push(fn);
    return () => { this.statusListeners = this.statusListeners.filter(l => l !== fn); };
  }

  private emitWeight(reading: WeightReading) {
    this.weightListeners.forEach(l => { try { l(reading); } catch {} });
  }

  private emitStatus(status: ScaleStatus) {
    this.status = status;
    this.statusListeners.forEach(l => { try { l(status); } catch {} });
  }

  async scan(onFound: (scale: ScaleInfo) => void, timeoutMs = 10000): Promise<void> {
    if (!this.manager) await this.init();
    const ok = await this.requestPermissions();
    if (!ok) throw new Error('Bluetooth permissions not granted');

    this.emitStatus('scanning');
    const found = new Map<string, ScaleInfo>();

    this.manager!.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error || !device) return;
      const name = device.name || device.localName || '';
      let type: ScaleType = null;

      if (name.toLowerCase().includes('decent scale')) type = 'decent';
      else if (name.toLowerCase().includes('skale')) type = 'skale';
      else if (name.toLowerCase().includes('scale') || name.toLowerCase().includes('weigh')) type = 'generic';

      if (type && !found.has(device.id)) {
        const info: ScaleInfo = { id: device.id, name, type, rssi: device.rssi ?? undefined };
        found.set(device.id, info);
        onFound(info);
      }
    });

    await new Promise(r => setTimeout(r, timeoutMs));
    this.manager!.stopDeviceScan();
    if (this.status === 'scanning') this.emitStatus('disconnected');
  }

  stopScan() {
    try { this.manager?.stopDeviceScan(); } catch {}
    if (this.status === 'scanning') this.emitStatus('disconnected');
  }

  async connect(deviceId: string, type: ScaleType): Promise<void> {
    if (!this.manager) await this.init();
    this.emitStatus('connecting');
    await this.setScaleType(type);

    try {
      const device = await this.manager!.connectToDevice(deviceId);
      await device.discoverAllServicesAndCharacteristics();
      this.connectedDevice = device;
      this.emitStatus('connected');

      // Start weight notifications based on scale type
      if (type === 'decent') await this.startDecentScale(device);
      else if (type === 'skale') await this.startSkale(device);
      else await this.startGeneric(device);

      // Handle disconnection
      device.onDisconnected(() => {
        this.connectedDevice = null;
        this.stopHeartbeat();
        this.emitStatus('disconnected');
      });
    } catch (e: any) {
      this.emitStatus('error');
      throw new Error('Could not connect: ' + (e?.message || String(e)));
    }
  }

  private async startDecentScale(device: Device) {
    // Send LED on to activate
    try {
      await device.writeCharacteristicWithResponseForService(
        DECENT_SCALE.serviceUUID,
        DECENT_SCALE.writeCharUUID,
        Buffer.from(DECENT_SCALE.ledOn, 'hex').toString('base64')
      );
    } catch {}

    // Start heartbeat (required every 5s)
    this.heartbeatInterval = setInterval(async () => {
      try {
        await device.writeCharacteristicWithResponseForService(
          DECENT_SCALE.serviceUUID,
          DECENT_SCALE.writeCharUUID,
          Buffer.from(DECENT_SCALE.heartbeat, 'hex').toString('base64')
        );
      } catch {}
    }, 4000);

    // Subscribe to weight
    device.monitorCharacteristicForService(
      DECENT_SCALE.serviceUUID,
      DECENT_SCALE.weightCharUUID,
      (error, char) => {
        if (error || !char?.value) return;
        const bytes = Array.from(Buffer.from(char.value, 'base64'));
        const weight = DECENT_SCALE.parseWeight(bytes);
        this.handleWeight(weight);
      }
    );
  }

  private async startSkale(device: Device) {
    device.monitorCharacteristicForService(
      SKALE.serviceUUID,
      SKALE.weightCharUUID,
      (error, char) => {
        if (error || !char?.value) return;
        const bytes = Array.from(Buffer.from(char.value, 'base64'));
        const weight = SKALE.parseWeight(bytes);
        this.handleWeight(weight);
      }
    );
  }

  private async startGeneric(device: Device) {
    // For generic scales, try to find a characteristic that sends weight data
    const services = await device.services();
    for (const service of services) {
      const chars = await service.characteristics();
      for (const char of chars) {
        if (char.isNotifiable) {
          char.monitor((error, c) => {
            if (error || !c?.value) return;
            const bytes = Array.from(Buffer.from(c.value, 'base64'));
            const weight = GENERIC_BLE.parseWeight(bytes);
            if (weight !== null) this.handleWeight(weight);
          });
        }
      }
    }
  }

  private handleWeight(weightGrams: number) {
    const stable = Math.abs(weightGrams - this.lastWeight) < 0.5;
    if (stable) this.stableCount++;
    else this.stableCount = 0;
    this.lastWeight = weightGrams;
    this.emitWeight({
      weightGrams,
      stable: this.stableCount >= 3,
      timestamp: Date.now(),
    });
  }

  async tare(): Promise<void> {
    if (!this.connectedDevice || this.scaleType !== 'decent') return;
    try {
      await this.connectedDevice.writeCharacteristicWithResponseForService(
        DECENT_SCALE.serviceUUID,
        DECENT_SCALE.writeCharUUID,
        Buffer.from(DECENT_SCALE.tare, 'hex').toString('base64')
      );
    } catch {}
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    try { await this.connectedDevice?.cancelConnection(); } catch {}
    this.connectedDevice = null;
    this.emitStatus('disconnected');
  }

  isConnected(): boolean { return this.status === 'connected'; }
}

export const ScaleService = new ScaleServiceClass();
