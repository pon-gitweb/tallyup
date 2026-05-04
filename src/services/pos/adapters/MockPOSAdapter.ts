import { POSAdapter, POSProduct, POSSale } from '../POSService';

const MOCK_PRODUCTS: POSProduct[] = [
  { id: 'p01', name: 'Heineken 330ml', sku: 'HNK330', category: 'Beer', price: 8.50, unit: 'bottle' },
  { id: 'p02', name: 'Stella Artois 330ml', sku: 'STA330', category: 'Beer', price: 8.00, unit: 'bottle' },
  { id: 'p03', name: 'Corona 330ml', sku: 'COR330', category: 'Beer', price: 8.50, unit: 'bottle' },
  { id: 'p04', name: 'Guinness Draught 440ml', sku: 'GUI440', category: 'Beer', price: 10.00, unit: 'can' },
  { id: 'p05', name: 'Jack Daniels Whiskey 700ml', sku: 'JD700', category: 'Spirits', price: 52.00, unit: 'bottle' },
  { id: 'p06', name: 'Jameson Irish Whiskey 700ml', sku: 'JAM700', category: 'Spirits', price: 48.00, unit: 'bottle' },
  { id: 'p07', name: 'Bombay Sapphire Gin 700ml', sku: 'BSG700', category: 'Spirits', price: 44.00, unit: 'bottle' },
  { id: 'p08', name: "Hendrick's Gin 700ml", sku: 'HNG700', category: 'Spirits', price: 58.00, unit: 'bottle' },
  { id: 'p09', name: 'Grey Goose Vodka 700ml', sku: 'GGV700', category: 'Spirits', price: 62.00, unit: 'bottle' },
  { id: 'p10', name: 'Absolut Vodka 700ml', sku: 'ABV700', category: 'Spirits', price: 38.00, unit: 'bottle' },
  { id: 'p11', name: 'Bacardi White Rum 700ml', sku: 'BCR700', category: 'Spirits', price: 36.00, unit: 'bottle' },
  { id: 'p12', name: 'Captain Morgan Spiced Rum 700ml', sku: 'CMR700', category: 'Spirits', price: 40.00, unit: 'bottle' },
  { id: 'p13', name: 'Cointreau 700ml', sku: 'CTR700', category: 'Liqueur', price: 46.00, unit: 'bottle' },
  { id: 'p14', name: 'Aperol 700ml', sku: 'APR700', category: 'Liqueur', price: 34.00, unit: 'bottle' },
  { id: 'p15', name: 'Marlborough Sauvignon Blanc 750ml', sku: 'MSB750', category: 'Wine', price: 22.00, unit: 'bottle' },
  { id: 'p16', name: 'Central Otago Pinot Noir 750ml', sku: 'COPN750', category: 'Wine', price: 28.00, unit: 'bottle' },
  { id: 'p17', name: 'Prosecco 750ml', sku: 'PRO750', category: 'Wine', price: 24.00, unit: 'bottle' },
  { id: 'p18', name: 'Lemon Lime Bitters 750ml', sku: 'LLB750', category: 'Non-Alcoholic', price: 5.50, unit: 'bottle' },
  { id: 'p19', name: 'Coca-Cola 330ml', sku: 'COK330', category: 'Non-Alcoholic', price: 4.50, unit: 'can' },
  { id: 'p20', name: 'Feijoa & Lime Soda 250ml', sku: 'FLS250', category: 'Non-Alcoholic', price: 5.00, unit: 'can' },
];

function generateSales(from: Date, to: Date): POSSale[] {
  const sales: POSSale[] = [];
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((to.getTime() - from.getTime()) / msPerDay);

  for (let d = 0; d < days; d++) {
    const date = new Date(from.getTime() + d * msPerDay);
    const isWeekend = date.getDay() === 5 || date.getDay() === 6;
    const txCount = isWeekend ? 8 : 4;

    for (let t = 0; t < txCount; t++) {
      const product = MOCK_PRODUCTS[Math.floor(Math.random() * MOCK_PRODUCTS.length)];
      const quantity = Math.ceil(Math.random() * 4);
      sales.push({
        productId: product.id,
        productName: product.name,
        quantity,
        date,
        revenue: quantity * (product.price ?? 10),
      });
    }
  }
  return sales;
}

export class MockPOSAdapter implements POSAdapter {
  readonly name = 'Mock POS';
  private connected = false;

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  async getProducts(): Promise<POSProduct[]> {
    return [...MOCK_PRODUCTS];
  }

  async getSales(from: Date, to: Date): Promise<POSSale[]> {
    return generateSales(from, to);
  }

  async connect(_credentials: Record<string, string>): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
