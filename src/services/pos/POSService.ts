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

// A till/menu item that needs to be mapped to a stock product or CraftIt recipe.
// Every POS adapter returns these; the mapping UI only ever speaks this shape.
export type POSSaleItem = {
  posItemId: string;
  posItemName: string;
  posSku: string | null;
  category: string | null;
  sellPrice: number | null;
};

export interface POSAdapter {
  name: string;
  isConnected(): Promise<boolean>;
  getProducts(): Promise<POSProduct[]>;
  getSales(from: Date, to: Date): Promise<POSSale[]>;
  getSaleItems(): Promise<POSSaleItem[]>;
  connect(credentials: Record<string, string>): Promise<void>;
  disconnect(): Promise<void>;
}
