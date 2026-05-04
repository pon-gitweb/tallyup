export interface POSProduct {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  price?: number;
  unit?: string;
}

export interface POSSale {
  productId: string;
  productName: string;
  quantity: number;
  date: Date;
  revenue: number;
}

export interface POSAdapter {
  name: string;
  isConnected(): Promise<boolean>;
  getProducts(): Promise<POSProduct[]>;
  getSales(from: Date, to: Date): Promise<POSSale[]>;
  connect(credentials: Record<string, string>): Promise<void>;
  disconnect(): Promise<void>;
}
