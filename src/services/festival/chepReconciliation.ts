// @ts-nocheck

export type ChepStatus = 'balanced' | 'shortage' | 'surplus';

export interface ChepReconciliation {
  supplierId: string;
  supplierName: string;
  received: number;
  distributedToBars: number;
  returnedFromBars: number;
  damaged: number;
  missing: number;
  toReturn: number;
  accountNumber: string | null;
  status: ChepStatus;
}

export function reconcileChepPallets(
  supplierId: string,
  supplierName: string,
  received: number,
  distributedToBars: number,
  returnedFromBars: number,
  damaged: number,
  accountNumber: string | null = null,
): ChepReconciliation {
  const missing = Math.max(0, distributedToBars - returnedFromBars);
  const toReturn = Math.max(0, received - damaged - missing);

  let status: ChepStatus;
  if (missing > 0) {
    status = 'shortage';
  } else if (toReturn > received) {
    status = 'surplus';
  } else {
    status = 'balanced';
  }

  return {
    supplierId,
    supplierName,
    received,
    distributedToBars,
    returnedFromBars,
    damaged,
    missing,
    toReturn,
    accountNumber,
    status,
  };
}
