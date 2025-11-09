export type UnitKind = 'ml' | 'l' | 'g' | 'kg' | 'each' | 'custom';

export type RecipeCategory = 'food' | 'beverage';
export type RecipeMode = 'single' | 'batch' | 'dish';

export type RecipeItem = {
  productId?: string | null;
  productName: string;           // free text fallback
  qty: number;                   // quantity in the chosen unit
  unit: UnitKind | string;       // allow custom
  // Optional pack metadata (autofill on product select)
  packSizeMl?: number | null;    // if liquid pack (ml)
  packSizeG?: number | null;     // if solid pack (g)
  packEach?: number | null;      // count per pack (if "each")
  packPrice?: number | null;     // gross price per pack
};

export type RecipeDoc = {
  name: string;
  status: 'draft'|'confirmed';
  category: RecipeCategory | null;
  mode: RecipeMode | null;
  // Yield semantics:
  // - single/dish: yield = 1, unit = 'serve'
  // - batch: yield = number of serves derived from total batch volume/weight / portion size
  yield: number | null;
  unit: string | null;           // 'serve' or custom (for batch may still be 'serve')
  items: RecipeItem[];
  // Derived money
  cogs: number | null;           // per serve cost (derived)
  rrp: number | null;            // per serve price (derived from target GP%)
  targetGpPct?: number | null;   // UI control to compute RRP
  // Batch-specific helpers (not required for single/dish)
  portionSize?: number | null;   // e.g., 150 ml per serve OR 200 g per serve
  portionUnit?: UnitKind | string | null;
  // Notes/method
  method: string | null;
  createdAt: any;
  updatedAt: any;
};
