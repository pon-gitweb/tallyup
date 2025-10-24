// @ts-nocheck
/**
 * Choose the cheapest supplier option.
 * Contract rates win ties with list pricing at the same price.
 */
export type SupplierPriceOpt = {
  supplierId: string;
  supplierName?: string | null;
  price: number;           // numeric, pre-tax or comparable basis
  isContract?: boolean;    // true if this is a contract price
};

export function chooseCheapest(options: SupplierPriceOpt[]): SupplierPriceOpt | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const valid = options.filter(o => Number.isFinite(o?.price));
  if (valid.length === 0) return null;

  // Sort by price asc, contract first if price equal
  valid.sort((a, b) => {
    if (a.price === b.price) {
      const ac = !!a.isContract, bc = !!b.isContract;
      return ac === bc ? 0 : (ac ? -1 : 1);
    }
    return a.price - b.price;
  });
  return valid[0];
}
