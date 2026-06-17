import { POSAdapter, POSProduct, POSSale, POSSaleItem } from '../POSService';

const NOT_IMPLEMENTED = 'Square integration coming soon.';

export class SquareAdapter implements POSAdapter {
  readonly name = 'Square';

  async isConnected(): Promise<boolean> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getProducts(): Promise<POSProduct[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getSales(_from: Date, _to: Date): Promise<POSSale[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getSaleItems(): Promise<POSSaleItem[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async connect(_credentials: Record<string, string>): Promise<void> {
    // OAuth flow placeholder — will redirect to Square OAuth when implemented
    throw new Error(NOT_IMPLEMENTED);
  }

  async disconnect(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
