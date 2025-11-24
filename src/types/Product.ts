// src/types/Product.ts

export type SupplierRef = {
  id: string;
  name?: string | null;
};

export type AltSupplierOption = {
  supplierId: string;
  supplierName?: string | null;
  externalSku?: string | null;
  unitCost?: number | null;       // per unit ex-GST
  packSize?: number | null;       // units per case/pack (optional)
};

export type Product = {
  id: string;

  // Core
  name: string;
  sku?: string | null;
  barcode?: string | null;

  // Display / measurement (all optional; used by recipes & ordering)
  unit?: string | null;           // 'bottle', 'keg', 'rtd', etc.
  size?: string | null;           // '700ml', '20l', etc.
  abv?: number | null;            // %
  category?: string | null;       // 'Beverage', 'Food', 'Consumable'
  subcategory?: string | null;    // 'Vodka', 'Rum', 'Mixer', etc.

  // Measurement model v2 (coexists with legacy unit/size/packSize)
  unitModel?: 'each' | 'ml' | 'l' | 'g' | 'kg' | 'portion' | null;
  /**
   * Numeric size for the unitModel, e.g.
   *  - 700 (ml) for a 700ml bottle
   *  - 20 (l) for a 20L keg
   *  - 375 (g) for a 375g pack
   */
  unitSize?: number | null;
  /**
   * Canonical label for the unit, e.g. 'ml', 'l', 'g', 'kg', 'each', 'portion'.
   * This is primarily for display and conversions in maths layers.
   */
  unitLabel?: string | null;
  /**
   * Units per outer (e.g. 24 bottles per case). Optional.
   */
  packUnits?: number | null;

  // Stock & purchasing
  par?: number | null;            // desired shelf level
  packSize?: number | null;       // units per order pack/case
  costPrice?: number | null;      // current preferred unit cost (ex-GST)

  // Supplier link (legacy and new live happily together)
  supplierId?: string | null;
  supplierName?: string | null;

  // New preference fields (optional)
  preferredSupplierId?: string | null;
  preferredSupplierName?: string | null;
  preferredPackSize?: number | null;
  preferredUnitCost?: number | null;

  // Alternative suppliers (purely advisory)
  altSuppliers?: AltSupplierOption[];

  // Operational flags
  orderable?: boolean;            // default true; false for water/ice/virtual
  trackStock?: boolean;           // default true; false for virtuals not counted
  isRecipe?: boolean;             // recipe node (not orderable)
  isBatch?: boolean;              // batch node (not orderable)
  isVirtual?: boolean;            // virtual ingredient (e.g., water)
  nonSku?: boolean;               // no supplier SKU by design

  // Misc
  active?: boolean;               // default true
  createdAt?: any;
  updatedAt?: any;
};

export default Product;
