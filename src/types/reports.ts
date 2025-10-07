export type VarianceItem = {
  itemId: string;
  name?: string | null;
  departmentId?: string | null;
  unitCost?: number | null;
  par?: number | null;

  // Movement model (numbers are optional; default to 0 in compute):
  lastCount?: number | null;
  received?: number | null;
  sold?: number | null;

  // Derived:
  theoreticalOnHand: number;  // lastCount + received - sold
  deltaVsPar: number | null;  // theoreticalOnHand - par (null if par missing)
  valueImpact?: number | null; // abs(deltaVsPar) * unitCost (when both present)
};

export type VarianceResult = {
  shortages: VarianceItem[];     // deltaVsPar < 0
  excesses: VarianceItem[];      // deltaVsPar > 0
  totalShortageValue: number;    // sum of |valueImpact| where deltaVsPar < 0
  totalExcessValue: number;      // sum of valueImpact where deltaVsPar > 0
  generatedAt: number;           // epoch ms
  scope: { venueId: string; departmentId?: string | null };
  notes?: string[];
};
