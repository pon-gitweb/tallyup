/**
 * Per-item classification for a reconciled stocktake cycle.
 * No Firebase imports.
 */

import { SalesFlag } from './aggregateSales';

export type ItemStatus =
  | 'tracked'
  | 'usage_only'
  | 'alarm_sold_not_counted'
  | 'sales_unit_unknown';

export interface SnapshotItemInput {
  productId?: string | null;
  name?: string | null;
  openingCount: number | null;
  actualClosing: number;
  costPrice?: number | null;
}

export interface ClassifiedItem {
  productId: string | null;
  name: string | null;
  opening: number | null;
  closing: number;
  sold: number;
  received: number;
  status: ItemStatus;
  /** Positive when opening + received > closing + sold (unexplained loss). */
  shortfall: number | null;
  /** null means no shortfall; 'sales coverage incomplete' when coverage is false. */
  shortfallReason: string | null;
  /** Constant wording key when shortfall is set. */
  shortfallKey: 'unexplained_by_recorded_sales' | null;
  /** Positive when closing > opening + received - sold (unexplained gain). */
  impliedDelivery: number | null;
  costPrice: number | null;
  shortfallDollars: number | null;
  impliedDeliveryDollars: number | null;
  /** For usage_only: opening + received - closing. */
  usage: number | null;
}

export interface ClassifyInputs {
  items: SnapshotItemInput[];
  soldByProductId: Record<string, number>;
  receivedByProductId: Record<string, number>;
  flagsByProductId: Record<string, SalesFlag[]>;
  /** posProductMappings docs — only those with mappingType 'direct_product'. */
  posProductMappings: { productId?: string | null; mappingType?: string | null }[];
  coverageComplete: boolean;
}

/**
 * Classify each snapshot item and compute variance figures.
 *
 * Status ladder:
 *   sales_unit_unknown — product has flagged sales but no valid sold units
 *   alarm_sold_not_counted — tracked, sold > 0, opening == 0 AND closing == 0
 *   tracked — direct_product mapping OR counted sale in window (sold > 0)
 *   usage_only — everything else
 *
 * Shortfall suppression: when coverageComplete is false, shortfall is set to null
 * with reason 'sales coverage incomplete'.
 */
export function classifyItems(inputs: ClassifyInputs): ClassifiedItem[] {
  const { items, soldByProductId, receivedByProductId, flagsByProductId,
          posProductMappings, coverageComplete } = inputs;

  const directMappedIds = new Set<string>(
    posProductMappings
      .filter(m => m.mappingType === 'direct_product' && m.productId)
      .map(m => m.productId as string),
  );

  return items.map(item => {
    const pid = item.productId ?? null;
    const sold = pid != null ? (soldByProductId[pid] ?? 0) : 0;
    const received = pid != null ? (receivedByProductId[pid] ?? 0) : 0;
    const hasFlags = pid != null && !!flagsByProductId[pid]?.length;
    const hasValidSold = sold > 0;

    // Status determination
    let status: ItemStatus;
    if (!hasValidSold && hasFlags) {
      status = 'sales_unit_unknown';
    } else {
      const isDirect = pid != null && directMappedIds.has(pid);
      const isTracked = isDirect || hasValidSold;
      if (isTracked) {
        if (sold > 0 && item.openingCount === 0 && item.actualClosing === 0) {
          status = 'alarm_sold_not_counted';
        } else {
          status = 'tracked';
        }
      } else {
        status = 'usage_only';
      }
    }

    const costPrice = typeof item.costPrice === 'number' ? item.costPrice : null;
    const opening = item.openingCount;
    const closing = item.actualClosing;

    let shortfall: number | null = null;
    let shortfallReason: string | null = null;
    let shortfallKey: 'unexplained_by_recorded_sales' | null = null;
    let impliedDelivery: number | null = null;
    let usage: number | null = null;

    if (status === 'tracked' || status === 'alarm_sold_not_counted') {
      if (opening != null) {
        const diff = opening + received - closing - sold; // positive = shortfall
        if (!coverageComplete) {
          shortfall = null;
          shortfallReason = 'sales coverage incomplete';
        } else if (diff > 0) {
          shortfall = diff;
          shortfallKey = 'unexplained_by_recorded_sales';
        } else if (diff < 0) {
          impliedDelivery = -diff;
        }
      }
    } else if (status === 'usage_only') {
      if (opening != null) {
        usage = opening + received - closing;
      }
    }

    const shortfallDollars = shortfall != null && costPrice != null
      ? shortfall * costPrice : null;
    const impliedDeliveryDollars = impliedDelivery != null && costPrice != null
      ? impliedDelivery * costPrice : null;

    return {
      productId: pid,
      name: item.name ?? null,
      opening,
      closing,
      sold,
      received,
      status,
      shortfall,
      shortfallReason,
      shortfallKey,
      impliedDelivery,
      costPrice,
      shortfallDollars,
      impliedDeliveryDollars,
      usage,
    };
  });
}
