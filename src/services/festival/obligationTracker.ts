import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type ObligationStatus = 'not_started' | 'on_track' | 'at_risk' | 'met' | 'missed';

export interface ObligationProgress {
  obligationId: string;
  supplierName: string;
  type: string;
  requirement: string;
  product: string | null;
  target: number | null;
  currentProgress: number;
  progressPercent: number;
  status: ObligationStatus;
  projectedAtClose: number | null;
  recommendation: string | null;
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function calculateObligationProgress(
  venueId: string,
  obligation: {
    id: string;
    supplierName: string;
    type: string;
    requirement: string;
    product: string | null;
    quantity: number | null;
    unit: string | null;
    zone: string | null;
    currentProgress?: number;
  },
  hoursRemainingInEvent: number | null,
): Promise<ObligationProgress> {
  const { id: obligationId, supplierName, type, requirement, product, quantity } = obligation;
  const target = quantity ?? null;

  try {
    if (type === 'minimum_volume' && target !== null) {
      // Sum all session usage for the product across all bars
      const sessionsSnap = await getDocs(collection(db, 'venues', venueId, 'sessions'));
      let totalUsed = 0;
      let totalVelocity = 0;
      let velocitySamples = 0;

      for (const sessDoc of sessionsSnap.docs) {
        const sess = sessDoc.data() as any;
        if (!Array.isArray(sess.counts)) continue;
        for (const countRow of sess.counts) {
          const nameMatch = !product || (countRow.productName || '').toLowerCase().includes(product.toLowerCase());
          if (!nameMatch) continue;
          const used = (countRow.openingCount ?? 0) + (countRow.receivedQty ?? 0) - (countRow.actualCount ?? 0);
          if (used > 0) {
            totalUsed += used;
            const durationMap: Record<string, number> = { morning: 4, afternoon: 4, evening: 5, full_day: 12 };
            const hrs = durationMap[sess.sessionType] ?? 4;
            totalVelocity += used / hrs;
            velocitySamples++;
          }
        }
      }

      const avgVelocity = velocitySamples > 0 ? totalVelocity / velocitySamples : 0;
      const projectedAtClose = hoursRemainingInEvent != null && avgVelocity > 0
        ? Math.round(totalUsed + avgVelocity * hoursRemainingInEvent)
        : null;

      const progressPercent = Math.min(100, Math.round((totalUsed / target) * 100));

      let status: ObligationStatus;
      let recommendation: string | null = null;

      if (totalUsed >= target) {
        status = 'met';
        recommendation = 'Obligation met.';
      } else if (projectedAtClose !== null && projectedAtClose >= target) {
        status = 'on_track';
        recommendation = `Projected to reach target (~${projectedAtClose} of ${target}).`;
      } else if (projectedAtClose !== null && projectedAtClose < target * 0.95) {
        status = 'at_risk';
        const shortfall = Math.round(target - projectedAtClose);
        recommendation = `At risk — ${shortfall} ${obligation.unit ?? 'units'} short of target. Consider featuring ${product || 'this product'} in promotional activity.`;
      } else if (totalUsed === 0) {
        status = 'not_started';
        recommendation = `No sales recorded yet for ${product || 'this product'}.`;
      } else {
        status = 'on_track';
        recommendation = null;
      }

      return {
        obligationId, supplierName, type, requirement, product: product ?? null,
        target, currentProgress: totalUsed, progressPercent,
        status, projectedAtClose, recommendation,
      };
    }

    if (type === 'exclusivity') {
      // Check if any competing products exist for this zone/category
      // Simplified: check venue products for brand conflicts
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const zone = obligation.zone?.toLowerCase() ?? '';
      const supplierLower = supplierName.toLowerCase();

      let competingFound = false;
      for (const pDoc of productsSnap.docs) {
        const p = pDoc.data() as any;
        const pSupplier = (p.supplierName || p.brand || '').toLowerCase();
        if (zone && !(p.zone || '').toLowerCase().includes(zone)) continue;
        // If product supplier differs from the obligation supplier — competing brand
        if (pSupplier && !pSupplier.includes(supplierLower) && !supplierLower.includes(pSupplier)) {
          competingFound = true;
          break;
        }
      }

      const status: ObligationStatus = competingFound ? 'missed' : 'met';
      return {
        obligationId, supplierName, type, requirement, product: product ?? null,
        target: null, currentProgress: 0, progressPercent: competingFound ? 0 : 100,
        status,
        projectedAtClose: null,
        recommendation: competingFound
          ? 'Competing brands found in venue products. Review zone exclusivity compliance.'
          : 'No competing brands found in catalogue.',
      };
    }

    if (type === 'display_requirement') {
      // Manual confirmation only
      const confirmed = obligation.currentProgress === 1;
      return {
        obligationId, supplierName, type, requirement, product: product ?? null,
        target: 1, currentProgress: confirmed ? 1 : 0,
        progressPercent: confirmed ? 100 : 0,
        status: confirmed ? 'met' : 'not_started',
        projectedAtClose: null,
        recommendation: confirmed ? null : 'Confirm when display is set up.',
      };
    }

    // Default / other — return current stored progress
    const currentProgress = obligation.currentProgress ?? 0;
    const progressPercent = target ? Math.min(100, Math.round((currentProgress / target) * 100)) : 0;
    return {
      obligationId, supplierName, type, requirement, product: product ?? null,
      target, currentProgress, progressPercent,
      status: currentProgress === 0 ? 'not_started' : 'on_track',
      projectedAtClose: null,
      recommendation: null,
    };

  } catch {
    return {
      obligationId, supplierName, type, requirement, product: product ?? null,
      target, currentProgress: 0, progressPercent: 0,
      status: 'not_started', projectedAtClose: null, recommendation: null,
    };
  }
}
