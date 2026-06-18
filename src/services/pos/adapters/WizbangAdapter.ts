import { POSAdapter, POSProduct, POSSale, POSSaleItem } from '../POSService';

export class WizbangAdapter implements POSAdapter {
  readonly name = 'Wizbang Onetap';

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
    // Credentials are stored by the connection screen; real OAuth/API wiring pending partnership.
  }

  async disconnect(): Promise<void> {
  }
}
