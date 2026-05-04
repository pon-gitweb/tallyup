import { POSAdapter, POSProduct, POSSale } from '../POSService';

const NOT_IMPLEMENTED =
  'Wizbang integration coming soon.\nContact support@wizbang.co.nz to request access.';

export class WizbangAdapter implements POSAdapter {
  readonly name = 'Wizbang Onetap';

  async isConnected(): Promise<boolean> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getProducts(): Promise<POSProduct[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getSales(_from: Date, _to: Date): Promise<POSSale[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async connect(_credentials: Record<string, string>): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async disconnect(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
