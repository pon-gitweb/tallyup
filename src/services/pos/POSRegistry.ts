import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { POSAdapter } from './POSService';
import { MockPOSAdapter } from './adapters/MockPOSAdapter';
import { WizbangAdapter } from './adapters/WizbangAdapter';
import { LightspeedAdapter } from './adapters/LightspeedAdapter';
import { SquareAdapter } from './adapters/SquareAdapter';

const ADAPTERS: Record<string, POSAdapter> = {
  mock: new MockPOSAdapter(),
  wizbang: new WizbangAdapter(),
  lightspeed: new LightspeedAdapter(),
  square: new SquareAdapter(),
};

export function getAdapter(name: string): POSAdapter {
  const adapter = ADAPTERS[name.toLowerCase()];
  if (!adapter) throw new Error(`No POS adapter registered for: ${name}`);
  return adapter;
}

export function listAdapters(): string[] {
  return Object.keys(ADAPTERS);
}

export async function getCurrentAdapter(venueId: string): Promise<POSAdapter | null> {
  try {
    const snap = await getDoc(doc(db, 'venues', venueId, 'posIntegration', 'config'));
    if (!snap.exists()) return null;
    const adapterName: string = (snap.data() as any)?.adapter ?? '';
    if (!adapterName) return null;
    return ADAPTERS[adapterName.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}
