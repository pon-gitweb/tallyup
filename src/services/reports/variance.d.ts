export type LegacyItem = { id: string; name: string; departmentId?: string | null; unitCost?: number | null; par?: number | null };
export type LegacyInput = {
  items: LegacyItem[];
  lastCountsByItemId: Record<string, number>;
  receivedByItemId?: Record<string, number>;
  soldByItemId?: Record<string, number>;
  filterDepartmentId?: string | null;
};

export type LegacyRow = { itemId: string; name: string; qty: number; value: number };
export type LegacyResult = {
  scope: { venueId: string };
  shortages: LegacyRow[];
  excesses: LegacyRow[];
  totalShortageValue: number;
  totalExcessValue: number;
};

export type UIResult = {
  summary: { message: string; withinBand: boolean; bandPct: number };
  rowsMaterial: any[];
  rowsMinor: any[];
};

export declare function computeVarianceFromData(data: LegacyInput): LegacyResult;
export declare function buildVariance(venueId: string, opts?: any): Promise<UIResult>;

/** Overloads:
 *   computeVariance('venueId', opts?) -> Promise<UIResult>
 *   computeVariance({ ...data })      -> LegacyResult
 */
export declare function computeVariance(venueId: string, opts?: any): Promise<UIResult>;
export declare function computeVariance(data: LegacyInput): LegacyResult;

export declare function computeVarianceForDepartment(venueId: string, departmentId: string, opts?: any): Promise<UIResult>;

declare const _default: {
  buildVariance: typeof buildVariance;
  computeVariance: typeof computeVariance;
  computeVarianceForDepartment: typeof computeVarianceForDepartment;
  computeVarianceFromData: typeof computeVarianceFromData;
};
export default _default;
