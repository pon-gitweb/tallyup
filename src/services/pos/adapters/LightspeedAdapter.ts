import { POSAdapter, POSProduct, POSSale, POSSaleItem } from '../POSService';

export class LightspeedAdapter implements POSAdapter {
  readonly name = 'Lightspeed';

  async isConnected(): Promise<boolean> {
    return false;
  }

  async getProducts(): Promise<POSProduct[]> {
    return [];
  }

  async getSales(_from: Date, _to: Date): Promise<POSSale[]> {
    return [];
  }

  async getSaleItems(): Promise<POSSaleItem[]> {
    return [];
  }

  async connect(_credentials: Record<string, string>): Promise<void> {
    // OAuth flow placeholder — will redirect to Lightspeed OAuth when implemented
  }

  async disconnect(): Promise<void> {
  }
}
